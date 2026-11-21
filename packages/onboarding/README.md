# Facilities Service Desk onboarding

The portable Member 2 package contains the sample knowledge base, evidence retrieval, PDF and Word source previews, and the intake walkthrough used in the demo.

## Run the Linux harness

From this directory, use Python 3.12 or newer, uv, Node.js 22.13 or newer, and Bun.

    uv sync --locked
    bun install --frozen-lockfile
    bun run build
    uv run --locked --no-env-file python -m onboarding.server --knowledge qdrant

Open http://127.0.0.1:8765. Qdrant mode has prompts for work-order assignment, access management findings, and completion records. Select a citation to open the original PDF and highlight its supporting quote. Ask “What is the cafeteria lunch menu for tomorrow?” to check insufficient evidence. For a walkthrough, ask “According to the June 2020 audit, walk me through requesting and completing a maintenance work order.” Narration is simulated in the Linux harness.

The root .env must contain QDRANT_URL, QDRANT_API_KEY, OPENROUTER_API_KEY, EMBEDDING_MODEL, ANTHROPIC_API_KEY, and LLM_MODEL. OpenRouter provides embeddings; Anthropic generates grounded answers and workflows. Start-up loads those settings without copying credentials into the browser.

Qdrant mode combines 768-dimensional cloud vector retrieval with local BM25 keyword ranking. It uses EMBEDDING_MODEL through OpenRouter for document and query embeddings, then uses LLM_MODEL through Anthropic to generate an answer from retrieved passages. Each cited quote is checked against its original passage and narrowed to an exact page range.

For a fresh checkout, import the available original PDF and create a new collection before starting the server.

    uv run --locked --no-env-file python scripts/import_public_pdfs.py --from-directory public-corpus/originals --document-id denton-facilities-audit-2020
    uv run --locked --no-env-file python -m onboarding.rag index

The available original is the 17-page June 2020 City of Denton audit. Three other catalog PDFs currently return HTTP 403 from their publisher. Answers describe the audit period. The fictional queue and handovers can be opened with fixture mode.

    uv run --locked --no-env-file python -m onboarding.server --knowledge fixtures

## Verification

    uv run --locked --no-env-file pytest
    uv run --locked --no-env-file python -m onboarding.schema --check
    bun run check
    bun test tests/workflow.test.ts
    node tests/test_pdf.mjs

For the interactive smoke test, run the harness in one terminal and run these commands in a second terminal from the same directory.

    bunx playwright install chromium
    node tests/browser-smoke.mjs

The smoke test checks the highlighted PDF on page 2, the Word reminder under **Unassigned tickets**, the earliest queue deadline, an unanswered budget question, and interrupted and completed walkthroughs. It verifies that the downloaded PNG extends beyond the viewport.

For Qdrant mode, run this live browser test against the running server.

    node tests/browser-rag.mjs

The test makes embedding and answer-model calls and checks three cited answers plus an unsupported question. The index command creates a fresh collection. It publishes the active local state only after verifying the complete point count. A failed attempt preserves the previous active state.

## Member 1 integration

Use the app’s existing uv dependency layout to install this package and import `FixtureKnowledge` from `onboarding`. Pass the app’s `turn_id` and `request_id` to `answer_onboarding_question` and `get_onboarding_walkthrough` when those IDs already exist. Send the validated `Answer.text` to both the UI and avatar. Keep the validated response with its request ID for `open_citation`, and serve the original file returned by `document_path` at the route used by your source preview.

For original-document retrieval, instantiate `QdrantKnowledge` from `onboarding.rag`. It exposes the same answer, walkthrough, citation, and document-path methods. Call `close()` at shutdown.

The browser adapter validates the generated schemas in `browser/schema.ts`. The preview module uses PDF.js 5.6.205 for the sample PDF and the original Word body projected by the backend. Its citation path accepts the document IDs and revisions produced by the app. Connect the preview to your own source route when it differs from the harness route.

`browser/diagram.ts` builds the scene and converts each revealed prefix into `create_view` arguments. Pass the partial flag when sending a cumulative scene to Excalidraw MCP v0.3.2. Drive reveal counts with the app’s verified speech playback events. Use `exportDiagram` with the entire completed scene. The harness exercises Excalidraw locally with simulated timing. Hosting the MCP App, testing Beyond Presence playback, and verifying File Explorer remain part of the Windows integration.

## Update the fixtures

The reviewed claims and workflow are in `src/onboarding/fixtures/knowledge.json`. They reference the source passages in `sources.json`. The review records preserve interview provenance for approved, duplicate, superseded, disputed, and excluded material. The full synthetic handover is available to reviewers in `handover.md`.

Edit the fixture source text or queue, then rebuild the PDF, DOCX, and their citation offsets together. Install the browser dependencies first so the generator can use the pinned PDF.js version.

    uv run --no-project --no-env-file --with reportlab --with python-docx python scripts/build_fixtures.py

After editing the wire contracts, regenerate the browser schema.

    uv run --locked --no-env-file python -m onboarding.schema
