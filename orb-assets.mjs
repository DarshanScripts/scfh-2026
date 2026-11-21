import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const fromRoot = (path) => new URL(path, import.meta.url);

export async function loadOrbAssets() {
  const [html, style, sdk, bundle] = await Promise.all([
    readFile(fromRoot('./demo/index.html')),
    readFile(fromRoot('./demo/orb.css')),
    readFile(fromRoot('./node_modules/livekit-client/dist/livekit-client.umd.js')),
    build({
      entryPoints: [fileURLToPath(fromRoot('./demo/orb.jsx'))],
      bundle: true, write: false, minify: true, jsx: 'automatic',
      define: { 'process.env.NODE_ENV': '"production"' },
    }),
  ]);
  return new Map([
    ['/', ['text/html; charset=utf-8', html]],
    ['/orb.css', ['text/css; charset=utf-8', style]],
    ['/orb.js', ['text/javascript; charset=utf-8', bundle.outputFiles[0].contents]],
    ['/livekit.js', ['text/javascript; charset=utf-8', sdk]],
  ]);
}
