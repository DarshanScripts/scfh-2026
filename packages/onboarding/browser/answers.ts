import { isAnswer, isCitation, type Passage } from './contracts';
import { preview } from './preview';

const answer = document.querySelector('#answer')!;
const citations = document.querySelector('#citations')!;
const sourcePanel = document.querySelector<HTMLElement>('#source')!;
const sourceTitle = document.querySelector('#source-title')!;
const sourceStatus = document.querySelector('#source-status')!;
const sourceBody = document.querySelector('#source-body')!;
let sourceSequence = 0;

async function openCitation(requestId: string, passage: Passage) {
  const sequence = ++sourceSequence;
  sourcePanel.hidden = false;
  sourceTitle.textContent = passage.title;
  sourceStatus.textContent = 'Opening source…';
  const page = document.createElement('div');
  sourceBody.replaceChildren(page);
  try {
    const response = await fetch('/api/citation', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, requestId, passageId: passage.passageId }),
    });
    if (!response.ok) throw new Error('Source unavailable');
    const source: unknown = await response.json();
    if (!isCitation(source) || (source.status !== 'unavailable' && (
        source.passage.passageId !== passage.passageId || source.passage.documentId !== passage.documentId ||
        !new RegExp(`^/sources/${passage.documentId}\\?revision=[a-f0-9]{64}$`).test(source.sourceUrl) ||
        (source.status === 'exact' && source.sourceUrl !== `/sources/${passage.documentId}?revision=${passage.revision}`)))) throw new Error('Invalid source');
    if (sequence !== sourceSequence) return;
    const message = await preview(source, page);
    if (sequence === sourceSequence) sourceStatus.textContent = message;
  } catch {
    if (sequence === sourceSequence) sourceStatus.textContent = 'The source document is unavailable.';
  }
}

window.addEventListener('message', ({ origin, source, data }) => {
  if (origin !== location.origin || source !== window.opener || data?.schemaVersion !== 1) return;
  const result: unknown = data.answer;
  if (data.type === 'answer' && (!isAnswer(result) || result.requestId !== data.requestId || result.turnId !== data.turnId)) return;
  if (data.type !== 'answer' && data.type !== 'error') return;
  sourceSequence++;
  sourcePanel.hidden = true;
  sourceBody.replaceChildren();
  citations.replaceChildren();
  answer.removeAttribute('data-outcome');
  answer.textContent = 'The onboarding service could not complete this request.';
  if (data.type !== 'answer' || !isAnswer(result)) return;
  answer.textContent = result.text;
  answer.setAttribute('data-outcome', result.outcome);
  for (const passage of result.citations) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'citation';
    button.dataset.passage = passage.passageId;
    const page = passage.locator.pageLabel ?? (passage.locator.format === 'pdf' ? passage.locator.page : undefined);
    button.textContent = [passage.title, passage.sectionPath.join(' › '), page ? `p. ${page}` : ''].filter(Boolean).join(' · ');
    button.title = passage.quote;
    button.onclick = () => void openCitation(result.requestId, passage);
    citations.append(button);
  }
});

window.opener?.postMessage({ type: 'onboarding-panel-ready' }, location.origin);
