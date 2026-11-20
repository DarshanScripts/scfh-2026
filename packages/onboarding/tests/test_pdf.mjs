import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readPdfPages } from "../scripts/pdf-pages.mjs";

const root = new URL("../src/onboarding/fixtures/", import.meta.url);
const { passages } = JSON.parse(await readFile(new URL("sources.json", root), "utf8"));
const pages = await readPdfPages(new URL("maintenance-intake-guide.pdf", root));
let verified = 0;
for (const { locator, quote, passageId } of passages) {
  if (locator.format !== "pdf") continue;
  assert.equal(Array.from(pages[locator.page - 1]).slice(locator.start, locator.end).join(""), quote, passageId);
  verified++;
}
console.log("Verified " + verified + " PDF passages against the original with PDF.js.");
