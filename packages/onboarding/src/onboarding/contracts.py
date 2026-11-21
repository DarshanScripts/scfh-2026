"""Version 1 payloads shared by retrieval, the browser, and the avatar host."""

from datetime import date
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    PositiveInt,
    StringConstraints,
    model_validator,
)

Slug = Annotated[str, StringConstraints(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=80)]
Digest = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
Path = Annotated[list[Text], Field(min_length=1)]
EvidenceIds = Annotated[list[Slug], Field(min_length=1)]


class StrictModel(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class Versioned(StrictModel):
    schemaVersion: Literal[1] = 1


class QueryContext(StrictModel):
    workflowStepId: Slug | None = None
    previousQuery: Query | None = None


class Request(Versioned):
    requestId: UUID
    turnId: UUID
    query: Query
    context: QueryContext | None = None


class Span(StrictModel):
    start: Annotated[int, Field(ge=0)]
    end: PositiveInt
    pageLabel: Text | None = None

    @model_validator(mode="after")
    def validate_order(self):
        if self.end <= self.start:
            raise ValueError("end must be greater than start")
        return self


class PdfLocator(Span):
    format: Literal["pdf"]
    page: PositiveInt


class WordLocator(Span):
    format: Literal["docx"]
    headingPath: Path
    paragraphOrdinal: PositiveInt


class Document(StrictModel):
    documentId: Slug
    title: Text
    format: Literal["pdf", "docx"]
    revision: Digest
    relativePath: Text


class Passage(StrictModel):
    passageId: Slug
    documentId: Slug
    revision: Digest
    title: Text
    sectionPath: Path
    quote: Annotated[str, Field(min_length=1)]
    locator: Annotated[PdfLocator | WordLocator, Field(discriminator="format")]


class Claim(StrictModel):
    claimId: Slug
    text: Text
    passageIds: EvidenceIds


class Topic(StrictModel):
    topicId: Slug
    cues: Annotated[list[Annotated[list[Text], Field(min_length=1)]], Field(min_length=1)]
    claimIds: EvidenceIds


class ReviewRecord(StrictModel):
    recordId: Slug
    taskId: Literal["maintenance-intake", "shift-handoff"]
    topicId: Slug
    applicability: Text
    passageIds: list[Slug] = Field(default_factory=list)
    interviewTurnIds: list[Slug] = Field(default_factory=list)
    meetingTurnIds: list[Slug] = Field(default_factory=list)
    capturedOn: date | None = None
    effectiveFrom: date | None = None
    disposition: Literal["approved", "duplicate", "superseded", "conflict", "excluded"]
    canonicalRecordId: Slug | None = None
    reviewerRole: Text
    reason: Text


class QueueItem(StrictModel):
    ticketId: Annotated[str, StringConstraints(pattern=r"^FM-[0-9]+$")]
    summary: Text
    status: Literal["completed", "pending", "upcoming"]
    priority: Literal["normal", "high"]
    ownerRole: Text
    nextAction: Text
    deadline: AwareDatetime | None
    building: Text | None = None
    room: Text | None = None
    receivedAt: AwareDatetime | None = None
    updatedAt: AwareDatetime | None = None
    channel: Literal["email", "phone", "portal", "internal"] | None = None
    waitingOn: Text | None = None
    relatedTicketIds: list[Annotated[str, StringConstraints(pattern=r"^FM-[0-9]+$")]] = Field(default_factory=list)
    notes: list[Text] = Field(default_factory=list)


class QueueSnapshot(StrictModel):
    asOf: date
    items: Annotated[list[QueueItem], Field(min_length=1)]


class Location(StrictModel):
    locationId: Slug
    label: Text
    kind: Literal["folder", "browser"]


class Evidence(StrictModel):
    claims: list[Claim]
    passages: list[Passage]
    uncovered: list[Text]


def check_evidence(references: set[str], citations: list[Passage]) -> None:
    ids = {item.passageId for item in citations}
    if len(ids) != len(citations) or ids != references:
        raise ValueError("citations must match referenced evidence without duplicates")


class Answer(Versioned):
    requestId: UUID
    turnId: UUID
    outcome: Literal["answered", "partial", "insufficient"]
    text: Text
    claims: list[Claim]
    citations: list[Passage]

    @model_validator(mode="after")
    def validate_answer(self):
        if bool(self.claims) == (self.outcome == "insufficient"):
            raise ValueError("answer outcome and claims disagree")
        check_evidence({ref for claim in self.claims for ref in claim.passageIds}, self.citations)
        return self


class Edge(StrictModel):
    label: Text
    toStepId: Slug


class Step(StrictModel):
    stepId: Slug
    kind: Literal["action", "decision", "handoff", "exception", "gap"]
    label: Text
    narration: Text
    passageIds: EvidenceIds
    edges: list[Edge]


class Workflow(StrictModel):
    workflowId: Slug
    title: Text
    steps: Annotated[list[Step], Field(min_length=1)]

    @model_validator(mode="after")
    def validate_graph(self):
        order = {step.stepId: index for index, step in enumerate(self.steps)}
        reachable = {self.steps[0].stepId}
        if len(order) != len(self.steps):
            raise ValueError("step IDs must be unique")
        for index, step in enumerate(self.steps):
            if step.stepId not in reachable:
                raise ValueError("all steps must be reachable from the first step")
            if step.kind == "decision" and len(step.edges) < 2:
                raise ValueError("decision nodes require multiple branches")
            destinations = {edge.toStepId for edge in step.edges}
            if len(destinations) != len(step.edges):
                raise ValueError("outgoing branches must have unique destinations")
            if any(order.get(target, -1) <= index for target in destinations):
                raise ValueError("branches must refer to a later step")
            reachable.update(destinations)
        return self


class Walkthrough(Workflow, Versioned):
    requestId: UUID
    turnId: UUID
    outcome: Literal["ready"] = "ready"
    citations: list[Passage]

    @model_validator(mode="after")
    def validate_citations(self):
        check_evidence({ref for step in self.steps for ref in step.passageIds}, self.citations)
        return self


class WalkthroughGap(Versioned):
    requestId: UUID
    turnId: UUID
    outcome: Literal["insufficient"] = "insufficient"
    text: Text


WalkthroughResult = Annotated[Walkthrough | WalkthroughGap, Field(discriminator="outcome")]


class PlaybackBase(Versioned):
    turnId: UUID
    runId: UUID


class PlaybackStep(PlaybackBase):
    type: Literal["stepStarted", "stepFinished"]
    stepId: Slug
    stepIndex: Annotated[int, Field(ge=0)]


class PlaybackStatus(PlaybackBase):
    type: Literal["ready", "completed", "cancelled", "closed", "failed"]


Playback = PlaybackStep | PlaybackStatus


class CitationRequest(Versioned):
    requestId: UUID
    passageId: Slug


class WordParagraph(StrictModel):
    text: str
    headingPath: list[Text]
    headingLevel: Annotated[int, Field(ge=0, le=6)]
    ordinal: PositiveInt | None


class CitationSource(Versioned):
    status: Literal["exact", "location_only"]
    passage: Passage
    sourceUrl: Text
    paragraphs: list[WordParagraph] | None = None


class CitationUnavailable(Versioned):
    status: Literal["unavailable"] = "unavailable"


CitationResult = Annotated[CitationSource | CitationUnavailable, Field(discriminator="status")]
