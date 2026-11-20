import { createCanvas, validateStep } from './canvas.mjs';
import { MAX_STEPS } from './contract.mjs';

const runId = /^[A-Za-z0-9_-]{1,80}$/u;

export function mountRoughPanel(root, { onClose = () => {} } = {}) {
  const panel = root.ownerDocument.createElement('section');
  panel.className = 'rough-lesson';
  panel.hidden = true;
  panel.innerHTML = `
    <header class="rough-lesson-header">
      <h2></h2>
      <button type="button">Close canvas</button>
    </header>
    <div class="rough-lesson-paper">
      <svg viewBox="0 0 1000 600" role="img"><g></g></svg>
    </div>
    <footer aria-live="polite">
      <strong></strong>
      <p></p>
    </footer>
  `;
  root.append(panel);

  const scene = panel.querySelector('svg');
  const canvas = createCanvas(scene, scene.querySelector('g'));
  const title = panel.querySelector('h2');
  const progress = panel.querySelector('strong');
  const caption = panel.querySelector('p');
  const button = panel.querySelector('button');
  const recentRuns = new Set();
  let run;
  let disposed = false;

  function clear() {
    run?.animation?.abort();
    run = undefined;
    canvas.reset();
    panel.hidden = true;
  }

  button.addEventListener('click', () => {
    const id = run?.id;
    clear();
    if (id) void Promise.resolve().then(() => onClose(id)).catch((error) => {
      console.error('Rough.js canvas close notification failed:', error);
    });
  });

  return {
    async receive(message) {
      if (disposed || !message || typeof message.id !== 'string' || !runId.test(message.id)) return 'invalid';
      if (message.type === 'begin') {
        if (recentRuns.has(message.id)) return 'closed';
        if (typeof message.title !== 'string' || !message.title.trim() || message.title.length > 72 ||
            !Number.isInteger(message.total) || message.total < 1 || message.total > MAX_STEPS) return 'invalid';

        if (!globalThis.rough?.svg) return 'unavailable';
        clear();
        recentRuns.add(message.id);
        if (recentRuns.size > 32) recentRuns.delete(recentRuns.values().next().value);
        run = { id: message.id, total: message.total, next: 0 };
        title.textContent = message.title;
        scene.setAttribute('aria-label', message.title);
        progress.textContent = 'Preparing the first step…';
        caption.textContent = '';
        panel.hidden = false;
        return 'ok';
      }

      const current = run;
      if (!current || message.id !== current.id || current.terminal) return 'closed';

      if (message.type === 'step') {
        if (current.animation || message.index !== current.next ||
            message.index >= current.total || !validateStep(message)) return 'invalid';
        const animation = current.animation = new AbortController();
        progress.textContent = 'Step ' + (message.index + 1) + ' of ' + current.total;
        caption.textContent = message.narration;
        try {
          await canvas.play(message, animation.signal);
          if (run !== current || current.terminal) return 'closed';
          current.next++;
          return 'ok';
        } catch {
          if (animation.signal.aborted) return 'closed';
          current.terminal = true;
          progress.textContent = 'Drawing stopped';
          return 'failed';
        } finally {
          current.animation = undefined;
        }
      }

      if (message.type === 'completed' && current.next === current.total) {
        current.terminal = true;
        progress.textContent = 'Complete · ' + current.total + ' steps';
        return 'ok';
      }

      if (message.type === 'paused' || message.type === 'failed') {
        current.terminal = true;
        current.animation?.abort();
        progress.textContent = message.type === 'paused' ? 'Drawing paused' : 'Drawing stopped';
        return 'ok';
      }

      return 'invalid';
    },

    dismiss: clear,
    dispose() {
      disposed = true;
      clear();
      panel.remove();
    },
  };
}
