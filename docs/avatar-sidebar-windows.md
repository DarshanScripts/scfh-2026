# Integrate the avatar sidebar on Windows

Feature branch: `feat/avatar-voice-sidebar`. This branch extends the portable Rough.js canvas with the Electron sidebar, live transcripts, cited answers, and the optional Qdrant backend. It already contains a Beyond Presence example in `agent.mjs`.

## Bring it into Member 1's branch

From a clean checkout of your avatar branch:

```powershell
git fetch origin feat/avatar-voice-sidebar
git merge origin/feat/avatar-voice-sidebar
```

If both branches changed the agent entry point, keep your existing credentials, avatar startup, and Windows desktop tool registration. Bring over the onboarding and workflow wiring described below. The prior standalone canvas guide is [roughjs-windows-integration.md](roughjs-windows-integration.md).

## Start the integrated reference app

Use Node.js 22.22+, Bun, and uv. Install the Node dependencies and build the onboarding browser bundle:

```powershell
npm ci
Push-Location packages/onboarding
uv sync --locked
bun install --frozen-lockfile
bun run build
Pop-Location
```

Create an untracked `.env` in the checkout with your own `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `ANTHROPIC_API_KEY`, `LLM_MODEL`, and `BEYOND_PRESENCE_API_KEY`. Set `BEYOND_PRESENCE_AVATAR_ID` if you use a specific avatar. Use a signed-in Windows desktop with `uvx` available for Windows-MCP.

```powershell
$env:ENABLE_AVATAR = '1'
npm run start:sidebar
```

Click the green phone icon to start a call. The launcher starts the localhost service, worker, and Electron client. The Windows launcher uses port 4321 by default. Set `DEMO_PORT` to use another port.

## Connect your existing avatar worker and client

| Area | Files and integration points |
| --- | --- |
| LiveKit worker | In [agent.mjs](../agent.mjs), register `createOnboardingAnswers(room, serviceUrl).tool` and `createWorkflowTools({ room, getAvatarAudio }).tools` alongside the desktop tools. On a new user turn, interrupt workflow narration and call `onboarding.beginTurn()`. Retain the shutdown callbacks. |
| Avatar playback | Use [workflow-playback.mjs](../workflow-playback.mjs) to observe the Beyond Presence participant's playback signal. Pass that signal through `getAvatarAudio` so workflow steps advance with speech. |
| Rough.js | [workflow-tools.mjs](../workflow-tools.mjs) sends validated lesson steps to the participant over room RPC. [demo/orb.js](../demo/orb.js) registers the receiver and uses [packages/rough-canvas](../packages/rough-canvas) to render. The Electron shell switches modes and restores the sidebar when the canvas closes. |
| Electron and transcripts | Use [demo.mjs](../demo.mjs), [floating-window.cjs](../floating-window.cjs), [sidebar-preload.cjs](../sidebar-preload.cjs), and [demo](../demo). Retain the preload's narrow mode API and the client checks on message senders. |
| Grounded answers | [onboarding-service.mjs](../onboarding-service.mjs) starts the Python service and proxies citation assets. Pass its localhost URL to the worker as `ONBOARDING_SERVICE_URL`. [onboarding-answer.mjs](../onboarding-answer.mjs) validates responses and sends answer events on `scfh.onboarding.v1`. The client mounts [answers.ts](../packages/onboarding/browser/answers.ts) in each answer bubble. Keep the same citation service for question answering and citation resolution. |

The integrated Windows worker registers `get_onboarding_walkthrough` for the approved maintenance procedure. It validates `/api/walkthrough`, retains evidence gaps, and advances the sidebar canvas with the existing speech playback signal. Custom workflows and charts use `draw_workflow` and `draw_canvas`.

## Choose the knowledge corpus

The default fixture corpus works locally and includes PDF and Word sources. For the public Denton audit, configure `ONBOARDING_KNOWLEDGE=qdrant`, `QDRANT_URL`, `QDRANT_API_KEY`, `OPENROUTER_API_KEY`, and `EMBEDDING_MODEL`. Embeddings use OpenRouter. Answers use `ANTHROPIC_API_KEY` and `LLM_MODEL`.

Follow the [corpus setup](../packages/onboarding/public-corpus/README.md) once per checkout to prepare the local source files and index state. Keep credentials and generated state local. A remote collection alone does not supply the original PDF or its local page mappings.

## Windows acceptance checklist

1. In fixture mode ask, “What do I need before logging a maintenance ticket?” Check that the spoken answer and source cards share one answer bubble.
2. In Qdrant mode ask, “According to the June 2020 Denton Facilities Maintenance audit, who reviews finished work orders before they’re closed? Show me the source.” Open the page 7 citation. Check inline highlighting, then choose **Full screen** and confirm it scrolls to the same passage. Press **Esc** to return.
3. Ask, “Draw and narrate the maintenance work-order process step by step. Mark any gaps in the documents.” Check that the canvas takes focus and steps appear with narration. Save a PNG and close the canvas. Confirm that the sidebar brings back the transcript and open citation.
4. Speak a sentence with short pauses and check that speech fragments stay in one bubble. Try the sidebar collapse and expand controls, then ask the agent to open a known folder on Windows.

The RAG HTTP path was checked locally with the Denton audit. Run these checks on Windows before merging to main, especially avatar playback, desktop input, and native full-screen transitions.
