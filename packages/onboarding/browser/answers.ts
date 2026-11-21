import { isAnswer, isCitation, type Passage } from './contracts';
import { citationPage, preview } from './preview';

export function mountAnswerPanel(root: ParentNode) {
  const part = (name: string) => root.querySelector<HTMLElement>(`[data-answer-part="${name}"], #${name}`)!;
  const answer = part('answer');
  const citations = part('citations');
  const sourcePanel = part('source');
  const sourceTitle = part('source-title');
  const sourceStatus = part('source-status');
  const sourceBody = part('source-body');
  const expand = part('source-expand');
  let selected: { requestId: string; passage: Passage } | undefined;
  let sourceSequence = 0;
  let sourceLoad: AbortController | undefined;

  async function openCitation(requestId: string, passage: Passage) {
    selected = { requestId, passage };
    sourceLoad?.abort();
    const load = sourceLoad = new AbortController();
    const sequence = ++sourceSequence;
    sourcePanel.hidden = false;
    sourceTitle.textContent = passage.title;
    sourceStatus.textContent = 'Opening source…';
    const page = document.createElement('div');
    sourceBody.replaceChildren(page);
    if (root instanceof HTMLElement && document.fullscreenElement !== sourcePanel) sourcePanel.scrollIntoView({ block: "nearest", behavior: "smooth" });
    try {
      const response = await fetch('/api/citation', {
        method: 'POST', signal: load.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schemaVersion: 1, requestId, passageId: passage.passageId }),
      });
      if (!response.ok) throw new Error('Source unavailable');
      const source: unknown = await response.json();
      if (!isCitation(source) || (source.status !== 'unavailable' && (
          source.passage.passageId !== passage.passageId || source.passage.documentId !== passage.documentId ||
          !new RegExp(`^/sources/${passage.documentId}\\?revision=[a-f0-9]{64}$`).test(source.sourceUrl) ||
          (source.status === 'exact' && source.sourceUrl !== `/sources/${passage.documentId}?revision=${passage.revision}`)))) throw new Error('Invalid source');
      if (sequence !== sourceSequence) return;
      const message = await preview(source, page, { scroller: sourceBody as HTMLElement, signal: load.signal });
      if (sequence === sourceSequence) sourceStatus.textContent = message;
    } catch {
      if (sequence === sourceSequence) sourceStatus.textContent = 'The source document is unavailable.';
    }
  }

  expand?.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement === sourcePanel) await document.exitFullscreen();
      else await sourcePanel.requestFullscreen();
    } catch {
      sourceStatus.textContent = 'Full screen is unavailable.';
    }
  });
  sourcePanel.addEventListener('fullscreenchange', () => {
    if (!expand || !selected) return;
    expand.textContent = document.fullscreenElement === sourcePanel ? 'Exit full screen' : 'Full screen';
    void openCitation(selected.requestId, selected.passage);
  });

  function closeSource() {
    selected = undefined;
    if (document.fullscreenElement === sourcePanel) void document.exitFullscreen();
    sourceLoad?.abort();
    sourceSequence++;
    sourcePanel.hidden = true;
    if (expand) expand.textContent = 'Full screen';
    sourceBody.replaceChildren();
  }
  part('source-close')?.addEventListener('click', closeSource);

  function receive(data: { schemaVersion: number; type: string; answer: unknown; requestId: string; turnId: string }) {
    if (data?.schemaVersion !== 1) return;
    const result: unknown = data.answer;
    if (data.type === 'answer' && (!isAnswer(result) || result.requestId !== data.requestId || result.turnId !== data.turnId)) return;
    if (data.type !== 'answer' && data.type !== 'error') return;
    closeSource();
    if (root instanceof HTMLElement) root.scrollTop = 0;
    citations.replaceChildren();
    answer.removeAttribute('data-outcome');
    answer.textContent = 'The onboarding service could not complete this request.';
    if (data.type !== 'answer' || !isAnswer(result)) return true;
    answer.textContent = result.text;
    answer.setAttribute('data-outcome', result.outcome);
    for (const passage of result.citations) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'citation';
      button.dataset.passage = passage.passageId;
      const page = citationPage(passage.locator);
      const title = document.createElement('span');
      title.className = 'citation-title';
      title.textContent = passage.title;
      const detail = document.createElement('span');
      detail.className = 'citation-detail';
      detail.textContent = [passage.sectionPath.join(' › '), page].filter(Boolean).join(' · ');
      button.append(title, detail);
      button.title = passage.quote;
      button.onclick = () => void openCitation(result.requestId, passage);
      citations.append(button);
    }
    return true;
  }

  return { receive };
}

if (window.opener && location.pathname === '/answers') {
  const panel = mountAnswerPanel(document);
  window.addEventListener('message', ({ origin, source, data }) => {
    if (origin === location.origin && source === window.opener) panel.receive(data);
  });
}

window.opener?.postMessage({ type: 'onboarding-panel-ready' }, location.origin);
