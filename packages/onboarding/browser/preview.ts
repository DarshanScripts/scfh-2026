import type { Citation, Passage } from "./contracts";

export function citationPage(locator: Passage["locator"]) {
  if (locator.format !== "pdf") return locator.pageLabel ? "p. " + locator.pageLabel : "";
  const physical = String(locator.page);
  if (!locator.pageLabel || locator.pageLabel === physical) return "p. " + physical;
  return "p. " + locator.pageLabel + " (PDF " + physical + ")";
}

const NO_HIGHLIGHT = "Opened the source location. The exact passage couldn’t be highlighted.";

type Source = Extract<Citation, { status: "exact" | "location_only" }>;
type Point = { node: Text; offset: number; width: number };

function normalize(text: string) {
  return text.replace(/\s+/gu, " ").trim();
}

type PreviewOptions = { scroller: HTMLElement; signal: AbortSignal };

function scrollToPassage(target: Element, options?: PreviewOptions) {
  requestAnimationFrame(() => {
    if (!target.isConnected || options?.signal.aborted) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!options) {
      target.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center", inline: "nearest" });
      return;
    }
    const { scroller, signal } = options;
    const targetRect = target.getBoundingClientRect();
    const from = scroller.scrollTop;
    const to = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight,
      from + targetRect.top - scroller.getBoundingClientRect().top - (scroller.clientHeight - targetRect.height) / 2));
    if (reduced || Math.abs(to - from) < 2) {
      scroller.scrollTop = to;
      return;
    }
    const duration = Math.max(460, Math.min(1050, Math.abs(to - from) * 1.2));
    const start = performance.now();
    function tick(now: number) {
      if (!target.isConnected || signal.aborted) return;
      const progress = Math.min(1, (now - start) / duration);
      scroller.scrollTop = from + (to - from) * (1 - (1 - progress) ** 2);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
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

function openWord(source: Source, container: HTMLElement, options?: PreviewOptions): boolean {
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
  scrollToPassage(paragraph?.querySelector("mark") ?? paragraph ?? nearest?.element ?? article, options);
  return highlight;
}

async function openPdf(source: Source, container: HTMLElement, options?: PreviewOptions): Promise<boolean> {
  const locator = source.passage.locator;
  if (locator.format !== "pdf") return false;
  const pdfjs: typeof import("pdfjs-dist") = await import(new URL("/pdfjs/pdf.mjs", location.origin).href);
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.mjs";
  const task = pdfjs.getDocument({ url: source.sourceUrl, isEvalSupported: false });
  try {
    const pdf = await task.promise;
    const pageNumber = Math.min(locator.page, pdf.numPages);
    const page = await pdf.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const fullscreen = document.fullscreenElement?.contains(container);
    const maxScale = fullscreen ? 1.65 : 1.05;
    const scale = options ? Math.min(maxScale, Math.max(0.1, (options.scroller.clientWidth - 16) / original.width)) : maxScale;
    const viewport = page.getViewport({ scale });
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
      scrollToPassage(wrapper, options);
      return false;
    }
    const nodes = textLayer.textDivs.map(span => span.firstChild)
      .filter((child): child is Text => child instanceof Text);
    const range = locatedRange(nodes, locator.start, locator.end, source.passage.quote);
    if (!range) {
      scrollToPassage(wrapper, options);
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
    if (visible) scrollToPassage(visible, options);
    return visible !== null;
  } finally {
    await task.destroy();
  }
}

export async function preview(source: Citation, container: HTMLElement, options?: PreviewOptions): Promise<string> {
  if (source.status === "unavailable") return "The source document is unavailable.";
  if (source.passage.locator.format === "docx") {
    return openWord(source, container, options) ? "" : NO_HIGHLIGHT;
  }
  return await openPdf(source, container, options) ? "" : NO_HIGHLIGHT;
}
