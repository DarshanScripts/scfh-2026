"""Retrieve approved onboarding evidence and resolve registered source documents."""

from collections.abc import Iterable
from hashlib import sha256
import json
from pathlib import Path, PureWindowsPath
import re
from uuid import UUID, uuid4
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

from pydantic import TypeAdapter

from .contracts import (
    Answer,
    CitationRequest,
    CitationResult,
    CitationSource,
    CitationUnavailable,
    Claim,
    Document,
    Evidence,
    Location,
    Passage,
    Query,
    QueueSnapshot,
    Request,
    ReviewRecord,
    Step,
    StrictModel,
    Topic,
    Walkthrough,
    WalkthroughGap,
    WalkthroughResult,
    WordLocator,
    WordParagraph,
    Workflow,
)

FIXTURES = Path(__file__).with_name("fixtures")
NO_ANSWER = "I couldn’t find an answer to that in the department’s documents."
SOME_MISSING = "The department’s documents don’t cover the rest of your question."
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
CLAUSE = re.compile(r"\b(?:and|also)\s+(?=(?:where|what|which|when|who|how)\b)")
FOLLOW_UP = {
    "unassigned-escalation": {"who do i tell", "who do i notify", "who should i contact"},
    "next-deadline": {"who owns it", "who is responsible for it", "who is handling it"},
}
QUERY = TypeAdapter(Query)


def normalize_query(query: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", query.casefold()))


def includes_phrase(clause: str, phrase: str) -> bool:
    return f" {phrase} " in f" {clause} "


def validate_rows[T: StrictModel](path: Path, field: str, model: type[T]) -> list[T]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return TypeAdapter(list[model]).validate_json(json.dumps(data[field]))


def by_id[T: StrictModel](items: list[T], key: str) -> dict[str, T]:
    index = {getattr(item, key): item for item in items}
    if len(index) != len(items):
        raise ValueError(f"Duplicate {key} in fixture")
    return index


def project_word(path: Path) -> list[WordParagraph]:
    """Read the main document body of the bundled Word fixture in source order."""
    with ZipFile(path) as archive:
        entry = archive.getinfo("word/document.xml")
        if entry.file_size > 1_000_000:
            raise ValueError("Word fixture body exceeds the preview limit")
        document = ElementTree.fromstring(archive.read(entry))
    result = []
    headings: list[tuple[int, str]] = []
    ordinal = 0
    for paragraph in document.findall(f"{WORD_NS}body/{WORD_NS}p"):
        style = paragraph.find(f"{WORD_NS}pPr/{WORD_NS}pStyle")
        style_name = style.get(f"{WORD_NS}val", "") if style is not None else ""
        text = "".join(node.text or "" for node in paragraph.iter(f"{WORD_NS}t"))
        heading = re.fullmatch(r"Heading([1-6])", style_name)
        level = int(heading[1]) if heading and text.strip() else 0
        if level:
            headings = [(depth, title) for depth, title in headings if depth < level]
            headings.append((level, text))
            ordinal = 0
        else:
            ordinal += 1
        result.append(WordParagraph(
            text=text,
            headingPath=[title for _, title in headings],
            headingLevel=level,
            ordinal=None if level else ordinal,
        ))
    return result


class FixtureKnowledge:
    """In-memory corpus with strict inputs. Desktop and speech stay in the host."""

    def __init__(self, fixture_root: Path = FIXTURES):
        self._root = fixture_root.resolve()
        sources = self._root / "sources.json"
        knowledge = self._root / "knowledge.json"
        self._documents = by_id(validate_rows(sources, "documents", Document), "documentId")
        self._passages = by_id(validate_rows(sources, "passages", Passage), "passageId")
        self._claims = by_id(validate_rows(knowledge, "claims", Claim), "claimId")
        self.locations = validate_rows(knowledge, "locations", Location)
        self.reviews = validate_rows(knowledge, "reviews", ReviewRecord)
        self.queue = QueueSnapshot.model_validate_json((self._root / "queue.json").read_bytes())
        self._topics = validate_rows(knowledge, "topics", Topic)
        self._workflow = Workflow.model_validate(
            json.loads(knowledge.read_text(encoding="utf-8"))["workflow"]
        )
        self._check_corpus()

    def _check_corpus(self) -> None:
        for passage in self._passages.values():
            document = self._documents[passage.documentId]
            if (passage.title, passage.revision, passage.locator.format) != (
                document.title, document.revision, document.format
            ):
                raise ValueError(f"Document metadata differs for {passage.passageId}")
            if isinstance(passage.locator, WordLocator) and passage.sectionPath != passage.locator.headingPath:
                raise ValueError(f"Heading differs for {passage.passageId}")

        reviews = by_id(self.reviews, "recordId")
        topics = by_id(self._topics, "topicId")
        allowed = set(self._passages)
        turns = set(re.findall(
            r"^### ([a-z0-9-]+)$",
            (self._root / "handover.md").read_text(encoding="utf-8"),
            re.MULTILINE,
        ))
        meeting_file = self._root / "operations-meeting.md"
        meeting_turns = set(re.findall(
            r"^### ([a-z0-9-]+)$",
            meeting_file.read_text(encoding="utf-8") if meeting_file.exists() else "",
            re.MULTILINE,
        ))
        for review in reviews.values():
            if (not set(review.passageIds) <= allowed
                    or not set(review.interviewTurnIds) <= turns
                    or not set(review.meetingTurnIds) <= meeting_turns):
                raise ValueError(f"Unknown provenance for {review.recordId}")
            if review.canonicalRecordId or review.disposition == "duplicate":
                canonical = reviews.get(review.canonicalRecordId)
                if canonical is None or canonical.disposition != "approved" or canonical.topicId != review.topicId:
                    raise ValueError(f"Invalid canonical review for {review.recordId}")
                if review.disposition == "duplicate" and not set(review.passageIds) <= set(canonical.passageIds):
                    raise ValueError(f"Canonical review lost a source for {review.recordId}")

        for claim in self._claims.values():
            review = reviews.get(claim.claimId)
            if review is None or review.disposition != "approved" or not set(claim.passageIds) <= set(review.passageIds):
                raise ValueError(f"Claim has no matching approval: {claim.claimId}")
        for topic in topics.values():
            if any(ref not in self._claims or reviews[ref].topicId != topic.topicId for ref in topic.claimIds):
                raise ValueError(f"Invalid approved claim for {topic.topicId}")
        for step in self._workflow.steps:
            if not set(step.passageIds) <= allowed:
                raise ValueError(f"Unknown workflow evidence for {step.stepId}")

    def _citations(self, groups: Iterable[Claim | Step]) -> list[Passage]:
        refs = dict.fromkeys(ref for group in groups for ref in group.passageIds)
        return [self._passages[ref].model_copy(deep=True) for ref in refs]

    def retrieve(self, query: str) -> Evidence:
        text = QUERY.validate_python(query, strict=True)
        wanted: dict[str, None] = {}
        uncovered = []
        previous_topics: list[str] = []
        for clause in CLAUSE.split(normalize_query(text)):
            matches = [
                topic for topic in self._topics
                if all(any(includes_phrase(clause, cue) for cue in group) for group in topic.cues)
            ]
            if not matches and any(clause in FOLLOW_UP.get(topic, ()) for topic in previous_topics):
                continue
            if not matches:
                uncovered.append(clause or "question")
            for topic in matches:
                wanted.update(dict.fromkeys(topic.claimIds))
            previous_topics = [topic.topicId for topic in matches]
        claims = [self._claims[ref].model_copy(deep=True) for ref in wanted]
        return Evidence(claims=claims, passages=self._citations(claims), uncovered=uncovered)

    def answer_onboarding_question(
        self, query: str, *, request_id: UUID | None = None, turn_id: UUID | None = None
    ) -> Answer:
        request = Request(query=query, requestId=request_id or uuid4(), turnId=turn_id or uuid4())
        evidence = self.retrieve(request.query)
        if not evidence.claims:
            outcome = "insufficient"
            text = NO_ANSWER
        else:
            outcome = "partial" if evidence.uncovered else "answered"
            text = " ".join(claim.text for claim in evidence.claims)
            if evidence.uncovered:
                text += " " + SOME_MISSING
        return Answer(
            requestId=request.requestId, turnId=request.turnId, outcome=outcome,
            text=text, claims=evidence.claims, citations=evidence.passages,
        )

    def get_onboarding_walkthrough(
        self, query: str, *, request_id: UUID | None = None, turn_id: UUID | None = None
    ) -> WalkthroughResult:
        request = Request(query=query, requestId=request_id or uuid4(), turnId=turn_id or uuid4())
        ids = {"requestId": request.requestId, "turnId": request.turnId}
        normalized = normalize_query(request.query)
        if not any(includes_phrase(normalized, cue) for cue in (
            "intake", "maintenance request", "maintenance ticket", "maintenance report", "log a ticket"
        )):
            return WalkthroughGap(**ids, text="I couldn’t find a documented walkthrough for that request.")
        workflow = self._workflow.model_copy(deep=True)
        return Walkthrough(**ids, **workflow.model_dump(), citations=self._citations(workflow.steps))

    def document_path(self, document_id: str) -> Path:
        document = self._documents[document_id]
        relative = Path(document.relativePath)
        windows = PureWindowsPath(document.relativePath)
        if relative.is_absolute() or windows.anchor or ".." in relative.parts or ".." in windows.parts:
            raise ValueError("Source paths must stay inside the fixture root")
        path = (self._root / relative).resolve()
        if not path.is_relative_to(self._root) or path.suffix.lower() != f".{document.format}":
            raise ValueError("Source path is outside the approved fixture format or root")
        return path

    def open_citation(
        self, request: CitationRequest, result: Answer | Walkthrough, *, source_prefix: str = "/sources/"
    ) -> CitationResult:
        if request.requestId != result.requestId:
            return CitationUnavailable()
        selected = next((p for p in result.citations if p.passageId == request.passageId), None)
        canonical = self._passages.get(request.passageId)
        if selected is None or canonical is None or selected.documentId != canonical.documentId:
            return CitationUnavailable()
        try:
            path = self.document_path(canonical.documentId)
            revision = sha256(path.read_bytes()).hexdigest()
            paragraphs = project_word(path) if canonical.locator.format == "docx" else None
        except (OSError, KeyError, ValueError, BadZipFile, ElementTree.ParseError):
            return CitationUnavailable()
        exact = selected == canonical and revision == canonical.revision
        if exact and isinstance(canonical.locator, WordLocator):
            locator = canonical.locator
            target = next((
                paragraph for paragraph in (paragraphs or [])
                if paragraph.headingPath == locator.headingPath and paragraph.ordinal == locator.paragraphOrdinal
            ), None)
            text = " ".join(target.text.split()) if target else ""
            exact = text[locator.start:locator.end] == " ".join(canonical.quote.split())
        return CitationSource(
            status="exact" if exact else "location_only",
            passage=canonical.model_copy(deep=True),
            sourceUrl=source_prefix + canonical.documentId + "?revision=" + revision,
            paragraphs=paragraphs,
        )
