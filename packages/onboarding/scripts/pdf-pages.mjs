// Load the same PDF.js release as the browser so the offsets match its text layer.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function readPdfLayout(source, modulePath = "pdfjs-dist/legacy/build/pdf.mjs") {
  const { getDocument } = await import(modulePath);
  const pdf = await getDocument({ data: new Uint8Array(await readFile(source)), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const { items } = await page.getTextContent();
      const normalize = text => text.replace(/\s+/gu, " ").trim();
      const text = normalize(items.map(item => item.str ?? "").join(" "));
      const headings = [];
      for (const [index, item] of items.entries()) {
        const heading = normalize(item.str ?? "");
        if (item.height >= 13 && heading.split(" ").length >= 3) {
          const prefix = normalize(items.slice(0, index).map(part => part.str ?? "").join(" "));
          const start = Array.from(prefix).length + (prefix.length ? 1 : 0);
          if (Array.from(text).slice(start, start + Array.from(heading).length).join("") === heading) {
            headings.push({ text: heading, start });
          }
        }
      }
      pages.push({ text, headings });
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}

export async function readPdfPages(source, modulePath) {
  return (await readPdfLayout(source, modulePath)).map(page => page.text);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const layout = process.argv.includes("--layout");
  const [source, modulePath] = process.argv.slice(2).filter(argument => argument !== "--layout");
  process.stdout.write(JSON.stringify(await (layout ? readPdfLayout : readPdfPages)(source, modulePath)));
}
