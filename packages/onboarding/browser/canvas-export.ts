import type { convertToExcalidrawElements } from '@excalidraw/excalidraw';

export type Scene = NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>;

async function exportOptions(scene: Scene) {
  const { convertToExcalidrawElements } = await import('@excalidraw/excalidraw');
  return {
    elements: convertToExcalidrawElements(scene, { regenerateIds: false }),
    appState: { exportBackground: true, viewBackgroundColor: '#ffffff' },
    files: null,
    exportPadding: 20,
  };
}

export async function renderDiagram(scene: Scene) {
  const { exportToSvg } = await import('@excalidraw/excalidraw');
  return exportToSvg({ ...await exportOptions(scene), skipInliningFonts: true });
}

export async function exportDiagram(scene: Scene) {
  const { exportToBlob } = await import('@excalidraw/excalidraw');
  return exportToBlob({ ...await exportOptions(scene), mimeType: 'image/png' });
}
