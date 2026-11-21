const view = document.querySelector('iframe');
const advance = document.querySelector('#advance');
const save = document.querySelector('#save');
const status = document.querySelector('#status');
const description = document.querySelector('#description');
const details = document.querySelector('#details');
const fallback = document.querySelector('#fallback');
let scenes;
let index = 0;
let config;
let completedScene;

function notify(method, params) {
  view.contentWindow.postMessage({ jsonrpc: '2.0', method, params }, '*');
}

function showFallback() {
  if (!config?.fallbackSteps?.length || !fallback.hidden) return;
  for (const text of config.fallbackSteps) {
    const item = document.createElement('li');
    item.textContent = text;
    fallback.append(item);
  }
  fallback.hidden = false;
  view.hidden = true;
}

const timeout = setTimeout(() => {
  status.textContent = 'Could not load the diagram view.';
  showFallback();
}, 15_000);
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
    if (!fallback.hidden) return;
    clearTimeout(timeout);
    if (config.narrated) {
      if (config.updates) return;
      status.textContent = 'Waiting for narration';
      config.updates = new EventSource('/updates');
      config.updates.onmessage = ({ data }) => {
        const update = JSON.parse(data);
        if (update.elements) renderScene(update.elements, update.result);
        status.textContent = update.status;
        if (typeof update.description === 'string') description.textContent = update.description;
        if (update.details?.length) {
          const items = update.details.map(text => {
            const item = document.createElement('li');
            item.textContent = text;
            return item;
          });
          details.querySelector('ol').replaceChildren(...items);
          details.hidden = false;
        }
        if (update.showFallback) showFallback();
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
    completedScene = elements.filter(({ type }) => type !== 'cameraUpdate');
    save.disabled = false;
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

save.onclick = async () => {
  if (!completedScene || !config.canExport) return;
  save.disabled = true;
  try {
    window.EXCALIDRAW_ASSET_PATH = '/excalidraw-assets/';
    const { exportDiagram } = await import('/canvas-export.js');
    const png = await exportDiagram(completedScene);
    const url = URL.createObjectURL(png);
    const download = document.createElement('a');
    download.href = url;
    download.download = 'workflow.png';
    download.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (error) {
    console.warn('Workflow PNG export failed:', error.message);
    status.textContent = 'The PNG could not be saved. Try again.';
  } finally {
    save.disabled = false;
  }
};

Promise.all([fetch('/config').then((r) => r.json()), fetch('/scenes').then((response) => {
  if (!response.ok) throw new Error('Diagram data unavailable.');
  return response.json();
})]).then(([settings, data]) => {
  config = settings;
  save.hidden = !config.canExport;
  if (config.narrated) advance.hidden = true;
  document.title = config.title;
  scenes = data;
  if (config.canvasAvailable) view.src = '/view';
  else {
    clearTimeout(timeout);
    status.textContent = 'Could not load the diagram view.';
    showFallback();
  }
}).catch(() => {
  clearTimeout(timeout);
  status.textContent = 'Could not load the workflow diagram.';
});
