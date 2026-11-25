// Small SVG helpers shared by the chart and its layers.
import { cx } from './smith.js';

export const NS = 'http://www.w3.org/2000/svg';
export const RING = 0.085;
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const P = g => [g.re, -g.im];             // reflection plane → SVG user space
export const G = (x, y) => cx(x, -y);            // SVG user space → reflection plane
export const f4 = v => +v.toFixed(5);

export function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

/** A label of constant screen size: the inner text is scaled by --u (user units per pixel). */
export function label(parent, x, y, text, cls = '', { rot = 0, anchor = 'middle', dy = 0, dx = 0 } = {}) {
  const g = el('g', { transform: `translate(${f4(x)} ${f4(y)})${rot ? ` rotate(${f4(rot)})` : ''}` }, parent);
  const t = el('text', { class: `s ${cls}`, 'text-anchor': anchor, dy: dy || null, dx: dx || null }, g);
  t.textContent = text;
  return g;
}

/** A group at a chart point whose children are drawn in screen pixels. */
export function pinned(parent, g, cls = '', rot = 0) {
  const [x, y] = P(g);
  const outer = el('g', { class: cls, transform: `translate(${f4(x)} ${f4(y)})${rot ? ` rotate(${f4(rot)})` : ''}` }, parent);
  return el('g', { class: 's' }, outer);
}

export function polyline(points) {
  return points.map((g, i) => `${i ? 'L' : 'M'}${f4(g.re)} ${f4(-g.im)}`).join('');
}

export function ringPoint(angle, radius) { return [radius * Math.cos(angle), -radius * Math.sin(angle)]; }

/** Rotation that keeps a rim label tangent and upright. */
export function tangent(angle) {
  let rot = 90 - angle * 180 / Math.PI;
  if (Math.sin(angle) < -1e-9) rot += 180;
  return rot;
}

/** Circle path that starts at a given angle, so a draw-on animation begins where the pencil is. */
export function circlePath(c, r, start = 0) {
  const [x, y] = P(c);
  const a = [x + r * Math.cos(start), y - r * Math.sin(start)];
  const b = [x - r * Math.cos(start), y + r * Math.sin(start)];
  // Counter-clockwise in the reflection plane (sweep 0 on screen).
  return `M${f4(a[0])} ${f4(a[1])}A${f4(r)} ${f4(r)} 0 1 0 ${f4(b[0])} ${f4(b[1])}A${f4(r)} ${f4(r)} 0 1 0 ${f4(a[0])} ${f4(a[1])}`;
}

/** Mark a path to be drawn on like a pencil stroke. */
export function drawOn(path, delay = 0) {
  path.classList.add('draw');
  path.style.setProperty('--len', (path.getTotalLength() + 0.01).toFixed(4));
  if (delay) path.style.animationDelay = `${delay}ms`;
  return path;
}

/** A short vibration on phones, only after the user has touched the page (browsers block it before). */
export function buzz(pattern) {
  if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern);
}
