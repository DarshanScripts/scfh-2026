"""Import the reviewed harbour selections from the unmodified 938-page budget."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory

from onboarding.contracts import Document, Passage, PdfLocator
from onboarding.harbour_catalog import ANCHORS, PROJECT_ID, REVISION, SECTIONS, STAGES, TOPICS, LINKS, WINDOWS
from onboarding.rag import PROJECT, RagError

BASE = PROJECT / "harbour-corpus"
DOCUMENT_ID = "hildesheim-budget-2026-2027"


def identity(page):
    if 725 <= page <= 756:
        return ("Vorlage 25/426", "administrative_proposal", "2025-10-27", "original_proposal", "City administration")
    if page in (757, 770, 771, 772):
        return ("Kostenaufstellung Hafenausbau und Hafensanierung", "cost_estimate", "2025-10" if page == 757 else "2025-11-12", "estimate", "City administration")
    if 758 <= page <= 783:
        return ("Hafenausbau und -sanierung: Anlagen zu 25/426", "presentation", "2025-11-12" if page >= 759 else "2025-10-28",
                "projection" if 780 <= page <= 782 else "historical_analysis", "City administration")
    if 784 <= page <= 785:
        return ("Veränderungsliste zum Haushalt 2026/2027 und HIP", "investment_schedule", "2025-11-03", "original_proposal", "FB 15 / FB 66")
    if 786 <= page <= 788:
        return ("Vorlage 25/522", "political_amendment", "2025-12-12", "proposed_amendment", "Council groups")
    if 789 <= page <= 790:
        return ("Ratsbeschluss 15.12.2025 · SI/066/24 · TOP 13.2.2", "council_minutes", "2025-12-15", "approved_resolution", "Rat der Stadt Hildesheim")
    if 877 <= page <= 881:
        return ("Vorlage 25/499", "budget_proposal", None, "budget_proposal", "City administration")
    if page in (803, 916):
        return ("Änderungsliste Haushalt 2026/2027", "change_list", "2025-12-15" if page == 916 else None, "proposed_amendment", "Budget change list")
    return ("Haushaltsplan 2026/2027", "municipal_budget", None, "published_budget", "Stadt Hildesheim")


def bounds(text, first, last):
    start = text.index(first) if first else 0
    end = text.index(last, start + len(first or "")) if last else len(text)
    return start, end


def import_harbour(source: Path):
    content = source.read_bytes()
    if not content.startswith(b"%PDF-") or sha256(content).hexdigest() != REVISION:
        raise RagError("Unexpected budget revision. Review the page map and update its source hash first.")
    parsed = subprocess.run(["node", str(PROJECT / "scripts/pdf-pages.mjs"), str(source), "--layout"],
                            check=True, capture_output=True, text=True, encoding="utf-8", timeout=150)
    pages = json.loads(parsed.stdout)
    if len(pages) != 938:
        raise RagError("Expected the 938-page combined budget.")
    passages, metadata = [], {}
    documents = {}
    stage_by_topic = {topic: stage for stage, (_, _, topics) in STAGES.items() for topic in topics}

    def add(page, topic, heading, text, start, end, anchor=None):
        quote = text[start:end].strip()
        if not quote:
            return
        start += len(text[start:end]) - len(text[start:end].lstrip())
        title, document_type, date, status, authority = identity(page)
        document_id = f"{DOCUMENT_ID}-{document_type.replace('_', '-')}-{date or 'budget'}"
        document = documents.setdefault(document_id, Document(documentId=document_id, title=title, format="pdf",
            relativePath="00_haushaltsplan_2026_2027_gesamt.pdf", revision=REVISION))
        passage_id = f"{DOCUMENT_ID}-{anchor}" if anchor else f"{DOCUMENT_ID}-p{page}-s{start}"
        section = [heading]
        document_page = re.search(r"(?:Seite:\s*|Seite )\d+(?:/| von )\d+", text[:140])
        if document_page:
            section.append(document_page[0])
        passages.append(Passage(passageId=passage_id, documentId=document_id, title=document.title,
            revision=REVISION, quote=quote, sectionPath=section,
            locator=PdfLocator(format="pdf", page=page, pageLabel=str(page - 2), start=start, end=start + len(quote))))
        metadata[passage_id] = dict(document_id=document_id, document_title=title, document_type=document_type,
            document_date=date, document_version="Haushaltsplan 2026/2027 · " + REVISION[:12], project_id=PROJECT_ID,
            workflow_step_id=stage_by_topic[topic], topic=topic, subtopic=anchor or heading, heading_path=section,
            content=quote, physical_pdf_page=page, printed_page=page-2, exact_evidence_quote=quote,
            approval_status=status, source_authority=authority, related_topics=list(LINKS[topic]),
            related_passage_ids=[], document_hash=REVISION)

    for first, last, topic, heading in SECTIONS:
        for page in range(first, last + 1):
            text = pages[page-1]["text"]
            for low, high in WINDOWS.get(page, [(None, None)]):
                cursor, end = bounds(text, low, high)
                while cursor < end:
                    stop = min(end, cursor + 1050)
                    if stop < end:
                        period = text.rfind(". ", cursor + 620, stop)
                        stop = period + 1 if period >= 0 else text.rfind(" ", cursor + 620, stop)
                        if stop <= cursor:
                            stop = min(end, cursor + 1050)
                    add(page, topic, heading, text, cursor, stop)
                    cursor = stop

    for anchor, (page, topic, first, last, heading) in ANCHORS.items():
        text = pages[page-1]["text"]
        start, end = bounds(text, first, last)
        add(page, topic, heading, text, start, end, anchor)

    tables = json.loads((BASE / "tables.json").read_text(encoding="utf-8"))
    for table in tables:
        text = pages[table["page"] - 1]["text"]
        start, end = bounds(text, table["first"], table.get("last"))
        for token in table["verifiedCells"]:
            if token not in text[start:end]:
                raise RagError(f"Table {table['id']} lost a reviewed cell.")
        add(table["page"], table["topic"], table["title"], text, start, end, table["id"])
        metadata[f"{DOCUMENT_ID}-{table['id']}"]["table"] = {
            "columns": table["columns"], "rows": table["rows"],
        }

    for passage_id, item in metadata.items():
        links = [f"{DOCUMENT_ID}-{key}" for key, (_, topic, *_) in ANCHORS.items()
                 if topic in [item["topic"], *item["related_topics"]]]
        item["related_passage_ids"] = [link for link in links if link != passage_id]
    index = {"documents": [doc.model_dump(mode="json") for doc in documents.values()],
             "passages": [p.model_dump(mode="json") for p in passages]}
    generation = sha256(json.dumps([index, metadata], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    output = BASE / "downloaded"
    output.mkdir(exist_ok=True)
    destination = output / generation
    if not destination.exists():
        with TemporaryDirectory(dir=output) as temporary:
            staged = Path(temporary) / generation
            staged.mkdir()
            (staged / "sources.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
            (staged / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False), encoding="utf-8")
            (staged / "00_haushaltsplan_2026_2027_gesamt.pdf").write_bytes(content)
            staged.rename(destination)
    pointer = output / "CURRENT.tmp"
    pointer.write_text(generation + "\n", encoding="ascii")
    pointer.replace(output / "CURRENT")
    print(f"Imported {len(passages)} located passages from {len({p.locator.page for p in passages})} PDF pages · {generation}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, type=Path)
    args = parser.parse_args()
    try:
        import_harbour(args.pdf)
    except (OSError, ValueError, RagError, subprocess.SubprocessError) as error:
        parser.exit(1, f"Harbour import failed: {error}\n")
