import { COLORS, HEIGHT, MAX_ACTIONS, MAX_LABEL, MAX_MARKS, MAX_STEPS, WIDTH, fitsScene, nodeIdPattern, validActionTargets } from './contract.mjs';

const svgNS = 'http://www.w3.org/2000/svg';
const kinds = new Set(['rectangle', 'ellipse', 'diamond', 'line', 'arrow', 'polyline', 'curve', 'label']);
const fills = { ink: '#eef1f4', teal: '#e4f0e9', blue: '#e9eff8', amber: '#fbf0df', rose: '#f7e9ed' };
const point = (x, y) => Number.isInteger(x) && x >= 20 && x <= WIDTH - 20 &&
  Number.isInteger(y) && y >= 20 && y <= HEIGHT - 20;
const nodeId = new RegExp(nodeIdPattern);
const isId = (id) => typeof id === 'string' && nodeId.test(id);
const isPoint = (p) => p && point(p.x, p.y);
const boundedInteger = (value, max) => Number.isInteger(value) && Math.abs(value) <= max;
const shortText = (text, max) => typeof text === 'string' && text.length <= max && text.trim().length > 0;

function isMark(mark) {
  if (!mark || !kinds.has(mark.kind) || (mark.color !== undefined && !Object.hasOwn(COLORS, mark.color))) return false;
  if (mark.group !== undefined && !isId(mark.group)) return false;
  if ((mark.from !== undefined || mark.to !== undefined) &&
      (!['line', 'arrow'].includes(mark.kind) ||
       [mark.from, mark.to].some((id) => id !== undefined && !isId(id)))) return false;
  switch (mark.kind) {
    case 'rectangle':
    case 'ellipse':
    case 'diamond':
      return point(mark.x, mark.y) && Number.isInteger(mark.width) && mark.width >= 12 &&
        Number.isInteger(mark.height) && mark.height >= 12 && fitsScene(mark);
    case 'line':
      return point(mark.x1, mark.y1) && point(mark.x2, mark.y2) && fitsScene(mark);
    case 'arrow':
      return point(mark.x1, mark.y1) && point(mark.x2, mark.y2) && fitsScene(mark) &&
        (mark.via === undefined || (Array.isArray(mark.via) && mark.via.length <= 8 && mark.via.every(isPoint)));
    case 'polyline':
      return Array.isArray(mark.points) && mark.points.length >= 2 && mark.points.length <= 10 &&
        mark.points.every((p) => p && point(p.x, p.y)) && fitsScene(mark);
    case 'curve':
      return [mark.start, mark.control1, mark.control2, mark.end].every(isPoint);
    case 'label':
      return point(mark.x, mark.y) && shortText(mark.text, MAX_LABEL) &&
        (mark.fontSize === undefined || (Number.isInteger(mark.fontSize) && mark.fontSize >= 10 && mark.fontSize <= 26));
  }
}

function drawMark(rough, mark, seed) {
  const stroke = COLORS[mark.color || 'ink'];
  const options = { stroke, seed, strokeWidth: 2.2, roughness: .6, disableMultiStroke: true };
  const shape = { ...options, fill: fills[mark.color || 'ink'], fillStyle: 'solid' };
  const { x, y, width, height, x1, y1, x2, y2 } = mark;
  switch (mark.kind) {
    case 'rectangle':
      return [rough.rectangle(x, y, width, height, shape)];
    case 'ellipse':
      return [rough.ellipse(x + width / 2, y + height / 2, width, height, shape)];
    case 'diamond':
      return [rough.polygon([[x + width / 2, y], [x + width, y + height / 2], [x + width / 2, y + height], [x, y + height / 2]], shape)];
    case 'line':
      return [rough.line(x1, y1, x2, y2, options)];
    case 'arrow': {
      const path = [[x1, y1], ...(mark.via ?? []).map(p => [p.x, p.y]), [x2, y2]];
      const [prevX, prevY] = path.at(-2);
      const angle = Math.atan2(y2 - prevY, x2 - prevX);
      const head = Math.min(14, Math.hypot(x2 - prevX, y2 - prevY) * .5);
      const tip = [x2, y2];
      const wing = (offset) => [x2 - head * Math.cos(angle + offset), y2 - head * Math.sin(angle + offset)];
      return [rough.linearPath(path, options), rough.linearPath([wing(-.55), tip, wing(.55)], options)];
    }
    case 'polyline':
      return [rough.linearPath(mark.points.map((p) => [p.x, p.y]), options)];
    case 'curve': {
      const coords = (p) => p.x + ' ' + p.y;
      return [rough.path('M ' + coords(mark.start) + ' C ' + coords(mark.control1) + ' ' +
        coords(mark.control2) + ' ' + coords(mark.end), options)];
    }
    case 'label': {
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', x);
      label.setAttribute('y', y);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('dominant-baseline', 'central');
      label.setAttribute('fill', stroke);
      label.setAttribute('font-size', mark.fontSize ?? 20);
      label.textContent = mark.text;
      return [label];
    }
  }
}

function isAction(action) {
  if (!action || typeof action !== 'object') return false;
  if (action.kind === 'fit') return true;
  if (!isId(action.group)) return false;
  if (action.kind === 'focus') return Number.isFinite(action.zoom) && action.zoom >= 1.2 && action.zoom <= 3;
  return action.kind === 'move' && boundedInteger(action.dx, 700) && boundedInteger(action.dy, 450);
}

export function validateStep(step) {
  if (!step || typeof step !== 'object') return false;
  const { narration, marks, actions = [] } = step;
  return shortText(narration, 230) &&
    Array.isArray(marks) && marks.length <= MAX_MARKS && marks.every(isMark) &&
    Array.isArray(actions) && actions.length <= MAX_ACTIONS && actions.every(isAction) &&
    marks.length + actions.length > 0;
}

export function validateLesson(lesson) {
  return Boolean(lesson && shortText(lesson.title, 72) && Array.isArray(lesson.steps) &&
    lesson.steps.length >= 1 && lesson.steps.length <= MAX_STEPS &&
    lesson.steps.every(validateStep) && validActionTargets(lesson.steps));
}

const overview = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
const zero = { x: 0, y: 0 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function createCanvas(scene, layer) {
  const positions = new Map();
  const connectors = new WeakMap();
  let focusedGroup;
  const offset = (group) => positions.get(group) ?? zero;
  const setView = ({ x, y, width, height }) => scene.setAttribute('viewBox', [x, y, width, height].join(' '));
  const groupMembers = (id) => [...layer.querySelectorAll('[data-group="' + id + '"]')];

  function updateConnector(rough, wrapper) {
    const { mark, seed } = connectors.get(wrapper);
    const from = offset(mark.from);
    const to = offset(mark.to);
    const moved = { ...mark, x1: mark.x1 + from.x, y1: mark.y1 + from.y, x2: mark.x2 + to.x, y2: mark.y2 + to.y };
    wrapper.replaceChildren(...drawMark(rough, moved, seed));
  }

  function addMark(rough, step, mark, seed) {
    const wrapper = document.createElementNS(svgNS, 'g');
    if (mark.group && !mark.from && !mark.to) {
      wrapper.dataset.group = mark.group;
      const { x, y } = offset(mark.group);
      wrapper.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
    }
    step.append(wrapper);
    if (mark.from || mark.to) {
      wrapper.dataset.connector = '';
      connectors.set(wrapper, { mark, seed });
      updateConnector(rough, wrapper);
    } else {
      wrapper.append(...drawMark(rough, mark, seed));
    }
  }

  async function playAction(rough, action, signal) {
    const members = action.group ? groupMembers(action.group) : [];
    const start = offset(action.group);
    if (action.group && !members.length) throw new Error('Canvas action refers to an undrawn group.');

    const boxes = members.map((element) => element.getBBox());
    const bounds = members.length ? {
      left: Math.min(...boxes.map((box) => box.x)),
      right: Math.max(...boxes.map((box) => box.x + box.width)),
      top: Math.min(...boxes.map((box) => box.y)),
      bottom: Math.max(...boxes.map((box) => box.y + box.height)),
    } : undefined;
    const { x: viewX, y: viewY, width, height } = scene.viewBox.baseVal;

    if (action.kind === 'move') {
      const deltaX = clamp(action.dx, 12 - start.x - bounds.left, WIDTH - 12 - start.x - bounds.right);
      const deltaY = clamp(action.dy, 12 - start.y - bounds.top, HEIGHT - 12 - start.y - bounds.bottom);
      const links = [...layer.querySelectorAll('[data-connector]')].filter((wrapper) => {
        const mark = connectors.get(wrapper).mark;
        return mark.from === action.group || mark.to === action.group;
      });
      await tween(750, signal, (t) => {
        const x = start.x + deltaX * t;
        const y = start.y + deltaY * t;
        positions.set(action.group, { x, y });
        for (const member of members) member.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
        for (const link of links) updateConnector(rough, link);
        if (focusedGroup === action.group) {
          setView({
            x: clamp(viewX + deltaX * t, 0, WIDTH - width),
            y: clamp(viewY + deltaY * t, 0, HEIGHT - height), width, height,
          });
        }
      });
      return;
    }

    let target = overview;
    if (action.kind === 'focus') {
      const centerX = start.x + (bounds.left + bounds.right) / 2;
      const centerY = start.y + (bounds.top + bounds.bottom) / 2;
      const w = WIDTH / action.zoom;
      const h = HEIGHT / action.zoom;
      target = { x: clamp(centerX - w / 2, 0, WIDTH - w), y: clamp(centerY - h / 2, 0, HEIGHT - h), width: w, height: h };
    }
    await tween(650, signal, (t) => setView({
      x: viewX + (target.x - viewX) * t, y: viewY + (target.y - viewY) * t,
      width: width + (target.width - width) * t, height: height + (target.height - height) * t,
    }));
    focusedGroup = action.kind === 'focus' ? action.group : undefined;
  }

  return {
    reset() {
      positions.clear();
      focusedGroup = undefined;
      layer.replaceChildren();
      setView(overview);
    },
    async play({ marks, actions = [], index }, signal) {
      signal.throwIfAborted();
      const rough = globalThis.rough.svg(scene);
      for (const action of actions) await playAction(rough, action, signal);
      signal.throwIfAborted();
      if (!marks.length) return;
      const step = document.createElementNS(svgNS, 'g');
      step.dataset.step = String(index + 1);
      layer.append(step);
      marks.forEach((mark, i) => addMark(rough, step, mark, 101 + index * 100 + i * 7));
      if (marks.length) await animateMarks(step, signal);
    },
  };
}

function tween(duration, signal, update) {
  signal.throwIfAborted();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    update(1);
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let frame;
    const start = performance.now();
    const abort = () => {
      cancelAnimationFrame(frame);
      reject(signal.reason);
    };
    const tick = (now) => {
      const t = clamp((now - start) / duration, 0, 1);
      try {
        update(t * t * (3 - 2 * t));
        if (t < 1) {
          frame = requestAnimationFrame(tick);
          return;
        }
        resolve();
      } catch (error) {
        reject(error);
      }
      signal.removeEventListener('abort', abort);
    };
    signal.addEventListener('abort', abort, { once: true });
    frame = requestAnimationFrame(tick);
  });
}

async function animateMarks(group, signal) {
  for (const label of group.querySelectorAll('text')) {
    const edge = Math.min(WIDTH / 2, label.getComputedTextLength() / 2 + 14);
    const x = Number(label.getAttribute('x'));
    label.setAttribute('x', Math.max(edge, Math.min(WIDTH - edge, x)));
  }
  const strokes = [...group.querySelectorAll('path, text')].map((node) => {
    const length = node.tagName === 'path' ? Math.max(1, Math.ceil(node.getTotalLength())) : 0;
    return { node, length, weight: Math.min(3, Math.max(1, length / 130)) };
  });

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stepDuration = reducedMotion ? 350 : Math.min(2450, 1150 + 123 * strokes.length);
  const unit = stepDuration / strokes.reduce((sum, stroke) => sum + stroke.weight, 0);
  let delay = 0;
  const animations = strokes.map(({ node, length, weight }) => {
    const frames = length && !reducedMotion
      ? [
          { opacity: 0, strokeDasharray: length + ' ' + length, strokeDashoffset: length },
          { opacity: 1, strokeDasharray: length + ' ' + length, strokeDashoffset: length * .98, offset: .03 },
          { opacity: 1, strokeDasharray: length + ' ' + length, strokeDashoffset: 0 },
        ]
      : [{ opacity: 0 }, { opacity: 1 }];
    const duration = unit * weight;
    const animation = node.animate(frames, { delay, duration, fill: 'backwards', easing: 'linear' });
    delay += duration;
    return animation;
  });
  const stop = () => {
    group.remove();
    for (const animation of animations) animation.cancel();
  };
  signal.addEventListener('abort', stop, { once: true });
  try {
    await Promise.all(animations.map((animation) => animation.finished));
  } finally {
    signal.removeEventListener('abort', stop);
  }
}
