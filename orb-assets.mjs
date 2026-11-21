import { readFile } from 'node:fs/promises';

const fromRoot = (path) => new URL(path, import.meta.url);

export async function loadOrbAssets() {
  const routes = [
    ['/', './demo/index.html', 'text/html'],
    ['/sidebar.css', './demo/sidebar.css', 'text/css'],
    ['/orb.js', './demo/orb.js', 'text/javascript'],
    ['/livekit.js', './node_modules/livekit-client/dist/livekit-client.umd.js', 'text/javascript'],
    ['/rough/rough.js', './node_modules/roughjs/bundled/rough.js', 'text/javascript'],
    ...['panel.mjs', 'canvas.mjs', 'contract.mjs', 'export.mjs', 'panel.css'].map(name =>
      ['/rough/' + name, './packages/rough-canvas/' + name, name.endsWith('.css') ? 'text/css' : 'text/javascript']),
  ];
  return new Map(await Promise.all(routes.map(async ([route, file, type]) =>
    [route, [type + '; charset=utf-8', await readFile(fromRoot(file))]])));
}
