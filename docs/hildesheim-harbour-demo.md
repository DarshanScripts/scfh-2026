# Relay jury demo · Hildesheim Harbour funding handover

**One role, one decision.** You are the new city employee asked to explain why a harbour project can qualify for funding on paper yet have no workable application. Follow that decision from the workflow to the exact budget passage, then leave a cited handover note in Notepad.

## Two-minute pitch

| Time | What to say or show |
| --- | --- |
| 0:00–0:30 | “Imagine taking over the Hildesheim harbour expansion. The October and November 2025 materials estimated about €105 million for 2026–2040. The new employee needs to know which grants were considered, who could apply, and what could block the application.” Show the original budget cover or a cropped funding page. |
| 0:30–1:00 | “The answer is spread across a proposal, an amendment, a council resolution and budget tables. Relay keeps those documents distinct and carries each claim back to the original page.” Use one simple visual: **proposal → council decision → budget**. |
| 1:00–1:35 | “Ask the avatar to explain a stage. It draws the options as it speaks. Then ask a follow-up as you would ask a colleague. Relay remembers the stage and retrieves the linked evidence.” Show a still of the canvas and a clipped citation card. |
| 1:35–2:00 | “A new colleague can verify the decision and get back to the source file from the same conversation. We’ll show all three steps live.” Switch to the already connected Windows sidebar. |

The €105 million figure is a preliminary project estimate, not a claim of blanket appropriations. The published budget and adopted 15 December 2025 resolution specify individual measures and conditions. Funding conditions shown live are findings in Vorlage 25/426 from October 2025. They do not establish current programme availability.

## Three-minute live demo · say exactly these three prompts

| Time | Prompt | What the jury should see and hear |
| --- | --- | --- |
| 0:00–0:45 | **“Walk me through the funding stage of the Hildesheim harbour project.”** | Beyond Presence avatar and live transcript. The sidebar gives focus to the Rough.js canvas. Four reveals show programme choice, combined transport, railway renewal, and the next check. Two branches make it clear that the federal programmes have different rules. Close the canvas after the last step. |
| 0:45–1:45 | **“Why can’t the city apply directly, and what gets in the way if HBG applies?”** | The question omits the project and the stage. Relay uses the funding context and retrieves eligibility, HBG’s role, the absence of funds in the federal KV programme at the time, and the operator’s own-contribution issue under SGFFG. Click **Vorlage 25/426 · p. 750 (PDF 752)** and show the German highlight. Keep the second citation visible for **p. 751 (PDF 753)**. |
| 1:45–3:00 | **“Open the Harbour source folder, find the 2026–2027 budget PDF, then put the funding answer and its source pages into Notepad. Save it on my desktop as `Harbour funding brief.txt`.”** | Relay opens the mapped directory in File Explorer and searches for `00_haushaltsplan_2026_2027_gesamt.pdf`. It carries the validated answer and cited pages from prompt 2 into Notepad, saves the file, and checks that it exists. Let the jury see the matching PDF and the saved brief. |

Say HBG as “H B G” if transcription needs help. Keep the second question short. The German source gives separate reasons: for KV, MCON said the city was ineligible, named HBG as a possible private applicant and reported the programme had no funds at the time. For SGFFG, it identified HBG as the operator and said it could not show the required own contribution. EFRE is a separate option with funds already committed, and it is covered in the first prompt. Avoid a general claim that municipalities can never apply for harbour grants.

## Windows setup for Member 1

1. Start with `git fetch origin feat/hildesheim-harbour` and review `git log main..origin/feat/hildesheim-harbour --oneline`. Merge the feature branch into your integration branch, then follow the root [README](../README.md) for Node, uv, and browser bundle setup.
2. Obtain the exact 938-page source file `00_haushaltsplan_2026_2027_gesamt.pdf` from the team workspace. Its SHA-256 is `78e8d0f836df424ba14ad710319bc977d4d2953855ae7960b588f9afb5efc0b3`. From `packages/onboarding`, run:

   ```powershell
   uv run --locked --no-env-file python scripts/import_harbour.py --pdf "C:\path\to\00_haushaltsplan_2026_2027_gesamt.pdf"
   ```

3. In the root `.env`, set `ONBOARDING_KNOWLEDGE=harbour`, `ENABLE_AVATAR=1`, and `REASONING_EFFORT=none`. Use the existing LiveKit, Beyond Presence, and Anthropic configuration, plus `QDRANT_URL`, `QDRANT_API_KEY`, `OPENROUTER_API_KEY`, and `EMBEDDING_MODEL=cohere/embed-5-fast` for the shared collection. The checked-in [collection reference](../packages/onboarding/harbour-corpus/collection.json) is public metadata only. Qdrant credentials must grant access to that project and collection.
4. Run `start.cmd` (or `restart.cmd` if already running). On a signed-in Windows desktop, verify the three prompts once before the jury slot. Start the call and confirm the avatar video before the three-minute timer. Close other Explorer windows or foreground dialogs that could confuse the navigation demo.

If the existing Qdrant credentials connect to a different project, run `uv run --locked --no-env-file python -m onboarding.rag index --corpus harbour` from `packages/onboarding` to create a new Harbour collection and select it locally. This does not repoint Denton. The browser preview needs the imported original PDF even when the hosted vectors already exist.

## Workspace map and optional Drive route

The local map resolves the imported budget folder for this checkout and records the exact filename. Relay uses the original PDF in the knowledge base to read evidence in prompt 2. In prompt 3 it finds the file in the workspace and reuses the previous validated answer and exact citation labels. This keeps the note tied to what the jury just saw.

To rehearse Drive instead, add `HARBOUR_DRIVE_FOLDER_URL` to the root `.env` with the verified `https://drive.google.com/drive/folders/…` link, restart, and use a signed-in browser account with access to the folder. Confirm that the folder contains the same budget revision. Replace prompt 3 with “Open the Harbour Funding folder in Google Drive, find the 2026–2027 budget PDF, then save our funding answer and its source pages in Notepad on my desktop as Harbour funding brief.txt.” Use one route during the timed demo.

## Rehearsal and evidence gaps

- **Live dependencies.** Start the room ahead of time. Confirm the avatar microphone, voice, funding follow-up and PDF preview, then time the full Explorer-to-Notepad sequence on the same Windows desktop. Use a fresh brief filename or move the rehearsal copy before the demo. If the final sequence runs over 75 seconds, shorten prompt 3 to “Open the Harbour source folder and find the 2026–2027 budget PDF.” Keep PNG export for a jury follow-up. Keep a captured walkthrough and a screenshot of the funding rules on backup slides. If a provider fails live, identify the backup as recorded.
- **Source gaps.** The budget references Vorlagen 24/194 and 24/195; the standalone documents were not found in this compilation. Grants discussed in 2025 do not establish current eligibility or award status. Direct receipts of about €39.2 million through 2095 exclude unquantified tax receipts. Keep the October cost estimate, proposal, Council decision, and budget classifications separate.
- **Optional jury questions, outside the timed script.** “What was approved for the western quay?” → €1.5 million of 2027 planning funds and a 2028 commitment authorization. “When must the committees hear about changes?” → project report in the meeting after the summer break, and immediate notice of material changes to the construction programme or cost deviation above 10%. Both are in the recorded Council resolution at printed p. 787 (PDF 789).
- **Platform limit.** The Linux browser harness exercises the same retrieval and original PDF viewer, plus a simulated canvas. The final avatar, Rough.js, File Explorer and Notepad sequence needs rehearsal on Windows. The optional Drive route also needs a verified link and an account with folder access. The existing Facilities mode remains useful for a separate Word citation demonstration.

See [Harbour corpus and retrieval](../packages/onboarding/harbour-corpus/README.md) for source selection and architecture.
