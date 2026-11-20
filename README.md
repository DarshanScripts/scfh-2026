# scfh-2026
Smart City Future Hackathon 2026

## LiveKit desktop voice agent

The worker controls native apps and browsers on the signed-in Windows desktop through [CursorTouch Windows-MCP](https://github.com/CursorTouch/Windows-MCP), pinned to version 0.8.9. LiveKit Inference provides Deepgram speech recognition and streaming Cartesia Sonic 3.6. Set the LiveKit project credentials in `.env` to use both. The worker also reads `ANTHROPIC_API_KEY`, `LLM_MODEL`, and `REASONING_EFFORT` from `.env` before checking the process environment. Conversation and screenshot interpretation both use the Anthropic Messages API. `LLM_MODEL` defaults to `claude-sonnet-5-5`, and `REASONING_EFFORT` defaults to `none`. With Sonnet 5.5, `none` turns off thinking before the response and allows short thinking updates between tool calls.

### Use the floating voice agent

The desktop orb creates a room in your LiveKit Cloud project when you click its microphone. The worker runs on your Windows PC and uses LiveKit Inference for speech. To select another voice, set `CARTESIA_VOICE_ID`.

1. Run `start.cmd` in an unlocked Windows desktop session. A floating orb appears near the bottom right. Drag its rim to move it.
2. Click the microphone in the orb. When the rim turns green, say **“Open Calculator.”** Hover over the center to see the call status.
3. Click the stop square to disconnect and release the microphone. Use `stop.cmd` or **Alt+F4** while the orb has focus to close it, or `restart.cmd` to reload settings. If startup fails, see `.hcu/demo.error.log` and `.hcu/demo.log`.

English is the default for recognition and replies. If the agent and room are already running, an automated Windows check can send a recorded command through the same LiveKit microphone track, verify a real click in a temporary app, and check the returned audio. Run `npm run test:voice` in a second terminal.

Run `npm run test:orb` to check the floating window and call cancellation with a simulated microphone.

See [Windows acceptance](docs/windows-acceptance.md) for the baseline audit and the cursor and avatar review steps.

### Try cited onboarding answers

Prepare the sample Facilities Service Desk documents once from the repo root, then run `restart.cmd` as usual. This builds the companion panel and prepares the Python service that starts with the orb.

```powershell
Push-Location packages/onboarding
uv sync --locked
npx.cmd --yes bun@1.4.5 install --frozen-lockfile
npx.cmd --yes bun@1.4.5 run build
Pop-Location
```

Start a call and ask “Where’s the guide for logging a maintenance request, and what do I need before I open a ticket?” The Facilities Onboarding window displays the spoken answer. Click **Intake checklist** to open the highlighted PDF passage on page 2. Ask “A maintenance ticket still has no owner. When should I follow up, and who do I tell?” for the Word citation. Ask “What budget do we have for repairs?” to check the reply for missing evidence. The integration uses reviewed demo fixtures. The standalone package documents the separate Qdrant mode.

Run `node --test test/onboarding-answer.test.mjs` to verify the answer and citation panel locally with the fixture service and simulated voice events.

### Setup

1. Install Node.js 22 or newer and run `npm ci` in this repository.
2. Use the existing `.env`, or copy `.env.example` to `.env` and fill in your LiveKit Cloud and Anthropic credentials.
3. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) on Windows and run from your unlocked desktop. The worker uses `uvx` to start the pinned package over stdio. The first run may download Python 3.14 and dependencies. If needed, put the full path to `uvx.exe` in `WINDOWS_MCP_UVX`. Linux desktop control requires a separate driver.

### Connect to LiveKit Cloud

```sh
npm run check:desktop
npm run dev
```

The first command verifies that Windows-MCP can read the local desktop. The second registers the worker with LiveKit. Use the [LiveKit Agent Console](https://docs.livekit.io/testing/agent-console/) or a LiveKit client that dispatches `handbook-windows`. For a room you already know the name of, use `npm run connect -- --room ROOM_NAME` instead of `npm run dev`.

Start with “Which windows are open?” Then try “Open Calculator.” The agent reads app controls from Windows-MCP snapshots and sends mouse and keyboard input to the desktop. If it needs a screenshot, the worker sends that image to the configured Claude model for interpretation.

For the Beyond Presence avatar, set `ENABLE_AVATAR=1` and `BEYOND_PRESENCE_API_KEY`. `BEY_AVATAR_ID` is optional. Use the screen share feature in your LiveKit client to show the controlled desktop alongside the avatar. The desktop control is local to the worker even when the viewer connects from a different computer.

### Verify Windows desktop control

The desktop harness requires a fresh observation before each input action, runs one desktop tool at a time, and stops sending input for the current request if desktop control is interrupted or denied. The agent stays quiet while it works and reports the observed outcome once. The workflow follows [LiveKit's tool loop guidance](https://docs.livekit.io/agents/logic/tools/design/) and uses the [Windows-MCP observation and input tools](https://github.com/CursorTouch/Windows-MCP#-mcp-tools).

Run `npm run test:desktop:windows` from the unlocked Windows desktop. It samples the real cursor as it travels to a text field and button, then exercises the voice agent's desktop toolset from a LiveKit session with a scripted model. It verifies that the pointer glides to a browser button and the click reaches the test page. Add `-- --public` to verify that the browser can also open `example.com`. These checks run without provider credentials. A separate LiveKit room is needed to verify microphone input and spoken replies.

The voice agent's [Windows-MCP settings](windows-mcp.toml) skip the desktop approval prompt and keep the control handoff enabled. Press **Ctrl+Alt+Shift+Backspace** to take back control. On an idle test desktop, add `-- --no-control` to test fixture input without the Windows-MCP control overlay.
