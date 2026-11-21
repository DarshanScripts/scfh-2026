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
      <button type="button" aria-label="Close canvas" title="Close canvas">×</button>
    </header>
    <div class="rough-view-controls" role="group" aria-label="Canvas view">
      <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out">−</button>
      <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in">+</button>
      <button type="button" data-zoom="fit">Fit view</button>
      <button type="button" data-zoom="follow" hidden>Follow steps</button>
    </div>
    <div class="rough-lesson-paper"><svg viewBox="0 0 1000 600" role="img"><g></g></svg></div>
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
  const button = panel.querySelector('[aria-label="Close canvas"]');
  const view = panel.querySelector('.rough-view-controls');
  const follow = view.querySelector('[data-zoom="follow"]');
  function useManualView(change) {
    change();
    if (run && !run.terminal) follow.hidden = false;
  }
  view.querySelector('[data-zoom="out"]').onclick = () => useManualView(() => canvas.zoom(1 / 1.3));
  view.querySelector('[data-zoom="in"]').onclick = () => useManualView(() => canvas.zoom(1.3));
  view.querySelector('[data-zoom="fit"]').onclick = () => useManualView(canvas.fit);
  follow.onclick = () => {
    canvas.follow();
    follow.hidden = true;
  };
  let drag;
  scene.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !scene.querySelector('[data-step]')) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    scene.setPointerCapture(drag.id);
  });
  scene.addEventListener('pointermove', (event) => {
    if (drag?.id !== event.pointerId) return;
    const scale = scene.getScreenCTM().a;
    useManualView(() => canvas.pan((drag.x - event.clientX) / scale, (drag.y - event.clientY) / scale));
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  scene.addEventListener('lostpointercapture', () => { drag = undefined; });
  const recentRuns = new Set();
  let run;
  let disposed = false;

  function clear() {
    if (drag && scene.hasPointerCapture(drag.id)) scene.releasePointerCapture(drag.id);
    drag = undefined;
    run?.animation?.abort();
    run = undefined;
    canvas.reset();
    follow.hidden = true;
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
          follow.hidden = true;
          await canvas.complete();
          progress.textContent = 'Drawing stopped';
          return 'failed';
        } finally {
          current.animation = undefined;
        }
      }

      if (message.type === 'completed' && current.next === current.total) {
        current.terminal = true;
        progress.textContent = 'Complete · ' + current.total + ' steps';
        follow.hidden = true;
        const animation = current.animation = new AbortController();
        try {
          await canvas.complete(animation.signal);
          return run === current ? 'ok' : 'closed';
        } catch {
          return animation.signal.aborted ? 'closed' : 'failed';
        } finally {
          current.animation = undefined;
        }
      }

      if (message.type === 'paused' || message.type === 'failed') {
        current.terminal = true;
        current.animation?.abort();
        progress.textContent = message.type === 'paused' ? 'Drawing paused' : 'Drawing stopped';
        follow.hidden = true;
        await canvas.complete();
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
