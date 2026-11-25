// What the student draws on the chart: the network of moves, the compass,
// ruler, marks and reflections, the guide circles, and the live preview.
import { cx, C, path as movePath, move_circle, read, R1, G1, admittance, to_z, isInf } from './smith.js';
import { el, label, pinned, polyline, P, f4, ringPoint, tangent, circlePath, drawOn, RING } from './draw.js';
import { num } from './format.js';

export const MOVE_TOOLS = ['series', 'shunt', 'line', 'stub'];
export const NEAR = 0.03; // |Γ| below this counts as matched, as in the desktop exercises

function arrow(parent, from, to, cls) {
  const [ax, ay] = P(from), [bx, by] = P(to);
  if (Math.hypot(bx - ax, by - ay) < 1e-9) return;
  const s = pinned(parent, to, `arrow ${cls}`, Math.atan2(by - ay, bx - ax) * 180 / Math.PI);
  el('path', { d: 'M2 0L-9 -5L-6 0L-9 5Z' }, s);
}

function badge(parent, g, text, cls) {
  const s = pinned(parent, g, `badge ${cls}`);
  el('circle', { r: 8.5 }, s);
  el('text', { 'text-anchor': 'middle', dy: '0.36em' }, s).textContent = text;
}

/** The network from the load: one coloured arc per move, numbered, with an arrow. */
export function renderNetwork(group, load, moves, { animate = -1 } = {}) {
  group.replaceChildren();
  if (!load) return [];
  const points = [load];
  let g = load;
  moves.forEach((move, i) => {
    const pts = movePath(g, move);
    const p = el('path', { d: polyline(pts), class: `net-path k-${move.kind}` }, group);
    if (i === animate) drawOn(p);
    const delay = i === animate ? ' late' : '';
    arrow(group, pts[pts.length - 5], pts[pts.length - 1], `net${delay}`);
    badge(group, pts[Math.floor(pts.length / 2)], String(i + 1), `net${delay}`);
    g = pts[pts.length - 1];
    points.push(g);
  });
  return points;
}

/** Compass circles, ruler lines, lettered marks and reflections, in pencil. */
export function renderItems(group, items, { animate = -1 } = {}) {
  group.replaceChildren();
  items.forEach((item, i) => {
    const fresh = i === animate;
    const g = el('g', { class: `item item-${item.type}` }, group);
    if (item.type === 'compass') {
      const c = cx(...item.c);
      drawCompassCircle(g, c, item.r, item.a ?? 0, fresh);
      el('path', { d: 'M-4 0H4M0 -4V4', class: 'needle' }, pinned(g, c));
    } else if (item.type === 'ruler') {
      const a = cx(...item.a), b = cx(...item.b);
      const line = el('path', { d: polyline([a, b]), class: 'pencil' }, g);
      if (fresh) drawOn(line);
      if (a.abs() < 1e-6 && b.abs() > 1e-6) rulerReading(g, b, fresh);
    } else if (item.type === 'mark') {
      const s = pinned(g, cx(...item.g), fresh ? 'pop-in' : '');
      el('path', { d: 'M-5 -5L5 5M-5 5L5 -5', class: 'mark-x' }, s);
      el('text', { x: 8, y: -8, class: 'hand' }, s).textContent = item.label;
    } else if (item.type === 'reflect') {
      const p = cx(...item.g), q = p.neg();
      const line = el('path', { d: polyline([p, q]), class: 'pencil dashed' }, g);
      if (fresh) line.classList.add('fade-in');
      el('circle', { r: 3, class: 'pencil-dot' }, pinned(g, p));
      const s = pinned(g, q, fresh ? 'pop-in late' : '');
      el('circle', { r: 6, class: 'y-dot' }, s);
      el('text', { x: 9, y: 13, class: 'hand' }, s).textContent = 'y';
    }
  });
}

function drawCompassCircle(parent, c, r, start, fresh) {
  const p = el('path', { d: circlePath(c, r, start), class: 'pencil' }, parent);
  if (fresh) drawOn(p);
  return p;
}

/** A ruler laid from the centre reads the angle and the wavelength ring where it meets the rim. */
function rulerReading(parent, tip, fresh) {
  const u = tip.scale(1 / tip.abs());
  const angle = Math.atan2(u.im, u.re);
  const outer = ringPoint(angle, 1 + 3 * RING);
  const ext = el('path', { d: `M${f4(u.re)} ${f4(-u.im)}L${f4(outer[0])} ${f4(outer[1])}`, class: 'pencil dashed' }, parent);
  if (fresh) ext.classList.add('fade-in');
  const r = read(u);
  const text = `∠ ${num(r.angle, 1)}°   ${num(r.toward_generator, 3)} λ→G`;
  const s = pinned(parent, u.scale(0.7), `ruler-box${fresh ? ' fade-in late' : ''}`);
  const width = text.length * 7.1 + 16;
  el('rect', { x: -width / 2, y: -10, width, height: 20, rx: 6 }, s);
  el('text', { 'text-anchor': 'middle', dy: '0.35em' }, s).textContent = text;
}

/** r = 1 and g = 1, and the circle the next move will slide along. */
export function renderGuides(group, { show, start, kind, zc }) {
  group.replaceChildren();
  if (!show) return;
  for (const [[c, r], cls, name] of [[R1, 'g-r1', 'r = 1'], [G1, 'g-g1', 'g = 1']]) {
    el('path', { d: circlePath(c, r, Math.PI / 2), class: `guide ${cls}` }, group);
    label(group, c.re, -(r + 0.035) + 0.07, name, `guide-label ${cls}`);
  }
  if (!start) return;
  const circle = move_circle(start, kind, zc);
  if (!circle) return;
  const [c, r] = circle;
  el('path', { d: circlePath(c, r, 0), class: 'guide g-move' }, group);
}

/** The move or construction being dragged, before it is committed. */
export function renderPreview(group, d) {
  group.replaceChildren();
  if (!d) return;
  if (d.mode === 'movetool' && d.move && d.start) {
    const pts = movePath(d.start, d.move);
    el('path', { d: polyline(pts), class: `preview-path${d.ghost ? ' ghost' : ''}` }, group);
    el('circle', { r: 5, class: 'preview-dot' }, pinned(group, pts[pts.length - 1]));
  } else if (d.mode === 'compass') {
    if (d.r > 1e-4) el('path', { d: circlePath(d.c, d.r, 0), class: 'pencil dashed' }, group);
    compassGlyph(group, d.c, d.tip ?? d.c);
  } else if (d.mode === 'ruler') {
    el('path', { d: polyline([d.a, d.b]), class: 'pencil dashed' }, group);
    rulerGlyph(group, d.a, d.b);
  }
}

/** A drafting compass: needle leg on the centre, pencil leg on the pointer. */
function compassGlyph(parent, needle, tip) {
  const [nx, ny] = P(needle), [tx, ty] = P(tip);
  const dx = tx - nx, dy = ty - ny, len = Math.hypot(dx, dy);
  const g = el('g', { class: 'compass-glyph' }, parent);
  if (len < 1e-6) { el('circle', { r: 4, class: 'hinge' }, pinned(g, needle)); return; }
  // Hinge above the midpoint, on the side away from the chart centre when possible.
  let nxp = -dy / len, nyp = dx / len;
  if (nyp > 0) { nxp = -nxp; nyp = -nyp; }
  const h = Math.min(0.6 * len, 0.45) + 0.06;
  const hx = (nx + tx) / 2 + nxp * h, hy = (ny + ty) / 2 + nyp * h;
  el('path', { d: `M${f4(nx)} ${f4(ny)}L${f4(hx)} ${f4(hy)}`, class: 'leg needle-leg' }, g);
  el('path', { d: `M${f4(tx)} ${f4(ty)}L${f4(hx)} ${f4(hy)}`, class: 'leg pencil-leg' }, g);
  const top = el('g', { transform: `translate(${f4(hx)} ${f4(hy)})` }, g);
  const s = el('g', { class: 's' }, top);
  el('rect', { x: -3.5, y: -16, width: 7, height: 12, rx: 3, class: 'handle' }, s);
  el('circle', { r: 5, class: 'hinge' }, s);
  el('circle', { r: 2.2, class: 'needle-tip' }, pinned(g, needle));
}

function rulerGlyph(parent, a, b) {
  const [ax, ay] = P(a), [bx, by] = P(b);
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1e-6) return;
  const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
  const g = el('g', { class: 'ruler-glyph', transform: `translate(${f4(ax)} ${f4(ay)}) rotate(${f4(ang)})` }, parent);
  // The ruler body sits beside the line; its length follows the drag.
  el('rect', { x: -0.03, y: 0.004, width: f4(len + 0.06), height: 0.07, rx: 0.01, class: 'ruler-body' }, g);
  for (let i = 0; i <= Math.floor((len + 0.03) / 0.05); i++) {
    const x = i * 0.05;
    el('path', { d: `M${f4(x)} 0.004V${i % 2 ? 0.024 : 0.036}`, class: 'ruler-tick' }, g);
  }
}

/** Points on the move's circle where a student would want to stop (desktop move_targets). */
export function moveTargets(start, kind, zc, scene) {
  const circle = move_circle(start, kind, zc);
  if (!circle) return [];
  const [c, r] = circle;
  const found = [];
  const hits = (c2, r2) => circleHits(c, r, c2, r2);
  for (const [[gc, gr], name] of [[R1, 'r = 1'], [G1, 'g = 1']]) for (const h of hits(gc, gr)) found.push([h, name]);
  for (const h of axisHits(c, r)) found.push([h, 'real axis']);
  for (const it of scene.items.filter(i => i.type === 'compass')) for (const h of hits(cx(...it.c), it.r)) found.push([h, 'your circle']);
  for (const [g, name] of scenePoints(scene)) if (Math.abs(g.sub(c).abs() - r) < 0.006) found.push([g, name]);
  if (Math.abs(c.abs() - r) < 1e-6) found.push([cx(0), 'centre']);
  const blocked = { series: cx(1), shunt: cx(-1), stub: cx(-1) }[kind];
  return found.filter(([g]) => g.abs() <= 1 + 1e-9 && (!blocked || g.sub(blocked).abs() > 1e-6));
}

/** Named points of the scene that pointers snap to. */
export function scenePoints(scene) {
  const out = [];
  if (scene.load) out.push([scene.load, 'Zₗ']);
  scene.points.slice(1).forEach((g, i) => out.push([g, `point ${i + 1}`]));
  for (const it of scene.items) {
    if (it.type === 'mark') out.push([cx(...it.g), it.label]);
    if (it.type === 'reflect') out.push([cx(...it.g).neg(), 'y']);
  }
  return out;
}

/** Crossings of the student's circles with r = 1, g = 1 and the real axis. */
export function crossings(scene) {
  const out = [];
  for (const it of scene.items.filter(i => i.type === 'compass')) {
    const c = cx(...it.c);
    for (const [[gc, gr], name] of [[R1, 'r = 1'], [G1, 'g = 1']]) for (const h of circleHits(c, it.r, gc, gr)) out.push([h, `circle × ${name}`]);
    for (const h of axisHits(c, it.r)) out.push([h, 'circle × axis']);
  }
  return out.filter(([g]) => g.abs() <= 1 + 1e-9);
}

function circleHits(c1, r1, c2, r2) {
  const d = c2.sub(c1).abs();
  if (d < 1e-12 || d > r1 + r2 + 1e-12 || d < Math.abs(r1 - r2) - 1e-12) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const u = c2.sub(c1).scale(1 / d);
  const base = c1.add(u.scale(a)), off = cx(0, h).mul(u);
  return h > 1e-9 ? [base.add(off), base.sub(off)] : [base];
}
function axisHits(c, r) {
  const h2 = r * r - c.im ** 2;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  return h > 1e-9 ? [cx(c.re - h), cx(c.re + h)] : [cx(c.re)];
}

/** Distance in chart units from g to an item or a move, for the eraser. */
export function hitTest(g, scene, limit) {
  let best = null;
  const consider = (d, hit) => { if (d < limit && (!best || d < best.d)) best = { d, ...hit }; };
  scene.items.forEach((it, index) => {
    if (it.type === 'compass') consider(Math.abs(g.sub(cx(...it.c)).abs() - it.r), { kind: 'item', index });
    else if (it.type === 'ruler') {
      const a = cx(...it.a), b = cx(...it.b), ab = b.sub(a);
      const t = Math.max(0, Math.min(1, (g.sub(a).re * ab.re + g.sub(a).im * ab.im) / Math.max(ab.re ** 2 + ab.im ** 2, 1e-12)));
      consider(a.add(ab.scale(t)).sub(g).abs(), { kind: 'item', index });
    } else if (it.type === 'mark') consider(cx(...it.g).sub(g).abs() - limit / 2, { kind: 'item', index });
    // Points win over the lines and circles that pass through them.
    else { const p = cx(...it.g); consider(Math.min(p.sub(g).abs(), p.neg().sub(g).abs()) - limit / 2, { kind: 'item', index }); }
  });
  let start = scene.load;
  scene.moves.forEach((move, index) => {
    const pts = movePath(start, move, 48);
    consider(Math.min(...pts.map(p => p.sub(g).abs())), { kind: 'move', index });
    start = pts[pts.length - 1];
  });
  return best;
}

export { NEAR as MATCHED };

/**
 * A worked solution played on the chart, in its own colour so it never looks like the student's work.
 * spec: { start, moves, upto, animate, guide, extraGuide, notes: [[Γ, text]] }. Returns the path of the
 * move being animated, so the chart can run a point along it.
 */
export function renderDemo(group, spec) {
  group.replaceChildren();
  if (!spec) return null;
  for (const which of [spec.extraGuide, spec.guide]) {
    if (!which) continue;
    if (which === 'g1' || which === 'r1') {
      const [c, r] = which === 'g1' ? G1 : R1;
      drawOn(el('path', { d: circlePath(c, r, Math.PI / 2), class: `demo-guide ${which}` }, group));
    } else if (which === 'axis') {
      drawOn(el('path', { d: 'M-1 0L1 0', class: 'demo-guide axis' }, group));
    } else if (which === 'vswr' && spec.start.abs() > 1e-6) {
      drawOn(el('path', { d: circlePath(cx(0), spec.start.abs(), Math.atan2(spec.start.im, spec.start.re)), class: 'demo-guide vswr' }, group));
    }
  }
  // Lessons: the compass circles and ruler lines a step asks for.
  for (const [c, r] of spec.circles || []) {
    drawOn(el('path', { d: circlePath(c, r, Math.atan2(spec.start.im, spec.start.re)), class: 'demo-path thin' }, group));
  }
  for (const [a, b] of spec.lines || []) {
    const [x1, y1] = P(a), [x2, y2] = P(b);
    drawOn(el('path', { d: `M${f4(x1)} ${f4(y1)}L${f4(x2)} ${f4(y2)}`, class: 'demo-path thin' }, group));
  }
  let g = spec.start, running = null;
  spec.moves.forEach((move, i) => {
    if (i > spec.upto && i !== spec.animate) return;
    const pts = movePath(g, move);
    if (i === spec.animate) {
      // The circle this move travels along, so the narration's "stay on the r = … circle" is visible.
      const track = move_circle(g, move.kind === 'stub' ? 'shunt' : move.kind, move.kind === 'line' ? move.zc : 1);
      if (track) el('path', { d: circlePath(track[0], track[1], 0), class: 'demo-guide track' }, group);
    }
    if (i < spec.upto || i === spec.animate) {
      const p = el('path', { d: polyline(pts), class: 'demo-path' }, group);
      if (i === spec.animate) { drawOn(p); running = pts; }
      arrow(group, pts[pts.length - 5], pts[pts.length - 1], `demo${i === spec.animate ? ' late' : ''}`);
      badge(group, pts[Math.floor(pts.length / 2)], String(i + 1), `demo${i === spec.animate ? ' late' : ''}`);
    }
    g = pts[pts.length - 1];
  });
  for (const [p, text] of spec.notes || []) {
    const s = pinned(group, p, 'demo-note late');
    el('circle', { r: 5 }, s);
    if (text) el('text', { x: 9, y: -9, class: 'hand' }, s).textContent = text;
  }
  return running;
}
