"""Regenerate the sample originals and revisioned citation locators."""

import argparse
from datetime import datetime
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import subprocess
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

from docx import Document
from docx.oxml.ns import qn
from docx.shared import RGBColor
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen.canvas import Canvas

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT / "src" / "onboarding" / "fixtures"
PDF_TITLE = "Maintenance Intake Guide"
WORD_TITLE = "Shift Handoff Guide"
REMINDER = "Send the ticket ID and latest status to the Desk Lead."

INTAKE = "Collect the building and room or location, an issue summary, and a callback channel."
MISSING = "If a required detail is missing, ask the reporter for it and pause intake."
DUPLICATE = (
    "Search open tickets by building and room first, then compare the issue summaries."
)
EXISTING = "If the same issue already has an open ticket, link the report to that ticket and stop."
NEW = "If there is no matching ticket, log a new routine maintenance ticket."
HANDOFF = "Assign the new ticket to the Maintenance Queue."
CALLBACK = "The guide gives no vendor callback deadline. Confirm the timing with the Desk Lead."
TRIGGER = "If a routine ticket is still unassigned at the end of the next business day after logging, follow up."
FOLDER = "The Maintenance Intake Guide is in the Facilities onboarding folder."
BACKUP = "The Duty Intake Coordinator covers intake when the regular coordinator is away."

PDF_SECTIONS = [
    [
        ("About this guide", "Use this guide to log and route routine maintenance requests."),
        ("Document control", "FM-INT-02 | Version 2.1 | Effective 2 November 2026. Owner: Facilities Desk Lead. Next review: February 2027. Fictional Stadt Lindenhafen, Central Building Services."),
        ("When to use it", "The desk takes routine building reports from the Town Hall annex, Library annex and Community centre. Reports arrive through the shared mailbox, telephone or facilities portal. Record the original channel and the time received so the next shift can reconstruct the conversation."),
        ("Service boundary", "This procedure covers routine intake and shift handoff. If the reporter describes an immediate danger, pause routine intake and use the site's emergency instructions. The desk does not approve spending or promise a contractor attendance time."),
        ("Change from version 1.4", "Since 2 November, new routine work goes to the Maintenance Queue. The previous building-supervisor email route is retained only in archived handover notes. The queue coordinator assigns the delivery team."),
    ],
    [
        ("Intake checklist", INTAKE + " Use the building register name and a floor or room reference. A summary such as 'light broken' needs a location before anyone can investigate. Ask permission to keep a staff work contact for follow-up."),
        ("Missing details", MISSING + " Keep the original received time. Leave a note recording what was requested and who is waiting for the reply."),
        ("Duplicate check", "Practice tip recorded with retiring Intake Coordinator Mara Voss on 16 November and approved by Desk Lead Jonas Weber on 20 November. " + DUPLICATE + " 'Dark corridor' and 'lamp flickers' can describe the same fault. A shared room alone does not prove a duplicate."),
        ("Existing ticket", EXISTING),
    ],
    [
        ("New ticket", NEW + " Keep the reporter's wording in the intake note, then write a concise issue summary. Attach the original message or a link to the shared mailbox item. Check the building and callback channel before saving."),
        ("Queue handoff", HANDOFF + " Record the queue assignment in the ticket. The queue coordinator decides the delivery team. A message sent to an individual colleague does not confirm that the shared queue has accepted the work."),
        ("Vendor callback", CALLBACK),
        ("Close the desk handoff", "The desk's next action is complete once the report is linked or a new ticket is saved and routed. Physical repair completion is recorded separately by the delivery team. Use the Shift Handoff Guide for unassigned work and the dated queue for outstanding actions."),
    ],
]


def write_pdf(path: Path) -> None:
    pdf = Canvas(str(path), pagesize=(595, 842), invariant=1)
    pdf.setTitle(PDF_TITLE)
    pdf.setAuthor("Municipal Facilities Service Desk")
    for page_number, sections in enumerate(PDF_SECTIONS, 1):
        pdf.setFillColor(HexColor("#183246"))
        pdf.setFont("Helvetica-Bold", 22)
        pdf.drawString(52, 779, PDF_TITLE)
        pdf.setFont("Helvetica", 11)
        pdf.drawString(52, 755, "Municipal Facilities Service Desk")
        pdf.setStrokeColor(HexColor("#A5B6C0"))
        pdf.line(52, 732, 543, 732)
        y = 702
        for heading, paragraph in sections:
            pdf.setFont("Helvetica-Bold", 14)
            pdf.drawString(52, y, heading)
            pdf.setFont("Helvetica", 12)
            y -= 23
            for line in simpleSplit(paragraph, "Helvetica", 12, 478):
                pdf.drawString(52, y, line)
                y -= 18
            y -= 22
        if y < 75:
            raise ValueError(f"PDF page {page_number} overflows the printable area")
        pdf.drawRightString(543, 45, str(page_number))
        pdf.showPage()
    pdf.save()


def queue_paragraph(item: dict) -> str:
    deadline = item["deadline"]
    when = ""
    if deadline:
        date, clock = deadline[:10], deadline[11:16]
        when = f" Due {date} at {clock} Berlin time."
    return (
        f"{item['ticketId']}. {item['summary']}. Status {item['status']}. "
        f"Priority {item['priority']}. Owner {item['ownerRole']}.{when} "
        f"Next action. {item['nextAction'].rstrip('.')}."
        + (f" Waiting on {item['waitingOn']}." if item.get("waitingOn") else "")
        + (" Notes. " + " ".join(item["notes"]) if item.get("notes") else "")
    )


def write_word(path: Path) -> dict[str, list[str]]:
    queue = json.loads((ROOT / "queue.json").read_text(encoding="utf-8"))
    sections = {
        "Shift handoff": [
            "Friday 20 November 2026, 15:30 handoff. Prepared by outgoing Shift Coordinator Selin Kaya for incoming coordinator Alex Neumann. Approved by Desk Lead Jonas Weber. Give the incoming shift a dated list of open items, with an owner and a next action.",
            REMINDER,
            BACKUP,
        ],
        "Unassigned tickets": [TRIGGER, REMINDER],
        "Current queue": [
            f"Queue snapshot as of {queue['asOf']}. The following entries include completed and planned work.",
            *[queue_paragraph(item) for item in queue["items"]],
        ],
        "Tools and locations": [
            FOLDER + r" Demo mapping: S:\Zentrale_Dienste\Gebaeude\Onboarding\Aktuell. Use FM-INT-02 v2.1, effective 2 November, for current routing.",
            r"Store handoff notes in the Shift Handoffs folder. Demo mapping: S:\Zentrale_Dienste\Gebaeude\Schichtuebergaben\2026\11. Keep the date and ticket ID in the filename.",
            "The facilities portal is https://facilities.lindenhafen.example/tickets. The .example address and drive paths are fictional demo destinations. The Windows host maps location identifiers to its own safe local folder and browser target.",
        ],
        "Access and working copies": [
            "Ask the service desk for membership in FM-Desk-Read and ask the Desk Lead to approve the request. Until access is granted, use the read-only onboarding copy and ask the Duty Intake Coordinator to attach new notes to the queue.",
            "Archive version 1.4 under Onboarding/Archiv. Its direct building-supervisor routing instruction expired on 2 November. Do not edit the only current shared copy while someone else is handing over a shift.",
        ],
        "Monday access booking": [
            "FM-104 is waiting for the Library site contact to confirm a staffed access window for service room B-012. The Desk Lead must confirm the slot by Monday 23 November at noon. The repair visit is not booked until that confirmation is recorded.",
            "The key is held by the Library caretaker, not the external contractor. On 20 November the caretaker had offered 07:30-08:30 subject to staffing. The next coordinator should check the portal note before calling again.",
        ],
    }
    document = Document()
    document.core_properties.title = WORD_TITLE
    document.core_properties.author = "Municipal Facilities Service Desk"
    document.core_properties.created = datetime(2026, 11, 20)
    document.core_properties.modified = datetime(2026, 11, 20)
    for style_name in ("Title", "Heading 1"):
        style = document.styles[style_name]
        style.font.color.rgb = RGBColor(0, 0, 0)
        for border in style.element.iter(qn("w:pBdr")):
            border.getparent().remove(border)
    document.add_paragraph(WORD_TITLE, "Title")
    document.add_paragraph(
        "Use this guide to hand over open maintenance tickets and find current onboarding materials."
    )
    for heading, paragraphs in sections.items():
        document.add_heading(heading, level=1)
        for paragraph in paragraphs:
            document.add_paragraph(paragraph)
    buffer = BytesIO()
    document.save(buffer)
    with ZipFile(buffer) as original, ZipFile(path, "w", ZIP_DEFLATED) as stable:
        for name in original.namelist():
            stable.writestr(ZipInfo(name), original.read(name), compress_type=ZIP_DEFLATED)
    return sections


def write_manifest(pdfjs_module: str | None) -> None:
    pdf = ROOT / "maintenance-intake-guide.pdf"
    word = ROOT / "shift-handoff-guide.docx"
    write_pdf(pdf)
    sections = write_word(word)
    command = ["node", str(PROJECT / "scripts" / "pdf-pages.mjs"), str(pdf)]
    if pdfjs_module:
        command.append(pdfjs_module)
    pages = json.loads(subprocess.check_output(command, text=True))

    documents = [
        {
            "documentId": path.stem,
            "title": title,
            "format": path.suffix[1:],
            "revision": sha256(path.read_bytes()).hexdigest(),
            "relativePath": path.name,
        }
        for path, title in ((pdf, PDF_TITLE), (word, WORD_TITLE))
    ]
    passages = []

    def add(document, passage_id, heading, quote, text, locator):
        if text.count(quote) != 1:
            raise ValueError(f"Missing or ambiguous quote for {passage_id}")
        start = text.index(quote)
        passages.append({
            "passageId": passage_id,
            **{field: document[field] for field in ("documentId", "title", "revision")},
            "sectionPath": [heading],
            "quote": quote,
            "locator": {**locator, "start": start, "end": start + len(quote)},
        })

    for passage_id, page, section, quote in [
        ("intake-checklist", 2, "Intake checklist", INTAKE),
        ("missing-details", 2, "Missing details", MISSING),
        ("duplicate-check", 2, "Duplicate check", DUPLICATE),
        ("existing-ticket", 2, "Existing ticket", EXISTING),
        ("new-ticket", 3, "New ticket", NEW),
        ("queue-handoff", 3, "Queue handoff", HANDOFF),
        ("vendor-callback-gap", 3, "Vendor callback", CALLBACK),
    ]:
        add(documents[0], passage_id, section, quote, pages[page - 1], {"format": "pdf", "page": page})

    for passage_id, section, ordinal in [
        ("shift-reminder", "Shift handoff", 2),
        ("intake-backup", "Shift handoff", 3),
        ("unassigned-trigger", "Unassigned tickets", 1),
        ("unassigned-reminder", "Unassigned tickets", 2),
        ("queue-as-of", "Current queue", 1),
        ("queue-completed", "Current queue", 2),
        ("queue-fm-104", "Current queue", 3),
        ("queue-upcoming", "Current queue", 4),
        ("guide-location", "Tools and locations", 1),
        ("handoff-location", "Tools and locations", 2),
        ("portal-location", "Tools and locations", 3),
        ("folder-access", "Access and working copies", 1),
        ("archived-routing", "Access and working copies", 2),
        ("access-booking", "Monday access booking", 1),
        ("key-holder", "Monday access booking", 2),
    ]:
        text = sections[section][ordinal - 1]
        add(documents[1], passage_id, section, text, text, {
            "format": "docx", "headingPath": [section], "paragraphOrdinal": ordinal,
        })
    (ROOT / "sources.json").write_text(
        json.dumps({"documents": documents, "passages": passages}, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdfjs-module", help="Optional path to the installed legacy PDF.js module")
    write_manifest(parser.parse_args().pdfjs_module)
