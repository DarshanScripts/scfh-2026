import { exportPng } from '/rough/export.mjs';
import { mountRoughPanel } from '/rough/panel.mjs';

const root = document.querySelector('#workflow-canvas');
const startup = document.querySelector('#startup');
const details = document.querySelector('#step-details');
let events;

try {
  const config = await fetch('/config').then(response => {
    if (!response.ok) throw new Error('Could not load the canvas configuration.');
    return response.json();
  });
  const postControl = (type, extra) => fetch('/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, id: config.id, nonce: config.nonce, ...extra }),
  });
  const panel = mountRoughPanel(root, { onClose: () => postControl('close') });
  const header = root.querySelector('header');
  const save = document.createElement('button');
  save.textContent = 'Save as PNG';
  save.type = 'button';
  save.hidden = true;
  header.insertBefore(save, header.querySelector('button'));
  save.onclick = () => {
    save.disabled = true;
    exportPng(root.querySelector('svg')).catch(() => {
      startup.hidden = false;
      startup.textContent = 'The PNG could not be saved. Try again.';
    }).finally(() => { save.disabled = false; });
  };
  const captions = [];
  function showDetails(lines, open = false) {
    if (!lines?.length) return;
    const items = lines.map(line => {
      const item = document.createElement('li');
      item.textContent = line;
      return item;
    });
    details.querySelector('ol').replaceChildren(...items);
    details.hidden = false;
    details.open = open;
  }
  events = new EventSource('/updates');
  events.onmessage = async ({ data }) => {
    const { message, messageId } = JSON.parse(data);
    if (message.id !== config.id) return;
    let result = 'failed';
    try { result = await panel.receive(message); } catch { /* The host handles failed acknowledgments. */ }
    if (result === 'ok') {
      if (message.type === 'begin') startup.hidden = true;
      if (message.type === 'step') captions[message.index] = message.narration;
      if (message.type === 'completed') { save.hidden = false; showDetails(captions); }
    }
    if (message.type === 'failed') showDetails(config.fallbackSteps, true);
    await postControl('ack', { messageId, result }).catch(() => {});
  };
  events.onopen = () => void postControl('ready').catch(() => {});
  events.onerror = () => {
    events.close();
    startup.hidden = false;
    startup.textContent = 'The workflow canvas disconnected.';
    showDetails(config.fallbackSteps, true);
  };
} catch {
  startup.textContent = 'The workflow canvas could not open.';
}
