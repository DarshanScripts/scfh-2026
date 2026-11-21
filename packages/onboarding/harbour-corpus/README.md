# Hildesheim Harbour corpus

Select `ONBOARDING_KNOWLEDGE=harbour` for Relay or run the existing browser harness with `--knowledge harbour`. The source is the team's 938-page Hildesheim 2026/2027 budget. Import is pinned to the reviewed SHA-256 and uses the original PDF, with the same PDF.js text sequence as the viewer.

## Data and source hierarchy

- 194 located passages across 82 selected physical PDF pages. The importer indexes the 32-page Vorlage 25/426 and its relevant tables and annexes, the 25/522 amendment, the council record, and selected rows and sections for products 55201/55202, allocations, and staffing.
- The corpus records printed page and physical page separately. Citations open physical PDF pages. Where the labels differ the UI shows both. Source document IDs distinguish the component documents even though the viewer opens the same original PDF.
- Qdrant payloads carry project, stage, topic, subtopic, source title and authority, date where available, version, disposition, document hash, exact quote, linked topics and linked passage IDs. The original proposal and amendment remain searchable for historical reasoning. The adopted council record takes precedence for decisions.
- `tables.json` preserves aligned column relationships for the core financial tables. It distinguishes draft HH and HIP schedules, appropriations, plan values, and commitment authorizations. The importer checks reviewed values against the original PDF.js text. Full-page table anchors keep original evidence clickable.
- Vorlagen 24/194 and 24/195 are available as references in the packet. Those files would require a new registered source import before Relay can cite their standalone contents.

## Retrieval

`src/onboarding/harbour_catalog.py` defines the six stages, English and German topic vocabulary, exact evidence anchors, and topic relationships. The importer writes metadata and PDF locators beside the original. `HarbourKnowledge.stage_evidence()` returns the directly tagged and explicitly linked evidence for a canonical stage.

The existing Qdrant path combines multilingual Cohere Embed 5 Fast vectors (768 dimensions) with a local BM25 index. English questions can retrieve German text without translating the original. [Cohere Embed documentation](https://docs.cohere.com/docs/cohere-embed) Harbour expands around the active stage and previous user question, searches the new collection with project and stage filters, joins related topics and passages, and reranks by relevance and source authority. It performs a broader two-hop pass if the first model answer reports incomplete evidence. The shared answer pipeline verifies model-selected quotes against the exact original text before producing a citation.

The browser and desktop keep the last revealed stage and previous user question for that conversation. The branch-specific funding walkthrough maps its four drawing steps to the same Finance stage. The context is sent with query requests. A new call or browser page starts fresh.

Run commands from `packages/onboarding` after the standard dependency and browser bundle setup:

```sh
uv run --locked --no-env-file python scripts/import_harbour.py --pdf /path/to/00_haushaltsplan_2026_2027_gesamt.pdf
uv run --locked --no-env-file python -m onboarding.server --knowledge harbour
```

`collection.json` points to the provisioned Qdrant collection if no local state exists. To provision a different collection, run `uv run --locked --no-env-file python -m onboarding.rag index --corpus harbour`. The original PDF and generated artifacts stay on the machine running Relay. Provider credentials stay in the root `.env`.

See the [three-prompt Windows demo](../../../docs/hildesheim-harbour-demo.md).
