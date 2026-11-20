import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.addInitScript(() => {
    const original = Element.prototype.scrollIntoView;
    window.citationScrolls = [];
    Element.prototype.scrollIntoView = function (options) {
      window.citationScrolls.push(options);
      return original.call(this, options);
    };
  });
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:8766');
  await page.locator('#query').fill('How can I spot a duplicate if people describe the same problem differently?');
  await page.locator('#ask-button').click();
  const citation = page.locator('[data-passage="duplicate-check"]');
  await citation.waitFor();
  await page.evaluate(() => {
    window.scrollSamples = [];
    window.recordScroll = true;
    function sample() {
      window.scrollSamples.push(document.querySelector('#source-body').scrollTop);
      if (window.recordScroll) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  await citation.click();
  await page.locator('.pdf-highlight').first().waitFor();
  await page.waitForFunction(() => window.citationScrolls.length > 0);
  await page.waitForFunction(() => {
    const frames = window.scrollSamples;
    return frames.length > 15 && frames.at(-1) > 0 && frames.slice(-8).every(value => Math.abs(value - frames.at(-1)) < 1);
  });
  const motion = await page.evaluate(() => {
    window.recordScroll = false;
    return { positions: new Set(window.scrollSamples.map(Math.round)).size, options: window.citationScrolls.at(-1) };
  });
  assert(motion.positions > 3, 'PDF scroll should have multiple intermediate positions');
  assert.equal(motion.options.behavior, 'smooth');
  assert.equal(motion.options.block, 'center');
  const visible = await page.locator('.pdf-highlight').first().evaluate(highlight => {
    const viewer = document.querySelector('#source-body').getBoundingClientRect();
    const rect = highlight.getBoundingClientRect();
    return rect.top >= viewer.top && rect.bottom <= viewer.bottom;
  });
  assert(visible, 'The cited passage must be visible after scrolling');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#close-source').click();
  await citation.click();
  await page.locator('.pdf-highlight').first().waitFor();
  await page.waitForFunction(() => window.citationScrolls.at(-1)?.behavior === 'instant');
  await page.getByRole('button', { name: 'Unassigned ticket', exact: true }).click();
  await page.locator('[data-passage="unassigned-reminder"]').click();
  await page.locator('.word-page mark').waitFor();
  console.log(JSON.stringify({ intermediateScrollPositions: motion.positions, reducedMotion: 'instant', wordCitation: 'passed' }));
} finally {
  await browser.close();
}
