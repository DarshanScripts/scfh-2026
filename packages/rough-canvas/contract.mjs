export const WIDTH = 1000;
export const HEIGHT = 600;
export const DRAW_RPC = 'sketch.lesson.v1';
export const CLOSE_TOPIC = 'sketch.close.v1';
export const MAX_STEPS = 16;
export const MAX_MARKS = 16;
export const MAX_LABEL = 52;
export const MAX_ACTIONS = 2;
export const nodeIdPattern = '^[a-z][a-z0-9-]{0,23}$';
export const MAX_PAYLOAD = 4096;
export const COLORS = {
  ink: '#223b37',
  teal: '#167d69',
  blue: '#3664af',
  amber: '#a95d1b',
  rose: '#b34460',
};

const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const str = (maxLength) => ({ type: 'string', minLength: 1, maxLength });
const x = int(20, WIDTH - 20);
const y = int(20, HEIGHT - 20);
const dimensions = { x, y, width: int(12, WIDTH - 40), height: int(12, HEIGHT - 40) };
const nodeId = { type: 'string', pattern: nodeIdPattern };
const ends = { x1: x, y1: y, x2: x, y2: y };
const object = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const xy = object({ x, y });
const kindField = (kind) => ({ type: 'string', enum: [kind] });
const mark = (kind, properties, link = false) => object({
  kind: kindField(kind), ...properties,
  group: nodeId, ...(link ? { from: nodeId, to: nodeId } : {}),
  color: { type: 'string', enum: Object.keys(COLORS) },
}, ['kind', ...Object.keys(properties)]);
const action = (kind, properties) => object({ kind: kindField(kind), ...properties });
const actionSchema = {
  type: 'array', maxItems: MAX_ACTIONS,
  items: { anyOf: [
    action('focus', { group: nodeId, zoom: { type: 'number', minimum: 1.2, maximum: 3 } }),
    action('fit', {}),
    action('move', { group: nodeId, dx: int(-700, 700), dy: int(-450, 450) }),
  ] },
};

export const lessonSchema = object({
  title: str(72),
  steps: {
    type: 'array', minItems: 1, maxItems: MAX_STEPS,
    items: { ...object({
      narration: str(230),
      marks: {
        type: 'array', maxItems: MAX_MARKS,
        items: {
          anyOf: [
            mark('rectangle', dimensions),
            mark('ellipse', dimensions),
            mark('line', ends, true),
            mark('arrow', ends, true),
            mark('curve', { start: xy, control1: xy, control2: xy, end: xy }),
            mark('polyline', {
              points: {
                type: 'array', minItems: 2, maxItems: 10,
                items: object({ x, y }),
              },
            }),
            mark('label', { x, y, text: str(MAX_LABEL) }),
          ],
        },
      },
      actions: actionSchema,
    }, ['narration', 'marks']), additionalProperties: true },
  },
});

export function fitsScene(mark) {
  if (mark.kind === 'rectangle' || mark.kind === 'ellipse') {
    return mark.x + mark.width <= WIDTH - 20 && mark.y + mark.height <= HEIGHT - 20;
  }
  if (mark.kind === 'arrow' || mark.kind === 'line') {
    return Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1) >= 10;
  }
  if (mark.kind === 'polyline') {
    return mark.points.some(({ x, y }) => x !== mark.points[0].x || y !== mark.points[0].y);
  }
  return true;
}

export function validActionTargets(steps) {
  const allNodes = new Set(steps.flatMap(({ marks }) => marks.filter((mark) => !mark.from && !mark.to)
    .map(({ group }) => group).filter(Boolean)));
  const drawn = new Set();
  return steps.every(({ marks, actions = [] }) => {
    if (marks.length + actions.length === 0) return false;
    if (actions.some(({ group }) => group && !drawn.has(group))) return false;
    for (const mark of marks) {
      if (mark.from || mark.to) {
        if ((mark.from && mark.from === mark.to) ||
            [mark.from, mark.to].some((id) => id && !allNodes.has(id))) return false;
      } else if (mark.group) {
        drawn.add(mark.group);
      }
    }
    return true;
  });
}
