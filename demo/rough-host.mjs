import { mountRoughPanel } from '/rough/panel.mjs';
import { HEIGHT, WIDTH } from '/rough/contract.mjs';

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

async function exportPng(scene) {
  const svg = scene.cloneNode(true);
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('width', String(WIDTH * 2));
  svg.setAttribute('height', String(HEIGHT * 2));
  for (const label of svg.querySelectorAll('text')) {
    label.setAttribute('font-family', 'Arial, sans-serif');
    label.setAttribute('font-weight', '600');
  }
  const source = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#fcfcf5';
    drawing.fillRect(0, 0, canvas.width, canvas.height);
    drawing.drawImage(image, 0, 0);
    const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('PNG conversion failed.');
    const url = URL.createObjectURL(png);
    const download = document.createElement('a');
    download.href = url;
    download.download = 'workflow.png';
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } finally { URL.revokeObjectURL(source); }
}
