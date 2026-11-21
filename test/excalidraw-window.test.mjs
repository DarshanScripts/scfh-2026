import assert from 'node:assert/strict';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { _electron } from 'playwright-core';
import { startPreview, windowScript } from '../preview-excalidraw.mjs';

test('the Windows canvas reveals the two stages in order', async () => {
  const { server, url } = await startPreview();
  let app;
  try {
    app = await _electron.launch({
      executablePath: createRequire(import.meta.url)('electron'),
      args: [windowScript, url],
      env: getDefaultEnvironment(),
    });
    const page = await app.firstWindow();
    const frame = page.frameLocator('iframe');
    const first = frame.locator('svg [stroke="#e03131"]');
    const second = frame.locator('svg [stroke="#1971c2"]');
    const advance = page.getByRole('button', { name: 'Reveal next step' });
    await advance.click({ timeout: 20_000 });
    await first.first().waitFor();
    assert.equal(await second.count(), 0);
    await advance.click();
    await second.first().waitFor();
    assert(await first.count());
    assert(await advance.isDisabled());
  } finally {
    await app?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Save as PNG exports the completed scene beyond the viewport', async () => {
  const elements = [
    { type: 'cameraUpdate', x: 0, y: 0, width: 450, height: 300 },
    { type: 'rectangle', id: 'first', x: 15, y: 20, width: 140, height: 80, strokeColor: '#e03131' },
    { type: 'rectangle', id: 'later', x: 1400, y: 900, width: 140, height: 80, strokeColor: '#1971c2' },
    { type: 'text', id: 'caption', x: 1400, y: 950, text: 'Last step', fontFamily: 2, fontSize: 18 },
  ];
  const { server, url, reveal, finish } = await startPreview({ elements, narrated: true });
  const folder = await mkdtemp(join(tmpdir(), 'scfh-workflow-'));
  const file = join(folder, 'workflow.png');
  let app;
  try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [windowScript, url], env: getDefaultEnvironment() });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }, path) => {
      BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => item.setSavePath(path));
    }, file);
    const save = page.getByRole('button', { name: 'Save as PNG' });
    await page.getByText('Waiting for narration').waitFor();
    reveal(elements.slice(0, 2), 1, 2);
    await page.getByText('Step 1 of 2').waitFor();
    assert(await save.isDisabled());
    finish();
    await save.click();
    const deadline = Date.now() + 15_000;
    let png;
    while (!png) {
      png = await readFile(file).catch(() => undefined);
      if (png?.length >= 24) break;
      assert(Date.now() < deadline, 'PNG export did not produce a file');
      png = undefined;
      await delay(100);
    }
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert(png.readUInt32BE(16) >= 1500 && png.readUInt32BE(20) >= 950, 'Export should include the off-screen rectangle');
  } finally {
    await app?.close();
    server.closeAllConnections();
    server.close();
    await unlink(file).catch(() => {});
    await rmdir(folder);
  }
});
