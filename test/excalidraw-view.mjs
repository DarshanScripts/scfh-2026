import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio';
import { chromium } from 'playwright-core';

export async function verifyView(html, scenes) {
  const executablePath = [
    process.env.DESKTOP_TEST_BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find((path) => path && existsSync(path));
  assert(executablePath, 'Set DESKTOP_TEST_BROWSER to a Chromium executable.');
  const browser = await chromium.launch({ executablePath, env: getDefaultEnvironment() });
  const fixture = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (request.url === '/view') response.end(html);
    else response.end('<iframe title="Excalidraw preview" sandbox="allow-scripts" width="740" height="550"></iframe>');
  });
  try {
    await new Promise((resolve, reject) => fixture.once('error', reject).listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + fixture.address().port;
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text().slice(0, 250));
    });
    await page.route(/^https?:\/\//, (route) => {
      const destination = new URL(route.request().url()).origin;
      return destination === origin || destination === 'https://esm.sh' ? route.continue() : route.abort();
    });
    await page.goto(origin);
    await page.evaluate(() => {
      const view = document.querySelector('iframe');
      window.addEventListener('message', ({ source, data }) => {
        if (source !== view.contentWindow || data?.jsonrpc !== '2.0') return;
        if (data.method) document.body.dataset.lastMessage = data.method;
        if (data.method === 'ui/initialize') {
          source.postMessage({
            jsonrpc: '2.0',
            id: data.id,
            result: {
              protocolVersion: data.params.protocolVersion,
              hostInfo: { name: 'SCFH preview check', version: '1.0.0' },
              hostCapabilities: {},
              hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'] },
            },
          }, '*');
        }
        if (data.method === 'ui/notifications/initialized') document.body.dataset.ready = 'true';
      });
      view.src = '/view';
    });
    await page.locator('body[data-ready="true"]').waitFor({ timeout: 15_000 }).catch(async (error) => {
      const lastMessage = await page.locator('body').getAttribute('data-last-message');
      throw new Error('View not ready. Last message: ' + lastMessage + '. Browser errors: ' + errors.slice(0, 5).join(' | '), { cause: error });
    });
    const frame = page.frameLocator('iframe');
    const notify = (method, params) => page.evaluate(({ method, params }) => {
      document.querySelector('iframe').contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
    }, { method, params });
    for (const { elements, color } of scenes) {
      const partial = [...elements, { type: 'cameraUpdate', x: 0, y: 0, width: 440, height: 330 }];
      await notify('ui/notifications/tool-input-partial', { arguments: { elements: JSON.stringify(partial) } });
      await frame.locator('svg [stroke="' + color + '"]').first().waitFor({ timeout: 15_000 });
      if (elements.length === 1) assert.equal(await frame.locator('svg [stroke="#1971c2"]').count(), 0);
      else assert(await frame.locator('svg [stroke="#e03131"]').count(), 'The second stage must retain the first.');
    }
    const final = scenes.at(-1);
    await notify('ui/notifications/tool-input', { arguments: { elements: JSON.stringify(final.elements) } });
    await notify('ui/notifications/tool-result', final.result);
    await frame.locator('svg [stroke="#1971c2"]').first().waitFor({ timeout: 15_000 });
  } finally {
    await browser.close();
    fixture.closeAllConnections();
    await new Promise((resolve) => fixture.close(resolve));
  }
}
