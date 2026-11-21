import { WIDTH, HEIGHT } from './contract.mjs';

export async function exportPng(scene) {
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
