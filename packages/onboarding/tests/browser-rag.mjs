import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:8765');
  const completed = [];
  for (const label of ['Work-order assignment', 'Access management', 'Completion records']) {
    const pending = page.waitForResponse(response => response.url().endsWith('/api/question'), { timeout: 120000 });
    await page.getByRole('button', { name: label, exact: true }).click();
    const response = await pending;
    assert.equal(response.status(), 200, label);
    const answer = await response.json();
    assert(['answered', 'partial'].includes(answer.outcome));
    assert(answer.citations.length > 0);
    await page.locator('[data-passage]').first().click();
    await page.locator('.pdf-page .pdf-highlight').first().waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.pdf-page').getAttribute('data-page'), String(answer.citations[0].locator.page));
    assert.equal(await page.locator('#source-status').textContent(), '');
    completed.push({ label, outcome: answer.outcome, pages: answer.citations.map(passage => passage.locator.page) });
    await page.locator('#close-source').click();
  }
  const pending = page.waitForResponse(response => response.url().endsWith('/api/question'), { timeout: 120000 });
  await page.locator('#query').fill('What is the cafeteria lunch menu for tomorrow?');
  await page.locator('#ask-button').click();
  const response = await pending;
  assert.equal(response.status(), 200);
  const unsupported = await response.json();
  assert.equal(unsupported.outcome, 'insufficient');
  assert.equal(unsupported.citations.length, 0);
  await page.screenshot({ path: '/tmp/hilhack-rag-browser.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ completed, unsupported: unsupported.outcome, browserErrors: errors }, null, 2));
} finally {
  await browser.close();
}
