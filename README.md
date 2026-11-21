# scfh-2026
Smart City Future Hackathon 2026

## LiveKit desktop voice agent

The worker controls native apps and browsers on the signed-in Windows desktop through [CursorTouch Windows-MCP](https://github.com/CursorTouch/Windows-MCP), pinned to version 0.8.9. LiveKit Inference provides Deepgram speech recognition and streaming Cartesia Sonic 3.6. Set the LiveKit project credentials in `.env` to use both. The worker also reads `ANTHROPIC_API_KEY`, `LLM_MODEL`, and `REASONING_EFFORT` from `.env` before checking the process environment. Conversation and screenshot interpretation both use the Anthropic Messages API. `LLM_MODEL` defaults to `claude-sonnet-5-5`, and `REASONING_EFFORT` defaults to `none`. With Sonnet 5.5, `none` turns off thinking before the response and allows short thinking updates between tool calls.

### Use the desktop sidebar

Run `start.cmd` on Windows, or `npm run start:sidebar` from this checkout. Set
`ENABLE_AVATAR=1` and configure Beyond Presence to show the live avatar. Select **Start call**
to open a LiveKit session. The sidebar sits on the right edge of the usable display.
The collapse button folds it into a small tab while the call continues. Select **End call**
to release the microphone. The launcher chooses a free local port by default. Set
`DEMO_PORT=4321` if a local integration needs a fixed address, such as the voice room test.
On Windows, use `stop.cmd` or **Alt+F4** to exit, or
`restart.cmd` to reload settings.

Ask the agent to draw a chart or walk through a process. The Rough.js canvas takes focus
as a separate view in the same Electron window. **Close canvas** restores the transcript
and any open citation. Drawing waits for the existing avatar playback signal.

### Open cited answers

Prepare the onboarding service from this checkout once.

```sh
cd packages/onboarding
uv sync --locked
bun install --frozen-lockfile
bun run build
```

Ask “Where’s the guide for logging a maintenance request, and what do I need before I open a
ticket?” Select **Intake checklist** to open page 2 in the sidebar. The document scrolls to the
verified highlight. If an exact highlight is unavailable, the viewer shows the nearest location
and explains the gap. The default source is the demo fixtures. To use an existing Qdrant index,
set `ONBOARDING_KNOWLEDGE=qdrant` and follow the setup in
[the onboarding package](packages/onboarding/README.md).

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
