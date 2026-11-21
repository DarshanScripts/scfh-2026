import { HEIGHT, MAX_LABEL, MAX_MARKS, MAX_STEPS, WIDTH } from './packages/rough-canvas/contract.mjs';

const colors = new Map([
  ['#35566e', 'blue'], ['#514879', 'blue'], ['#25604e', 'teal'],
  ['#76521f', 'amber'], ['#7b4840', 'rose'], ['#4b5c6c', 'ink'],
]);

const clamp = (value, min, max) => Math.round(Math.min(max, Math.max(min, value)));
const trimText = (value, limit) => value.trim().length > limit ? value.trim().slice(0, limit - 1).trimEnd() + '…' : value.trim();

function symbolFor(card, color) {
  const text = card.label.text;
  if (card.type === 'ellipse') return 'clock';
  if (color === 'amber' || color === 'rose') return 'alert';
  if (/duplicat|search|find/i.test(text)) return 'search';
  if (/desk lead|owner/i.test(text)) return 'person';
  if (/queue|assign|rout/i.test(text)) return 'queue';
  if (/handoff|send|notify/i.test(text) || color === 'teal') return 'handoff';
  if (/confirm|check|validat|review/i.test(text)) return 'check';
  if (/guide|source|document/i.test(text)) return 'document';
  if (/folder|files/i.test(text)) return 'folder';
  return 'ticket';
}

function fitCardLabel(text, width, height, kind) {
  const words = text.trim().split(/\s+/u);
  const usableWidth = width * (kind === 'diamond' ? .71 : kind === 'ellipse' ? .78 : .9);
  let fallback;
  for (let fontSize = clamp(height * .42, 10, 21); fontSize >= 10; fontSize--) {
    const limit = clamp(usableWidth / (fontSize * .56), 5, MAX_LABEL);
    const maxLines = height >= fontSize * 2 + 6 ? 2 : 1;
    const lines = [];
    let line = '';
    for (const word of words) {
      if (line && line.length + word.length + 1 > limit) { lines.push(line); line = word; }
      else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
    if (lines.length <= maxLines && lines.every(value => value.length <= limit)) return { fontSize, lines };
    fallback = { fontSize, lines: [...lines.slice(0, maxLines - 1), lines.slice(maxLines - 1).join(' ')].map(value => trimText(value, limit)) };
  }
  return fallback;
}

export function workflowToLesson({ title, narration, elements, nodes, links }) {
  const headers = elements.filter(element => element.id?.startsWith('lane-'));
  const cards = nodes.map(node => elements.find(element => element.id === node));
  const shapes = [...cards, ...headers];
  const bounds = shapes.map(shape => [shape.x, shape.y, shape.x + (shape.width ?? Math.min(300, shape.text.length * 12)), shape.y + (shape.height ?? 24)]);
  for (const { arrow } of links) {
    for (const [dx, dy] of arrow.points) bounds.push([arrow.x + dx, arrow.y + dy, arrow.x + dx, arrow.y + dy]);
  }
  const left = Math.min(...bounds.map(bound => bound[0]));
  const top = Math.min(...bounds.map(bound => bound[1]));
  const spanX = Math.max(...bounds.map(bound => bound[2])) - left;
  const spanY = Math.max(...bounds.map(bound => bound[3])) - top;
  const scale = Math.min(1.15, (WIDTH - 92) / spanX, (HEIGHT - 70) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;
  const x = value => clamp(offsetX + (value - left) * scale, 21, WIDTH - 21);
  const y = value => clamp(offsetY + (value - top) * scale, 21, HEIGHT - 21);
  const groups = new Map(nodes.map((node, i) => [node, `step-${i}`]));
  const label = (x, y, text, fontSize, group, color = 'ink') => ({
    kind: 'label', x, y, text: trimText(text, MAX_LABEL), fontSize, color, ...(group && { group }),
  });
  const steps = cards.flatMap((card, i) => {
    const group = groups.get(card.id);
    const width = x(card.x + card.width) - x(card.x);
    const height = y(card.y + card.height) - y(card.y);
    const isDecision = card.type === 'diamond';
    const useSymbol = !isDecision && height >= 21 && width >= 65;
    const symbolSize = clamp(height * .76, 14, 40);
    const labelOffset = useSymbol ? symbolSize + 6 : 0;
    const { fontSize, lines } = fitCardLabel(card.label.text, width - labelOffset, height, card.type);
    const color = colors.get(card.strokeColor) ?? 'blue';
    const centerX = x(card.x + card.width / 2);
    const centerY = y(card.y + card.height / 2);
    const marks = [];
    if (isDecision) marks.push({ kind: 'diamond', x: x(card.x), y: y(card.y), width, height, group, color });
    if (useSymbol) marks.push({
      kind: 'symbol', name: symbolFor(card, color), x: x(card.x) + Math.ceil(symbolSize / 2),
      y: centerY, size: symbolSize, group, color,
    });
    marks.push(...lines.map((text, line) => label(centerX + Math.floor(labelOffset / 2),
      Math.round(centerY + (line - (lines.length - 1) / 2) * fontSize), text, fontSize, group)));
    if (i === 0) {
      const laneWidth = cards[0].width * scale;
      const laneFont = clamp(laneWidth * .09, 10, 20);
      marks.unshift(...headers.map(header => label(clamp(x(header.x) + laneWidth / 2, 21, WIDTH - 21), y(header.y),
        trimText(header.text, clamp(laneWidth / (laneFont * .56), 8, MAX_LABEL)), laneFont, undefined, 'blue')));
    }
    const revealedLinks = links.filter(({ from, to }) => Math.max(nodes.indexOf(from), nodes.indexOf(to)) === i);
    const overflow = [];
    for (const { from, to, arrow } of revealedLinks) {
      const points = arrow.points.map(([dx, dy]) => ({ x: x(arrow.x + dx), y: y(arrow.y + dy) }))
        .filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
      const first = points[0];
      const last = points.at(-1);
      if (Math.hypot(last.x - first.x, last.y - first.y) < 10) {
        throw new Error('The connector is too short to read at this scale. Split the diagram into smaller sections.');
      }
      const edge = [{ kind: 'arrow', x1: first.x, y1: first.y, x2: last.x, y2: last.y,
        via: points.slice(1, -1), from: groups.get(from), to: groups.get(to) }];
      if (arrow.label?.text) {
        const a = points[Math.floor((points.length - 1) / 2)];
        const b = points[Math.floor((points.length - 1) / 2) + 1];
        edge.push(label(clamp((a.x + b.x) / 2 + (a.x === b.x ? 32 : 0), 21, WIDTH - 21),
          clamp((a.y + b.y) / 2 - (a.y === b.y ? 11 : 0), 21, HEIGHT - 21), arrow.label.text, 12));
      }
      const current = overflow.at(-1) ?? marks;
      if (current.length + edge.length > MAX_MARKS) overflow.push(edge);
      else current.push(...edge);
    }
    return [{ narration: narration[i], marks }, ...overflow.map(marks => ({ narration: 'Here are the other connections for this step.', marks }))];
  });
  if (steps.length > MAX_STEPS) throw new Error('Split the diagram into smaller sections to show all connections.');
  return { title: trimText(title, 72), steps };
}
