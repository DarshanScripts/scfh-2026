"""Hildesheim Harbour policy and linked retrieval for Relay's existing Qdrant backend."""

from collections import defaultdict
from typing import Literal
import json
import re
from uuid import uuid4

from pydantic import Field
from rank_bm25 import BM25Okapi
from qdrant_client import models

from .contracts import Edge, Step, StrictModel, Text, Walkthrough, WalkthroughGap
from .harbour_catalog import LINKS, PROJECT_ID, STAGES, TOPICS
from .rag import (PROJECT, QUERY, DraftAnswer, DraftClaim, QdrantKnowledge, RagError, Router, Support, index_public, tokens)

BASE = PROJECT / "harbour-corpus"
CORPUS = BASE / "downloaded"
STATE = BASE / "qdrant-state.json"
PUBLISHED_STATE = BASE / "collection.json"
STOP = set("the a an to are is can why how in of for did what was stage step and with it i on "
           "which why does work der die das dem den des und ist im mit wie warum wer was hat auf "
           "fur kann konnen wurde stufe schritt".split())
STAGE_ALIASES = {
    "infrastructure-assessment": ("infrastructure assessment", "condition assessment", "infrastrukturzustand", "bestandsaufnahme"),
    "strategic-alternatives": ("strategic alternatives", "alternative options", "variantenvergleich", "variantenprufung"),
    "financial-feasibility": ("funding", "financial feasibility", "financing", "forderung", "fordermittel", "finanzierung"),
    "external-coordination": ("external coordination", "wsv", "abstimmung"),
    "political-approval": ("political approval", "budget allocation", "ratsbeschluss", "haushaltsfreigabe"),
    "execution-monitoring": ("execution", "monitoring", "reporting", "bauausfuhrung", "projektbericht", "berichterstattung"),
}
WALKTHROUGH_ANCHORS = (
    ("p727-s0", "east-wall-assessment"), ("p754-s0", "adopted-option"), ("kv-eligibility", "sgffg-eligibility", "estimate-total"),
    ("adopted-wsv",), ("adopted-priorities", "adopted-west-planning"), ("adopted-reporting",),
)
FOLLOW_UP = re.compile(r"\b(it|that|they|there|this|those|city|directly|apply|sie|dort|dafur|stadt|direkt)\b")
DISAMBIGUATE = {
    "funding-eligibility": set("apply directly eligibility eligible applicant antrag antragsberechtigt antragsmoglichkeiten sgffg".split()),
    "reporting-monitoring": set("report reporting sommerpause projektbericht abweichung deviation".split()),
    "budget-allocations": set("appropriation commitment verpflichtungsermachtigung planungsmittel".split()),
}
AUTHORITY = {"approved_resolution": 1.0, "published_budget": 0.55}


def terms(text):
    return [word for word in tokens(text) if word not in STOP]


def stage_for(query):
    normalized = " " + " ".join(tokens(query)) + " "
    matches = [stage for stage, aliases in STAGE_ALIASES.items()
               if any(" " + alias + " " in normalized for alias in aliases)]
    return matches[0] if len(matches) == 1 else None


def topic_order(query):
    q = set(terms(query))
    return sorted(TOPICS, key=lambda topic: -(
        len(q & set(terms(TOPICS[topic]))) + 4 * len(q & DISAMBIGUATE.get(topic, set()))
    ))


def read_metadata(generation):
    try:
        return json.loads((CORPUS / generation / "metadata.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise RagError("The Harbour corpus metadata is missing. Import the original budget.") from None


def index_harbour(settings):
    generation = (CORPUS / "CURRENT").read_text(encoding="ascii").strip()
    return index_public(settings, corpus=CORPUS, state_path=STATE, prefix="relay-hildesheim-harbour",
                        metadata=read_metadata(generation))


class SelectedClaim(StrictModel):
    text: Text
    evidenceRefs: list[Text] = Field(min_length=1, max_length=4)


class SelectedAnswer(StrictModel):
    outcome: Literal["answered", "partial", "insufficient"]
    claims: list[SelectedClaim] = Field(max_length=7)
    gap: str = ""


def exact_spans(quote):
    # Select whole sentences where possible, without dividing German decimal numbers.
    cuts = [0]
    for boundary in re.finditer(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ–])", quote):
        if boundary.start() - cuts[-1] >= 75:
            cuts.append(boundary.end())
    cuts.append(len(quote))
    return [span for start, end in zip(cuts, cuts[1:]) if (span := quote[start:end].strip())
            and quote.count(span) == 1]


class HarbourRouter(Router):
    source_policy = (
        "These are records for Stadt Hildesheim's harbour project. "
        "For adopted decisions, prioritize the 15 December 2025 council resolution over the administration proposal "
        "and the proposed amendment. For numeric budget allocations use the published investment plan. "
        "Distinguish cash appropriations, later plan values and commitment authorizations; never add them together. "
        "Preserve dates and differentiate estimates, projected receipts, historical conditions and unresolved topics "
        "from approved decisions. Funding availability is time-bound to when the source was written, and eligibility "
        "is programme-specific. Use the language of the current question even if the source or previous question is in another language. "
        "Table annotations preserve original column associations. Use original evidence spans for citations. "
        "Treat a referenced Vorlage as a cross-reference unless that document itself is supplied. "
    )


    def generate(self, query, passages, contract, instructions, verify=None, *, annotations=None):
        if contract is not DraftAnswer:
            return super().generate(query, passages, contract, instructions, verify, annotations=annotations)

        lookup = {}
        metadata = {}
        for p_index, passage in enumerate(passages):
            record = dict((annotations or {}).get(passage.passageId, {}))
            spans = {}
            for s_index, quote in enumerate(exact_spans(passage.quote) or [passage.quote]):
                ref = f"e{p_index}-{s_index}"
                lookup[ref] = Support(passageId=passage.passageId, quote=quote)
                spans[ref] = quote
            record["exactEvidenceSpans"] = spans
            metadata[passage.passageId] = record

        def to_draft(selected):
            try:
                draft = DraftAnswer(outcome=selected.outcome, gap=selected.gap, claims=[
                    DraftClaim(text=claim.text, evidence=[lookup[key] for key in dict.fromkeys(claim.evidenceRefs)])
                    for claim in selected.claims
                ])
            except KeyError:
                raise RagError("The answer referenced an unknown evidence span.") from None
            if verify:
                verify(draft)
            return draft

        # Supply the canonical note and exact spans once, rather than duplicate each quote in the prompt.
        selected = super().generate(query, [], SelectedAnswer, instructions, verify=to_draft,
                                    annotations=metadata)
        return to_draft(selected)


class HarbourKnowledge(QdrantKnowledge):
    support_instructions = (
        "For each claim return evidenceRefs containing only IDs from exactEvidenceSpans. "
        "Choose the smallest spans that directly support the claim. "
        "When the evidence is insufficient return claims [] and a gap. "
    )
    corpus = CORPUS
    router_type = HarbourRouter

    def __init__(self, settings=None):
        self.state_path = STATE if STATE.is_file() else PUBLISHED_STATE
        super().__init__(settings)
        self.metadata = read_metadata(self.state.generation)
        if set(self.metadata) != self.passages.keys():
            self.close()
            raise RagError("Harbour passage metadata differs from the source register.")
        self.positions = {p.passageId: i for i, p in enumerate(self.ordered)}
        self.lexical = BM25Okapi([
            terms(p.quote) + terms(" ".join([self.metadata[p.passageId]["subtopic"],
                                            TOPICS[self.metadata[p.passageId]["topic"]]]))
            for p in self.ordered
        ])
        self.by_topic = defaultdict(list)
        self.by_stage = defaultdict(list)
        for p in self.ordered:
            data = self.metadata[p.passageId]
            self.by_topic[data["topic"]].append(p.passageId)
            self.by_stage[data["workflow_step_id"]].append(p.passageId)

    @staticmethod
    def focus(query, context):
        stage = stage_for(query)
        normalized = " ".join(tokens(query))
        stage_question = bool(stage and (
            len(terms(query)) <= 3
            or re.search(r"\b(stage|phase|walk|explain|schritt|phase|erklare)\b", normalized)
        ))
        if stage_question:
            return stage, list(STAGES[stage][2])[:2]
        q = set(terms(query))
        ordered = topic_order(query)
        direct = [topic for topic in ordered if q & set(terms(TOPICS[topic]))]
        follow_up = bool(context and context.workflowStepId in STAGES and not stage and (
            FOLLOW_UP.search(normalized) or len(q) <= 2 or not direct))
        if follow_up:
            stage = context.workflowStepId
            allowed = STAGES[stage][2]
            local = [topic for topic in direct if topic in allowed]
            # Follow the recorded funding context unless the wording names a different topic explicitly.
            if not local and any(q & DISAMBIGUATE.get(topic, set()) for topic in direct):
                return None, direct[:2]
            return stage, (local or list(allowed))[:2]
        if not stage and context and context.previousQuery and FOLLOW_UP.search(normalized):
            prior = topic_order(context.previousQuery)
            if not direct or (q <= {"city", "stadt", "apply", "directly", "direkt"}):
                return None, prior[:2]
        return stage, direct[:2]

    def related(self, focus, hops):
        expanded = dict.fromkeys(focus)
        frontier = list(focus)
        for _ in range(hops):
            frontier = list(dict.fromkeys(link for topic in frontier for link in LINKS[topic] if link not in expanded))
            expanded.update(dict.fromkeys(frontier))
        return list(expanded)

    def retrieve(self, query, limit=14, *, context=None, broaden=False):
        query = QUERY.validate_python(query, strict=True)
        stage, focus = self.focus(query, context)
        related = self.related(focus, 2 if broaden else 1)
        original = terms(query)
        expansion = [*original]
        if context and context.previousQuery and (stage or FOLLOW_UP.search(" ".join(tokens(query)))):
            expansion.extend(terms(context.previousQuery))
        for topic in (related if broaden else focus):
            expansion.extend(terms(TOPICS[topic]))
        queries = [" ".join(dict.fromkeys(expansion)) or query]
        if broaden and queries[0] != query:
            queries.append(query)
        vectors = self.router.embed(queries, "search_query")
        project_filter = models.FieldCondition(key="project_id", match=models.MatchValue(value=PROJECT_ID))
        dense = [self.dense_ids(vector, [project_filter]) for vector in vectors]
        if stage:
            step_filter = models.FieldCondition(key="workflow_step_id", match=models.MatchValue(value=stage))
            dense.append(self.dense_ids(vectors[0], [project_filter, step_filter]))

        lexical = self.lexical.get_scores(original)
        expanded_scores = self.lexical.get_scores(expansion)
        ranks = defaultdict(float)
        for ids in [*dense, *[
            [self.ordered[i].passageId for i in sorted(range(len(scores)), key=lambda i: -scores[i])[:32] if scores[i] > 0]
            for scores in (lexical, expanded_scores)
        ]]:
            for rank, key in enumerate(ids, 1):
                ranks[key] += 1 / (60 + rank)
        for topic in related:
            for key in self.by_topic[topic]:
                ranks[key] += 0.010 if topic in focus else 0.003

        def rerank(key):
            data = self.metadata[key]
            return (ranks[key] + 0.007 * AUTHORITY.get(data["approval_status"], 0)
                    + (0.008 if stage == data["workflow_step_id"] else 0)
                    + (0.004 if "-p" not in key.removeprefix("hildesheim-budget-2026-2027") else 0))

        selected = {}
        for topic in related[:8 if broaden else 5]:
            candidates = sorted(self.by_topic[topic], key=rerank, reverse=True)
            quota = 3 if topic in focus else 1
            for key in candidates[:quota]:
                selected[key] = None
        # Traverse reviewed passage links as well as topic links, preferring question-relevant nodes.
        linked = {ref for key in selected for ref in self.metadata[key]["related_passage_ids"]}
        for key in sorted(sorted(linked), key=rerank, reverse=True)[:5 if broaden else 2]:
            selected[key] = None
        for key in sorted(ranks, key=rerank, reverse=True):
            if len(selected) >= limit:
                break
            selected[key] = None
        return [self.passages[key] for key in list(selected)[:limit]]

    def evidence_annotations(self, evidence):
        return {p.passageId: {k: data[k] for k in ("topic", "subtopic", "approval_status", "source_authority", "document_date", "table") if k in data}
                for p in evidence if (data := self.metadata[p.passageId])}

    def answer_onboarding_question(self, query, *, request_id=None, turn_id=None, context=None):
        stage, focus = self.focus(query, context)
        request_id, turn_id = request_id or uuid4(), turn_id or uuid4()
        extra = (
            "For a voice reply use about 70 to 110 words when possible. Answer the exact question, "
            "and add a gap only for an unanswered part the user actually asked about. "
            "Cite every distinct claim and frame past funding constraints explicitly as findings at the source date. "
        )
        if stage:
            extra += f"The active or requested workflow stage is {STAGES[stage][0]}. "
        if focus:
            extra += "Relevant research topics: " + ", ".join(focus) + ". "
        if context and context.previousQuery:
            extra += "Previous question is supplied for reference resolution only. "
        model_query = query
        # Keep user text and history as data, never interpolate it into the system instruction.
        if context and context.previousQuery:
            model_query = json.dumps({"question": query, "previousQuestion": context.previousQuery}, ensure_ascii=False)
        evidence = self.retrieve(query, context=context)
        answer = self.compose_answer(model_query, evidence, request_id, turn_id, self.evidence_annotations(evidence), extra)
        if answer.outcome != "answered":
            expanded = self.retrieve(query, limit=22, context=context, broaden=True)
            by_id = {p.passageId: p for p in [*expanded, *evidence]}
            if set(by_id) != {p.passageId for p in evidence}:
                retry_evidence = list(by_id.values())[:25]
                retry = self.compose_answer(model_query, retry_evidence, request_id, turn_id,
                                            self.evidence_annotations(retry_evidence), extra)
                if retry.outcome == "answered" or len(retry.claims) > len(answer.claims):
                    return retry
        return answer

    def stage_evidence(self, stage):
        """All directly tagged evidence and the supporting links for one canonical stage."""
        keys = self.by_stage[stage]
        related = {ref for key in keys for ref in self.metadata[key]["related_passage_ids"]}
        return [self.passages[key] for key in dict.fromkeys([*keys, *sorted(related)])]

    def get_onboarding_walkthrough(self, query, *, request_id=None, turn_id=None, context=None):
        QUERY.validate_python(query, strict=True)
        ids = {"requestId": request_id or uuid4(), "turnId": turn_id or uuid4()}
        stage = stage_for(query)
        workflow_terms = set(terms(query))
        if not stage and not workflow_terms & {"harbour", "harbor", "hafen", "hafenausbau", "hildesheim", "workflow",
                                               "project", "projekt", "walkthrough", "ablauf", "gesamtmassnahme", "stages"}:
            return WalkthroughGap(**ids, text="The Harbour sources cover the six stages of harbour expansion and renovation. I could not identify a documented walkthrough for that request.")
        if stage == "financial-feasibility":
            return self.funding_walkthrough(ids)
        stages = list(STAGES)
        chosen = [stage] if stage else stages
        steps, citations = [], []
        for index, key in enumerate(chosen):
            title, narration, _ = STAGES[key]
            anchors = WALKTHROUGH_ANCHORS[stages.index(key)]
            passage_ids = [f"hildesheim-budget-2026-2027-{anchor}" for anchor in anchors]
            steps.append(Step(stepId=key, kind="action", label=title, narration=narration,
                              passageIds=passage_ids, edges=[Edge(label="", toStepId=chosen[index+1])] if index+1 < len(chosen) else []))
            citations.extend(self.passages[ref] for ref in passage_ids)
        return Walkthrough(**ids, workflowId=PROJECT_ID,
                           title=STAGES[stage][0] if stage else "Hildesheim Harbour Expansion and Renovation",
                           steps=steps, citations=citations)


    def funding_walkthrough(self, ids):
        """The funding stage expanded into a short comparison for the live demo."""
        definitions = [
            ("funding-applicant", "decision", "Which programme fits?",
             "Start with the measure. The proposal identifies separate grant routes for combined transport and railway renewal.",
             ["kv-eligibility", "sgffg-eligibility"], [("Combined transport", "funding-kv"), ("Railway renewal", "funding-rail")]),
            ("funding-kv", "action", "Combined transport",
             "For the federal combined transport grant, the proposal identifies H B G as a possible applicant. The programme had no funds at the time.",
             ["kv-eligibility"], [("Compare other funding", "funding-next")]),
            ("funding-rail", "action", "Railway renewal",
             "For the railway grant, the operator must apply. The proposal says H B G could not demonstrate the required own contribution.",
             ["sgffg-eligibility"], [("Compare other funding", "funding-next")]),
            ("funding-next", "handoff", "Check funds and follow up",
             "The E F R E option also had funds already committed. The council directed the city to intensify the search for grants.",
             ["efre-availability", "adopted-west-planning"], []),
        ]
        steps = []
        for key, kind, label, narration, anchors, edges in definitions:
            steps.append(Step(stepId=key, kind=kind, label=label, narration=narration,
                              passageIds=[f"hildesheim-budget-2026-2027-{anchor}" for anchor in anchors],
                              edges=[Edge(label=label, toStepId=to) for label, to in edges]))
        sources = dict.fromkeys(ref for step in steps for ref in step.passageIds)
        return Walkthrough(**ids, workflowId="hildesheim-harbour-funding", title="How harbour funding is assessed",
                           steps=steps, citations=[self.passages[key] for key in sources])
