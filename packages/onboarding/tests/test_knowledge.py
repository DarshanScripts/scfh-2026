from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import shutil
from uuid import uuid4

from pydantic import TypeAdapter, ValidationError
import pytest

from onboarding import FixtureKnowledge
from onboarding.contracts import Answer, CitationRequest, CitationResult, Playback, Request, Walkthrough, WalkthroughResult
from onboarding.knowledge import FIXTURES
from onboarding.server import Handler, Harness


@pytest.fixture
def knowledge():
    return FixtureKnowledge()


@pytest.mark.parametrize(("question", "expected"), [
    ("Where’s the guide for logging a maintenance request, and what do I need before I open a ticket?",
     ["guide-location", "intake-checklist"]),
    ("Where can I find the maintenance guide and what information should I gather before logging a ticket?",
     ["guide-location", "intake-checklist"]),
    ("A maintenance ticket still has no owner. When should I follow up, and who do I tell?",
     ["unassigned-trigger", "unassigned-reminder"]),
    ("When do I escalate a ticket that hasn't been assigned and who should I contact?",
     ["unassigned-trigger", "unassigned-reminder"]),
    ("I’m taking over the queue. Which open item is due first, and who owns it?",
     ["queue-as-of", "queue-fm-104"]),
    ("Which pending ticket has the earliest deadline and who is handling it?",
     ["queue-as-of", "queue-fm-104"]),
    ("How can I spot a duplicate if people describe the same problem differently?", ["duplicate-check"]),
])
def test_demo_questions_and_paraphrases(knowledge, question, expected):
    result = knowledge.answer_onboarding_question(question)
    assert result.outcome == "answered"
    assert [citation.passageId for citation in result.citations] == expected


@pytest.mark.parametrize("question", ["What budget do we have for repairs?", "Where did the old team get coffee?"])
def test_uncovered_questions(knowledge, question):
    result = knowledge.answer_onboarding_question(question)
    assert result.outcome == "insufficient"
    assert not result.claims and not result.citations
    assert "couldn’t find" in result.text


def test_partial_answer(knowledge):
    result = knowledge.answer_onboarding_question("Which open ticket is due first, and what budget do we have for repairs?")
    assert result.outcome == "partial"
    assert result.text.startswith("As of November 20, 2026, FM-104")
    assert "don’t cover" in result.text
    assert {citation.passageId for citation in result.citations} == {"queue-as-of", "queue-fm-104"}
    queue = knowledge.queue
    earliest = min((item for item in queue.items if item.deadline and item.status != "completed"),
                   key=lambda item: item.deadline)
    assert (earliest.ticketId, earliest.ownerRole) == ("FM-104", "Desk Lead")


def test_review_records_and_documented_gap(knowledge):
    reviews = {review.recordId: review for review in knowledge.reviews}
    canonical = reviews[reviews["repeated-shift-reminder"].canonicalRecordId]
    assert {"unassigned-reminder", "shift-reminder"} <= set(canonical.passageIds)
    assert reviews["old-routing"].disposition == "superseded"
    assert reviews["vendor-callback"].disposition == "conflict"
    assert len(reviews["vendor-callback"].interviewTurnIds) == 2
    assert reviews["social-routine"].disposition == "excluded"
    result = knowledge.answer_onboarding_question("Where do I assign a new maintenance ticket?")
    assert "Maintenance Queue" in result.text
    assert "building supervisor" not in result.text
    workflow = knowledge.get_onboarding_walkthrough("Walk me through a maintenance request from intake to handoff")
    assert isinstance(workflow, Walkthrough)
    assert [step.stepId for step in workflow.steps] == [
        "check-details", "request-details", "check-duplicate", "link-duplicate",
        "log-ticket", "assign-queue", "callback-gap",
    ]
    assert {edge.toStepId for edge in workflow.steps[0].edges} == {"request-details", "check-duplicate"}
    assert workflow.steps[-1].kind == "gap"
    assert "no vendor callback deadline" in workflow.steps[-1].narration


def test_exact_word_occurrence(knowledge):
    result = knowledge.answer_onboarding_question("Who handles a maintenance ticket without an owner?")
    click = CitationRequest(requestId=result.requestId, passageId="unassigned-reminder")
    source = knowledge.open_citation(click, result)
    assert source.status == "exact"
    duplicates = [p for p in source.paragraphs if p.text == source.passage.quote]
    assert [p.headingPath for p in duplicates] == [["Shift handoff"], ["Unassigned tickets"]]
    assert source.passage.locator.headingPath == duplicates[1].headingPath
    assert source.passage.locator.paragraphOrdinal == duplicates[1].ordinal
    assert knowledge.open_citation(click.model_copy(update={"requestId": uuid4()}), result).status == "unavailable"
    assert knowledge.open_citation(click.model_copy(update={"passageId": "shift-reminder"}), result).status == "unavailable"


def test_stale_locator_opens_nearest_location(tmp_path):
    fixture_root = tmp_path / "fixtures"
    shutil.copytree(FIXTURES, fixture_root)
    knowledge = FixtureKnowledge(fixture_root)
    result = knowledge.answer_onboarding_question("Who handles an unassigned maintenance ticket?")
    click = CitationRequest(requestId=result.requestId, passageId="unassigned-reminder")
    source_path = knowledge.document_path("shift-handoff-guide")
    with source_path.open("ab") as handle:
        handle.write(b"\n")
    source = knowledge.open_citation(click, result)
    assert source.status == "location_only"
    assert source.passage.sectionPath == ["Unassigned tickets"]
    assert source.sourceUrl.endswith(sha256(source_path.read_bytes()).hexdigest())


def test_unknown_source_path_is_rejected(knowledge):
    with pytest.raises(KeyError):
        knowledge.document_path("handover")


def test_queue_and_meeting_provenance_are_consistent(knowledge):
    items = {item.ticketId: item for item in knowledge.queue.items}
    assert len(items) == len(knowledge.queue.items)
    assert items["FM-107"].room is None and items["FM-107"].waitingOn
    for item in items.values():
        assert set(item.relatedTicketIds) <= set(items) - {item.ticketId}
        assert item.receivedAt <= item.updatedAt
    review = next(review for review in knowledge.reviews if review.recordId == "access-booking")
    assert review.meetingTurnIds == ["meeting-access-window"]
    result = knowledge.answer_onboarding_question("What is FM-104 waiting on?")
    assert result.outcome == "answered"
    assert "Library site contact" in result.text
    assert [passage.passageId for passage in result.citations] == ["access-booking"]


def test_access_question_cites_the_updated_word_guide(knowledge):
    result = knowledge.answer_onboarding_question("I cannot open the handoff folder. What permissions do I need?")
    assert result.outcome == "answered"
    assert "FM-Desk-Read" in result.text
    click = CitationRequest(requestId=result.requestId, passageId="folder-access")
    source = knowledge.open_citation(click, result)
    assert source.status == "exact"
    assert source.passage.locator.headingPath == ["Access and working copies"]


@pytest.mark.parametrize("type_name", ["request", "answer", "walkthrough", "playback", "citationRequest", "citation"])
def test_versioned_payloads_accept_valid_and_reject_unknown_fields(knowledge, type_name):
    result = knowledge.answer_onboarding_question("Where is the maintenance guide?")
    click = CitationRequest(requestId=result.requestId, passageId="guide-location")
    options = {
        "request": (Request, Request(requestId=result.requestId, turnId=result.turnId, query="Where is the guide?").model_dump(mode="json")),
        "answer": (Answer, result.model_dump(mode="json")),
        "walkthrough": (WalkthroughResult, knowledge.get_onboarding_walkthrough("Explain maintenance intake").model_dump(mode="json")),
        "playback": (Playback, {"schemaVersion": 1, "runId": str(uuid4()), "turnId": str(result.turnId),
                                "type": "stepStarted", "stepId": "check-details", "stepIndex": 0}),
        "citationRequest": (CitationRequest, click.model_dump(mode="json")),
        "citation": (CitationResult, knowledge.open_citation(click, result).model_dump(mode="json")),
    }
    contract, good = options[type_name]
    adapter = TypeAdapter(contract)
    adapter.validate_json(json.dumps(good))
    with pytest.raises(ValidationError):
        adapter.validate_json(json.dumps({**good, "unexpected": True}))


class InMemoryRequest:
    """Run the real request handler without requiring a listening socket."""

    def __init__(self, request: bytes):
        self.input = BytesIO(request)
        self.output = bytearray()

    def makefile(self, mode, *_args):
        assert mode == "rb"
        return self.input

    def sendall(self, data: bytes):
        self.output.extend(data)


def http(harness, method, target, data=None):
    request = f"{method} {target} HTTP/1.0\r\n"
    body = b""
    if data is not None:
        body = json.dumps(data).encode()
        request += f"Content-Type: application/json\r\nContent-Length: {len(body)}\r\n"
    connection = InMemoryRequest(request.encode() + b"\r\n" + body)
    Handler(harness, connection, ("127.0.0.1", 0), object())
    headers, content = bytes(connection.output).split(b"\r\n\r\n", 1)
    return int(headers.split()[1]), content


def test_question_to_citation_to_original(tmp_path):
    harness = Harness(tmp_path, Path("dist/harness.js"), tmp_path)
    status, payload = http(harness, "POST", "/api/question", {
        "query": "What details are required before I log a maintenance ticket?"
    })
    assert status == 200
    answer = Answer.model_validate_json(payload)
    status, payload = http(harness, "POST", "/api/citation", {
        "schemaVersion": 1, "requestId": str(answer.requestId), "passageId": "intake-checklist",
    })
    assert status == 200
    citation = TypeAdapter(CitationResult).validate_json(payload)
    assert citation.status == "exact" and citation.passage.locator.page == 2
    status, original = http(harness, "GET", citation.sourceUrl)
    assert status == 200 and original.startswith(b"%PDF-")
    assert sha256(original).hexdigest() == citation.passage.revision

    assert http(harness, "POST", "/api/question", {"query": " "})[0] == 400
    assert http(harness, "GET", "/sources/handover")[0] == 404
    assert http(harness, "GET", "/sources/maintenance-intake-guide")[0] == 409
