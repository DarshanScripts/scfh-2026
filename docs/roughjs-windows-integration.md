# Rough.js canvas handoff for Member 1

Use the feature branch `feat/roughjs-canvas` from
[DarshanScripts/scfh-2026](https://github.com/DarshanScripts/scfh-2026). It is based on
`origin/develop` at `7b9bbf6`, where the Windows app already has the Beyond Presence avatar,
LiveKit voice, Windows computer use, onboarding answers, and the Excalidraw walkthrough.

The branch delivers the portable Rough.js canvas and its typed data contract, browser panel,
and npm dependency. Wire it into your existing Windows app. The separate Linux tutor and its
launcher are outside this feature.

## Get the feature

Fetch from your existing Windows checkout. Review the diff, then cherry-pick the single feature
commit onto your current Windows integration branch. This keeps your local agent changes as the
base. Run these commands from a clean working tree.

```powershell
git status -sb
git fetch origin
git show --stat origin/feat/roughjs-canvas
git cherry-pick origin/feat/roughjs-canvas
npm ci
```

If the manifests conflict, resolve `package.json` first and keep your current dependencies
alongside `"roughjs": "4.6.6"`. For a conflicted lockfile, use
`git checkout --ours -- package-lock.json` as a starting point, then regenerate it with
`npm install --save-exact --package-lock-only roughjs@4.6.6`. Stage the resolved files and run
`git cherry-pick --continue` before `npm ci`. No extra environment variables or provider
credentials are needed.

## What to read

| File | Use |
| --- | --- |
| `packages/rough-canvas/contract.mjs` | Tool JSON schema, size limits, and geometry and connector checks. |
| `packages/rough-canvas/canvas.mjs` | `validateLesson`, `validateStep`, and the Rough.js SVG renderer with stroke animation, camera transitions, and movable nodes. |
| `packages/rough-canvas/panel.mjs` and `panel.css` | Ready to mount panel with captions, ordered steps, interruption, and Close. |
| `workflow-tools.mjs` | Current `draw_workflow` tool, preview lifecycle, and session-owned narration. |
| `workflow-playback.mjs` and `agent.mjs` | Existing speech timing, Beyond Presence audio signal, tool registration, new turn interruption, and shutdown. |
| `preview-excalidraw.mjs`, `demo/canvas.html`, `demo/canvas.js`, and `excalidraw-window.cjs` | Current loopback server and sandboxed Electron window. |

Inspect your current code before applying the edits below. Paths refer to the published base.

## Replace the Windows preview

1. Reuse the sandboxed Electron canvas window in `excalidraw-window.cjs`. Use the title
   **Workflow Canvas** and, if you rename the launcher, update its caller. Keep the
   loopback URL restriction, disabled Node integration, denied permissions, and navigation
   guard. Open this window through the existing child process lifecycle.
2. Replace the Excalidraw-specific preview in `preview-excalidraw.mjs` with a local preview
   server, for example `preview-roughjs.mjs`. Remove calls to `loadPreview()`, the MCP App
   iframe and bridge, `/view`, and `/scenes` from this walkthrough route. Bind only to
   `127.0.0.1` on an ephemeral port. Add a fixed allowlist for the local HTML shell,
   bootstrap JavaScript, the three shipped modules, `panel.css`, and
   `node_modules/roughjs/bundled/rough.js`. Serve `.mjs` as JavaScript and the Rough.js bundle
   as a classic script. Let module imports resolve together in one path, such as
   `/rough/panel.mjs`, `/rough/canvas.mjs`, and `/rough/contract.mjs`.
3. In the HTML shell, load `/rough/panel.css` and the local Rough.js browser bundle before
   the module bootstrap. Give the panel container a height, for example `100vh`, through
   the host stylesheet. Keep a same-origin CSP and the window’s existing credential-free child
   environment. The renderer needs drawing data only.

```js
import { mountRoughPanel } from '/rough/panel.mjs';

const panel = mountRoughPanel(document.querySelector('#workflow-canvas'), {
  onClose: (id) => postControl({ type: 'close', id }),
});

// Register before acknowledging that the window is ready.
attachUpdates(async ({ message, messageId }) => {
  const result = await panel.receive(message);
  await postControl({ type: 'ack', id: message.id, messageId, result });
});
```

`postControl` and `attachUpdates` are host functions. The existing `/updates` SSE feed can
deliver the message envelope. Add a bounded same-origin POST route for ready, acknowledgment,
and close. Check Host, Origin and a per-window nonce, use unique message IDs, and accept only
the active run ID. Resolve the send promise only after the matching renderer acknowledgment.
Reject a missing or non-`ok` acknowledgment after a finite timeout. Do not replay an
unacknowledged old step into a new run. Close streams, cancel pending waits, and release the
window from the existing shutdown and child exit handlers. A direct Electron bridge can use
the same contract if your current code has a trusted preload.

## Drive one canvas step per spoken step

Keep `agent.mjs` on your Windows voice path. Keep
`listenForAvatarAudio()`, `playWorkflowStep()`, and the existing
`createWorkflowTools()` lifecycle. Update the existing tool in `workflow-tools.mjs` to
describe Rough.js. It should continue to open or close the canvas through your own worker.

- For the current workflow tool contract, replace `buildWorkflow()` with a deterministic
  mapper. Give each node a stable ID such as `step-0`, use that `group` on the node and its
  label, and lay out nodes within the 1000 by 600 scene. Convert each edge to an `arrow` with
  `from` and `to` set to the node IDs and endpoints on the node borders. Add an edge when both
  ends are visible. Add any branch labels as separate `label` marks. Preserve decisions,
  handoffs, exceptions, and source gaps from the workflow. For documented procedures, use
  the validated steps and evidence behind the existing walkthrough.
- For free-form diagrams or charts, let a tool generate `{ title, steps }` using
  `lessonSchema`. Validate the full plan with `validateLesson()` before starting. Input limits
  are 1–16 steps, 16 marks and 2 camera or move actions per step, and 230 characters per
  narration. A step must draw something or perform an action. Prefer a readable layout and
  split crowded diagrams. Clamp or split long upstream labels to fit the canvas contract.
- After the renderer is ready, send `{ type: 'begin', id, title, total }`. For each step,
  use `playWorkflowStep()` with the existing avatar audio signal. Inside its `reveal`
  callback, send `{ type: 'step', id, index, narration, marks, actions }` and capture that
  promise. Handle a rejection immediately to avoid an unhandled rejection during speech,
  then await the promise before advancing. The `index` is zero based. The existing
  `reveal` callback is synchronous, so returning its promise alone will not wait for the canvas.
- Advance only after avatar playout and the renderer's `ok` acknowledgment. The panel
  acknowledges a step after its final animation frame. Finish with `{ type: 'completed', id }`.
  Keep the completed window visible. On interruption send `paused` for that run and stop
  pending speech and sends. On failure send `failed`. On Close, abort the run and dismiss
  the window. Use a fresh ID for subsequent walkthroughs. Keep your existing
  `onUserTurnCompleted` and shutdown behavior.
- Optional actions are `{ kind: 'focus', group: 'client-b', zoom: 2 }`,
  `{ kind: 'move', group: 'client-b', dx: 100, dy: 40 }`, and `{ kind: 'fit' }`.
  Actions run before new marks in the same step. Their targets must have appeared in an
  earlier step. The camera follows a focused node as it moves. Arrows with matching
  `from` or `to` endpoints redraw during the move.
- Keep the avatar playback-start signal as the reveal gate. The standalone Linux tutor's
  generic speaking state does not establish audible Beyond Presence playback.

## Windows acceptance

1. Use the existing `start.cmd` and enable the avatar with your existing configuration.
   Confirm voice, avatar playback, desktop navigation, and citation previews.
2. Ask “Walk me through a maintenance request from intake to handoff.” Check ordered
   drawing, branch labels, narration, and a finished diagram that stays open.
3. Ask “Draw three clients sharing an electricity meter. Zoom into client B, move it
   while keeping its connection attached, then zoom out.” Check the connector tracks
   the movement and the overview returns. Try a chart separately.
4. Close during a step, interrupt by speaking, and start a new walkthrough. Check the
   old run cannot draw into the new panel. Close a completed panel and confirm the avatar
   session still works.
5. If PNG export is needed for the demo, add it in the Windows host. This canvas package
   does not expose an exporter. Export the original full scene, including content outside
   the current zoomed viewport.

The source renderer was exercised on Linux with spoken line and bar charts, a profile icon,
a branching flowchart, and a shared meter with zoom and a moving client. Windows and Beyond
Presence synchronization still need the checks above. The combined chart and meter example
passed a renderer fixture; a single live request for the whole dashboard timed out.
