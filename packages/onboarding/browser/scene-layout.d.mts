import type { Scene } from './canvas-export';

export const diagramLayouts: string[];
export const diagramKinds: string[];
export function layoutScene(
  nodes: { id: string; label: string; kind: string; lane?: number }[],
  links: { id: string; from: string; to: string; label: string }[],
  options?: { layout?: string; lanes?: string[] },
): { cards: Scene; arrows: Scene; headers: Scene };
