// Smith Chart Lab: state, readings, explanations, setup form and the phone bottom sheet.
import { C, cx, read, to_z, admittance, from_impedance, from_admittance, isInf, Move, apply, describe, expj } from './smith.js';
import { num, cplx, parse } from './format.js';
import { SmithChart } from './chart.js';
import { MOVE_TOOLS, MATCHED } from './layers.js';
import { ladderSVG } from './ladder.js';
import { buzz } from './draw.js';
import { solutions, lesson, title as solutionTitle, summary as solutionSummary } from './solver.js';
import { EXERCISES, BY_KEY, sceneOf, progress, checkAnswer, diagnose, watch, toolFor } from './lessons.js';
import { encode, decode } from './share.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ } },
};
const phone = matchMedia('(max-width: 899px)');
const fine = matchMedia('(pointer: fine)');

// ---- state -------------------------------------------------------------------
const TOOLS = ['select', 'load', 'series', 'shunt', 'line', 'stub', 'compass', 'ruler', 'mark', 'reflect', 'erase'];
const saved = store.get('smith.state') || {};
const toC = v => (Array.isArray(v) ? cx(v[0], v[1]) : null);
const state = {
  z0: saved.z0 > 0 ? saved.z0 : 50,
  f0: saved.f0 > 0 ? saved.f0 : 1,
  // A lesson starts on an empty chart, so a saved null load stays empty.
  load: 'load' in saved ? toC(saved.load) : from_impedance(cx(25, -40), 50),
  probe: toC(saved.probe),
  moves: Array.isArray(saved.moves) ? saved.moves.filter(m => ['series', 'shunt', 'line', 'stub'].includes(m.kind)) : [],
  items: Array.isArray(saved.items) ? saved.items : [],
  opts: { zc: saved.opts?.zc > 0 ? saved.opts.zc : (saved.z0 > 0 ? saved.z0 : 50), end: saved.opts?.end === 'short' ? 'short' : 'open' },
  focus: ['load', 'probe', 'end'].includes(saved.focus) ? saved.focus : 'load',
  grid: ['z', 'y', 'zy'].includes(saved.grid) ? saved.grid : 'z',
  tool: TOOLS.includes(saved.tool) ? saved.tool : 'select',
  reading: saved.reading ?? null,
  family: ['lnet', 'stub', 'qwt'].includes(saved.family) ? saved.family : 'lnet',
  loadMode: ['z', 'g', 'y'].includes(saved.loadMode) ? saved.loadMode : 'z',
  lesson: saved.lesson && BY_KEY[saved.lesson.key] ? saved.lesson : null,
};
if (!state.lesson && !state.load) state.load = from_impedance(cx(25, -40), 50);
if (state.focus === 'probe' && !state.probe) state.focus = 'load';
if (state.focus === 'end' && !state.moves.length) state.focus = 'load';
const firstVisit = !('load' in saved);
let preview = null; // { which, g } while a point is being dragged

const pair = g => (g ? [g.re, g.im] : null);
function save() {
  store.set('smith.state', { z0: state.z0, f0: state.f0, load: pair(state.load), probe: pair(state.probe),
    moves: state.moves, items: state.items, opts: state.opts,
    focus: state.focus, grid: state.grid, tool: state.tool, reading: state.reading, family: state.family, loadMode: state.loadMode,
    lesson: state.lesson });
}

// Undo and redo keep whole snapshots of what the student drew.
const history = { undo: [], redo: [] };
const snapshot = () => JSON.stringify({ z0: state.z0, f0: state.f0, load: pair(state.load), probe: pair(state.probe),
  moves: state.moves, items: state.items, focus: state.focus });
function restore(text) {
  const s = JSON.parse(text);
  Object.assign(state, { z0: s.z0, f0: s.f0, load: toC(s.load), probe: toC(s.probe), moves: s.moves, items: s.items, focus: s.focus });
}
/** Change the drawing as one undoable step. */
function edit(change, fx) {
  if (player.sol && !player.applying) closePlayer();
  stopWatching();
  const before = snapshot();
  change();
  if (snapshot() === before) { commit(fx); return; }
  history.undo.push(before);
  if (history.undo.length > 200) history.undo.shift();
  history.redo = [];
  commit(fx);
}
function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  restore(history.undo.pop());
  commit();
  toast('Undone');
}
function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  restore(history.redo.pop());
  commit();
  toast('Redone');
}

const movesOf = () => state.moves.map(m => Move.fromDict(m, state.z0));
function pointsOf(load = pointOf('load')) {
  if (!load) return [];
  const pts = [load];
  for (const m of movesOf()) pts.push(apply(pts.at(-1), m));
  return pts;
}
const pointOf = which => (preview && preview.which === which ? preview.g : state[which]);
function focusPoint() {
  if (state.focus === 'end' && state.moves.length) return pointsOf().at(-1);
  return pointOf(state.focus) || pointOf('load');
}

// ---- readings and how each is read --------------------------------------------
const READINGS = [
  { key: 'unitz', label: 'z', hint: 'normalized impedance', value: c => cplx(c.z) },
  { key: 'z', label: 'Z', hint: 'impedance', value: c => isInf(c.z) ? '∞' : `${cplx(c.z.scale(c.z0), 2)} Ω` },
  { key: 'unity', label: 'y', hint: 'normalized admittance', value: c => cplx(c.y) },
  { key: 'y', label: 'Y', hint: 'admittance', value: c => isInf(c.y) ? '∞' : `${cplx(c.y.scale(1000 / c.z0), 3)} mS` },
  { key: 'gamma', label: 'Γ', hint: 'reflection coefficient', value: c => cplx(c.g, 4) },
  { key: 'polar', label: '|Γ| ∠ θ', hint: 'magnitude and angle', value: c => `${num(c.r.magnitude, 4)} ∠ ${c.r.angle === null ? '—' : num(c.r.angle, 1) + '°'}` },
  { key: 'vswr', label: 'VSWR', hint: 'standing-wave ratio', value: c => num(c.r.vswr, 2) },
  { key: 'rl', label: 'Return loss', hint: 'RL', value: c => `${num(c.r.return_loss, 2)} dB` },
  { key: 'ml', label: 'Mismatch loss', hint: 'ML', value: c => `${num(c.r.mismatch_loss, 2)} dB` },
  { key: 'power', label: 'Reflected power', hint: '|Γ|²', value: c => `${num(100 * c.r.reflected_power, 1)} %` },
  { key: 'wtg', label: 'λ → generator', hint: 'middle ring', value: c => c.r.toward_generator === null ? '—' : `${num(c.r.toward_generator, 4)} λ` },
  { key: 'wtl', label: 'λ → load', hint: 'outer ring', value: c => c.r.toward_load === null ? '—' : `${num(c.r.toward_load, 4)} λ` },
];
const PEEK = ['unitz', 'polar', 'vswr'];

function context(g) {
  return { g, r: read(g), z: to_z(g), y: admittance(g), z0: state.z0 };
}
const paren = s => `(${s})`;

/** Title, how to read it on paper, the formula, and the working with today's numbers. */
function explain(key, c) {
  const { g, r, z, y, z0 } = c;
  const m = num(r.magnitude, 4);
  const zs = cplx(z), ys = cplx(y);
  switch (key) {
    case 'unitz': return {
      title: 'Normalized impedance z',
      how: 'The point sits on one <b class="t-zr">resistance circle</b> and one <b class="t-zx">reactance arc</b>. Follow the circle down to the horizontal axis to read r, and the arc out to the rim to read x.',
      formula: 'z = Z / Z₀ = r + jx = (1 + Γ) / (1 − Γ)',
      work: isInf(z) ? 'Γ = 1 here, so 1 − Γ = 0 and z is infinite: an open circuit.' : `z = (1 + Γ) / (1 − Γ) = ${zs}<br>so r = ${num(z.re, 3)} and x = ${num(z.im, 3)}`,
    };
    case 'z': return {
      title: 'Impedance Z in ohms',
      how: 'Read the normalized r and x on the chart first, then multiply both by the reference Z₀. The chart itself only knows normalized values.',
      formula: 'Z = Z₀ · z = Z₀ (r + jx)',
      work: isInf(z) ? 'z is infinite, so Z is an open circuit.' : `Z = ${num(z0, 2)} × ${paren(zs)} = ${cplx(z.scale(z0), 2)} Ω`,
    };
    case 'unity': return {
      title: 'Normalized admittance y',
      how: 'Read y on the <b class="t-yg">admittance grid</b>, which is the impedance grid turned half a turn (press <b>Y</b> or <b>Z+Y</b>). The paper trick: reflect the point through the centre and read the impedance grid there.',
      formula: 'y = Y · Z₀ = g + jb = 1 / z = (1 − Γ) / (1 + Γ)',
      work: isInf(y) ? 'Γ = −1 here, so y is infinite: a short circuit.' : isInf(z) ? 'z is infinite, so y = 0.' : `y = 1 / ${paren(zs)} = ${ys}<br>so g = ${num(y.re, 3)} and b = ${num(y.im, 3)}`,
    };
    case 'y': return {
      title: 'Admittance Y in millisiemens',
      how: 'Read the normalized g and b on the admittance grid, then divide by Z₀ to get siemens. Multiply by 1000 for mS.',
      formula: 'Y = y / Z₀',
      work: isInf(y) ? 'y is infinite: a short circuit.' : `Y = ${paren(ys)} / ${num(z0, 2)} Ω = ${cplx(y.scale(1000 / z0), 3)} mS`,
    };
    case 'gamma': return {
      title: 'Reflection coefficient Γ',
      how: 'The chart is drawn in the Γ plane with radius 1. Drop a line straight down to the horizontal axis for <b class="t-gold">Re Γ</b>, and across to the vertical diameter for <b class="t-gold">Im Γ</b>.',
      formula: 'Γ = (z − 1) / (z + 1) = (Z − Z₀) / (Z + Z₀)',
      work: isInf(z) ? 'For an open circuit Γ = 1.' : `Γ = ${paren(zs + ' − 1')} / ${paren(zs + ' + 1')} = ${cplx(g, 4)}`,
    };
    case 'polar': return {
      title: 'Magnitude |Γ| and angle θ',
      how: '|Γ| is the distance from the centre, as a fraction of the chart radius. θ is the angle from the right-hand axis, positive counter-clockwise.',
      formula: '|Γ| = √(Re² Γ + Im² Γ),  θ = atan2(Im Γ, Re Γ)',
      work: `|Γ| = √(${num(g.re, 3)}² + ${num(g.im, 3)}²) = ${m}<br>θ = ${r.angle === null ? 'undefined at the centre' : num(r.angle, 1) + '°'}`,
    };
    case 'vswr': return {
      title: 'Voltage standing-wave ratio',
      how: 'Put the compass needle on the centre and swing a <b class="t-mint">circle</b> through the point. Where it crosses the right-hand axis, the resistance value r is the VSWR. The VSWR ruler under the chart gives the same answer.',
      formula: 'VSWR = (1 + |Γ|) / (1 − |Γ|)',
      work: r.magnitude >= 1 - 1e-12 ? '|Γ| = 1, so all power is reflected and the VSWR is infinite.' : `VSWR = (1 + ${m}) / (1 − ${m}) = ${num(r.vswr, 3)}`,
    };
    case 'rl': return {
      title: 'Return loss',
      how: 'Swing the point down to the right-hand axis with the compass. The distance from the centre is |Γ|. Carry it straight down to the <b class="t-gold">RL ruler</b>.',
      formula: 'RL = −20 log₁₀ |Γ|  (dB)',
      work: r.magnitude <= 1e-12 ? '|Γ| = 0: a perfect match, so the return loss is infinite.' : `RL = −20 log₁₀ ${m} = ${num(r.return_loss, 2)} dB`,
    };
    case 'ml': return {
      title: 'Mismatch loss',
      how: 'Carry |Γ| down to the <b class="t-gold">ML ruler</b>. It tells you how much less power reaches the load than a matched load would get.',
      formula: 'ML = −10 log₁₀ (1 − |Γ|²)  (dB)',
      work: `ML = −10 log₁₀ (1 − ${m}²) = ${num(r.mismatch_loss, 2)} dB`,
    };
    case 'power': return {
      title: 'Reflected power',
      how: 'Carry |Γ| down to the |Γ| ruler, then square it. That fraction of the incident power comes back; the rest goes into the load.',
      formula: 'P_reflected / P_incident = |Γ|²',
      work: `|Γ|² = ${m}² = ${num(100 * r.reflected_power, 1)} %, so ${num(100 - 100 * r.reflected_power, 1)} % reaches the load`,
    };
    case 'wtg': return {
      title: 'Wavelengths toward generator',
      how: 'Draw a ray from the centre through the point out to the <b class="t-gold">middle ring</b>. It counts clockwise from the short-circuit end; one full turn is half a wavelength.',
      formula: 'd/λ = (180° − θ) / 720°  (mod 0.5)',
      work: r.angle === null ? 'At the centre there is no angle, so there is nothing to read.' : `d/λ = (180° − ${paren(num(r.angle, 1) + '°')}) / 720° = ${num(r.toward_generator, 4)} λ`,
    };
    case 'wtl': return {
      title: 'Wavelengths toward load',
      how: 'Draw a ray from the centre through the point out to the <b class="t-violet">outer ring</b>. It counts counter-clockwise from the short-circuit end.',
      formula: 'd/λ = (θ − 180°) / 720°  (mod 0.5)',
      work: r.angle === null ? 'At the centre there is no angle, so there is nothing to read.' : `d/λ = (${num(r.angle, 1)}° − 180°) / 720° = ${num(r.toward_load, 4)} λ`,
    };
  }
  return null;
}

// ---- chart --------------------------------------------------------------------
const chart = new SmithChart($('#chart'), {
  preview(which, g) {
    preview = { which, g };
    if (which !== state.focus && !(which === 'load' && state.focus === 'end')) state.focus = which;
    render({ live: true });
  },
  place(which, g) {
    preview = null;
    if (which === 'mark') {
      edit(() => state.items.push({ type: 'mark', g: [g.re, g.im], label: nextLetter() }), { animateItem: state.items.length });
      return;
    }
    if (which === 'reflect') {
      edit(() => state.items.push({ type: 'reflect', g: [g.re, g.im] }), { animateItem: state.items.length });
      return;
    }
    edit(() => {
      state[which] = g;
      if (!(which === 'load' && state.focus === 'end')) state.focus = which;
    }, { animate: true });
  },
  addMove(move) {
    edit(() => { state.moves.push(move.toDict(state.z0)); state.focus = 'end'; }, { animateMove: state.moves.length });
    const end = pointsOf().at(-1);
    if (end.abs() < MATCHED) celebrate();
  },
  addItem(item) { edit(() => state.items.push(item), { animateItem: state.items.length }); },
  erase(hit) {
    if (hit.kind === 'item') {
      const it = state.items[hit.index];
      const name = { compass: 'circle', ruler: 'ruler line', mark: `mark ${it.label}`, reflect: 'reflection' }[it.type];
      edit(() => state.items.splice(hit.index, 1));
      toast(`Erased the ${name}. Undo brings it back.`);
    } else {
      const n = state.moves.length - hit.index;
      edit(() => { state.moves.splice(hit.index); if (!state.moves.length && state.focus === 'end') state.focus = 'load'; });
      toast(n > 1 ? `Erased moves ${hit.index + 1} to ${hit.index + n}.` : `Erased move ${hit.index + 1}.`);
    }
  },
  message(text) { toast(text); },
  cancel() { preview = null; render(); },
  focus(which) { state.focus = which; commit(); },
  background() {},
  touch() { $('#toast').classList.remove('on'); },
  view(zoom) { $('#zoom-out').disabled = zoom <= 1.001; },
});

window.smithChart = chart; // handy from the browser console

function setTool(tool) {
  if (!TOOLS.includes(tool)) return;
  state.tool = tool;
  chart.setTool(tool);
  $$('.tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
  $(`.tool[data-tool="${tool}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  const opts = $('#opts');
  opts.hidden = !(tool === 'line' || tool === 'stub');
  opts.querySelector('.seg').hidden = tool !== 'stub';
  hint();
  if (MOVE_TOOLS.includes(tool) && !state.load) toast('Plot the load first: pick Load and tap the chart.');
  if (state.lesson) renderCoach();
  save();
}
function setGrid(mode) {
  state.grid = mode;
  chart.setGrid(mode);
  const sw = $('.grid-switch');
  sw.dataset.gridMode = mode;
  $$('[data-grid]', sw).forEach(b => b.setAttribute('aria-checked', String(b.dataset.grid === mode)));
  save();
}
const HINTS = {
  select: ['Read', 'Click anywhere to read it with the probe P. Drag points to move them. Scroll to zoom, drag to pan.', 'Touch the chart to read any point. Pinch to zoom.'],
  load: ['Load', 'Click to place the load Zₗ. It snaps to grid crossings; hold Shift to place it freely.', 'Touch and slide to place Zₗ. The magnifier shows exactly where it lands.'],
  series: ['Series', 'The end slides on its constant-r circle. Clockwise adds L, anticlockwise adds C. Click to add the move.', 'Slide along the circle: clockwise adds L, anticlockwise adds C.'],
  shunt: ['Shunt', 'The end slides on its constant-g circle. Clockwise adds C, anticlockwise adds L. Click to add the move.', 'Slide along the circle: clockwise adds C, anticlockwise adds L.'],
  line: ['Line', 'A line toward the generator turns the point clockwise around the centre. Half a wavelength is a full turn.', 'Slide clockwise around the centre. A full turn is half a wavelength.'],
  stub: ['Stub', 'A shunt stub slides on the constant-g circle like a shunt element. Set Zc and open or short on the chart.', 'Slide along the conductance circle. Pick open or short on the chart.'],
  compass: ['Compass', 'Press on the needle point, drag out to the pencil point, release. Snaps to the centre, points and marks.', 'Press the needle point, drag out the radius, lift to draw.'],
  ruler: ['Ruler', 'Drag a straight line. Starting at the centre it reads the angle and the wavelength rings.', 'Drag a straight line. From the centre it reads the rings.'],
  mark: ['Mark', 'Click to mark a point with a letter. It snaps to crossings of your circles with r = 1, g = 1 and the axis.', 'Tap to mark a point with a letter.'],
  reflect: ['Reflect', 'Click a point to draw the diameter through the centre to its admittance point y.', 'Tap a point to reflect it through the centre to y.'],
  erase: ['Erase', 'Click a circle, line, mark or move to erase it. Erasing a move also erases the moves after it.', 'Tap a circle, line, mark or move to erase it.'],
};
function hint() {
  const touch = !fine.matches;
  const [name, mouse, finger] = HINTS[state.tool];
  $('#hint').innerHTML = `<b>${name}</b> · ${mouse}`;
  if (touch) toast(`<b>${name}</b> · ${finger}`);
}
function nextLetter() {
  const used = new Set(state.items.filter(i => i.type === 'mark').map(i => i.label));
  return [...'ABCDEFGHJKLMNPQRSTUVWXYZ'].find(ch => !used.has(ch)) || '•';
}
function celebrate() {
  toast('<b>Matched!</b> The end of the network sits on the centre: Γ ≈ 0.');
  buzz([10, 40, 10]);
}

// ---- rendering -----------------------------------------------------------------
function render({ live = false, animate = false, animateMove, animateItem } = {}) {
  const load = pointOf('load');
  chart.setScene({ load, probe: pointOf('probe'), focus: state.focus, moves: movesOf(), points: pointsOf(load),
    items: state.items, opts: { zc: state.opts.zc / state.z0, end: state.opts.end }, z0: state.z0, f0: state.f0 },
  { animate, animateMove, animateItem });
  const g = focusPoint();
  const c = g ? context(g) : null;
  const hide = masked();
  chart.setQuiet(hide);
  renderFocus();
  renderPeek(c, hide);
  renderReadings(c, live, hide);
  renderExplain(hide ? null : c);
  chart.constr.classList.toggle('instant', live);
  if (state.reading) chart.construct(state.reading, g); else chart.clearConstruction();
  if (!live || preview?.which === 'load') syncFields(pointOf('load'));
  renderNetwork(live);
  if (!live) { renderSolutions(); renderCoach(); }
  $('#undo').disabled = !history.undo.length;
  $('#redo').disabled = !history.redo.length;
}
function commit(opts) { render(opts); save(); }

function renderFocus() {
  const box = $('#focus');
  const chip = (which, name, sub) => `<button class="focus-chip ${which}" aria-pressed="${state.focus === which}" data-focus="${which}">
    <span class="sym">${name}</span><span>${sub}</span></button>`;
  $('#masked-note').hidden = !masked();
  if (!state.load) { box.innerHTML = `<span class="focus-title">Reading</span><span class="focus-empty">Plot a load to read it.</span>`; return; }
  box.innerHTML = `<span class="focus-title">Reading</span>${chip('load', 'Z<sub>L</sub>', 'load')}${state.moves.length ? chip('end', 'Z<sub>in</sub>', 'network end') : ''}${state.probe ? chip('probe', 'P', 'probe') +
    '<button class="icon-btn small" id="clear-probe" aria-label="Remove the probe" title="Remove the probe (Delete)"><i class="ph ph-x"></i></button>' : ''}`;
}
const HIDDEN = '• • •';
function renderPeek(c, hide) {
  $('#peek').innerHTML = PEEK.map(key => {
    const row = READINGS.find(r => r.key === key);
    const value = !c ? '—' : hide ? HIDDEN : key === 'polar'
      ? `${num(c.r.magnitude, 3)} ∠ ${c.r.angle === null ? '—' : num(c.r.angle, 0) + '°'}`
      : key === 'unitz' ? cplx(c.z, 2) : row.value(c);
    return `<button class="peek-chip" data-key="${key}" aria-pressed="${state.reading === key}"><span>${row.label}</span><b>${value}</b></button>`;
  }).join('');
}
let lastValues = {};
function renderReadings(c, live, hide) {
  const list = $('#readings');
  if (!list.children.length) {
    list.innerHTML = READINGS.map(row => `<li><button data-key="${row.key}" aria-pressed="false">
      <span class="k">${row.label}<small>${row.hint}</small></span><span class="v"></span><i class="ph ph-caret-right"></i></button></li>`).join('');
  }
  for (const row of READINGS) {
    const btn = $(`button[data-key="${row.key}"]`, list);
    const value = !c ? '—' : hide ? HIDDEN : row.value(c);
    const v = $('.v', btn);
    if (v.textContent !== value) {
      v.textContent = value;
      if (!live && lastValues[row.key] !== undefined) { v.classList.remove('flash'); void v.offsetWidth; v.classList.add('flash'); }
    }
    lastValues[row.key] = value;
    btn.setAttribute('aria-pressed', String(state.reading === row.key));
  }
}
function renderExplain(c) {
  const box = $('#explain');
  const e = state.reading && c && explain(state.reading, c);
  if (!e) { box.hidden = true; box.dataset.key = ''; return; }
  const fresh = box.hidden || box.dataset.key !== state.reading;
  box.hidden = false;
  box.dataset.key = state.reading;
  box.innerHTML = `<header><h2>${e.title}</h2><button class="icon-btn small" id="close-explain" aria-label="Close"><i class="ph ph-x"></i></button></header>
    <p class="how"><span class="tag">On the chart</span>${e.how}</p>
    <p class="formula">${e.formula}</p>
    <p class="work"><span class="tag">With your point</span>${e.work}</p>`;
  if (fresh) { box.classList.remove('enter'); void box.offsetWidth; box.classList.add('enter'); }
}

function renderNetwork(live) {
  const moves = movesOf();
  $('#net-count').textContent = moves.length ? String(moves.length) : '';
  if (live && preview?.which !== 'load') return;
  $('#ladder').innerHTML = ladderSVG(moves, state.z0, state.f0);
  const unit = { series: 'Δx', shunt: 'Δb', line: 'λ', stub: 'λ' };
  $('#moves').innerHTML = moves.map((m, i) => {
    const [name, value, detail] = describe(m, state.z0, state.f0);
    const last = i === moves.length - 1;
    const field = last ? `<span class="input small"><input data-last inputmode="decimal" value="${+m.value.toFixed(4)}" aria-label="Value of the last move"><em>${unit[m.kind]}</em></span>` : '';
    return `<li class="k-${m.kind}"><span class="num">${i + 1}</span><span class="nm"><b>${name}</b><small>${detail}</small></span><span class="vl">${value}</span>${field}</li>`;
  }).join('');
  const status = $('#net-status');
  if (!state.load) status.innerHTML = '';
  else if (!moves.length) status.innerHTML = '<p>Pick <b>Series</b>, <b>Shunt</b>, <b>Line</b> or <b>Stub</b> and drag from the load to add a move. Aim for the centre.</p>';
  else {
    const end = pointsOf().at(-1), r = read(end);
    const ok = end.abs() < MATCHED;
    status.innerHTML = `<p class="${ok ? 'ok' : ''}">${ok ? '<i class="ph ph-check-circle"></i> <b>Matched.</b> ' : ''}At the input: z = ${cplx(to_z(end), 3)}, |Γ| = ${num(r.magnitude, 3)}, VSWR ${num(r.vswr, 2)}</p>`;
  }
  $('#remove-last').disabled = $('#clear-net').disabled = !moves.length;
}
$('#moves').addEventListener('change', e => {
  if (!e.target.matches('[data-last]')) return;
  const v = parse(e.target.value);
  if (!Number.isFinite(v)) { render(); return; }
  edit(() => { state.moves.at(-1).value = v; });
});
$('#remove-last').addEventListener('click', () => edit(() => { state.moves.pop(); if (!state.moves.length && state.focus === 'end') state.focus = 'load'; }));
$('#clear-net').addEventListener('click', () => edit(() => { state.moves = []; if (state.focus === 'end') state.focus = 'load'; }));

// Tool options for the next line or stub.
const zcField = $('#opt-zc');
zcField.value = String(+state.opts.zc.toFixed(3));
zcField.addEventListener('change', () => {
  const v = parse(zcField.value);
  if (v > 0 && Number.isFinite(v)) { state.opts.zc = v; save(); render(); }
  else { zcField.value = String(state.opts.zc); toast('Zc must be a positive number of ohms.'); }
});
function setEnd(end) {
  state.opts.end = end;
  $$('[data-end]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.end === end)));
  save();
}

// ---- worked solutions -------------------------------------------------------------
const FAMILY_NOTE = {
  lnet: 'Two lumped elements, L or C. Up to four ways, depending on where the point is.',
  stub: 'A line of Z₀, then a shunt stub. Set Zc and open or short with the Stub tool.',
  qwt: 'A line to the real axis if needed, then a quarter-wave transformer.',
};
let shownSolutions = [];
function renderSolutions() {
  const start = state.load ? pointsOf().at(-1) : null;
  const from = $('#solve-from');
  $$('[data-family]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.family === state.family)));
  const list = $('#solutions');
  if (!start) { from.textContent = 'Plot a load first.'; list.innerHTML = ''; return; }
  const where = state.moves.length ? 'the end of your network, Z<sub>in</sub>' : 'the load Z<sub>L</sub>';
  if (start.abs() < MATCHED) {
    from.innerHTML = `Starting from ${where}: it already sits on the centre. Nothing left to match.`;
    list.innerHTML = '';
    shownSolutions = [];
    return;
  }
  if (start.abs() >= 1 - 1e-9) {
    from.innerHTML = `Starting from ${where}: it is on the rim (|Γ| = 1), a pure reactance. No lossless network can match it.`;
    list.innerHTML = '';
    shownSolutions = [];
    return;
  }
  from.innerHTML = `Starting from ${where}. ${FAMILY_NOTE[state.family]}`;
  const opts = { zc: state.opts.zc / state.z0, end: state.opts.end };
  shownSolutions = solutions(start, opts).filter(sol => sol.family === state.family);
  list.innerHTML = shownSolutions.length ? shownSolutions.map((sol, i) => `<li>
      <span class="sol-n">${i + 1}</span>
      <span class="sol-text"><b>${solutionTitle(sol, state.z0, state.f0)}</b><small>${solutionSummary(sol, state.z0, state.f0)}</small></span>
      <span class="sol-actions">
        <button class="primary small" data-show="${i}"><i class="ph ph-play"></i> Show me</button>
        <button class="ghost-btn small" data-use="${i}" title="Add these moves to your network"><i class="ph ph-plus"></i></button>
      </span></li>`).join('')
    : `<li class="none">No ${state.family === 'lnet' ? 'L-network' : 'match of this kind'} reaches the centre from here. Try another kind.</li>`;
}

const player = { sol: null, steps: [], i: 0, start: null, applying: false };
function openPlayer(sol) {
  const start = pointsOf().at(-1);
  player.sol = sol;
  player.start = start;
  player.steps = lesson(sol, start, state.z0, state.f0);
  player.i = 0;
  state.reading = null;
  render();
  $('#player-name').textContent = solutionTitle(sol, state.z0, state.f0);
  $('#player').hidden = false;
  $('#player').classList.remove('enter'); void $('#player').offsetWidth; $('#player').classList.add('enter');
  document.body.classList.add('playing');
  if (phone.matches) setSheet('peek');
  showStep();
}
function showStep() {
  const step = player.steps[player.i];
  $('#player-title').innerHTML = step.title;
  $('#player-text').innerHTML = step.text;
  const f = $('#player-formula');
  f.hidden = !step.formula;
  f.textContent = step.formula || '';
  $('#player-dots').innerHTML = player.steps.map((_, i) => `<span class="${i === player.i ? 'on' : i < player.i ? 'past' : ''}"></span>`).join('');
  $('#player-back').disabled = player.i === 0;
  $('#player-next').hidden = !!step.done;
  $('#player-use').hidden = !step.done;
  const card = $('#player-text').parentElement;
  card.classList.remove('step-in'); void card.offsetWidth; card.classList.add('step-in');
  chart.showDemo({ start: player.start, moves: player.sol.moves, upto: step.upto, animate: step.animate,
    guide: step.guide, extraGuide: step.extraGuide, notes: step.notes });
  // On phones the chart shrinks to sit above the card instead of hiding behind it.
  document.body.style.setProperty('--player-h', `${$('#player').offsetHeight}px`);
}
function closePlayer() {
  if (!player.sol) return;
  player.sol = null;
  $('#player').hidden = true;
  document.body.classList.remove('playing');
  chart.showDemo(null);
}
function useSolution(sol) {
  closePlayer();
  edit(() => {
    for (const m of sol.moves) state.moves.push(m.toDict(state.z0));
    state.focus = 'end';
  }, { animateMove: state.moves.length });
  celebrate();
}
$('#player-next').addEventListener('click', () => { if (player.i < player.steps.length - 1) { player.i++; showStep(); } });
$('#player-back').addEventListener('click', () => { if (player.i > 0) { player.i--; showStep(); } });
$('#player-replay').addEventListener('click', showStep);
$('#player-close').addEventListener('click', closePlayer);
$('#player-use').addEventListener('click', () => { if (player.sol) useSolution(player.sol); });
$('#solutions').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  const sol = shownSolutions[+(b.dataset.show ?? b.dataset.use)];
  if (!sol) return;
  if (b.dataset.show !== undefined) openPlayer(sol); else useSolution(sol);
});
$('#families').addEventListener('click', e => {
  const b = e.target.closest('[data-family]');
  if (!b) return;
  state.family = b.dataset.family;
  save();
  renderSolutions();
});

// ---- guided lessons -------------------------------------------------------------------
// The student works on their own chart; every render checks the steps of the lesson.
const lessonsDone = store.get('smith.lessons')?.done || {};
const coach = { index: null, key: null, watching: false, hint: false, feedback: null, folded: false };
const TOOL_NAME = { load: 'Load', compass: 'Compass', ruler: 'Ruler', mark: 'Mark', reflect: 'Reflect', line: 'Line', stub: 'Stub', series: 'Series', shunt: 'Shunt' };

function lessonStatus() {
  const ex = BY_KEY[state.lesson.key];
  const scene = sceneOf(state.z0, state.load, movesOf(), state.items);
  const prog = progress(ex, scene, state.lesson.answers);
  return { ex, scene, prog, current: prog.indexOf(false) };
}
/** While the lesson asks for a value, the readouts would give it away. */
function masked() {
  if (!state.lesson) return false;
  const { ex, current } = lessonStatus();
  return current >= 0 && ex.steps[current].kind === 'answer';
}
const stepTool = (ex, s) => (s.kind === 'match' ? (ex.key === 'stub' ? 'stub' : null) : toolFor(s));

function startLesson(key) {
  const ex = BY_KEY[key];
  if (!ex) return;
  closePlayer();
  stopWatching();
  // Keep the student's own chart to bring back when they leave the lessons.
  if (!state.lesson) store.set('smith.stash', { snap: snapshot(), opts: { ...state.opts } });
  Object.assign(state, { z0: ex.z0, f0: ex.f0, load: null, probe: null, moves: [], items: [], focus: 'load', reading: null,
    lesson: { key, answers: {}, started: false } });
  state.opts.zc = ex.z0;
  zcField.value = String(ex.z0);
  setEnd('open');
  history.undo = []; history.redo = [];
  Object.assign(coach, { index: null, key, hint: false, feedback: null, folded: false });
  setTool('select');
  commit();
  const card = $('#coach');
  card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
  if (phone.matches) setSheet('peek');
}
function leaveLesson() {
  if (!state.lesson) return;
  stopWatching();
  state.lesson = null;
  const stash = store.get('smith.stash');
  if (stash?.snap) {
    restore(stash.snap);
    Object.assign(state.opts, stash.opts);
    zcField.value = String(+state.opts.zc.toFixed(3));
    setEnd(state.opts.end);
  }
  if (!state.load) state.load = from_impedance(cx(25, -40), 50);
  store.set('smith.stash', null);
  history.undo = []; history.redo = [];
  state.reading = null;
  commit();
  toast('Back to your own chart.');
}
function stopWatching() {
  if (!coach.watching) return;
  coach.watching = false;
  if (!player.sol) chart.showDemo(null);
}
function watchStep() {
  const { ex, scene, current } = lessonStatus();
  if (current < 0) return;
  const w = watch(ex, current, scene, state.opts.zc);
  if (!w) { toast(ex.steps[current].kind === 'answer' ? 'Work this one out: the hint shows how.' : 'Plot the load first.'); return; }
  if (w.reading) {
    state.reading = w.reading;
    state.focus = w.at === 'end' && state.moves.length ? 'end' : 'load';
    commit();
    toast('The pencil shows where it is read. The number is yours to read.');
    return;
  }
  chart.showDemo(w);
  coach.watching = true;
  toast('Watch, then do it yourself on the chart.');
}

function renderCoach() {
  const card = $('#coach');
  const on = !!state.lesson;
  card.hidden = !on;
  document.body.classList.toggle('coaching', on);
  renderLessonList();
  if (!on) { document.body.style.removeProperty('--coach-h'); return; }
  const { ex, scene, prog, current } = lessonStatus();
  const intro = !state.lesson.started, complete = current < 0;
  if (coach.key !== ex.key) Object.assign(coach, { key: ex.key, index: null });
  if (coach.index !== current) {
    const forward = coach.index !== null && (complete || current > coach.index);
    if (forward && !complete) { toast(`<b>Step ${coach.index + 1} done.</b> On to step ${current + 1}.`); buzz(12); }
    coach.index = current;
    coach.hint = false;
    coach.feedback = null;
    stopWatching();
    if (forward) { card.classList.remove('step-in'); void card.offsetWidth; card.classList.add('step-in'); }
    if (complete && forward) {
      lessonsDone[ex.key] = true;
      store.set('smith.lessons', { done: lessonsDone });
      toast(`<b>Lesson ${ex.n} complete!</b> Every step checks out.`);
      buzz([10, 40, 10, 40, 10]);
      renderLessonList();
    }
  }
  const s = complete ? null : ex.steps[current];
  card.classList.toggle('folded', coach.folded);
  card.classList.toggle('complete', complete);
  $('#coach-min i').className = `ph ${coach.folded ? 'ph-caret-up' : 'ph-caret-down'}`;
  $('#coach-name').textContent = `Lesson ${ex.n} · ${ex.title}`;
  $('#coach-count').textContent = intro ? `${ex.steps.length} steps` : complete ? 'Done' : `${current + 1} / ${ex.steps.length}`;
  const last = ex.n === EXERCISES.length;
  $('#coach-text').innerHTML = intro ? ex.brief
    : complete ? `<b>Well done.</b> You worked “${ex.title}” on the chart, step by step. ${last ? 'That was the last lesson.' : 'Ready for the next one?'}`
    : `<b>Step ${current + 1}.</b> ${s.text}`;
  const asks = !intro && s?.kind === 'answer';
  $('#coach-answer').hidden = !asks;
  if (asks) $('#coach-unit').textContent = s.unit;
  const fb = $('#coach-feedback');
  const tip = intro || complete ? null : coach.feedback || (diagnose(ex, current, scene) && { ok: false, text: diagnose(ex, current, scene) });
  fb.hidden = !tip;
  if (tip) { fb.textContent = tip.text; fb.className = `coach-feedback ${tip.ok ? 'ok' : 'bad'}`; }
  const hintBox = $('#coach-hint');
  hintBox.hidden = !(coach.hint && s?.hint);
  if (s) hintBox.innerHTML = `<i class="ph ph-lightbulb"></i> ${s.hint}`;
  $('#coach-dots').innerHTML = prog.map((ok, i) => `<span class="${i === current && !intro ? 'on' : ok ? 'past' : ''}"></span>`).join('');
  $('#coach-hint-btn').hidden = intro || complete || !s.hint;
  $('#coach-hint-btn').setAttribute('aria-pressed', String(coach.hint));
  $('#coach-watch').hidden = intro || complete;
  const tool = !intro && s ? stepTool(ex, s) : null;
  const toolBtn = $('#coach-tool');
  toolBtn.hidden = !tool || state.tool === tool;
  if (tool) { toolBtn.dataset.use = tool; toolBtn.innerHTML = `Use ${TOOL_NAME[tool]}`; }
  $('#coach-start').hidden = !intro;
  $('#coach-next').hidden = !complete;
  $('#coach-next').innerHTML = last ? '<i class="ph ph-arrow-u-up-left"></i> My chart' : 'Next lesson <i class="ph ph-caret-right"></i>';
}
// The chart makes room for the card, so follow its height as it changes.
new ResizeObserver(([entry]) => {
  const h = entry.target.offsetHeight;
  if (h) document.body.style.setProperty('--coach-h', `${h}px`);
}).observe($('#coach'));

function renderLessonList() {
  const active = state.lesson?.key;
  const doneCount = EXERCISES.filter(ex => lessonsDone[ex.key]).length;
  $('#lesson-count').textContent = doneCount ? `${doneCount}/${EXERCISES.length}` : '';
  $('#lessons-done').textContent = doneCount ? `${doneCount} of ${EXERCISES.length} done` : 'Your progress stays in this browser.';
  $('#lessons-reset').hidden = !doneCount;
  const status = active ? lessonStatus() : null;
  $('#lessons').innerHTML = EXERCISES.map(ex => {
    const isActive = ex.key === active, isDone = !!lessonsDone[ex.key];
    const steps = isActive ? `<ol class="lesson-steps">${ex.steps.map((s, i) => `<li class="${status.prog[i] ? 'ok' : i === status.current ? 'now' : ''}">
        <i class="ph ${status.prog[i] ? 'ph-check-circle' : i === status.current ? 'ph-arrow-circle-right' : 'ph-circle'}"></i><span>${s.text}</span></li>`).join('')}</ol>` : '';
    return `<li class="lesson${isActive ? ' active' : ''}${isDone ? ' done' : ''}">
      <span class="ln">${isDone ? '<i class="ph ph-check"></i>' : ex.n}</span>
      <span class="lt"><b>${ex.title}</b><small>${ex.brief}</small></span>
      ${isActive ? `<button class="ghost-btn small" data-leave>Leave</button>` : `<button class="primary small" data-lesson="${ex.key}">${isDone ? 'Again' : 'Start'}</button>`}
      ${steps}</li>`;
  }).join('');
}

$('#lessons').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.lesson) startLesson(b.dataset.lesson);
  else if (b.dataset.leave !== undefined) leaveLesson();
});
$('#lessons-reset').addEventListener('click', () => {
  for (const k of Object.keys(lessonsDone)) delete lessonsDone[k];
  store.set('smith.lessons', { done: lessonsDone });
  renderLessonList();
  toast('Lesson progress reset.');
});
$('#coach-start').addEventListener('click', () => { state.lesson.started = true; commit(); });
$('#coach-close').addEventListener('click', leaveLesson);
$('#coach-min').addEventListener('click', () => { coach.folded = !coach.folded; renderCoach(); });
$('#coach-hint-btn').addEventListener('click', () => { coach.hint = !coach.hint; renderCoach(); });
$('#coach-watch').addEventListener('click', watchStep);
$('#coach-tool').addEventListener('click', e => { setTool(e.currentTarget.dataset.use); renderCoach(); });
$('#coach-next').addEventListener('click', () => {
  const ex = BY_KEY[state.lesson.key];
  const next = EXERCISES[ex.n];
  if (next) startLesson(next.key); else leaveLesson();
});
$('#coach-answer').addEventListener('submit', e => {
  e.preventDefault();
  const { ex, current } = lessonStatus();
  const s = ex.steps[current];
  if (!s || s.kind !== 'answer') return;
  const input = $('#coach-input');
  const r = checkAnswer(s, input.value);
  if (r.ok) {
    state.lesson.answers[current] = { ok: true, value: r.value };
    input.value = '';
    state.reading = null;
  } else {
    coach.feedback = { ok: false, text: r.message };
    buzz(30);
    const card = $('#coach');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  }
  commit();
});

// ---- clear all ------------------------------------------------------------------------
const confirmBox = $('#confirm-clear');
function askClearAll() {
  if (!state.moves.length && !state.items.length && !state.probe) { toast('Nothing to clear: the chart only has the load.'); return; }
  if (typeof confirmBox.showModal === 'function') confirmBox.showModal();
  else if (window.confirm('Clear the network, circles, lines, marks and the probe?')) clearAll();
}
confirmBox.addEventListener('close', () => { if (confirmBox.returnValue === 'clear') clearAll(); });
function clearAll() {
  closePlayer();
  state.reading = null;
  edit(() => { state.moves = []; state.items = []; state.probe = null; state.focus = 'load'; });
  chart.svg.classList.remove('wipe'); void chart.svg.getBoundingClientRect(); chart.svg.classList.add('wipe');
  toast('Chart cleared. Undo brings it all back.');
}
$('#clear-all').addEventListener('click', askClearAll);

function selectReading(key) {
  state.reading = state.reading === key ? null : key;
  commit();
  if (state.reading && phone.matches) {
    showTab('read');
    if (sheet.state === 'peek') setSheet('half');
    $('#explain').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ---- setup form ------------------------------------------------------------------
const fields = { z0: $('#z0'), f0: $('#f0'), lr: $('#lr'), lx: $('#lx') };
const MODES = {
  z: [['Load R', 'Ω'], ['Load X', 'Ω']],
  g: [['|Γ|', ''], ['Angle θ', '°']],
  y: [['Load G', 'mS'], ['Load B', 'mS']],
};
const trim = t => t.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
function setLoadMode(mode) {
  state.loadMode = mode;
  const [[a, ua], [b, ub]] = MODES[mode];
  $('#la-name').textContent = a; $('#la-unit').textContent = ua;
  $('#lb-name').textContent = b; $('#lb-unit').textContent = ub;
  $$('#load-mode [data-mode]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.mode === mode)));
  save();
  syncFields(state.load, true);
}
function syncFields(g, force = false) {
  if (!g) return;
  fields.z0.value = String(+state.z0.toFixed(4));
  fields.f0.value = String(+state.f0.toFixed(6));
  if (!force && (document.activeElement === fields.lr || document.activeElement === fields.lx)) return;
  if (state.loadMode === 'g') {
    const r = read(g);
    fields.lr.value = trim(num(r.magnitude, 4));
    fields.lx.value = r.angle === null ? '0' : trim(num(r.angle, 2));
    return;
  }
  if (state.loadMode === 'y') {
    const y = admittance(g);
    if (isInf(y)) { fields.lr.value = '∞'; fields.lx.value = '0'; return; }
    fields.lr.value = trim(num(y.re * 1000 / state.z0, 3));
    fields.lx.value = trim(num(y.im * 1000 / state.z0, 3));
    return;
  }
  const z = to_z(g);
  if (isInf(z)) { fields.lr.value = '∞'; fields.lx.value = '0'; return; }
  fields.lr.value = trim(num(z.re * state.z0, 2));
  fields.lx.value = trim(num(z.im * state.z0, 2));
}
/** The load from the two fields in the current mode, or an error message. */
function loadFromFields(z0) {
  const A = parse(fields.lr.value), B = parse(fields.lx.value);
  if (Number.isNaN(A) || Number.isNaN(B)) return { error: 'Enter both values as numbers, for example 25 and −40.' };
  if (state.loadMode === 'g') {
    if (!(A >= 0 && A <= 1)) return { error: '|Γ| must be between 0 and 1 for a passive load.' };
    if (!Number.isFinite(B)) return { error: 'Enter the angle θ in degrees.' };
    return { g: expj(B * Math.PI / 180).scale(A) };
  }
  if (state.loadMode === 'y') {
    if (A < 0) return { error: 'G must be zero or more for a passive load.' };
    if (A === Infinity) return { g: cx(-1) };
    if (!Number.isFinite(B)) return { error: 'B must be finite. For a short circuit, set G to ∞.' };
    return { g: from_admittance(cx(A, B).scale(z0 / 1000)) };
  }
  if (A < 0) return { error: 'R must be zero or more: a passive load lies inside the chart.' };
  if (A === Infinity) return { g: cx(1) };
  if (!Number.isFinite(B)) return { error: 'X must be finite. For an open circuit, set R to ∞.' };
  return { g: from_impedance(cx(A, B), z0) };
}
$('#load-mode').addEventListener('click', e => {
  const b = e.target.closest('[data-mode]');
  if (b) setLoadMode(b.dataset.mode);
});
function applyFields({ teach = true } = {}) {
  const z0 = parse(fields.z0.value), f0 = parse(fields.f0.value);
  const err = $('#setup-error');
  let message = '', loaded = null;
  if (!(z0 > 0) || !Number.isFinite(z0)) message = 'Z₀ must be a positive number of ohms.';
  else if (!(f0 > 0) || !Number.isFinite(f0)) message = 'f₀ must be a positive number of GHz.';
  else { loaded = loadFromFields(z0); message = loaded.error || ''; }
  err.textContent = message;
  $$('input', $('#setup')).forEach(i => i.removeAttribute('aria-invalid'));
  if (message) return false;
  if (teach) state.reading = 'unitz';
  edit(() => {
    // Keep the next line's Zc in step with the reference while they match.
    if (state.opts.zc === state.z0) { state.opts.zc = z0; zcField.value = String(z0); }
    state.z0 = z0;
    state.f0 = f0;
    state.load = loaded.g;
    state.focus = 'load';
  }, { animate: true });
  return true;
}
$('#setup').addEventListener('submit', e => {
  e.preventDefault();
  if (applyFields() && phone.matches) setSheet('peek');
});
for (const f of Object.values(fields)) f.addEventListener('change', () => applyFields({ teach: false }));
$$('[data-preset]').forEach(b => b.addEventListener('click', () => {
  const p = b.dataset.preset;
  if (state.loadMode !== 'z') setLoadMode('z');
  if (p === 'open') { fields.lr.value = '∞'; fields.lx.value = '0'; }
  else if (p === 'match') { fields.lr.value = String(state.z0); fields.lx.value = '0'; }
  else { const [R, X] = p.split(','); fields.lr.value = R; fields.lx.value = X; }
  if (applyFields() && phone.matches) setSheet('peek');
}));

// ---- clicks ------------------------------------------------------------------------
document.addEventListener('click', e => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.key) selectReading(t.dataset.key);
  else if (t.dataset.focus) { state.focus = t.dataset.focus; commit(); }
  else if (t.id === 'clear-probe') removeProbe();
  else if (t.id === 'close-explain') { state.reading = null; commit(); }
  else if (t.dataset.tool) setTool(t.dataset.tool);
  else if (t.dataset.grid) setGrid(t.dataset.grid);
  else if (t.dataset.tab) showTab(t.dataset.tab);
  else if (t.dataset.end) { setEnd(t.dataset.end); render(); }
});
function removeProbe() { edit(() => { state.probe = null; if (state.focus === 'probe') state.focus = 'load'; }); }
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#zoom-in').addEventListener('click', () => chart.zoomBy(1.8));
$('#zoom-out').addEventListener('click', () => chart.zoomBy(1 / 1.8));
$('#fit').addEventListener('click', () => chart.fit());
$('#theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('smith.theme', root.dataset.theme); } catch { /* ignore */ }
  themeIcon();
});
function themeIcon() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  $('#theme i').className = `ph ${dark ? 'ph-sun' : 'ph-moon'}`;
}

const KEYS = { v: 'select', l: 'load', s: 'series', p: 'shunt', t: 'line', b: 'stub', c: 'compass', r: 'ruler', m: 'mark', y: 'reflect', e: 'erase' };
document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea')) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
    else return;
    e.preventDefault();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (player.sol && (k === 'arrowright' || k === 'enter')) { $('#player-next').click(); }
  else if (player.sol && k === 'arrowleft') { $('#player-back').click(); }
  else if (KEYS[k]) setTool(KEYS[k]);
  else if (k === 'f') chart.fit();
  else if (k === 'g') setGrid({ z: 'y', y: 'zy', zy: 'z' }[state.grid]);
  else if (k === '+' || k === '=') chart.zoomBy(1.6);
  else if (k === '-' || k === '_') chart.zoomBy(1 / 1.6);
  else if (k === 'escape') {
    if (!menu.hidden) { openMenu(false); moreBtn.focus(); }
    else
    if (chart.cancelDrag()) { /* dropped the drag */ }
    else if (player.sol) closePlayer();
    else if (state.reading) { state.reading = null; commit(); }
    else if (state.tool !== 'select') setTool('select');
  }
  else if (k === 'delete' || k === 'backspace') {
    if (state.moves.length) edit(() => { state.moves.pop(); if (!state.moves.length && state.focus === 'end') state.focus = 'load'; });
    else if (state.probe) removeProbe();
    else return;
  }
  else return;
  e.preventDefault();
});

// ---- tabs and the phone bottom sheet ---------------------------------------------------
function showTab(tab) {
  $$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $$('.tab-page').forEach(p => p.classList.toggle('active', p.dataset.page === tab));
}
const panel = $('#panel');
const sheet = { state: 'peek' };
function sheetOffsets() {
  const h = panel.offsetHeight, vh = innerHeight;
  const peek = parseFloat(getComputedStyle(panel).getPropertyValue('--peek-h')) || 150;
  return { peek: h - peek, half: Math.max(0, h - vh * 0.5), full: 0 };
}
function setSheet(name) {
  sheet.state = name;
  document.body.dataset.sheet = name;
  panel.style.transform = '';
}
setSheet('peek');
(() => {
  let drag = null;
  const start = e => {
    if (!phone.matches || e.target.closest('button:not(.handle), input')) return;
    const offsets = sheetOffsets();
    drag = { y0: e.clientY, base: offsets[sheet.state], offsets, t: performance.now(), last: e.clientY, v: 0, moved: false };
    panel.classList.add('dragging');
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = e => {
    if (!drag) return;
    const dy = e.clientY - drag.y0;
    if (Math.abs(dy) > 3) drag.moved = true;
    const now = performance.now();
    drag.v = (e.clientY - drag.last) / Math.max(1, now - drag.t);
    drag.last = e.clientY; drag.t = now;
    const y = Math.max(0, Math.min(drag.offsets.peek, drag.base + dy));
    panel.style.transform = `translateY(${y}px)`;
  };
  const end = e => {
    if (!drag) return;
    panel.classList.remove('dragging');
    const { offsets } = drag;
    if (!drag.moved) { setSheet(sheet.state === 'peek' ? 'half' : 'peek'); drag = null; return; }
    const y = Math.max(0, Math.min(offsets.peek, drag.base + e.clientY - drag.y0)) + drag.v * 180;
    const best = Object.entries(offsets).sort((a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y))[0][0];
    setSheet(best);
    drag = null;
  };
  for (const zone of [$('#handle'), $('.tabs')]) {
    zone.addEventListener('pointerdown', start);
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
})();
phone.addEventListener('change', () => { setSheet('peek'); hint(); });

let toastTimer;
function toast(text) {
  const t = $('#toast');
  t.innerHTML = text;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

// ---- menu: share, print, install ---------------------------------------------------------
const menu = $('#menu'), moreBtn = $('#more');
function openMenu(open) {
  menu.hidden = !open;
  moreBtn.setAttribute('aria-expanded', String(open));
  if (!open) return;
  menu.classList.remove('enter'); void menu.offsetWidth; menu.classList.add('enter');
  renderOfflineState();
  menu.querySelector('[role=menuitem]:not([hidden])')?.focus({ preventScroll: true });
}
moreBtn.addEventListener('click', e => { e.stopPropagation(); openMenu(menu.hidden); });
document.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('#menu, #more')) openMenu(false); });
menu.addEventListener('click', e => {
  const b = e.target.closest('[data-menu]');
  if (!b) return;
  openMenu(false);
  ({ share: openShare, print: () => $('#print-dlg').showModal(), install: installApp })[b.dataset.menu]();
});

// Share: the chart (or just the problem) travels in the link itself.
let shareKind = 'all';
const canShare = () => !!navigator.share && !fine.matches;
function renderShare() {
  $$('#share-kind [data-kind]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.kind === shareKind)));
  const z = state.load ? (isInf(to_z(state.load)) ? 'an open circuit' : `${cplx(to_z(state.load).scale(state.z0), 2)} Ω`) : 'no load yet';
  const n = state.moves.length, drawn = state.items.length;
  $('#share-note').innerHTML = shareKind === 'all'
    ? `Everything on your chart: the load (${z})${n ? `, ${n} move${n > 1 ? 's' : ''}` : ''}${drawn ? `, ${drawn} drawing${drawn > 1 ? 's' : ''}` : ''}. Whoever opens it gets their own copy to work on.`
    : `Only Z₀ = ${num(state.z0, 0)} Ω, f₀ = ${num(state.f0, 3)} GHz and the load (${z}), on a clean chart: a problem for someone else to solve.`;
  const url = new URL(location.href);
  url.hash = `c=${encode(state, shareKind)}`;
  $('#share-link').value = url.href;
  $('#share-go').innerHTML = canShare() ? '<i class="ph ph-share-network"></i> Share' : '<i class="ph ph-copy"></i> Copy link';
}
function openShare() { renderShare(); $('#share-dlg').showModal(); }
$('#share-kind').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (b) { shareKind = b.dataset.kind; renderShare(); }
});
$('#share-link').addEventListener('focus', e => e.target.select());
$('#share-go').addEventListener('click', async () => {
  const url = $('#share-link').value;
  if (canShare()) {
    try { await navigator.share({ title: 'Smith Chart Lab', text: shareKind === 'problem' ? 'A Smith chart problem to solve' : 'My Smith chart', url }); $('#share-dlg').close(); }
    catch { /* the share sheet was closed */ }
    return;
  }
  try { await navigator.clipboard.writeText(url); $('#share-dlg').close(); toast('<b>Link copied.</b> Paste it in a message or on your course page.'); }
  catch { $('#share-link').focus(); toast('Select the link and copy it.'); }
});

/** Open a chart someone shared (#c=…), as one undoable step. */
function openShared() {
  const m = location.hash.match(/^#c=([\w-]+)$/);
  if (!m) return;
  window.history.replaceState(null, '', location.pathname + location.search); // `history` here is undo/redo
  const d = decode(m[1]);
  if (!d) { toast('This share link is damaged or incomplete.'); return; }
  if (state.lesson) leaveLesson();
  closePlayer();
  state.reading = null;
  if (d.opts) { Object.assign(state.opts, d.opts); zcField.value = String(+state.opts.zc.toFixed(3)); setEnd(state.opts.end); }
  if (d.grid) setGrid(d.grid);
  edit(() => Object.assign(state, { z0: d.z0, f0: d.f0, load: d.load ? cx(d.load[0], d.load[1]) : null, moves: d.moves, items: d.items,
    probe: null, focus: d.moves.length && d.load ? 'end' : 'load' }), { animate: true });
  toast(d.problem ? '<b>A shared problem.</b> Read it, then match it. Undo brings your own chart back.' : '<b>A shared chart.</b> Undo brings your own chart back.');
}
window.addEventListener('hashchange', openShared);

// Print: the browser's print dialog also saves a PDF.
$('#print-dlg').addEventListener('close', () => {
  const v = $('#print-dlg').returnValue;
  if (v === 'work' || v === 'blank') printSheet(v === 'work');
});
const LINE = '<span class="blank"></span>';
const minusText = v => String(v).replace('-', '−');
/** Fill the print-only sheet. work: the chart as drawn; otherwise a blank worksheet. */
function buildSheet(work) {
  const sheet = $('#print-sheet');
  const ex = state.lesson ? BY_KEY[state.lesson.key] : null;
  const g = state.load, zl = g && to_z(g);
  const title = ex ? `Lesson ${ex.n}: ${ex.title}` : work ? 'My Smith chart' : 'Smith chart worksheet';
  const data = [['Reference Z₀', `${num(state.z0, 2)} Ω`], ['Design frequency f₀', `${num(state.f0, 3)} GHz`]];
  if (ex) data.push(['Load Z<sub>L</sub>', `${minusText(ex.load[0])} ${ex.load[1] >= 0 ? '+' : '−'} j${Math.abs(ex.load[1])} Ω`]);
  else if (g) data.push(['Load Z<sub>L</sub>', isInf(zl) ? 'open circuit' : `${cplx(zl.scale(state.z0), 2)} Ω`]);
  let body = '';
  if (work && g) {
    const end = pointsOf().at(-1);
    const both = state.moves.length > 0;
    const row = r => `<tr><th>${r.label} <small>${r.hint}</small></th><td>${r.value(context(g))}</td>${both ? `<td>${r.value(context(end))}</td>` : ''}</tr>`;
    body += `<div class="pcols"><div><h3>Readings</h3><table class="preads"><tr><th></th><th>Load</th>${both ? '<th>Input</th>' : ''}</tr>${READINGS.map(row).join('')}</table></div>`;
    const moves = movesOf();
    body += `<div><h3>Matching network</h3>${moves.length ? `<div class="pladder">${ladderSVG(moves, state.z0, state.f0)}</div><ol class="pmoves">${moves.map(m => {
      const [name, value, detail] = describe(m, state.z0, state.f0);
      return `<li><b>${name}</b> ${value}<small>${detail}</small></li>`;
    }).join('')}</ol>` : '<p class="muted">No moves yet.</p>'}</div></div>`;
  } else {
    const tasks = ex ? ex.steps.map(s => `<li>${s.text}${s.kind === 'answer' ? ` ${LINE}${s.unit ? ' ' + s.unit : ''}` : ''}</li>`)
      : [`Normalize the load: z = ${LINE}`, 'Plot it on the chart.', `Read the reflection coefficient: |Γ| = ${LINE} ∠ ${LINE}°`,
        `Draw the |Γ| circle with a compass and read VSWR = ${LINE}`, `Return loss = ${LINE} dB`,
        `Reflect the point through the centre and read y = ${LINE}`, `Design a matching network and give its element values: ${LINE}`].map(t => `<li>${t}</li>`);
    body += `<div class="ptasks">${ex ? `<p>${ex.brief}</p>` : ''}<h3>${ex ? 'Steps' : 'Tasks'}</h3><ol>${tasks.join('')}</ol></div>`;
  }
  const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  sheet.innerHTML = `<header><img src="icons/icon-192.png" alt=""><div><h1>${title}</h1><p>Smith Chart Lab · ${date}</p></div>${work ? '' : `<p class="pname">Name ${LINE}</p>`}</header>
    <table class="pdata"><tr>${data.map(([k, v]) => `<th>${k}</th><td>${v}</td>`).join('')}</tr></table>
    <div class="pchart"></div>${body}
    <footer>Made with Smith Chart Lab, free at ${location.host}${location.pathname.replace(/index\.html$/, '')} · by Dr Hichem Boubakar</footer>`;
  $('.pchart', sheet).append(chart.printable(work ? 470 : 560, { work: work && !!g }));
  return sheet;
}
function printSheet(work) {
  const root = document.documentElement, theme = root.dataset.theme;
  root.dataset.theme = 'light'; // paper colours on paper
  buildSheet(work);
  document.body.classList.add('printing');
  const done = () => {
    window.removeEventListener('afterprint', done);
    document.body.classList.remove('printing');
    $('#print-sheet').replaceChildren();
    if (theme) root.dataset.theme = theme; else delete root.dataset.theme;
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 80);
}
window.smithSheet = buildSheet; // to check the sheet on screen

// Install as an app, and work offline (needs https, or localhost).
let installEvent = null;
const installItem = $('[data-menu="install"]');
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (ios && !standalone) installItem.hidden = false;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; installItem.hidden = false; });
window.addEventListener('appinstalled', () => { installEvent = null; installItem.hidden = true; toast('<b>Installed.</b> Open Smith Chart Lab from your home screen, even offline.'); });
async function installApp() {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    installItem.hidden = true;
    return;
  }
  toast('On iPhone or iPad: tap <b>Share</b>, then <b>Add to Home Screen</b>.');
}
if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
function renderOfflineState() {
  const p = $('#offline-state');
  if (!('serviceWorker' in navigator) || !isSecureContext) p.innerHTML = '<i class="ph ph-wifi-slash"></i> Offline use starts once the page is on its https site.';
  else if (navigator.serviceWorker.controller) p.innerHTML = '<i class="ph ph-check-circle"></i> Saved on this device: works offline.';
  else p.innerHTML = '<i class="ph ph-cloud-arrow-down"></i> Saving for offline use…';
}

// ---- start ------------------------------------------------------------------------------

setGrid(state.grid);
chart.setGrid(state.grid, true);
setEnd(state.opts.end);
setLoadMode(state.loadMode);
setTool(state.tool);
themeIcon();
render();
openShared();
if (firstVisit && !state.moves.length) {
  // Show a first-time visitor how the plotted load is read off the paper.
  setTimeout(() => { state.reading = 'unitz'; commit(); }, 700);
}
