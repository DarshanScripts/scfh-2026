const view = document.querySelector('iframe');
const advance = document.querySelector('#advance');
const status = document.querySelector('#status');
let scenes;
let index = 0;
let config;

function notify(method, params) {
  view.contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
}

const timeout = setTimeout(() => { status.textContent = 'Could not load the diagram view.'; }, 15_000);
window.addEventListener('message', ({ source, data }) => {
  if (source !== view.contentWindow || data?.jsonrpc !== '2.0') return;
  if (data.method === 'ui/initialize' && typeof data.params?.protocolVersion === 'string') {
    source.postMessage({
      jsonrpc: '2.0', id: data.id,
      result: {
        protocolVersion: data.params.protocolVersion,
        hostInfo: { name: 'SCFH desktop canvas', version: '1.0.0' },
        hostCapabilities: {},
        hostContext: { theme: 'light', displayMode: 'inline', availableDisplayModes: ['inline'] },
      },
    }, '*');
  }
  if (data.method === 'ui/notifications/initialized' && scenes && index === 0) {
    clearTimeout(timeout);
    if (config.narrated) {
      if (config.updates) return;
      status.textContent = 'Waiting for narration';
      config.updates = new EventSource('/updates');
      config.updates.onmessage = ({ data }) => {
        const update = JSON.parse(data);
        if (update.elements) renderScene(update.elements, update.result);
        status.textContent = update.status;
      };
      return;
    }
    status.textContent = 'Ready';
    advance.disabled = false;
  }
});

function renderScene(elements, result) {
  if (result) {
    notify('ui/notifications/tool-input', { arguments: { elements: JSON.stringify(elements) } });
    notify('ui/notifications/tool-result', result);
    return;
  }
  const camera = elements.find((element) => element.type === 'cameraUpdate') ?? { type: 'cameraUpdate', x: 0, y: 0, width: 440, height: 330 };
  // The pinned renderer drops the last entry of a partial update.
  notify('ui/notifications/tool-input-partial', { arguments: { elements: JSON.stringify([...elements, camera]) } });
}

advance.onclick = () => {
  if (!scenes || index >= scenes.length) return;
  const scene = scenes[index++];
  status.textContent = 'Step ' + index + ' of ' + scenes.length;
  advance.disabled = index === scenes.length;
  renderScene(scene.elements);
  if (advance.disabled) renderScene(scene.elements, scene.result);
};

Promise.all([fetch('/config').then((r) => r.json()), fetch('/scenes').then((response) => {
  if (!response.ok) throw new Error('Diagram data unavailable.');
  return response.json();
})]).then(([settings, data]) => {
  config = settings;
  if (config.narrated) advance.hidden = true;
  document.title = config.title;
  scenes = data;
  view.src = '/view';
}).catch(() => {
  clearTimeout(timeout);
  status.textContent = 'Could not load the workflow diagram.';
});
