# Excalidraw hosting check

This check runs the pinned [Excalidraw v0.3.2 bundle](https://github.com/excalidraw/excalidraw-mcp/releases/tag/v0.3.2) over stdio, reads the HTML resource advertised by `create_view`, and mounts it in a sandboxed test iframe. It checks that a second rectangle appears only after the second partial update and that the first rectangle remains. It does not start the voice agent or need provider credentials. The pinned UI imports its renderer dependencies from `esm.sh`, so preview rendering needs access to that host.

The bundle is already installed in the current workspace. For a fresh checkout, run this from the repo in PowerShell:

```powershell
$folder = Join-Path (Get-Location) '.hcu/excalidraw-0.3.2'
New-Item -ItemType Directory -Force -Path $folder | Out-Null
$zip = Join-Path $folder 'release.zip'
Invoke-WebRequest 'https://github.com/excalidraw/excalidraw-mcp/releases/download/v0.3.2/excalidraw-mcp-app.mcpb' -OutFile $zip
if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne '2b494012b5fee5937f9f7b86f04a76cc4a91ec843ee3339b93e4e15e415274ff') {
  throw 'Excalidraw release digest mismatch.'
}
Expand-Archive -LiteralPath $zip -DestinationPath $folder
```

Run `npm run check:excalidraw`. Expect two success lines reporting the server discovery and both rendered updates.

Run `npm run preview:excalidraw` to open the **Workflow Canvas** desktop window. Click **Reveal next step** twice. The first click draws a red rectangle. The second adds a blue rectangle and retains the red one. Close the window to exit the preview. The preview uses a synthetic scene and does not require the voice session.

`npm run test:excalidraw-window` verifies both manual reveals in the Electron window.

To try the narrated walkthrough, run `restart.cmd`, start a voice session, and say “Walk me through an example maintenance request in Excalidraw. Show the intake, details check, and assignment as you explain each step.” The separate canvas should open, show each step when its narration starts, and keep earlier steps visible. Interrupt with another voice request to stop the walkthrough, or close the canvas to stop the narration.

`node --test test/workflow-tools.test.mjs` checks staged rendering in Electron, playback sequencing, and interruption with simulated audio events. The voice worker uses its audio output cue for direct speech and listens for audio returning from the Beyond Presence participant in avatar mode.
