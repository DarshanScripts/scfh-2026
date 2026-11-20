import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function loadPreview(customElements) {
  const root = new URL('./.hcu/excalidraw-0.3.2/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.version, '0.3.2');
  assert.equal(manifest.server.entry_point, 'dist/index.js');

  // The diagram subprocess receives only the SDK's default OS environment.
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL('dist/index.js', root)), '--stdio'],
    stderr: 'ignore',
  });
  const client = new Client({ name: 'scfh-excalidraw-check', version: '1.0.0' });
  const options = { timeout: 15_000 };
  try {
    await client.connect(transport, options);
    const { tools } = await client.listTools({}, options);
    assert(tools.some(({ name }) => name === 'read_me'));
    const view = tools.find(({ name }) => name === 'create_view');
    const uri = view?._meta?.ui?.resourceUri ?? view?._meta?.['ui/resourceUri'];
    assert(typeof uri === 'string' && uri.startsWith('ui://'), 'create_view must advertise a UI resource.');
    const { contents } = await client.readResource({ uri }, options);
    const html = contents.find((entry) => entry.uri === uri)?.text;
    assert(typeof html === 'string' && /<html\b/i.test(html), 'The advertised resource must contain HTML.');
    const reference = await client.callTool({ name: 'read_me', arguments: {} }, options);
    assert(!reference.isError && reference.content.some(({ type }) => type === 'text'));
    const scenes = [];
    for (const count of customElements ? [customElements.length] : [1, 2]) {
      const colors = ['#e03131', '#1971c2'];
      const elements = customElements ?? Array.from({ length: count }, (_, index) => ({
        type: 'rectangle', id: 'step-' + index, x: index * 200, y: 0, width: 140, height: 80,
        strokeColor: colors[index],
      }));
      const result = await client.callTool({
        name: 'create_view', arguments: { elements: JSON.stringify(elements) },
      }, options);
      assert(!result.isError, 'create_view rejected the ' + count + '-element fixture.');
      scenes.push({ elements, color: colors[count - 1], result });
    }
    return { html, scenes };
  } finally {
    await client.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { verifyView } = await import('./test/excalidraw-view.mjs');
  const { html, scenes } = await loadPreview();
  console.log('Excalidraw 0.3.2: tools discovered, UI resource read, and both diagram inputs accepted.');
  await verifyView(html, scenes);
  console.log('Sandboxed view: both staged diagram updates rendered.');
}
