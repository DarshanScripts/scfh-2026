# Start here for Member 1’s agent

Integrate and rehearse the Harbour demo in Member 1’s existing Windows avatar project. The source branch is **feat/hildesheim-harbour** on **DarshanScripts/scfh-2026**. It contains the Harbour corpus, funding walkthrough, contextual follow-ups, citation viewer wiring, and mapped handover workspace.

## 1. Inspect and merge

From the repo root, inspect Member 1’s current checkout, startup scripts, agent tool registration, avatar wiring, and Windows desktop tools. Review the incoming changes before merging. Use the existing Windows configuration.

~~~powershell
git status -sb
git fetch origin feat/hildesheim-harbour
git log --oneline HEAD..FETCH_HEAD
git diff --stat HEAD...FETCH_HEAD
~~~

With existing work safely committed, merge into Member 1’s chosen integration branch:

~~~powershell
git merge --no-edit FETCH_HEAD
~~~

Member 1 owns the final merge into main after Windows acceptance.

## 2. Build, import, and run

Use Node.js 22.22+, Python 3.12+, and uv. Get the original team file **00_haushaltsplan_2026_2027_gesamt.pdf** from Member 2 if missing. The reviewed copy has 938 pages and SHA-256 **78e8d0f836df424ba14ad710319bc977d4d2953855ae7960b588f9afb5efc0b3**. The PDF is transferred separately from Git.

~~~powershell
npm.cmd ci
Push-Location packages/onboarding
uv sync --locked
npx.cmd --yes bun@1.4.5 install --frozen-lockfile
npx.cmd --yes bun@1.4.5 run build
uv run --locked --no-env-file python scripts/import_harbour.py --pdf "C:\actual\path\00_haushaltsplan_2026_2027_gesamt.pdf"
Pop-Location
~~~

In the repo **.env**, set **ONBOARDING_KNOWLEDGE=harbour**, **ENABLE_AVATAR=1**, and **REASONING_EFFORT=none**. Use the existing LiveKit, Beyond Presence, and Anthropic credentials and model. Also set **QDRANT_URL**, **QDRANT_API_KEY**, **OPENROUTER_API_KEY**, and **EMBEDDING_MODEL=cohere/embed-5-fast**.

**packages/onboarding/harbour-corpus/collection.json** selects the shared 768-dimensional Qdrant collection with 194 passages. Use credentials for that Qdrant project. If using another authorized Qdrant project, run **uv run --locked --no-env-file python -m onboarding.rag index --corpus harbour** from **packages/onboarding** to create and select its Harbour collection.

On a signed-in Windows desktop, run **.\start.cmd** or **.\restart.cmd** and start a call. Confirm the avatar is visible. The local map resolves the bundled handover folders at startup. Set **HARBOUR_DRIVE_FOLDER_URL** only when rehearsing with a verified team folder and a signed-in account that can open it.

## 3. Locate the features

All paths below are relative to the repository root.

| Path | What to inspect |
| --- | --- |
| **agent.mjs**, **desktop-harness.mjs**, **harbour-workspace.mjs** | Tool registration, Windows observation and control rules, workspace map injection, and reuse of the previous validated answer. |
| **onboarding-service.mjs**, **onboarding-answer.mjs** | Harbour mode, contextual query requests, speech, citation bubbles, and cached source labels. |
| **packages/onboarding/src/onboarding/harbour.py** and **harbour_catalog.py** in the same folder | Six canonical stages, the four-step funding walkthrough, linked hybrid retrieval, and exact evidence selection. |
| **workflow-tools.mjs**, **workflow-playback.mjs**, **demo/orb.js** | Drawing, speech synchronization, active stage, and returning to the sidebar when the canvas closes. |
| **packages/onboarding/browser/answers.ts** and **preview.ts** in the same folder | Citation labels and exact PDF highlighting. |
| **demo/harbour-workspace/** | 11 simulated internal files in five folders. They are separate from the public corpus and already included in Git. |
| **demo/harbour-workspace/01-Funding/Grant readiness register.txt** | Prompt 3 reads FND-014 here. Its output goes to the Windows Desktop as **Harbour funding brief.txt**. |

The merged app already injects the Harbour instructions. If porting into a separate agent, use the [copy-ready prompt and complete file inventory](harbour-agent-prompt.md) and fill in the resolved Windows paths.

## 4. Rehearse in one call

1. **“Walk me through the funding stage of the Hildesheim harbour project.”** Check that four steps draw while the avatar speaks. Close the canvas and check that the sidebar returns.
2. **“Why can’t the city apply directly, and what gets in the way if HBG applies?”** Check the separate funding barriers. Open printed p. 750, PDF 752, and verify that the original German passage highlights. Keep the p. 751 / PDF 753 railway citation available.
3. **“Find the Grant Readiness Register in the Harbour Handover folder. Read FND-014, then save its next action and our cited funding answer in Notepad on my desktop as Harbour funding brief.txt.”** Observe Explorer finding and opening the register. Check the brief separates public evidence from the simulated next action and that the file exists on the Windows Desktop.

Give prompt 3 at most 75 seconds. If it runs long, end after reading FND-014. Use the [timed pitch, demo and recording guide](hildesheim-harbour-demo.md).

Linux checks covered live contextual retrieval, the exact PDF highlight, and Rough.js scene validation. Rehearse the native Windows avatar, Explorer, and Notepad sequence before recording or merging into main.
