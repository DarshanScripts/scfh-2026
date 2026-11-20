import type { Citation } from "./contracts";

const NO_HIGHLIGHT = "Opened the source location. The exact passage couldn’t be highlighted.";
const pdfModuleUrl: string = "/pdfjs/pdf.mjs";

type Source = Extract<Citation, { status: "exact" | "location_only" }>;
type Point = { node: Text; offset: number; width: number };

function normalize(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

function scrollToPassage(target: Element) {
  requestAnimationFrame(() => {
    if (!target.isConnected) return;
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "center",
      inline: "nearest",
    });
  });
}

function locatedRange(nodes: Text[], start: number, end: number, quote: string): Range | null {
  const points: (Point | null)[] = [];
  const kept = [];
  let space = false;
  for (const node of nodes) {
    let offset = 0;
    for (const character of node.data) {
      if (/\s/u.test(character)) {
        space = true;
      } else {
        if (space && kept.length > 0) {
          kept.push(" ");
          points.push(null);
        }
        kept.push(character);
        points.push({ node, offset, width: character.length });
        space = false;
      }
      offset += character.length;
    }
    space = true;
  }
  const first = points[start];
  const last = points[end - 1];
  if (!first || !last || kept.slice(start, end).join("") !== normalize(quote)) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + last.width);
  return range;
}

function openWord(source: Source, container: HTMLElement): boolean {
  const locator = source.passage.locator;
  if (locator.format !== "docx" || !source.paragraphs) return false;
  const headings: { path: string[]; element: HTMLElement }[] = [];
  let paragraph: HTMLParagraphElement | undefined;
  let highlight = false;
  const article = document.createElement("article");
  article.className = "word-page";
  for (const record of source.paragraphs) {
    if (record.headingLevel) {
      const heading = document.createElement("h" + Math.min(record.headingLevel + 1, 6));
      heading.textContent = record.text;
      headings.push({ path: record.headingPath, element: heading });
      article.append(heading);
      continue;
    }
    const element = document.createElement("p");
    const node = document.createTextNode(record.text);
    element.append(node);
    article.append(element);
    if (record.ordinal !== locator.paragraphOrdinal ||
        JSON.stringify(record.headingPath) !== JSON.stringify(locator.headingPath)) continue;
    paragraph = element;
    if (source.status === "exact") {
      const range = locatedRange([node], locator.start, locator.end, source.passage.quote);
      if (range) {
        const mark = document.createElement("mark");
        mark.className = "source-highlight";
        range.surroundContents(mark);
        highlight = true;
      }
    }
  }
  container.replaceChildren(article);
  const nearest = headings.filter(item => item.path.every((part, i) => part === locator.headingPath[i]))
    .sort((a, b) => b.path.length - a.path.length)[0];
  scrollToPassage(paragraph?.querySelector("mark") ?? paragraph ?? nearest?.element ?? article);
  return highlight;
}

async function openPdf(source: Source, container: HTMLElement): Promise<boolean> {
  const locator = source.passage.locator;
  if (locator.format !== "pdf") return false;
  const pdfjs: typeof import("pdfjs-dist") = await import(pdfModuleUrl);
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.mjs";
  const task = pdfjs.getDocument({ url: source.sourceUrl, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const pageNumber = Math.min(locator.page, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.05 });
    const wrapper = document.createElement("div");
    wrapper.className = "pdf-page";
    wrapper.style.width = viewport.width + "px";
    wrapper.style.height = viewport.height + "px";
    wrapper.style.setProperty("--total-scale-factor", String(viewport.scale));
    wrapper.dataset.page = String(pageNumber);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const layer = document.createElement("div");
    layer.className = "textLayer";
    wrapper.append(canvas, layer);
    container.replaceChildren(wrapper);
    const textLayer = new pdfjs.TextLayer({
      textContentSource: await page.getTextContent(), container: layer, viewport,
    });
    await Promise.all([
      page.render({ canvas, viewport }).promise,
      textLayer.render(),
    ]);
    if (source.status !== "exact" || pageNumber !== locator.page) {
      scrollToPassage(wrapper);
      return false;
    }
    const nodes = textLayer.textDivs.map(span => span.firstChild)
      .filter((child): child is Text => child instanceof Text);
    const range = locatedRange(nodes, locator.start, locator.end, source.passage.quote);
    if (!range) {
      scrollToPassage(wrapper);
      return false;
    }
    const origin = wrapper.getBoundingClientRect();
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      const highlight = document.createElement("span");
      highlight.className = "pdf-highlight source-highlight";
      highlight.style.left = rect.left - origin.left + "px";
      highlight.style.top = rect.top - origin.top + "px";
      highlight.style.width = rect.width + "px";
      highlight.style.height = rect.height + "px";
      wrapper.append(highlight);
    }
    const visible = wrapper.querySelector(".source-highlight");
    if (visible) scrollToPassage(visible);
    return visible !== null;
  } finally {
    await task.destroy();
  }
}

export async function preview(source: Citation, container: HTMLElement): Promise<string> {
  if (source.status === "unavailable") return "The source document is unavailable.";
  if (source.passage.locator.format === "docx") {
    return openWord(source, container) ? "" : NO_HIGHLIGHT;
  }
  return await openPdf(source, container) ? "" : NO_HIGHLIGHT;
}
