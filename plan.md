# Challenge 2 — The Memory of Public Administration

The Windows release uses Rough.js for the narrated workflow. See the [release checks](docs/windows-acceptance.md) for the current implementation and acceptance results.

## Scope and team ownership

Build an English-language Windows demo for a fictional **Municipal Facilities Service Desk**. The **Beyond Presence digital avatar** is the interface employees speak to and see. Reuse the existing voice pipeline for speech and the existing Windows computer-use integration for browser and File Explorer actions. Show answers, clickable citations, and a floating Excalidraw canvas beside the avatar.

Cover two tasks, **logging a routine maintenance request** and **handing over an open ticket**. Both support Q&A. Maintenance intake also gets one complete narrated walkthrough. Use synthetic fixtures for the demo. Production database setup, corpus ingestion, live interview capture, and handbook publishing belong to the later phase.

| Owner | Deliverable |
| --- | --- |
| **Member 1 · Windows** | Audit and run the existing app locally. Publish the working baseline to GitHub. Integrate the portable code with tool dispatch, the Beyond Presence avatar, the source viewer, and the Excalidraw MCP App. Run Windows acceptance and own every merge to `main`. |
| **Member 2 · Arch Linux / KDE Plasma** | Build the shared contracts, synthetic corpus, handover review records, retrieval, citation previews, and workflow scene and export helpers. Verify them in a local browser and test harness with simulated speech events. |

The Windows app and portable onboarding package are now in this repository. The [README](README.md) lists the current runtime versions and demo commands.

## Shared contracts and safety

Keep the portable Python package under `packages/onboarding/` so both agents can work against it before the Windows app is pushed. Use **uv** for Python dependencies and locked runs. Member 2 can start with Python 3.13 from the local scaffold. Before integrating, test the package on Member 1’s actual Python version and use the Windows app’s existing dependency layout. Commit dependency manifests and lockfiles with each dependency change. [uv locking and syncing](https://docs.astral.sh/uv/concepts/projects/sync/)

Define strict Pydantic v2 models with unknown fields forbidden. Generate JSON Schema from those models, use schema-derived types in the browser adapter, and validate incoming JSON there at runtime. Commit one valid and one invalid example for every message type. The wire uses camelCase and `schemaVersion: 1`. The app assigns UUIDs for `requestId`, `turnId`, and `runId`. Fixture IDs are stable lowercase slugs.

| Contract | Fields and rules |
| --- | --- |
| **Tool input** | `answer_onboarding_question(query)` and `get_onboarding_walkthrough(query)` accept one trimmed string of 1–600 characters. The app attaches `requestId` and `turnId`. Tool inputs carry everyday-language questions. |
| **Document and passage** | The manifest records `documentId`, `title`, `format`, `revision` as the SHA-256 of the original bytes, and a path relative to the fixture root. Each `Passage` carries `passageId`, `documentId`, `revision`, `title`, `sectionPath`, verbatim `quote`, and a typed `locator`. The app checks that the passage and document metadata agree. |
| **PDF locator** | `{format: "pdf", page, start, end, pageLabel?}`. `page` is 1-based. `start` and `end` select the exact occurrence within that page’s text. |
| **Word locator** | `{format: "docx", headingPath, paragraphOrdinal, start, end, pageLabel?}`. `paragraphOrdinal` is 1-based within the exact heading, counting body paragraphs in document order. `pageLabel` is present only when the source supplies one. |
| **Retrieval** | `retrieve(query)` returns approved answer claims, their `Passage` records, and any uncovered parts of the question. Each claim has `claimId`, reviewed `text`, and one or more `passageIds`. The fixture implementation can later be replaced behind this interface. |
| **Answer** | `{schemaVersion, requestId, turnId, outcome, text, claims, citations}`. `outcome` is `answered`, `partial`, or `insufficient`. Every supported claim has retrieved evidence. `partial` includes a plain statement of what the sources did not cover. `insufficient` has empty `claims` and `citations`. The avatar speaks the exact validated `text` shown in the answer panel. |
| **Walkthrough** | Echo the request IDs and version. `outcome: "ready"` carries `workflowId`, `title`, `steps`, and `citations`. `outcome: "insufficient"` carries a plain explanation. Each ordered step has `stepId`, `kind`, `label`, `narration`, `passageIds`, and `edges` of `{label, toStepId}`. Kinds are `action`, `decision`, `handoff`, `exception`, and `gap`. Validate unique IDs, evidence references, and edge destinations. |
| **Playback** | `{schemaVersion, turnId, runId, type}` with `stepId` and zero-based `stepIndex` on `stepStarted` and `stepFinished`. Other events are `ready`, `completed`, `cancelled`, `closed`, and `failed`. Accept events only for the active run and expected step. One validated step supplies both the speech segment and its reveal group. |
| **Citation open** | The UI passes the answer’s `requestId` and `passageId`. The app resolves the original locator and returns `exact`, `location_only`, or `unavailable`. A citation click can open only documents registered in the fixture manifest. |

Ranges are zero-based, half-open Unicode code-point offsets. Collapse whitespace runs to a single space and trim before calculating offsets. For PDFs, build the normalized text from the pinned PDF.js text items in page order. For Word, use the selected paragraph’s text. Keep a map back to the rendered text so the highlight covers the exact occurrence, including spans across PDF text items or Word runs. Verify the quote at the recorded range before highlighting.

**Trust boundaries.** Treat transcripts, document text, model output, and MCP payloads as data. The app resolves locations by approved IDs and enforces the fixture root after path resolution. Render plain text and app-resolved links. Only an explicit user navigation request can authorize the existing desktop tools. Evidence text cannot trigger desktop actions, tool calls, or external requests. On invalid input, unavailable data, or an invalid model or MCP response, show a short app-owned error and return control to the conversation. Reserve `insufficient` for a genuine evidence gap.

**Configuration.** Use the existing local `.env` with `LIVEKIT_*`, `BEYOND_PRESENCE_*`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, and `REASONING_EFFORT`. Use the app’s current loader, or `uv run --locked --env-file .env` if the launcher needs dotenv loading. Replace the credentials shared in chat before live testing. Check that `.env` is ignored and absent from the staged diff before pushing. GitHub gets placeholder config and logs with IDs, status codes, and timings. Linux fixture tests need no provider credentials. [uv dotenv configuration](https://docs.astral.sh/uv/concepts/configuration-files/)

## Member 2 — Build and verify on Linux

### Build the four knowledge pillars

| Pillar | Fixture |
| --- | --- |
| **Handover interviews** | A synthetic transcript of 700–1,000 words across two departing employees, with interview dates, speaker roles, and stable turn IDs. Have the outgoing Intake Coordinator explain how they spot duplicate reports when descriptions differ. Include a repeated instruction, a superseded instruction, an unresolved disagreement, and an off-topic remark. |
| **Task status** | A small queue dated **November 20, 2026** with one completed item, one high-priority pending item, and one upcoming item. Give each an ID, status, priority, owner role, next action, and deadline where applicable. Set the earliest open item to `FM-104`, owned by the Desk Lead and due **November 23 at noon, Berlin time**. Store deadlines with an explicit offset. |
| **Documents and procedures** | A text-based **Maintenance Intake Guide** PDF documents the intake decisions and queue handoff. Put **Intake checklist** and **Duplicate check** on page 2. Add the Intake Coordinator’s tip on searching by building and room before comparing summaries. Record the Desk Lead’s approval and the interview turn in the review register. The **Shift Handoff Guide** DOCX covers ownership, backup, escalation, the dated queue, and file locations. Under **Unassigned tickets**, document the escalation trigger at the end of the next business day after logging and include “Send the ticket ID and latest status to the Desk Lead.” Repeat that sentence under **Shift handoff** to test which occurrence opens. |
| **Where work lives** | A manifest with `facilities-onboarding-folder` and a safe demo browser destination, plus document IDs, revisions, and fixture paths. The Word guide explains where to find the intake checklist and where to store handoff materials. Member 1 supplies the actual Windows folder and browser mappings locally. |

Use the three live questions in the demo matrix to author the fixture passages and expected claim and citation IDs. Add one English paraphrase of each to the retrieval tests. The organizer’s German questions establish the topics and the department’s synthetic documents supply the evidence. [Organizer’s question bank](<Mögliche Fragen bei der Einarbeitung.pdf>)

### Capture experience and resolve conflicting advice

Use a short adaptation of **Applied Cognitive Task Analysis**. Pre-fill the two tasks and known documents. Budget **10–15 minutes per employee**. Ask four questions and use an optional follow-up when an answer leaves an important gap or conflicts with the current procedure. [Militello and Hutton, Applied Cognitive Task Analysis](https://web.mit.edu/16.459/www/Militello98.pdf)

1. **Walk me through a recent case from first request to completion.** What did you check, who took over, and how did you know you were done?
2. **Where does a new employee usually get stuck?** Describe one exception and the cue that told you to handle it differently.
3. **What needs attention after you leave?** Name the pending, completed, and upcoming items, with the priority, owner, deadline, and next action.
4. **What should your replacement open to do this correctly?** Point to the current rule, template, folder, or link and identify anything that has changed.

Write a typed review register alongside the fixtures. Each record carries a task and topic ID, applicability, source passage or interview turn IDs, capture and effective dates where known, disposition, reviewer role, and reason. Use `approved`, `duplicate`, `superseded`, `conflict`, or `excluded`. A duplicate points to its approved canonical record, which retains both sources.

- Check whether two statements apply to the same task, conditions, and period. Use the current approved procedure for instructions and the dated queue for case status. Keep an approved experiential tip attributed to its speaker role.
- Demonstrate the rules with an older routing instruction superseded by the Intake Guide, the duplicate Desk Lead reminder, and conflicting vendor callback deadlines. Record both accounts for the Desk Lead to review. The employee-facing walkthrough says the deadline is undocumented. It gives only the approved next action.
- Index the approved claims and approved documents. Keep interview turns and review notes available to fixture reviewers. Keep off-topic remarks out of retrieval, speech, and diagrams.

For the **later jury deliverable**, collect a short interview or voice memo under the department’s approved access and retention rules. Give the employee a way to review and correct the account. Produce a handbook draft with steps, decision cues, handoffs, open items, links, and provenance. Remove unnecessary personal information and require process-owner approval. Publishing the approved page makes it searchable immediately through the retrieval interface. The full jury run adds this live handover to the three cited Q&A questions.

### Implement the portable components

1. **Retrieval and answers.** Use an in-memory fixture index with reviewed answer snippets and everyday-language synonyms. Match each requested topic against its required cue terms, retrieve only its approved evidence, and assemble the matching snippets in question order. Deduplicate citation IDs. Return `partial` when some requested topics are covered and `insufficient` when none are covered. This keeps the response grounded without a second model call. Test paraphrases and mixed supported and unsupported questions.
2. **Citation preview.** Use the existing viewer if Member 1 proves it passes the same exact-highlight checks. Otherwise provide a browser component. Render PDFs with PDF.js and its selectable text layer. Project the actual DOCX body into headings and anchored paragraphs so the preview reflects the original file. On a stale revision or unverified quote, open the nearest known page or heading and show **“Opened the source location. The exact passage couldn’t be highlighted.”** If the document is unavailable, show that status. [PDF.js rendering examples](https://mozilla.github.io/pdf.js/examples/)
3. **Workflow scene.** Narrate the intake procedure in order. Check required details → request missing details and pause → check for duplicates → link to an existing ticket and stop → log a new ticket → hand it to the Maintenance Queue → flag the vendor callback deadline gap. The two decision nodes branch to the corresponding exceptions and onward steps. Back each step with a PDF passage and include the reviewed practice tip in the duplicate-check narration. Assign stable IDs to nodes and connectors. Reveal an edge once its two endpoints have been introduced.
4. **Linux proof.** Run `uv sync --locked` and `uv run --locked --no-env-file pytest` in the portable project. Use the browser harness to open the real PDF and Word sources, simulate playback events, and export the full diagram. Include the harness launch command, sample prompts, expected results, and the tested commit in the PR.

## Member 1 — Audit and integrate on Windows

### Start in the existing local app

Before editing, the coding agent must read the project instructions, manifests, lockfiles, and startup docs. Run the current app. Trace an actual utterance through transcription, tool selection and registration, tool execution, streaming TTS, and Beyond Presence audio/video playback. Locate the avatar UI, answer panel, viewer, window or panel controls, turn IDs, cancellation, and playback events. Record the responsible files and symbols plus the exact startup and test commands.

Run one real File Explorer request and one browser request through the avatar. Record the prompts and expected destinations. Check whether the installed viewer can highlight a PDF text range and a Word paragraph range. Share the entry points, viewer decision, Python and JS versions, and baseline commit SHA with Member 2. [Beyond Presence integration](https://docs.livekit.io/agents/models/avatar/plugins/bey/)

### Wire answers and navigation

- Register both new tools at the existing dispatch boundary. Route “open the onboarding folder” to the Windows path, “where is the checklist?” to Q&A, and “walk me through intake” to the walkthrough. For an explicit combined request, complete the navigation and provide the sourced answer. Pass the active turn ID through both.
- Validate the portable result before sending it to the avatar and UI. Use the pinned app’s direct speech path for the validated answer and suppress the automatic follow-up for that tool response. Show clickable document title, section, and page where available. Verify the spoken text and answer card agree in the normal app. [LiveKit speech control](https://docs.livekit.io/agents/multimodality/audio/) · [LiveKit tool reply control](https://docs.livekit.io/reference/agents/events/#function_tools_executed)

### Wire Excalidraw to actual avatar playback

1. **Prove MCP Apps hosting first.** Inspect the existing MCP host for tool discovery, UI resource loading, sandboxed mounting, view readiness, partial inputs, final results, and teardown. Reuse it if those work. Otherwise add a minimal `AppBridge` host for the Excalidraw view. Use the **v0.3.2** release bundle as the local server over stdio. Discover `create_view` and fetch its advertised UI resource. Call `read_me` at setup, then prove that two staged updates render. Scope the bridge to the pinned server and diagram tools. Keep provider credentials out of the bridge and its child process. [MCP Apps host lifecycle](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html) · [Excalidraw v0.3.2](https://github.com/excalidraw/excalidraw-mcp/releases/tag/v0.3.2)
2. **Verify the speech cue.** Play two short segments through the installed Beyond Presence path. Use a playback-start event correlated to the current speech segment. If that signal is unavailable, test the synchronized LiveKit transcription stream against audible playback and use it only if it tracks the actual avatar reliably. `speech_created` is useful for correlating handles. The reveal needs a cue tied to playback. Run narration in a session-owned task so it can await playout without blocking its own tool call. [LiveKit avatar playback](https://docs.livekit.io/agents/models/avatar/#custom-avatar-workers) · [Synchronized transcription](https://docs.livekit.io/agents/multimodality/text/#synchronized-transcription-forwarding)
3. **Drive both outputs from the same step.** Wait for the view to initialize, then queue one step’s narration at a time. On its playback-start cue, send the cumulative scene through `sendToolInputPartial`. The pinned view drops the last element of every partial update. Append a trailing non-drawing `cameraUpdate` to the partial `elements` JSON array so the last real element survives. After final playout, send complete input without that marker, invoke `create_view` with the full `elements` JSON string, and forward the result. Test that each step visibly appears while the matching line is spoken. [Pinned view code](https://github.com/excalidraw/excalidraw-mcp/blob/v0.3.2/src/mcp-app.tsx) · [Pinned tool schema](https://github.com/excalidraw/excalidraw-mcp/blob/v0.3.2/src/server.ts)
4. **Handle interruption and export.** Cancel the active narration and pending reveals on a confirmed interruption or **Close**. Discard late events by run ID. A restart gets a fresh run and view. Keep a completed diagram open across other questions until the user selects **Close**. Enable **Save as PNG** after completion. Use the installed Excalidraw version’s export API, such as `exportToBlob` with `image/png` on the 0.18 series, and pass the full scene including off-screen nodes and connectors. Save through the local app download or save flow. If the canvas fails to initialize or loses synchronization, show the documented steps and a clear canvas error. The narrated canvas acceptance check still needs to pass before merging. [Excalidraw export API](https://plus.excalidraw.com/docs/sdk/excalidraw/api/utils/export#exporttoblob)

## GitHub handoff and acceptance

Member 1 publishes the working Windows baseline to [DarshanScripts/scfh-2026](https://github.com/DarshanScripts/scfh-2026) and shares its SHA. If `main` already exists, use `chore/windows-baseline` for the baseline PR. If the repo has no `main`, Member 1 establishes it from the verified baseline. Member 2 can make local portable commits in the meantime and cherry-pick the scoped commits onto a branch from the shared baseline.

| Merge order | Branch | Owner | Gate before Member 1 squash-merges |
| --- | --- | --- | --- |
| 1 | `feat/onboarding-knowledge` | Member 2 | Schema, reviewed fixtures, Q&A, partial and insufficient outcomes, and conflict checks pass. |
| 2 | `feat/citation-previews` | Member 2 | PDF and Word jumps, repeated passages, and stale locator fallback pass in the browser. |
| 3 | `feat/avatar-qa` | Member 1 | Member 2 reviews the integration. Windows navigation and live cited Q&A pass in the normal app. |
| 4 | `feat/workflow-scene` | Member 2 | Ordered reveals and full-scene export pass with simulated speech and the pinned view. |
| 5 | `feat/avatar-walkthrough` | Member 1 | Member 2 reviews the integration. Live avatar timing, interruption, PNG save, and Close pass on Windows. |

Dependent features can be built from their parent branch. After a parent is squash-merged, rebase only the child’s commits onto current `main` before review. Keep each PR focused, with its base SHA, contract changes, checks, and any failures. Use short Conventional Commits such as `feat: add fixture retrieval` and `fix: align diagram with speech`. Member 1 reruns the Windows smoke check after each integration merge and records the final tested SHA.

### Three live onboarding questions

Use the English prompts to follow a new Facilities Service Desk employee through a first shift. Open the listed citations live to show the page or heading and its highlighted evidence.

| Organizer example | Ask the avatar | Expected answer and citation |
| --- | --- | --- |
| “Welche Prozesse sind schriftlich dokumentiert und wo finde ich diese?” | “Where’s the guide for logging a maintenance request, and what do I need before I open a ticket?” | The guide is in the Facilities onboarding folder. Collect the building and room or location, issue summary, and callback channel. Cite Word **Tools and locations** for the folder and PDF **Intake checklist**, page 2, for the required details. |
| “Wer muss bei wichtigen Themen informiert werden?” | “A maintenance ticket still has no owner. When should I follow up, and who do I tell?” | If it is still unassigned at the end of the next business day after logging, send the ticket ID and latest status to the Desk Lead. Cite Word **Unassigned tickets** for the trigger and highlight the copy of the reminder under that heading. |
| “Welche Fristen müssen eingehalten werden?” | “I’m taking over the queue. Which open item is due first, and who owns it?” | As of November 20, `FM-104` is due first, on November 23 at noon Berlin time. The Desk Lead owns it. Cite Word **Current queue**. |

### Navigation, walkthrough, and follow-up checks

| Windows demo check | Expected result |
| --- | --- |
| “Open the Facilities onboarding folder.” Repeat the baseline browser prompt. | The avatar reaches the existing File Explorer and browser destinations through the original desktop tools. |
| Optional jury follow-up. “How can I spot a duplicate if people describe the same problem differently?” | Search open tickets by building and room first, then compare the issue summaries. Present this as the Intake Coordinator’s approved practice tip and cite PDF **Duplicate check**, page 2. |
| “What budget do we have for repairs?” Then ask “Which open ticket is due first, and what budget do we have for repairs?” | The first answer acknowledges the budget gap. The second cites the queue entry for `FM-104` and identifies the missing budget information. |
| Open an intentionally stale locator. | The preview jumps to the nearest known location and explains why the highlight is unavailable. |
| “I’ve just received a maintenance request. Walk me through what to do from intake to handoff.” | The live MCP App reveals each step as the avatar speaks. Branches, queue handoff, and the callback gap match the documents. A PNG saved from a clipped viewport contains the complete diagram. The completed diagram stays open until Close. |
| Interrupt a run and restart. Then ask a normal Q&A question. | Old narration and reveals stop, the restarted run begins at step one, and the next question works. |

## Quick read

**Member 2** builds the reviewed sample knowledge base, clickable PDF and Word citations, and workflow scene on Linux. **Member 1** audits the existing Windows app, connects those pieces to the Beyond Presence avatar, proves the live demo, and merges each feature PR. This build delivers three cited answers and one narrated, exportable walkthrough. Live interview-to-handbook publishing comes next.
