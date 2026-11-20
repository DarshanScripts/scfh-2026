# Windows baseline and feature review

## Baseline audit

- Git baseline: `05bd16d2197e65eb5512594aaf0670e284379671`. The Windows app is in the working tree and has not been published from this checkout.
- Local runtime: Node.js 22.14.0, uv 0.12.5, and Python 3.14.7 for Windows-MCP 0.8.9. The npm lockfile pins LiveKit Agents and its Beyond Presence plugin to 1.10.1, LiveKit Client to 2.25.0, and Electron to 45.4.1.
- Launch with `start.cmd`, reload with `restart.cmd`, and stop with `stop.cmd`. The running baseline served its loopback orb successfully. `.env` is ignored.
- [demo.mjs](../demo.mjs) handles room dispatch at `POST /connect`. [floating-window.cjs](../floating-window.cjs) opens the Windows orb and grants its main frame microphone access. [demo/orb.js](../demo/orb.js) captures the microphone, publishes the audio track, and selects playback media.
- [agent.mjs](../agent.mjs) configures Deepgram transcription, the Claude model, Cartesia speech, and the optional Beyond Presence session. Its LLM hook suppresses speech on tool-calling turns. [desktop.mjs](../desktop.mjs) registers the Windows-MCP tools through `createDesktopTools`. [desktop-harness.mjs](../desktop-harness.mjs) guards desktop input. [windows-mcp-cursor.py](../windows-mcp-cursor.py) moves the actual Windows pointer.
- The baseline orb previously forced the avatar off and attached audio tracks only. There is no source viewer to reuse for PDF or Word highlighting. The portable knowledge package, validated answer cards, contract turn IDs, Excalidraw host, and narrated playback synchronization are separate integration work.

## Feature 1: Cursor glide

The pointer eases in and out, with distance-based timing capped at 1.15 seconds. The Windows test measured 22 intermediate positions over 373 ms for typing, 22 over 358 ms for a native click, and 64 over 1,064 ms for a 1,794 px LiveKit browser click. The text entry, native button callback, browser button callback, and link navigation all passed. The test used a scripted model and ran the fixture driver without its control overlay.

**Manual review:** With avatar mode off, run `restart.cmd`. Open Calculator and leave it near one edge of the screen. Start a call on the orb, say **“Click seven in Calculator,”** and keep the mouse still. Watch for a visible glide from the orb to the **7** button and one click when it arrives.

## Feature 2: Beyond Presence media in the orb

The orb can opt into Beyond Presence. It plays audio and video from the avatar publishing on behalf of the session's agent, shows video inside the circle, and removes those tracks on disconnect. This uses [LiveKit's published-on-behalf identity](https://docs.livekit.io/agents/models/avatar/#avatar-workers) and the [Beyond Presence plugin](https://docs.livekit.io/agents/models/avatar/plugins/bey/).

**Manual review:** After replacing the provider credentials identified in the plan, set `ENABLE_AVATAR=1` and configure `BEYOND_PRESENCE_API_KEY` in `.env`. Use a LiveKit Cloud room for this check. Run `restart.cmd`, click the microphone on the orb, and wait for the avatar. Say **“Which windows are open?”** and listen for synchronized speech while the portrait moves. Then try **“Open Downloads in File Explorer”** and **“Open example.com in a new Chrome tab.”** Verify the two destinations and that the orb returns to its idle display after ending the call.

The simulated media checks cover correct participant selection, voice-only playback, video attachment, and disconnect cleanup. Actual avatar speech synchronization and the two live desktop commands remain manual acceptance checks.
