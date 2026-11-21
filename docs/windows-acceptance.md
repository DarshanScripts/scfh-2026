# Windows release checks

This release follows [Challenge 2](../plan.md) using the fictional Facilities Service Desk. The Windows app uses reviewed fixtures and the Rough.js Workflow Canvas. The portable browser harness still exercises the Excalidraw renderer.

`start.cmd` opens the Electron sidebar with live transcripts, inline PDF and Word citations, source fullscreen, and collapse and expand controls. The Rough.js canvas opens in a separate window. The Electron test verifies that the canvas and sidebar take up 50% and 30% of the display work area. Both hide during desktop control. The sidebar returns without taking focus, while the drawing stays available through **Show canvas**. The sidebar transport acknowledges drawing updates before continuing narration. The original integration also passed live avatar Q&A and seven-step walkthrough checks.

| Plan area | Verification |
| --- | --- |
| Evidence and contracts | The Python suite verifies reviewed claims, provenance, conflict handling, evidence gaps, and the queue deadline. Every exported contract has a valid and invalid example. Schema drift and the PDF.js offsets passed. |
| Cited answers | Electron displayed the same answer the tool sent to speech. PDF page 2 and the correct Word occurrence were highlighted. The browser harness covered citation scrolling and reduced motion. LiveKit returned audible speech and the Word citation. |
| Desktop actions | Windows-MCP opened a test window, entered text, clicked native and HTML buttons, followed a link, and reached `example.com`. Pointer sampling confirmed intermediate positions. Windows window enumeration confirmed the control border was present and the rectangular notice was absent. |
| Workflow | A live Beyond Presence session narrated all seven approved steps. The canvas checks verified ordered reveals, interruption, restart, moving connected elements, and full-scene PNG export. |
| Orb and video | The Electron orb joined a real LiveKit room using a scripted microphone. Local tests covered cancel, end, voice-only media, and a simulated matching avatar track. A live cited Q&A session verified Beyond Presence video and audible speech. An earlier usage-limit test verified the voice-only fallback. |

The live spoken desktop check with Beyond Presence transcribed the command, clicked the native Windows button, and verified the fixture callback. During desktop actions, keep the mouse and keyboard idle and clear any system dialog covering the target.

The Anam placeholder shares the existing LiveKit avatar viewport. A future Anam adapter can publish to the same room using the server-side integration. [Anam LiveKit integration](https://anam.ai/integrations/livekit)

The plan schedules live interview capture and approved handbook publishing for a later phase. Qdrant checks exercised the local retrieval tests. Live Qdrant requires the optional provider setup in the [portable package](../packages/onboarding/README.md).

The Excalidraw diagnostic, portable harness, fixtures, and Windows window harnesses all have active test or demo entry points. Keep them when preparing the Windows presentation.
