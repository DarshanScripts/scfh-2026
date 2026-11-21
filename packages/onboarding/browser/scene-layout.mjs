const palette = {
  action: ['#e9f1f7', '#35566e'],
  decision: ['#eae8f5', '#514879'],
  handoff: ['#e1f1eb', '#25604e'],
  exception: ['#fcf1dd', '#76521f'],
  gap: ['#f7e9e6', '#7b4840'],
  milestone: ['#e1f1eb', '#25604e'],
  document: ['#edf0f4', '#4b5c6c'],
};

export const diagramLayouts = ['flowchart', 'timeline', 'swimlane', 'hierarchy'];
export const diagramKinds = Object.keys(palette);
const width = 300;
const height = 100;
const rowGap = 82;
const columnGap = 124;

export function layoutScene(nodes, links, { layout = 'flowchart', lanes = [] } = {}) {
  const indices = new Map(nodes.map((node, i) => [node.id, i]));
  const placements = [];
  const nextColumn = new Map();
  const depth = new Map();
  let row = 0;
  for (const [i, node] of nodes.entries()) {
    let column = 0;
    let currentRow;
    const parents = links.filter(link => link.to === node.id && indices.get(link.from) < i);
    if (layout === 'hierarchy') {
      currentRow = parents.length ? Math.max(...parents.map(link => depth.get(link.from) + 1)) : 0;
      depth.set(node.id, currentRow);
      column = nextColumn.get(currentRow) ?? 0;
      nextColumn.set(currentRow, column + 1);
    } else if (layout === 'flowchart' && node.kind === 'exception' && parents.length === 1) {
      currentRow = placements[indices.get(parents[0].from)].row;
      column = nextColumn.get(currentRow) ?? 1;
      nextColumn.set(currentRow, column + 1);
    } else {
      currentRow = row++;
      if (layout === 'swimlane') column = node.lane ?? 0;
      if (layout === 'timeline') column = i % 2;
    }
    placements.push({ row: currentRow, column });
  }

  const columns = Math.max(lanes.length, ...placements.map(box => box.column + 1));
  const boxes = new Map();
  const cards = nodes.map((node, i) => {
    const { column, row } = placements[i];
    const offset = layout === 'hierarchy' ? (columns - nextColumn.get(row)) * (width + columnGap) / 2 : 0;
    const box = { x: 64 + column * (width + columnGap) + offset, y: 88 + row * (height + rowGap), width, height };
    boxes.set(node.id, box);
    const [backgroundColor, strokeColor] = palette[node.kind] ?? palette.action;
    const type = node.kind === 'decision' ? 'diamond' : node.kind === 'milestone' ? 'ellipse' : 'rectangle';
    return { ...box, type, id: node.id, seed: i + 10, fillStyle: 'solid', backgroundColor, strokeColor,
      strokeWidth: 1.5, roughness: 0, ...(type === 'rectangle' && { roundness: { type: 3 } }),
      label: { text: node.label, fontFamily: 2, fontSize: 20, textAlign: 'center' } };
  });

  const headers = layout === 'swimlane' ? lanes.map((text, i) => ({
    type: 'text', id: `lane-${i}`, x: 64 + i * (width + columnGap), y: 36,
    text, fontFamily: 2, fontSize: 21, strokeColor: '#35566e',
  })) : [];
  const gutters = new Map();
  const arrows = links.map((link) => {
    const from = boxes.get(link.from);
    const to = boxes.get(link.to);
    const points = route(from, to, cards, gutters);
    const [x, y] = points[0];
    return { id: link.id, type: 'arrow', x, y,
      width: Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])),
      height: Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])),
      points: points.map(([px, py]) => [px - x, py - y]),
      strokeColor: '#506478', strokeWidth: 1.5, roughness: 0, endArrowhead: 'arrow',
      ...(link.label && { label: { text: link.label, fontFamily: 2, fontSize: 15 } }) };
  });
  return { cards, arrows, headers };
}

function route(from, to, cards, gutters) {
  const fromCenter = from.x + from.width / 2;
  const toCenter = to.x + to.width / 2;
  if (from.y === to.y) {
    const right = to.x > from.x;
    const middle = from.y + from.height / 2;
    const x = right ? from.x + from.width : from.x;
    const target = right ? to.x : to.x + to.width;
    if (!cards.some(card => card.y === from.y && card.x > Math.min(from.x, to.x) && card.x < Math.max(from.x, to.x))) {
      return [[x, middle], [target, middle]];
    }
  }
  if (to.y - from.y === height + rowGap) {
    const bottom = from.y + from.height;
    if (fromCenter === toCenter) return [[fromCenter, bottom], [toCenter, to.y]];
    const elbow = bottom + rowGap / 2;
    return [[fromCenter, bottom], [fromCenter, elbow], [toCenter, elbow], [toCenter, to.y]];
  }

  // Long or returning edges use an outside lane, with horizontal segments in the row gaps.
  const edge = Math.max(...cards.map(card => card.x + card.width));
  const corridor = edge + 36 + gutters.size * 12;
  gutters.set(corridor, true);
  const down = to.y > from.y;
  const start = down ? from.y + from.height : from.y;
  const end = down ? to.y : to.y + to.height;
  const startGap = start + (down ? 24 : -24);
  const endGap = end + (down ? -24 : 24);
  return [[fromCenter, start], [fromCenter, startGap], [corridor, startGap], [corridor, endGap], [toCenter, endGap], [toCenter, end]];
}
