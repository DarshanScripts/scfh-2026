// Run against: python -m onboarding.server --knowledge harbour
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const url = process.env.HARBOUR_TEST_URL ?? 'http://127.0.0.1:8765';
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_PATH && { executablePath: process.env.CHROMIUM_PATH }),
});
try {
  const page = await browser.newPage();
  await page.goto(url);
  const overviewResponse = await page.request.post(url + '/api/walkthrough', {
    data: { query: 'Walk me through the Hildesheim harbour project.' },
  });
  assert.equal(overviewResponse.status(), 200);
  const overview = await overviewResponse.json();
  assert.equal(overview.outcome, 'ready');
  assert.equal(overview.steps.length, 6);
  await page.locator('#query').fill('Walk me through the funding stage of the Hildesheim harbour project.');
  await page.locator('#walkthrough-button').click();
  await page.waitForFunction(() => document.querySelector('#diagram').dataset.count === '4');
  await page.locator('#close-workflow').click();

  const response = page.waitForResponse(result => result.url().endsWith('/api/question'));
  await page.locator('#query').fill("Why can't the city apply directly, and what gets in the way if HBG applies?");
  await page.locator('#ask-button').click();
  const request = await response;
  assert.equal(request.status(), 200);
  assert.equal(request.request().postDataJSON().context.workflowStepId, 'financial-feasibility');
  const answer = await request.json();
  assert.equal(answer.outcome, 'answered');
  assert.match(answer.text, /HBG|Hafenbetriebsgesellschaft/i);
  assert.match(answer.text, /funds|funding/i);
  assert.match(answer.text, /own contribution|matching funds|own funds|its share|co[ -]?financ/i);
  assert(answer.citations.some(source => source.locator.page === 753));

  const citation = page.locator('#citations .citation').filter({ hasText: 'p. 750 (PDF 752)' }).first();
  await citation.click();
  await page.locator('.pdf-page[data-page="752"] .pdf-highlight').first().waitFor({ timeout: 30_000 });
  console.log('Funding context, live answer, and exact PDF highlight passed.');
} finally {
  await browser.close();
}
