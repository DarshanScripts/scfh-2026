import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { _electron } from 'playwright-core';
import { validateLesson } from '../packages/rough-canvas/canvas.mjs';
import { startRoughPreview, windowScript } from '../preview-roughjs.mjs';

const group = (name, x, y, text) => [
  { kind: 'rectangle', group: name, x, y, width: 160, height: 80, color: 'blue' },
  { kind: 'label', group: name, x: x + 80, y: y + 40, text },
];
const lesson = { title: 'Shared meter', steps: [
  { narration: 'The meter serves Client B and a third client.', marks: [
    ...group('meter', 100, 200, 'Meter'), ...group('client-b', 400, 180, 'Client B'),
    ...group('client-c', 780, 420, 'Client C'),
    { kind: 'arrow', x1: 260, y1: 230, x2: 400, y2: 230, from: 'meter', to: 'client-b' },
  ] },
  { narration: 'Zoom in and move Client B.', marks: [], actions: [
    { kind: 'focus', group: 'client-b', zoom: 2 }, { kind: 'move', group: 'client-b', dx: 100, dy: 50 },
  ] },
] };

async function until(check, message) {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const result = await check();
    if (result) return result;
    assert(Date.now() < deadline, message);
    await delay(75);
  }
}

test('lesson validation rejects links to nodes that are not yet drawn', () => {
  assert(validateLesson(lesson));
  const marks = [{ kind: 'arrow', x1: 260, y1: 230, x2: 400, y2: 230, from: 'meter', to: 'client-b' }];
  assert(!validateLesson({ ...lesson, steps: [{ narration: 'Draw early.', marks }, ...lesson.steps] }));
});

test('the Windows Rough.js panel acknowledges drawing, moves connectors, and exports the full scene while zoomed', async () => {
  const id = randomUUID();
  const closed = Promise.withResolvers();
  const preview = await startRoughPreview({ id, onClose: closed.resolve });
  const folder = await mkdtemp(join(tmpdir(), 'scfh-rough-png-'));
  const file = join(folder, 'workflow.png');
  let app;
  try {
    const forbidden = await fetch(preview.url + '/control', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://example.test' }, body: JSON.stringify({ id, type: 'ready' }) });
    assert.equal(forbidden.status, 403);
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
      args: [windowScript, preview.url], env: getDefaultEnvironment() });
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await app.evaluate(({ BrowserWindow }, path) => {
      BrowserWindow.getAllWindows()[0].webContents.session.once('will-download', (_event, item) => item.setSavePath(path));
    }, file);
    await until(preview.isReady, 'The canvas did not become ready');
    await preview.send({ type: 'begin', title: lesson.title, total: lesson.steps.length });
    await assert.rejects(preview.send({ type: 'step', index: 1, ...lesson.steps[1] }), /rejected/);
    await preview.send({ type: 'step', index: 0, ...lesson.steps[0] });
    const connector = page.locator('[data-connector] path').first();
    const original = await connector.getAttribute('d');
    await preview.send({ type: 'step', index: 1, ...lesson.steps[1] });
    assert.notEqual(await connector.getAttribute('d'), original);
    assert.equal(await page.locator('[data-group="client-b"]').first().getAttribute('transform'), 'translate(100 50)');
    assert.notEqual(await page.locator('svg').getAttribute('viewBox'), '0 0 1000 600');
    await preview.send({ type: 'completed' });
    await page.getByRole('button', { name: 'Save as PNG' }).click();
    const png = await until(async () => {
      const content = await readFile(file).catch(() => undefined);
      return content?.length >= 24 && content;
    }, 'The export did not create a PNG');
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16), 2000);
    assert.equal(png.readUInt32BE(20), 1200);
    const pixel = await page.evaluate(async (base64) => {
      const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), byte => byte.charCodeAt(0))], { type: 'image/png' }));
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        context.drawImage(image, 1620, 860, 1, 1, 0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data];
      } finally { URL.revokeObjectURL(url); }
    }, png.toString('base64'));
    assert.deepEqual(pixel, [233, 239, 248, 255], 'The offscreen Client C card is in the exported image');
    await page.getByRole('button', { name: 'Close canvas' }).click();
    await closed.promise;
  } finally {
    preview.close();
    await app?.close();
    await unlink(file).catch(() => {});
    await rmdir(folder);
  }
});

test('a pause cancels the current drawing and rejects late steps', async () => {
  const preview = await startRoughPreview({ id: randomUUID(), onClose() {} });
  let app;
  try {
    app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'),
      args: [windowScript, preview.url], env: getDefaultEnvironment() });
    const page = await app.firstWindow();
    await until(preview.isReady, 'The canvas did not become ready');
    await preview.send({ type: 'begin', title: lesson.title, total: lesson.steps.length });
    const pending = assert.rejects(preview.send({ type: 'step', index: 0, ...lesson.steps[0] }), /rejected/);
    await page.getByText('Step 1 of 2').waitFor();
    await preview.send({ type: 'paused' });
    await pending;
    await page.getByText('Drawing paused').waitFor();
    assert.equal(await page.locator('[data-step]').count(), 0);
    await assert.rejects(preview.send({ type: 'step', index: 1, ...lesson.steps[1] }), /rejected/);
  } finally {
    preview.close();
    await app?.close();
  }
});
