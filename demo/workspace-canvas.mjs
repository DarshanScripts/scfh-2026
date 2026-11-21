import { exportPng } from '/rough/export.mjs';
import { mountRoughPanel } from '/rough/panel.mjs';

const root = document.querySelector('#workflow-canvas');
const panel = mountRoughPanel(root, { onClose: () => window.workflowCanvas.close() });
const save = document.createElement('button');
save.type = 'button';
save.textContent = 'Save as PNG';
save.hidden = true;
root.querySelector('header').insertBefore(save, root.querySelector('button'));

save.onclick = async () => {
  save.disabled = true;
  try { await exportPng(root.querySelector('svg')); }
  catch { root.querySelector('footer p').textContent = 'The PNG could not be saved. Try again.'; }
  finally { save.disabled = false; }
};

window.workflowCanvas.onUpdate(async (message) => {
  const result = await panel.receive(message);
  if (result === 'ok' && message.type === 'begin') save.hidden = true;
  if (result === 'ok' && message.type === 'completed') save.hidden = false;
  return result;
});
