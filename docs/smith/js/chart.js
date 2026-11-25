// The paper Smith chart: an SVG drawn in reflection coordinates (radius 1),
// with zoom, pan, pinch, snapping, a magnifier under the finger, and the
// pencil constructions that show how each reading is taken off the chart.
import { cx, C, read, to_z, to_gamma, admittance, from_admittance, isInf, Move, project, apply, drawn, describe } from './smith.js';
import { num, cplx, short } from './format.js';
import { el, label, polyline, ringPoint, tangent, P, G, f4, RING, reduceMotion, buzz } from './draw.js';
import { MOVE_TOOLS, MATCHED, renderNetwork, renderItems, renderGuides, renderPreview, moveTargets, scenePoints, crossings, hitTest, renderDemo } from './layers.js';

export { RING };
const Z_MAJOR = [0.2, 0.5, 1, 2, 5];
const Z_MINOR = [0.1, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 1.2, 1.4, 1.6, 1.8, 3, 4, 10, 20];
const Z_FINE = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 1.1, 1.3, 1.5, 1.7, 1.9,
  2.2, 2.4, 2.6, 2.8, 3.5, 4.5, 6, 7, 8, 9, 15, 50];
const RULER_TOP = 1.44, RULER_GAP = 0.13;
export const RULERS = [
  { key: 'mag', title: '|Γ|', labels: [0, 0.2, 0.4, 0.6, 0.8, 1].map(q => [q, short(q)]), minor: [...Array(11).keys()].map(i => i / 10) },
  { key: 'vswr', title: 'VSWR', labels: [[0, '1'], ...[1.5, 2, 3, 5, 10].map(v => [(v - 1) / (v + 1), short(v)]), [1, '∞']],
    minor: [1.25, 1.75, 2.5, 4, 7, 20].map(v => (v - 1) / (v + 1)) },
  { key: 'rl', title: 'RL dB', labels: [[0, '∞'], ...[20, 10, 6, 3, 1, 0].map(v => [10 ** (-v / 20), short(v)])],
    minor: [30, 15, 8, 5, 4, 2].map(v => 10 ** (-v / 20)) },
  { key: 'ml', title: 'ML dB', labels: [[0, '0'], ...[0.1, 0.5, 1, 2, 3, 6].map(v => [Math.sqrt(1 - 10 ** (-v / 10)), short(v)]), [1, '∞']],
    minor: [0.2, 0.3, 1.5, 4, 10].map(v => Math.sqrt(1 - 10 ** (-v / 10))) },
].map((row, i) => ({ ...row, y: RULER_TOP + i * RULER_GAP }));
const FULL = { x0: -1.34, x1: 1.34, y0: -1.34, y1: RULER_TOP + 3 * RULER_GAP + 0.14 };
// When the chart area is short and wide (a phone with a card open), the rulers give way to the disk.
const COMPACT = { x0: -1.34, x1: 1.34, y0: -1.34, y1: 1.34 };
let CONTENT = FULL;
const MAX_ZOOM = 14;

const span = (() => { const out = [0]; for (let i = 0; i < 200; i++) out.push(0.002 * (600 / 0.002) ** (i / 199)); return out; })();

/** Points along a constant-reactance arc (or constant-susceptance arc when admit is true). */
function reactanceArc(x, admit = false) {
  return span.map(t => (admit ? from_admittance(cx(t, x)) : to_gamma(cx(t, x))));
}
export class SmithChart {
  constructor(host, handlers) {
    this.host = host;
    this.on = handlers;
    this.tool = 'select';
    this.grid = 'z';
    this.scene = { load: null, probe: null, focus: 'load', moves: [], points: [], items: [], opts: { zc: 1, end: 'open' }, z0: 50, f0: 1 };
    this.view = { zoom: 1, cx: (CONTENT.x0 + CONTENT.x1) / 2, cy: (CONTENT.y0 + CONTENT.y1) / 2 };
    this.pointers = new Map();
    this.build();
    this.observe();
    this.bind();
  }

  // ---- static paper --------------------------------------------------------
  build() {
    const svg = this.svg = el('svg', { class: 'smith', role: 'img', 'aria-label': 'Smith chart' }, this.host);
    const defs = el('defs', {}, svg);
    el('circle', { r: 1 }, el('clipPath', { id: 'disk-clip' }, defs));
    const root = this.root = el('g', { id: 'paper-root' }, svg);

    el('circle', { r: 1 + 3 * RING, class: 'ring-fill' }, root);
    el('circle', { r: 1, class: 'disk' }, root);

    const clipped = el('g', { 'clip-path': 'url(#disk-clip)' }, root);
    this.gridMain = el('g', { class: 'grid grid-main' }, clipped);
    this.drawGrid(this.gridMain);
    this.gridY = el('g', { class: 'grid grid-y' }, clipped);
    this.drawGrid(this.gridY);
    el('line', { x1: -1, y1: 0, x2: 1, y2: 0, class: 'axis' }, clipped);

    this.drawRings(el('g', { class: 'rings' }, root));
    this.labelsZ = el('g', { class: 'grid-labels lz' }, root);
    this.labelsY = el('g', { class: 'grid-labels ly' }, root);
    this.drawGridLabels(this.labelsZ, 1);
    this.drawGridLabels(this.labelsY, -1);
    for (const [g, name] of [[cx(-1), 'short'], [cx(1), 'open']]) label(root, g.re * 0.9, -0.035, name, 'end-label');
    this.drawRulers(el('g', { class: 'rulers' }, root));

    const dyn = el('g', { class: 'dyn' }, root);
    this.guideLayer = el('g', { class: 'guides' }, dyn);
    this.itemsLayer = el('g', { class: 'items' }, dyn);
    this.netLayer = el('g', { class: 'network' }, dyn);
    this.demoLayer = el('g', { class: 'demo' }, dyn);
    this.constr = el('g', { class: 'constr' }, dyn);
    this.previewLayer = el('g', { class: 'preview' }, dyn);
    this.rulerFocus = el('line', { class: 'ruler-focus', y1: RULER_TOP - 0.07, y2: RULERS.at(-1).y + 0.05 }, dyn);
    this.markers = el('g', { class: 'markers' }, dyn);
    this.snapRing = this.marker('snap', '');
    this.ghost = this.marker('ghost', '');
    this.demoDot = this.marker('demo', '');
    this.endMark = this.marker('end', 'Z<tspan baseline-shift="sub" font-size="0.75em">in</tspan>');
    this.probeMark = this.marker('probe', 'P');
    this.loadMark = this.marker('load', 'Z<tspan baseline-shift="sub" font-size="0.75em">L</tspan>');

    this.tip = document.createElement('div');
    this.tip.className = 'chart-tip';
    this.host.appendChild(this.tip);
    this.loupe = document.createElement('div');
    this.loupe.className = 'loupe';
    this.loupe.innerHTML = `<svg class="smith loupe-svg"><g class="loupe-paper"></g><g class="loupe-dyn"></g><g class="loupe-cross"><line/><line/></g></svg>`;
    this.host.appendChild(this.loupe);
    this.setGrid(this.grid, true);
  }

  drawGrid(group) {
    for (const [values, cls] of [[Z_FINE, 'fine'], [Z_MINOR, 'minor'], [Z_MAJOR, 'major']]) {
      let d = '';
      for (const v of values) {
        // Constant-resistance circle, as two half arcs.
        const c = v / (1 + v), r = 1 / (1 + v);
        d += `M${f4(c + r)} 0A${f4(r)} ${f4(r)} 0 1 0 ${f4(c - r)} 0A${f4(r)} ${f4(r)} 0 1 0 ${f4(c + r)} 0`;
        // Constant-reactance arcs: only the part inside the disk, from the open point to the rim.
        for (const s of [1, -1]) {
          const rim = to_gamma(cx(0, s * v));
          d += `M1 0A${f4(1 / v)} ${f4(1 / v)} 0 0 ${s > 0 ? 1 : 0} ${f4(rim.re)} ${f4(-rim.im)}`;
        }
      }
      el('path', { d, class: cls }, group);
    }
  }

  drawGridLabels(group, sign) {
    const extra = [0.1, 0.3, 0.4, 0.7, 1.5, 3, 10];
    for (const v of [...Z_MAJOR, ...extra]) {
      const zoomOnly = !Z_MAJOR.includes(v);
      const gx = sign * (v - 1) / (v + 1);
      label(group, gx, 0, short(v), `axis-label${zoomOnly ? ' zoom-only' : ''}`, { dy: sign > 0 ? '-0.45em' : '1.15em' });
    }
    for (const v of [...Z_MAJOR, 0.3, 1.5, 3]) {
      const zoomOnly = !Z_MAJOR.includes(v);
      for (const d of [1, -1]) {
        const g = to_gamma(cx(0, d * v)).scale(sign);
        const angle = g.phase();
        const text = `${d * sign > 0 ? '+' : '−'}j${short(v)}`;
        // With both grids shown, the y labels move further in so they never sit on the z labels.
        for (const [radius, where] of sign > 0 ? [[0.955, '']] : [[0.955, ' outset'], [0.875, ' inset']]) {
          const [x, y] = ringPoint(angle, radius);
          label(group, x, y, text, `rim-label${zoomOnly ? ' zoom-only' : ''}${where}`, { rot: tangent(angle), dy: '0.35em' });
        }
      }
    }
  }

  drawRings(group) {
    for (const k of [1, 2, 3]) el('circle', { r: 1 + k * RING, class: k === 3 ? 'ring-edge' : 'ring-line' }, group);
    el('circle', { r: 1, class: 'rim' }, group);
    let ticks = '';
    const tick = (angle, inner, len) => {
      const [x1, y1] = ringPoint(angle, inner), [x2, y2] = ringPoint(angle, inner + len);
      ticks += `M${f4(x1)} ${f4(y1)}L${f4(x2)} ${f4(y2)}`;
    };
    for (let d = -180; d < 180; d += 5) {
      const a = d * Math.PI / 180;
      tick(a, 1, d % 30 === 0 ? 0.03 : 0.016);
      if (d % 30 === 0) {
        const [x, y] = ringPoint(a, 1 + RING * 0.6);
        label(group, x, y, d === -180 ? '±180' : `${d}`.replace('-', '−'), 'ring-label deg', { rot: tangent(a), dy: '0.35em' });
      }
    }
    for (let k = 0; k < 100; k++) {
      const len = k / 200, major = k % 10 === 0;
      const ag = Math.PI - 4 * Math.PI * len, al = Math.PI + 4 * Math.PI * len;
      tick(ag, 1 + RING, major ? 0.026 : 0.012);
      tick(al, 1 + 2 * RING, major ? 0.026 : 0.012);
      if (major) {
        const text = len === 0 ? '0' : len.toFixed(2).replace(/^0/, '');
        let [x, y] = ringPoint(ag, 1 + RING * 1.6);
        label(group, x, y, text, 'ring-label wtg', { rot: tangent(ag), dy: '0.35em' });
        [x, y] = ringPoint(al, 1 + RING * 2.6);
        label(group, x, y, text, 'ring-label wtl', { rot: tangent(al), dy: '0.35em' });
      }
    }
    el('path', { d: ticks, class: 'ticks' }, group);
  }

  drawRulers(group) {
    for (const row of RULERS) {
      const g = el('g', { class: `ruler r-${row.key}` }, group);
      let d = `M0 ${row.y}L1 ${row.y}`;
      for (const q of row.minor) d += `M${f4(q)} ${f4(row.y - 0.012)}L${f4(q)} ${f4(row.y + 0.012)}`;
      for (const [q] of row.labels) d += `M${f4(q)} ${f4(row.y - 0.024)}L${f4(q)} ${f4(row.y + 0.024)}`;
      el('path', { d, class: 'ruler-line' }, g);
      label(g, -0.05, row.y, row.title, 'ruler-title', { anchor: 'end', dy: '0.35em' });
      for (const [q, text] of row.labels) label(g, q, row.y + 0.024, text, 'ruler-label', { dy: '1.1em' });
    }
  }

  marker(kind, html) {
    const outer = el('g', { class: `marker m-${kind}` }, this.markers);
    const inner = el('g', { class: 's' }, outer);
    if (kind === 'load') {
      el('circle', { r: 13, class: 'pulse' }, inner);
      el('circle', { r: 6.5, class: 'dot' }, inner);
    } else if (kind === 'end') {
      el('circle', { r: 15, class: 'match-ring' }, inner);
      el('circle', { r: 11, class: 'pulse' }, inner);
      el('circle', { r: 5, class: 'dot' }, inner);
    } else if (kind === 'probe') {
      el('circle', { r: 9, class: 'pulse' }, inner);
      el('circle', { r: 4.5, class: 'dot' }, inner);
      el('path', { d: 'M-12 0H-6M6 0H12M0 -12V-6M0 6V12', class: 'cross' }, inner);
    } else if (kind === 'demo') {
      el('circle', { r: 12, class: 'pulse' }, inner);
      el('circle', { r: 6, class: 'dot' }, inner);
    } else if (kind === 'ghost') {
      el('path', { d: 'M-9 0H-3M3 0H9M0 -9V-3M0 3V9', class: 'cross' }, inner);
    } else {
      el('circle', { r: 10, class: 'ring' }, inner);
    }
    if (html) {
      const t = el('text', { class: 'mark-label', x: 10, y: -10 }, inner);
      t.innerHTML = html;
    }
    const snapText = kind === 'snap' ? el('text', { class: 'snap-label', x: 0, y: 26, 'text-anchor': 'middle' }, inner) : null;
    return { outer, inner, snapText, shown: false };
  }

  placeMarker(m, g, { animate = false } = {}) {
    if (!g) { m.outer.classList.remove('on'); m.shown = false; return; }
    const [x, y] = P(g);
    const was = m.shown;
    m.outer.style.transition = was && animate && !reduceMotion() ? '' : 'none';
    m.outer.style.transform = `translate(${f4(x)}px, ${f4(y)}px)`;
    if (!was || animate) {
      m.outer.classList.remove('pop');
      void m.outer.getBoundingClientRect();
      m.outer.classList.add('pop');
    }
    m.outer.classList.add('on');
    m.shown = true;
    if (!was) requestAnimationFrame(() => { m.outer.style.transition = ''; });
  }

  // ---- view: fit, zoom, pan --------------------------------------------------
  observe() {
    this.size = { w: 1, h: 1 };
    new ResizeObserver(() => this.measure()).observe(this.host);
    this.measure();
  }
  /** Read the host size; returns true when it changed. */
  measure() {
    const r = this.host.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    if (Math.abs(r.width - this.size.w) < 0.5 && Math.abs(r.height - this.size.h) < 0.5) return false;
    this.size = { w: r.width, h: r.height };
    const compact = innerWidth < 900 && r.height < r.width * 1.12;
    if ((CONTENT === COMPACT) !== compact) {
      CONTENT = compact ? COMPACT : FULL;
      this.svg.classList.toggle('compact', compact);
      if (this.view.zoom <= 1.001) { this.view.cx = (CONTENT.x0 + CONTENT.x1) / 2; this.view.cy = (CONTENT.y0 + CONTENT.y1) / 2; }
      this.clampView();
    }
    this.applyView();
    return true;
  }
  get basePpu() {
    const { w, h } = this.size;
    return Math.min(w / (CONTENT.x1 - CONTENT.x0), h / (CONTENT.y1 - CONTENT.y0));
  }
  get ppu() { return this.basePpu * this.view.zoom; }

  applyView() {
    const { w, h } = this.size, ppu = this.ppu;
    const v = this.view;
    this.svg.setAttribute('viewBox', `${v.cx - w / 2 / ppu} ${v.cy - h / 2 / ppu} ${w / ppu} ${h / ppu}`);
    const u = 1 / ppu;
    this.svg.style.setProperty('--u', u);
    this.svg.style.setProperty('--fs', `${Math.max(8.5, Math.min(11.5, ppu * 0.032))}px`);
    this.svg.classList.toggle('zoomed', ppu > 380);
    this.svg.classList.toggle('fine', ppu > 700);
    if (this.on.view) this.on.view(v.zoom);
  }

  clampView() {
    const v = this.view;
    v.zoom = Math.max(1, Math.min(MAX_ZOOM, v.zoom));
    const mx = (CONTENT.x0 + CONTENT.x1) / 2, my = (CONTENT.y0 + CONTENT.y1) / 2;
    const hw = (CONTENT.x1 - CONTENT.x0) / 2, hh = (CONTENT.y1 - CONTENT.y0) / 2;
    v.cx = Math.max(mx - hw, Math.min(mx + hw, v.cx));
    v.cy = Math.max(my - hh, Math.min(my + hh, v.cy));
  }

  zoomAt(factor, sx, sy) {
    const before = this.toUser(sx, sy);
    this.view.zoom *= factor;
    this.clampView();
    const after = this.toUser(sx, sy);
    this.view.cx += before[0] - after[0];
    this.view.cy += before[1] - after[1];
    this.clampView();
    this.applyView();
  }

  animateView(target, ms = 380) {
    const from = { ...this.view };
    if (reduceMotion()) { Object.assign(this.view, target); this.clampView(); this.applyView(); return; }
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - (1 - t) ** 3;
      const z = from.zoom * (target.zoom / from.zoom) ** e;
      this.view = { zoom: z, cx: from.cx + (target.cx - from.cx) * e, cy: from.cy + (target.cy - from.cy) * e };
      this.applyView();
      if (t < 1) this.anim = requestAnimationFrame(step);
    };
    cancelAnimationFrame(this.anim);
    this.anim = requestAnimationFrame(step);
  }
  fit() { this.animateView({ zoom: 1, cx: (CONTENT.x0 + CONTENT.x1) / 2, cy: (CONTENT.y0 + CONTENT.y1) / 2 }); }
  zoomBy(factor) {
    const z = Math.max(1, Math.min(MAX_ZOOM, this.view.zoom * factor));
    const focus = this.focusGamma();
    let { cx: x, cy: y } = this.view;
    if (factor > 1 && focus && this.view.zoom === 1) [x, y] = P(focus);
    this.animateView({ zoom: z, cx: z === 1 ? (CONTENT.x0 + CONTENT.x1) / 2 : x, cy: z === 1 ? (CONTENT.y0 + CONTENT.y1) / 2 : y });
  }

  toUser(sx, sy) {
    const { w, h } = this.size, ppu = this.ppu;
    return [this.view.cx + (sx - w / 2) / ppu, this.view.cy + (sy - h / 2) / ppu];
  }
  toScreen(g) {
    const { w, h } = this.size, ppu = this.ppu;
    const [x, y] = P(g);
    return [w / 2 + (x - this.view.cx) * ppu, h / 2 + (y - this.view.cy) * ppu];
  }
  local(e) {
    const r = this.host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  // ---- state from the app ----------------------------------------------------
  setTool(tool) {
    this.tool = tool;
    this.host.dataset.tool = tool;
    this.cancelDrag();
    this.hover(null);
    this.renderGuides();
  }
  /** Quiet: hide the numbers the tools would show, while a lesson asks the student to read one. */
  setQuiet(on) {
    this.quiet = !!on;
    this.svg.classList.toggle('quiet', this.quiet);
    if (this.quiet) this.tip.classList.remove('on');
  }

  /** A still copy of the whole chart with its rulers, `px` CSS pixels wide, for printing. */
  printable(px, { work = true } = {}) {
    const s = this.svg.cloneNode(true);
    const b = FULL, ppu = px / (b.x1 - b.x0);
    s.setAttribute('viewBox', `${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`);
    s.setAttribute('width', String(px));
    s.setAttribute('height', String(Math.round((b.y1 - b.y0) * ppu)));
    s.style.width = `${px}px`; // the screen styles stretch the chart to its box
    s.style.height = `${Math.round((b.y1 - b.y0) * ppu)}px`;
    s.style.maxWidth = '100%';
    s.style.setProperty('--u', 1 / ppu);
    s.style.setProperty('--fs', `${Math.max(8.5, Math.min(11.5, ppu * 0.032))}px`);
    s.classList.remove('compact', 'demoing', 'wipe', 'fine', 'quiet', 'can-erase');
    s.classList.toggle('zoomed', ppu > 380);
    for (const n of s.querySelectorAll('.demo, .constr, .preview')) n.replaceChildren();
    for (const n of s.querySelectorAll('.marker.m-ghost, .marker.m-snap, .marker.m-demo, .ruler.hl')) n.classList.remove('on', 'hl');
    if (!work) for (const n of s.querySelectorAll('.guides, .items, .network, .markers, .ruler-focus')) n.remove();
    return s;
  }

  setGrid(mode, instant = false) {
    this.grid = mode;
    this.svg.dataset.grid = mode;
    if (instant) {
      this.gridMain.style.transition = 'none';
      requestAnimationFrame(() => { this.gridMain.style.transition = ''; });
    }
  }
  /**
   * scene: { load, probe, focus, moves: Move[], points: Γ[], items, opts: { zc, end } }
   * fx: { animate, animateMove, animateItem }
   */
  setScene(scene, fx = {}) {
    const old = this.scene;
    const loadMoved = fx.animate && scene.load && (!old.load || old.load.sub(scene.load).abs() > 1e-9);
    this.scene = scene;
    renderItems(this.itemsLayer, scene.items, { animate: fx.animateItem ?? -1 });
    renderNetwork(this.netLayer, scene.load, scene.moves, { animate: fx.animateMove ?? -1 });
    this.placeMarker(this.loadMark, scene.load, { animate: loadMoved });
    this.placeMarker(this.probeMark, scene.probe, { animate: fx.animate });
    const end = scene.moves.length ? scene.points.at(-1) : null;
    this.placeMarker(this.endMark, end, { animate: fx.animateMove !== undefined && fx.animateMove >= 0 });
    this.endMark.outer.classList.toggle('matched', !!end && end.abs() < MATCHED);
    for (const [m, which] of [[this.loadMark, 'load'], [this.probeMark, 'probe'], [this.endMark, 'end']])
      m.outer.classList.toggle('focus', scene.focus === which);
    const g = this.focusGamma();
    this.rulerFocus.classList.toggle('on', !!g);
    if (g) {
      const m = Math.min(g.abs(), 1);
      this.rulerFocus.setAttribute('x1', f4(m));
      this.rulerFocus.setAttribute('x2', f4(m));
    }
    this.renderGuides();
  }
  focusGamma() {
    const s = this.scene;
    if (s.focus === 'probe' && s.probe) return s.probe;
    if (s.focus === 'end' && s.moves.length) return s.points.at(-1);
    return s.load;
  }
  get end() { return this.scene.points.length ? this.scene.points.at(-1) : null; }
  moveOptions(kind) {
    const o = this.scene.opts;
    return { zc: kind === 'line' || kind === 'stub' ? o.zc : 1, end: o.end };
  }
  renderGuides() {
    const kind = this.tool;
    const show = MOVE_TOOLS.includes(kind) && !!this.scene.load;
    const start = show && !(this.drag && this.drag.mode === 'movetool') ? this.end : null;
    renderGuides(this.guideLayer, { show, start, kind, zc: this.moveOptions(kind).zc });
  }

  // ---- snapping --------------------------------------------------------------
  targets() {
    const tier = this.ppu > 380 ? [...Z_MAJOR, ...Z_MINOR] : Z_MAJOR;
    const values = [0, ...tier];
    const key = `${this.grid}:${tier.length}`;
    if (this._targets && this._targets.key === key) return this._targets.list;
    const list = [[cx(0), 'centre · z = 1'], [cx(1), 'open circuit'], [cx(-1), 'short circuit']];
    const add = admit => {
      for (const r of values) for (const x of values) for (const s of x ? [1, -1] : [1]) {
        const v = cx(r, s * x);
        const g = admit ? from_admittance(v) : to_gamma(v);
        list.push([g, `${admit ? 'y' : 'z'} = ${cplx(v, 2).replace(/\.00/g, '').replace(/(\.\d)0\b/g, '$1')}`]);
      }
    };
    if (this.grid !== 'y') add(false);
    if (this.grid !== 'z') add(true);
    this._targets = { key, list };
    return list;
  }
  /** Snap to the scene first (points, marks, circle crossings), then to the grid. */
  snap(g, e, { grid = true, scene = true } = {}) {
    if (e && e.shiftKey) return { g, name: null };
    const limit = (e && e.pointerType !== 'mouse' ? 14 : 9) / this.ppu;
    let best = null;
    const lists = [];
    if (scene) lists.push(scenePoints(this.scene), crossings(this.scene));
    if (grid) lists.push(this.targets());
    else lists.push(this.targets().slice(0, 3));
    for (const list of lists) for (const [t, name] of list) {
      const d = t.sub(g).abs();
      // Scene points win ties against grid crossings.
      if (d < limit && (!best || d < best.d - 1e-9)) best = { d, g: t, name };
    }
    return best ? { g: best.g, name: best.name } : { g, name: null };
  }
  clampDisk(g) { const m = g.abs(); return m > 1 ? g.scale(1 / m) : g; }

  /** The move that ends nearest the pointer, snapped to useful landings. */
  moveTo(kind, start, target, e) {
    const { zc, end } = this.moveOptions(kind);
    let move = new Move(kind, project(start, kind, target, zc, end), zc, end);
    let landing = apply(start, drawn(move));
    let snapped = null;
    if (!(e && e.shiftKey)) {
      const limit = (e && e.pointerType !== 'mouse' ? 16 : 10) / this.ppu;
      let best = null;
      for (const [g, name] of moveTargets(start, kind, zc, this.scene)) {
        const d = g.sub(landing).abs();
        if (d < limit && (!best || d < best.d)) best = { d, g, name };
      }
      if (best) {
        move = new Move(kind, project(start, kind, best.g, zc, end), zc, end);
        landing = apply(start, drawn(move));
        snapped = best;
      }
    }
    return { move, landing, snapped };
  }

  // ---- pointer input ---------------------------------------------------------
  bind() {
    const s = this.svg;
    s.addEventListener('pointerdown', e => this.down(e));
    s.addEventListener('pointermove', e => this.move(e));
    s.addEventListener('pointerup', e => this.up(e));
    s.addEventListener('pointercancel', e => this.up(e, true));
    s.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !this.drag) this.hover(null); });
    s.addEventListener('contextmenu', e => e.preventDefault());
    s.addEventListener('wheel', e => {
      e.preventDefault();
      const [sx, sy] = this.local(e);
      cancelAnimationFrame(this.anim);
      this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), sx, sy);
    }, { passive: false });
    s.addEventListener('dblclick', e => {
      if (!['select', 'load'].includes(this.tool)) return;
      const [sx, sy] = this.local(e);
      if (this.view.zoom > 1.05) this.fit(); else {
        const [x, y] = this.toUser(sx, sy);
        this.animateView({ zoom: 3, cx: x, cy: y });
      }
    });
  }

  hitMarker(sx, sy, touch) {
    const radius = touch ? 26 : 12;
    for (const [which, g] of [['probe', this.scene.probe], ['load', this.scene.load]]) {
      if (!g) continue;
      const [mx, my] = this.toScreen(g);
      if (Math.hypot(mx - sx, my - sy) < radius) return which;
    }
    return null;
  }

  down(e) {
    this.measure();
    const [sx, sy] = this.local(e);
    try { this.svg.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    this.pointers.set(e.pointerId, [sx, sy]);
    cancelAnimationFrame(this.anim);
    if (this.on.touch) this.on.touch();
    if (this.pointers.size === 2) {
      this.cancelDrag();
      const [a, b] = [...this.pointers.values()];
      this.pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if (this.pointers.size > 2) return;
    const touch = e.pointerType !== 'mouse';
    if (e.button === 1 || e.button === 2) { this.drag = { mode: 'pan', last: [sx, sy] }; return; }
    const tool = this.tool, g = this.gammaAt(sx, sy);
    const base = { start: [sx, sy], last: [sx, sy], moved: false, touch };

    if (MOVE_TOOLS.includes(tool)) {
      if (!this.scene.load) { this.on.message('Plot the load first: pick Load and tap the chart.'); return; }
      this.drag = { ...base, mode: 'movetool', kind: tool, start: this.end, from: [sx, sy] };
      this.trackMove(e, sx, sy);
      return;
    }
    if (tool === 'compass') {
      const { g: c, name } = this.snap(this.clampDisk(g), e);
      this.drag = { ...base, mode: 'compass', c, r: 0, tip: c, from: [sx, sy] };
      this.showSnap(name ? c : null, name, e);
      this.drawPreview();
      this.caption(`Needle on ${name || 'the paper'}. Drag out the radius.`, sx, sy, touch);
      return;
    }
    if (tool === 'ruler') {
      const { g: a, name } = this.snap(g, e);
      this.drag = { ...base, mode: 'ruler', a, b: a, from: [sx, sy] };
      this.showSnap(name ? a : null, name, e);
      this.drawPreview();
      return;
    }
    if (tool === 'erase') { this.drag = { ...base, mode: 'erase' }; return; }
    if (tool === 'select' || tool === 'load') {
      const hit = this.hitMarker(sx, sy, touch);
      if (hit) { this.drag = { ...base, mode: 'move', which: hit }; if (touch) this.track(e, sx, sy); return; }
    }
    const which = tool === 'load' ? 'load' : tool === 'select' ? 'probe' : tool;
    this.drag = { ...base, mode: touch ? 'place' : 'press', which };
    if (touch) this.track(e, sx, sy);
  }

  move(e) {
    const [sx, sy] = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [sx, sy]);
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      this.zoomAt(dist / this.pinch.dist, mid[0], mid[1]);
      this.view.cx -= (mid[0] - this.pinch.mid[0]) / this.ppu;
      this.view.cy -= (mid[1] - this.pinch.mid[1]) / this.ppu;
      this.clampView();
      this.applyView();
      this.pinch = { dist, mid };
      return;
    }
    const d = this.drag;
    if (!d) { if (e.pointerType === 'mouse') this.hover(this.gammaAt(sx, sy), e); return; }
    if (Math.hypot(sx - d.start[0], sy - d.start[1]) > (d.touch ? 6 : 3)) d.moved = true;
    if (d.mode === 'pan') {
      this.view.cx -= (sx - d.last[0]) / this.ppu;
      this.view.cy -= (sy - d.last[1]) / this.ppu;
      d.last = [sx, sy];
      this.clampView();
      this.applyView();
      return;
    }
    if (d.mode === 'press' || d.mode === 'erase') {
      // A mouse drag on empty paper pans; a finger drag with the eraser just wipes.
      if (d.moved && !d.touch) { d.mode = 'pan'; this.hover(null); }
      d.last = [sx, sy];
      return;
    }
    if (d.mode === 'movetool') return this.trackMove(e, sx, sy);
    if (d.mode === 'compass') {
      const { g: tip, name } = this.snap(this.gammaAt(sx, sy), e);
      d.tip = tip;
      d.r = tip.sub(d.c).abs();
      this.showSnap(name ? tip : null, name, e);
      this.drawPreview();
      const centred = d.c.abs() < 1e-6;
      if (this.quiet) this.caption(centred ? 'A |Γ| circle. Let go to draw it.' : 'Let go to draw the circle.', sx, sy, d.touch);
      else this.caption(centred ? `radius |Γ| = ${num(d.r, 3)} · VSWR ${num(d.r < 1 ? (1 + d.r) / (1 - d.r) : Infinity, 2)}` : `radius ${num(d.r, 3)}`, sx, sy, d.touch);
      if (d.touch) this.showLoupe(sx, sy, tip);
      return;
    }
    if (d.mode === 'ruler') {
      const { g: b, name } = this.snap(this.gammaAt(sx, sy), e);
      d.b = b;
      this.showSnap(name ? b : null, name, e);
      this.drawPreview();
      if (this.quiet) this.caption('Read the rings where the line crosses them.', sx, sy, d.touch);
      else if (d.a.abs() < 1e-6 && b.abs() > 1e-6) {
        const r = read(b);
        this.caption(`∠ ${num(r.angle, 1)}° · ${num(r.toward_generator, 3)} λ toward generator`, sx, sy, d.touch);
      } else this.caption(`length ${num(b.sub(d.a).abs(), 3)}`, sx, sy, d.touch);
      if (d.touch) this.showLoupe(sx, sy, b);
      return;
    }
    this.track(e, sx, sy);
  }

  /** While a finger or a dragged marker moves: snap, preview and magnify. */
  track(e, sx, sy) {
    const d = this.drag;
    if (!d || (d.mode !== 'move' && d.mode !== 'place')) return;
    let raw = this.gammaAt(sx, sy);
    if (d.which !== 'ruler') raw = this.clampDisk(raw);
    const { g, name } = this.snap(raw, e);
    d.g = g;
    this.showSnap(name ? g : null, name, e);
    if (d.which === 'load' || d.which === 'probe') this.on.preview(d.which, g);
    else this.drawGhost(d.which, g);
    if (e.pointerType !== 'mouse') this.showLoupe(sx, sy, g);
  }

  trackMove(e, sx, sy) {
    const d = this.drag;
    const { move, landing, snapped } = this.moveTo(d.kind, d.start, this.gammaAt(sx, sy), e);
    d.move = move;
    d.landing = landing;
    this.showSnap(snapped ? landing : null, snapped && snapped.name, e);
    this.renderGuides();
    this.drawPreview();
    const [name, value, detail] = describe(move, this.scene.z0, this.scene.f0);
    const [lx, ly] = this.toScreen(landing);
    this.caption(`<b>${name}</b> ${value}<br><span>${detail}</span>`, lx, ly, d.touch);
    if (d.touch) this.showLoupe(sx, sy, landing);
  }

  up(e, cancelled = false) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = null; return; }
    const d = this.drag;
    this.drag = null;
    this.hideLoupe();
    this.showSnap(null);
    this.hideCaption();
    renderPreview(this.previewLayer, null);
    this.renderGuides();
    if (!d) return;
    if (cancelled) { if (d.mode === 'move' || d.mode === 'place') this.on.cancel(); return; }
    const [sx, sy] = this.local(e);
    switch (d.mode) {
      case 'movetool':
        if (d.move && Math.abs(d.move.value) > 1e-6) this.on.addMove(d.move);
        break;
      case 'compass':
        if (d.r > 0.004) {
          const a = Math.atan2(d.tip.im - d.c.im, d.tip.re - d.c.re);
          this.on.addItem({ type: 'compass', c: [d.c.re, d.c.im], r: d.r, a });
        } else this.on.message('Press on the needle point, then drag out to the radius you want.');
        break;
      case 'ruler':
        if (d.b.sub(d.a).abs() > 0.01) this.on.addItem({ type: 'ruler', a: [d.a.re, d.a.im], b: [d.b.re, d.b.im] });
        break;
      case 'erase': {
        const limit = (d.touch ? 20 : 10) / this.ppu;
        const hit = hitTest(this.gammaAt(sx, sy), this.scene, limit);
        if (hit) this.on.erase(hit); else this.on.message('Nothing to erase here. Tap a circle, line, mark or move.');
        break;
      }
      case 'press': {
        const raw = this.gammaAt(sx, sy);
        if (raw.abs() > 1 + 3 * RING) { this.on.background(); return; }
        const { g } = this.snap(this.clampDisk(raw), e);
        this.on.place(d.which, g);
        if (e.pointerType === 'mouse') this.hover(raw, e);
        break;
      }
      case 'move':
        if (!d.moved) this.on.focus(d.which);
        else if (d.g) this.on.place(d.which, d.g);
        break;
      case 'place':
        if (d.g) this.on.place(d.which, d.g);
        break;
    }
  }
  cancelDrag() {
    const d = this.drag;
    this.drag = null;
    this.hideLoupe();
    this.showSnap(null);
    this.hideCaption();
    renderPreview(this.previewLayer, null);
    if (d && (d.mode === 'move' || d.mode === 'place')) this.on.cancel();
    if (this.scene) this.renderGuides();
    return !!d;
  }

  drawPreview(ghost = false) {
    const d = this.drag;
    renderPreview(this.previewLayer, d && { ...d, ghost });
  }
  /** Where a mark or reflection would land while the finger is down. */
  drawGhost(which, g) {
    this.previewLayer.replaceChildren();
    if (which === 'reflect') renderPreview(this.previewLayer, { mode: 'ruler', a: g, b: g.neg() });
    if (which === 'mark' || which === 'reflect') this.placeMarker(this.ghost, g);
  }

  caption(html, sx, sy, touch) {
    const t = this.tip;
    t.innerHTML = html;
    t.classList.add('on', 'caption');
    const tw = t.offsetWidth || 160, th = t.offsetHeight || 40;
    let x, y;
    // Under a finger the magnifier sits above it, so the caption goes to the bottom edge.
    if (touch) { x = (this.size.w - tw) / 2; y = this.size.h - th - 10; }
    else {
      x = Math.max(6, Math.min(this.size.w - tw - 6, sx + 16));
      y = sy - th - 16 < 6 ? sy + 20 : sy - th - 16;
    }
    t.style.transform = `translate(${x}px, ${y}px)`;
  }
  hideCaption() { this.tip.classList.remove('on', 'caption'); }

  gammaAt(sx, sy) { const [x, y] = this.toUser(sx, sy); return G(x, y); }

  showSnap(g, name, e) {
    if (!g) { this.snapRing.outer.classList.remove('on'); this.lastSnap = null; return; }
    this.placeMarker(this.snapRing, g);
    this.snapRing.snapText.textContent = name;
    if (this.lastSnap !== name && e && e.pointerType !== 'mouse') buzz(6);
    this.lastSnap = name;
  }

  hover(g, e) {
    const clear = () => {
      this.ghost.outer.classList.remove('on');
      this.tip.classList.remove('on', 'caption');
      this.showSnap(null);
      if (!this.drag) this.previewLayer.replaceChildren();
    };
    const tool = this.tool;
    if (!g || g.abs() > 1 + 3 * RING) return clear();
    if (MOVE_TOOLS.includes(tool)) {
      // Show where a click would take the network before committing it.
      if (!this.scene.load) return clear();
      const { move, landing, snapped } = this.moveTo(tool, this.end, g, e);
      this.showSnap(snapped ? landing : null, snapped && snapped.name, e);
      renderPreview(this.previewLayer, { mode: 'movetool', start: this.end, move, ghost: true });
      const [name, value, detail] = describe(move, this.scene.z0, this.scene.f0);
      const [lx, ly] = this.toScreen(landing);
      this.caption(`<b>${name}</b> ${value}<br><span>${detail}</span>`, lx, ly, false);
      this.ghost.outer.classList.remove('on');
      return;
    }
    if (tool === 'erase') {
      const hit = hitTest(g, this.scene, 10 / this.ppu);
      this.svg.classList.toggle('can-erase', !!hit);
      this.ghost.outer.classList.remove('on');
      return;
    }
    if (g.abs() > 1 + 1e-9 && tool !== 'ruler') return clear();
    let shown = g, name = null;
    if (tool !== 'select') ({ g: shown, name } = this.snap(g, e));
    this.showSnap(name ? shown : null, name, e);
    this.placeMarker(this.ghost, shown);
    if (this.quiet || (tool !== 'select' && tool !== 'load')) { this.tip.classList.remove('on', 'caption'); return; }
    const r = read(shown);
    const lines = [`<b>z = ${cplx(to_z(shown), 2)}</b>`];
    if (this.grid !== 'z') lines.push(`y = ${cplx(admittance(shown), 2)}`);
    lines.push(`Γ = ${num(r.magnitude, 3)} ∠ ${r.angle === null ? '—' : num(r.angle, 1) + '°'}`);
    lines.push(`VSWR ${num(r.vswr, 2)}`);
    this.tip.innerHTML = lines.join('<br>');
    this.tip.classList.remove('caption');
    const [sx, sy] = this.toScreen(shown);
    const tw = this.tip.offsetWidth || 150, th = this.tip.offsetHeight || 70;
    const x = sx + 18 + tw < this.size.w ? sx + 18 : sx - 18 - tw;
    const y = sy + 18 + th < this.size.h ? sy + 18 : sy - 18 - th;
    this.tip.style.transform = `translate(${x}px, ${y}px)`;
    this.tip.classList.add('on');
  }

  showLoupe(sx, sy, g) {
    const size = 132, mag = 2.6;
    const svg = this.loupe.firstElementChild;
    const ppu = this.ppu * mag;
    const [x, y] = P(g);
    svg.setAttribute('viewBox', `${x - size / 2 / ppu} ${y - size / 2 / ppu} ${size / ppu} ${size / ppu}`);
    svg.style.setProperty('--u', 1 / ppu);
    svg.style.setProperty('--fs', this.svg.style.getPropertyValue('--fs'));
    svg.dataset.grid = this.grid;
    svg.classList.toggle('zoomed', ppu > 380);
    svg.classList.toggle('fine', ppu > 700);
    // A real copy of the paper (cached) and of the live layer, so the loupe is styled like the chart.
    const paper = svg.querySelector('.loupe-paper');
    if (!paper.firstChild) {
      for (const node of this.root.children) if (!node.classList.contains('dyn')) paper.appendChild(node.cloneNode(true));
      paper.querySelectorAll('[id]').forEach(n => n.removeAttribute('id'));
    }
    const live = this.root.querySelector('.dyn').cloneNode(true);
    live.querySelectorAll('.pop').forEach(n => n.classList.remove('pop'));
    live.querySelectorAll('.marker').forEach(n => { n.style.transition = 'none'; });
    live.querySelectorAll('.draw, .fade').forEach(n => { n.style.animation = 'none'; n.style.strokeDashoffset = '0'; n.style.opacity = '1'; });
    svg.querySelector('.loupe-dyn').replaceChildren(...live.childNodes);
    const [l1, l2] = svg.querySelectorAll('.loupe-cross line');
    const arm = 14 / ppu;
    l1.setAttribute('x1', x - arm); l1.setAttribute('x2', x + arm); l1.setAttribute('y1', y); l1.setAttribute('y2', y);
    l2.setAttribute('y1', y - arm); l2.setAttribute('y2', y + arm); l2.setAttribute('x1', x); l2.setAttribute('x2', x);
    svg.style.setProperty('--cross', 1.4 / ppu);
    // Sit above the finger, or below it near the top edge.
    let ly = sy - size - 46;
    if (ly < 4) ly = sy + 46;
    const lx = Math.max(4, Math.min(this.size.w - size - 4, sx - size / 2));
    this.loupe.style.transform = `translate(${lx}px, ${ly}px)`;
    this.loupe.classList.add('on');
  }
  hideLoupe() { this.loupe.classList.remove('on'); }

  // ---- worked solutions ---------------------------------------------------------
  /** Play one step of a worked solution; the moving point follows the move being explained. */
  showDemo(spec) {
    cancelAnimationFrame(this.demoAnim);
    this.svg.classList.toggle('demoing', !!spec);
    const pts = renderDemo(this.demoLayer, spec);
    if (!spec) { this.placeMarker(this.demoDot, null); return; }
    const at = pts ? pts[0] : null;
    this.placeMarker(this.demoDot, at || this.demoEnd(spec));
    if (!pts) return;
    if (reduceMotion()) { this.placeMarker(this.demoDot, pts.at(-1)); return; }
    this.demoDot.outer.style.transition = 'none';
    const t0 = performance.now(), ms = 800;
    const step = now => {
      const t = Math.min(1, (now - t0) / ms), e = 1 - (1 - t) ** 3;
      const g = pts[Math.min(pts.length - 1, Math.round(e * (pts.length - 1)))];
      const [x, y] = P(g);
      this.demoDot.outer.style.transform = `translate(${f4(x)}px, ${f4(y)}px)`;
      if (t < 1) this.demoAnim = requestAnimationFrame(step);
      else this.demoDot.outer.style.transition = '';
    };
    this.demoAnim = requestAnimationFrame(step);
  }
  demoEnd(spec) {
    let g = spec.start;
    spec.moves.slice(0, spec.upto).forEach(m => { g = apply(g, drawn(m)); });
    return g;
  }

  // ---- constructions: how a reading is taken off the chart --------------------
  clearConstruction() {
    this.constr.replaceChildren();
    this.host.querySelectorAll('.ruler.hl').forEach(n => n.classList.remove('hl'));
  }

  construct(key, g) {
    this.clearConstruction();
    if (!key || !g) return;
    const k = this.constr;
    const draw = (d, cls, delay = 0) => {
      const p = el('path', { d, class: `c ${cls} draw` }, k);
      p.style.setProperty('--len', (p.getTotalLength() + 0.01).toFixed(4));
      p.style.animationDelay = `${delay}ms`;
      return p;
    };
    const circle = (c, r, cls, delay = 0) => {
      // Start the circle at its right-hand point and draw it clockwise on screen.
      const [x, y] = P(c);
      return draw(`M${f4(x + r)} ${f4(y)}A${f4(r)} ${f4(r)} 0 1 1 ${f4(x - r)} ${f4(y)}A${f4(r)} ${f4(r)} 0 1 1 ${f4(x + r)} ${f4(y)}`, cls, delay);
    };
    const line = (a, b, cls, delay = 0) => draw(`M${f4(a[0])} ${f4(a[1])}L${f4(b[0])} ${f4(b[1])}`, cls, delay);
    const dash = (a, b, cls, delay = 0) => {
      const p = el('line', { x1: f4(a[0]), y1: f4(a[1]), x2: f4(b[0]), y2: f4(b[1]), class: `c ${cls} dashed fade` }, k);
      p.style.animationDelay = `${delay}ms`;
      return p;
    };
    const dot = (pt, cls, delay = 0) => {
      const outer = el('g', { transform: `translate(${f4(pt[0])} ${f4(pt[1])})`, class: 'fade' }, k);
      outer.style.animationDelay = `${delay}ms`;
      el('circle', { r: 3.6, class: `c-dot ${cls}` }, el('g', { class: 's' }, outer));
    };
    const note = (pt, text, cls, opts = {}, delay = 0) => {
      const n = label(k, pt[0], pt[1], text, `pencil ${cls}`, opts);
      n.classList.add('fade');
      n.style.animationDelay = `${delay}ms`;
      return n;
    };
    const hl = row => this.host.querySelector(`.ruler.r-${row}`)?.classList.add('hl');
    const rowY = key => RULERS.find(r => r.key === key).y;

    const r = read(g);
    const z = to_z(g), y = admittance(g);
    const pt = P(g);
    const rho = Math.min(r.magnitude, 1);
    const theta = Math.atan2(g.im, g.re);
    const swing = (cls, delay) => {
      // Compass swing from the point down to the right-hand axis at radius |Γ|.
      const steps = 48, pts = [];
      for (let i = 0; i <= steps; i++) pts.push(cx(rho * Math.cos(theta * (1 - i / steps)), rho * Math.sin(theta * (1 - i / steps))));
      if (rho > 1e-6) draw(polyline(pts), cls, delay);
      dot([rho, 0], cls, delay + 450);
    };

    switch (key) {
      case 'gamma': {
        line([-1, 0], [1, 0], 'gold thin');
        line([0, 1], [0, -1], 'gold thin');
        dash(pt, [pt[0], 0], 'gold', 250);
        dash(pt, [0, pt[1]], 'gold', 250);
        dot([pt[0], 0], 'gold', 400); dot([0, pt[1]], 'gold', 400);
        note([pt[0], 0], `Re Γ = ${num(g.re, 3)}`, 'gold', { dy: g.im > 0 ? '1.3em' : '-0.6em' }, 500);
        note([0, pt[1]], `Im Γ = ${num(g.im, 3)}`, 'gold', { anchor: g.re > 0 ? 'end' : 'start', dy: '0.35em', rot: 0 }, 500)
          .firstChild.setAttribute('dx', g.re > 0 ? '-0.6em' : '0.6em');
        break;
      }
      case 'polar': {
        if (rho < 1e-6) { note([0, 0], 'At the centre |Γ| = 0', 'gold', { dy: '-1em' }); break; }
        line([0, 0], pt, 'gold');
        const a = 0.22, steps = 40, pts = [];
        for (let i = 0; i <= steps; i++) pts.push(cx(a * Math.cos(theta * i / steps), a * Math.sin(theta * i / steps)));
        line([0, 0], [a + 0.08, 0], 'gold thin');
        draw(polyline(pts), 'gold', 300);
        const mid = [pt[0] / 2, pt[1] / 2];
        note(mid, `|Γ| = ${num(r.magnitude, 3)}`, 'gold', { rot: 0, dy: '-0.7em' }, 400);
        const ha = theta / 2;
        note([(a + 0.06) * Math.cos(ha), -(a + 0.06) * Math.sin(ha)], `θ = ${num(r.angle, 1)}°`, 'gold', { anchor: 'start', dy: '0.35em' }, 600);
        break;
      }
      case 'unitz': case 'z': {
        if (isInf(z)) { note(pt, 'Open circuit: z = ∞', 'zr', { dy: '-1.4em', anchor: 'end' }); break; }
        const rr = z.re, xx = z.im;
        circle(cx(rr / (1 + rr)), 1 / (1 + rr), 'zr');
        if (Math.abs(xx) > 1e-6) draw(polyline(reactanceArc(xx)), 'zx', 350);
        else line([-1, 0], [1, 0], 'zx', 350);
        const foot = [(rr - 1) / (rr + 1), 0];
        dot(foot, 'zr', 500);
        note(foot, `r = ${num(rr, 2)}`, 'zr', { dy: '1.4em' }, 600);
        const rim = to_gamma(cx(0, xx)), rp = P(rim);
        dot(rp, 'zx', 700);
        const out = ringPoint(rim.phase(), 1.04);
        note(out, `x = ${num(xx, 2)}`, 'zx', { anchor: rp[0] < -0.2 ? 'end' : rp[0] > 0.2 ? 'start' : 'middle', dy: rp[1] > 0 ? '1em' : '-0.3em' }, 800);
        if (key === 'z') note(pt, `× Z₀`, 'zr', { anchor: 'start', dy: '1.6em' }, 900).firstChild.setAttribute('dx', '0.8em');
        break;
      }
      case 'unity': case 'y': {
        if (isInf(y)) { note(pt, 'Short circuit: y = ∞', 'yg', { dy: '-1.4em', anchor: 'start' }); break; }
        const gg = y.re, bb = y.im;
        circle(cx(-gg / (1 + gg)), 1 / (1 + gg), 'yg');
        if (Math.abs(bb) > 1e-6) draw(polyline(reactanceArc(bb, true)), 'yb', 350);
        else line([-1, 0], [1, 0], 'yb', 350);
        const foot = [-(gg - 1) / (gg + 1), 0];
        dot(foot, 'yg', 500);
        note(foot, `g = ${num(gg, 2)}`, 'yg', { dy: '1.4em' }, 600);
        const rim = from_admittance(cx(0, bb)), rp = P(rim);
        dot(rp, 'yb', 700);
        note(ringPoint(rim.phase(), 1.04), `b = ${num(bb, 2)}`, 'yb', { anchor: rp[0] < -0.2 ? 'end' : rp[0] > 0.2 ? 'start' : 'middle', dy: rp[1] > 0 ? '1em' : '-0.3em' }, 800);
        if (rho > 1e-6) {
          const ref = [-pt[0], -pt[1]];
          dash(pt, ref, 'pencil-line', 900);
          dot(ref, 'pencil-dot', 1100);
          note(ref, 'y on the Z grid', 'pencil-note', { dy: '-1em' }, 1150);
        }
        break;
      }
      case 'vswr': {
        if (rho > 1e-6) circle(cx(0), rho, 'mint');
        dot([rho, 0], 'mint', 600);
        note([rho, 0], `r = VSWR = ${num(r.vswr, 2)}`, 'mint', { anchor: 'start', dy: '-0.7em' }, 700).firstChild.setAttribute('dx', '0.3em');
        dash([rho, 0], [rho, rowY('vswr')], 'mint', 800);
        dot([rho, rowY('vswr')], 'mint', 900);
        hl('vswr');
        break;
      }
      case 'rl': case 'ml': case 'power': {
        swing('gold', 0);
        const row = key === 'power' ? 'mag' : key;
        dash([rho, 0], [rho, rowY(row)], 'gold', 600);
        dot([rho, rowY(row)], 'gold', 750);
        const text = key === 'rl' ? `RL = ${num(r.return_loss, 2)} dB` : key === 'ml' ? `ML = ${num(r.mismatch_loss, 2)} dB` : `|Γ|² = ${num(100 * r.reflected_power, 1)} %`;
        note([rho, rowY(row)], text, 'gold', { anchor: rho > 0.6 ? 'end' : 'start', dy: '-0.6em' }, 800)
          .firstChild.setAttribute('dx', rho > 0.6 ? '-0.5em' : '0.5em');
        hl(row);
        break;
      }
      case 'wtg': case 'wtl': {
        if (rho < 1e-6) { note([0, 0], 'At the centre there is no angle to read', 'gold', { dy: '-1em' }); break; }
        const outer = key === 'wtg' ? 1 + 2 * RING : 1 + 3 * RING;
        const end = ringPoint(theta, outer);
        line([0, 0], end, key === 'wtg' ? 'gold' : 'violet');
        const tickR = key === 'wtg' ? 1 + RING : 1 + 2 * RING;
        dot(ringPoint(theta, tickR + RING * 0.5), key === 'wtg' ? 'gold' : 'violet', 500);
        const value = key === 'wtg' ? r.toward_generator : r.toward_load;
        note(ringPoint(theta, outer + 0.07), `${num(value, 3)} λ`, key === 'wtg' ? 'gold' : 'violet',
          { rot: tangent(theta), dy: '0.35em' }, 650);
        break;
      }
    }
  }
}

