# Windows release checks

This release follows [Challenge 2](../plan.md) using the fictional Facilities Service Desk. The Windows app uses reviewed fixtures and the Rough.js Workflow Canvas. The portable browser harness still exercises the Excalidraw renderer.

| Plan area | Verification |
| --- | --- |
| Evidence and contracts | The Python suite verifies reviewed claims, provenance, conflict handling, evidence gaps, and the queue deadline. Every exported contract has a valid and invalid example. Schema drift and the PDF.js offsets passed. |
| Cited answers | Electron displayed the same answer the tool sent to speech. PDF page 2 and the correct Word occurrence were highlighted. The browser harness covered citation scrolling and reduced motion. LiveKit returned audible speech and the Word citation. |
| Desktop actions | Windows-MCP opened a test window, entered text, clicked native and HTML buttons, followed a link, and reached `example.com`. Pointer sampling confirmed intermediate positions. Windows window enumeration confirmed the control border was present and the rectangular notice was absent. |
| Workflow | LiveKit narrated all seven approved steps. The canvas checks verified ordered reveals, interruption, restart, moving connected elements, and full-scene PNG export. |
| Orb and video | Electron checks covered start, cancel, end, voice-only media, and a simulated matching avatar track. Beyond Presence returned HTTP 402 for its usage limit. LiveKit Q&A and walkthrough sessions continued with working voice-only audio. |

The separate spoken desktop test transcribed the command and reached Windows-MCP. A Windows security dialog took focus and the fixture did not register the click. Re-run `npm.cmd run test:voice` after the desktop is clear.

The Anam placeholder shares the existing LiveKit avatar viewport. A future Anam adapter can publish to the same room using the server-side integration. [Anam LiveKit integration](https://anam.ai/integrations/livekit)

The plan schedules live interview capture and approved handbook publishing for a later phase. Qdrant checks exercised the local retrieval tests. Live Qdrant requires the optional provider setup in the [portable package](../packages/onboarding/README.md).

The Excalidraw diagnostic, portable harness, fixtures, and Windows window harnesses all have active test or demo entry points. Keep them when preparing the Windows presentation.
