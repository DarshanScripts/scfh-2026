import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
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
