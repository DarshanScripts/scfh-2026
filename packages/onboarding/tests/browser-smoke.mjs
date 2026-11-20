import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1150, height: 850 } });
  await page.goto(process.argv[2] ?? "http://127.0.0.1:8765");
  await page.getByRole("button", { name: "Intake checklist", exact: true }).click();
  await page.locator('[data-passage="intake-checklist"]').click();
  await page.locator('.pdf-page[data-page="2"] .pdf-highlight').first().waitFor();
  await page.locator("#close-source").click();

  await page.getByRole("button", { name: "Unassigned ticket", exact: true }).click();
  await page.locator('[data-passage="unassigned-reminder"]').click();
  const word = page.locator(".word-page mark");
  await word.waitFor();
  assert.equal(await word.textContent(), "Send the ticket ID and latest status to the Desk Lead.");
  assert.equal(await word.evaluate(mark => mark.parentElement.previousElementSibling.previousElementSibling.textContent), "Unassigned tickets");
  await page.locator("#close-source").click();

  await page.getByRole("button", { name: "Next deadline", exact: true }).click();
  await page.locator("#answer").filter({ hasText: "FM-104" }).waitFor();
  await page.locator("#query").fill("What budget do we have for repairs?");
  await page.locator("#ask-button").click();
  await page.locator("#answer").filter({ hasText: "couldn’t find" }).waitFor();

  const start = async () => {
    await page.locator("#query").fill("Walk me through a maintenance request from intake to handoff");
    await page.locator("#walkthrough-button").click();
    await page.locator('#diagram[data-count="1"]').waitFor();
  };
  await start();
  await page.locator("#stop").click();
  await page.locator("#narration").filter({ hasText: "interrupted" }).waitFor();
  await start();
  await page.locator("#narration").filter({ hasText: "Walkthrough complete" }).waitFor();
  await page.locator('#diagram[data-count="7"]').waitFor();
  const visibleHeight = await page.locator("#diagram").evaluate(view => view.clientHeight);
  const pending = page.waitForEvent("download");
  await page.locator("#save").click();
  const download = await pending;
  const saved = await readFile(await download.path());
  assert.equal(saved.toString("hex", 0, 8), "89504e470d0a1a0a");
  assert(saved.readUInt32BE(20) > visibleHeight, "PNG should extend beyond the diagram viewport");
  await page.locator("#close-workflow").click();
  await page.locator("#workflow").waitFor({ state: "hidden" });
  console.log("Verified PDF and Word highlights, Q&A fallback, walkthrough restart, and full-scene PNG.");
} finally {
  await browser.close();
}
