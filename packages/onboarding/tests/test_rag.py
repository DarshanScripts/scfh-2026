from types import SimpleNamespace
from uuid import uuid4

import pytest

from onboarding.contracts import CitationRequest, Document, Passage, PdfLocator
from onboarding.rag import (
    DIMENSIONS, DraftAnswer, PublicSources, QdrantKnowledge, RagError, Router, Settings,
)


@pytest.fixture
def passage():
    quote = "The technician records the work performed and the time spent."
    return Passage(
        passageId="audit-page-7", documentId="audit", title="Audit dated June 2020",
        revision="a" * 64, sectionPath=["Work orders"], quote=quote,
        locator=PdfLocator(format="pdf", page=7, start=50, end=50 + len(quote)),
    )


def answerer(passage, draft):
    service = QdrantKnowledge.__new__(QdrantKnowledge)
    service.retrieve = lambda _query: [passage]
    service.router = SimpleNamespace(generate=lambda *_args, **_kwargs: DraftAnswer.model_validate(draft))
    return service


def test_model_quote_is_resolved_to_exact_page_range(passage):
    quote = "the work performed and the time spent."
    service = answerer(passage, {
        "outcome": "answered",
        "claims": [{"text": "The audit says to record work and time.",
                    "evidence": [{"passageId": passage.passageId, "quote": quote}]}],
    })
    answer = service.answer_onboarding_question("What should be recorded?")
    citation = answer.citations[0]
    assert citation.quote == quote
    assert citation.locator.start == passage.locator.start + passage.quote.index(quote)
    assert citation.locator.end == citation.locator.start + len(quote)
    assert citation.locator.page == 7
    assert answer.claims[0].passageIds == [passage.passageId]


@pytest.mark.parametrize(("passage_id", "quote"), [
    ("invented-source", "the work performed"),
    ("audit-page-7", "The technician always calls the manager."),
])
def test_unretrieved_ids_and_invented_quotes_are_rejected(passage, passage_id, quote):
    service = answerer(passage, {
        "outcome": "answered",
        "claims": [{"text": "Unsupported.", "evidence": [{"passageId": passage_id, "quote": quote}]}],
    })
    with pytest.raises(RagError, match="could not be verified"):
        service.answer_onboarding_question("What should be recorded?")


def test_unanswerable_question_has_no_claims_or_citations(passage):
    service = answerer(passage, {
        "outcome": "insufficient", "claims": [],
        "gap": "The retrieved audit passages do not provide the cafeteria menu.",
    })
    answer = service.answer_onboarding_question("What is for lunch?")
    assert answer.outcome == "insufficient"
    assert not answer.citations and not answer.claims


def test_embedding_call_uses_configured_model_and_requested_dimensions(httpx_mock):
    router = Router(Settings(
        qdrant_url="https://qdrant.example", qdrant_key="private",
        openrouter_key="private", embedding_model="configured/model", answer_model="configured/chat",
    ))
    httpx_mock.add_response(
        url="https://openrouter.ai/api/v1/embeddings",
        json={"data": [{"index": 0, "embedding": [0.1] * DIMENSIONS}]},
    )
    try:
        assert len(router.embed(["work order"], "search_query")[0]) == 768
        import json
        body = json.loads(httpx_mock.get_request().content)
        assert body["model"] == "configured/model"
        assert body["dimensions"] == 768
        assert body["input_type"] == "search_query"
    finally:
        router.http.close()


def test_incompatible_embedding_dimensions_are_rejected(httpx_mock):
    router = Router(Settings(
        qdrant_url="https://qdrant.example", qdrant_key="private",
        openrouter_key="private", embedding_model="configured/model", answer_model="configured/chat",
    ))
    httpx_mock.add_response(
        url="https://openrouter.ai/api/v1/embeddings",
        json={"data": [{"index": 0, "embedding": [0.1] * 1024}]},
    )
    try:
        with pytest.raises(RagError, match="768-dimensional"):
            router.embed(["work order"], "search_document")
    finally:
        router.http.close()
