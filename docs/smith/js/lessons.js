// The 7 guided exercises from the desktop lab (smith_lessons.py), with the same checks
// and tolerances. No DOM here, so every check can be tested against the Python.
import { cx, Move, apply, read, to_z, to_gamma, admittance, l_networks, single_stubs, quarter_wave, stub_length, isInf, fmtG } from './smith.js';
import { num, minus } from './format.js';

// Tolerances in reflection-coefficient units. 0.03 is about 1.5 mm on a
// 10 cm paper chart, which is a careful pencil mark.
export const NEAR = 0.03;

const deg = g => Math.atan2(g.im, g.re) * 180 / Math.PI;
const gammaOf = (R, X, z0) => to_gamma(cx(R / z0, X / z0));

/** A step. kind: answer | load | compass | ruler | reflect | mark | move | match. */
function step(text, kind, hint = '', extra = {}) {
  return { text, kind, hint, answer: null, tol: 0, relative: false, unit: '', index: 0, kinds: [], ends: '', length: null, zc: null, target: null, most: 2, reading: null, at: 'load', ...extra };
}
const answer = (text, hint, value, tol, relative = false, unit = '', extra = {}) =>
  step(text, 'answer', hint, { answer: value, tol, relative, unit, ...extra });

function build() {
  const out = [];
  let g;

  g = gammaOf(25, 50, 50);
  out.push({ key: 'plot', title: 'Plot an impedance', z0: 50, f0: 1, load: [25, 50],
    brief: 'A load Z<sub>L</sub> = 25 + j50 Ω terminates a 50 Ω line. Normalize it, plot it, and read its reflection coefficient from the chart.',
    steps: [
      answer('Normalize the resistance: r = R / Z₀.', 'Divide 25 Ω by the 50 Ω reference.', 0.5, 0.02, true),
      answer('Normalize the reactance: x = X / Z₀.', 'Divide +50 Ω by 50 Ω. Keep the sign.', 1, 0.02, true),
      step('Pick <b>Load</b> and put the load where the r = 0.5 circle meets the x = +1 arc.', 'load',
        'Follow the r = 0.5 circle (it touches the right edge). The +1 arc leaves the top of the rim. Upper half means inductive.'),
      step('Pick <b>Ruler</b> and drag from the centre through the load to the rim.', 'ruler',
        'Start on the centre dot; it snaps. Drag past the load until the line reaches the scales.'),
      answer('Read the angle of Γ where the ruler crosses the inner degree scale.',
        'The inner ring is the angle of the reflection coefficient, counter-clockwise from the right.', deg(g), 2.5, false, '°', { reading: 'polar' }),
      answer('Read |Γ| on the |Γ| scale under the chart.',
        'Set the compass from the centre to the load, then carry that radius to the |Γ| scale, starting at its 0.', g.abs(), 0.02, false, '', { reading: 'rl' }),
    ] });

  g = gammaOf(100, -50, 50);
  const r2 = read(g);
  out.push({ key: 'vswr', title: 'VSWR with the compass', z0: 50, f0: 1, load: [100, -50],
    brief: 'Z<sub>L</sub> = 100 − j50 Ω on a 50 Ω line. Every point on the line has the same |Γ|, so they all lie on one circle. Use it to read VSWR and return loss.',
    steps: [
      step('Plot the load at z = 2 − j1.', 'load', 'r = 2 is the circle crossing the axis at 2. Lower half means capacitive.'),
      step('Pick <b>Compass</b>. Put the needle on the centre and draw the circle through the load.', 'compass',
        'Press on the centre (it snaps), then drag to the load (it snaps) and let go.'),
      step('Pick <b>Mark</b> and mark where your circle crosses the right-hand real axis.', 'mark',
        'Marks snap to crossings of your circles with the axis.', { target: cx(g.abs(), 0) }),
      answer('The r value at that mark is the VSWR. Enter it.',
        'Read the resistance circle through the mark. On the real axis to the right, r = VSWR.', r2.vswr, 0.03, true, '', { reading: 'vswr' }),
      answer('Carry the compass radius to the RL scale. Enter the return loss.',
        'The RL scale under the chart converts the radius to −20 log₁₀ |Γ|.', r2.return_loss, 0.4, false, 'dB', { reading: 'rl' }),
    ] });

  g = gammaOf(50, 50, 50);
  const y3 = admittance(g);
  out.push({ key: 'admittance', title: 'Admittance by reflection', z0: 50, f0: 1, load: [50, 50],
    brief: 'On a paper impedance chart, y is the point diametrically opposite z on the same |Γ| circle. Find y for Z<sub>L</sub> = 50 + j50 Ω.',
    steps: [
      step('Plot the load at z = 1 + j1.', 'load', 'r = 1 passes through the centre. x = +1 leaves the top of the rim.'),
      step('Draw its |Γ| circle with the <b>Compass</b>.', 'compass', 'Needle on the centre, pencil on the load.'),
      step('Pick <b>Reflect</b> and tap the load. The diameter lands on y.', 'reflect',
        'Reflect draws the line through the centre and marks the opposite point.'),
      answer('Read g at the reflected point (same grid, now read as conductance).',
        'The reflected point sits on a circle you would read as r. At the reflected point that number is g.', y3.re, 0.03, false, '', { reading: 'unity' }),
      answer('Read b at the reflected point.', 'Below the axis the value is negative.', y3.im, 0.03, false, '', { reading: 'unity' }),
    ] });

  g = gammaOf(30, 20, 50);
  const after = apply(g, new Move('line', 0.15));
  const zin = to_z(after).scale(50);
  out.push({ key: 'line', title: 'Move along a line', z0: 50, f0: 1, load: [30, 20],
    brief: 'A 0.15 λ, 50 Ω line ends in Z<sub>L</sub> = 30 + j20 Ω. Moving toward the generator turns the point clockwise at constant |Γ|. Find Z<sub>in</sub>.',
    steps: [
      step('Plot the load at z = 0.6 + j0.4.', 'load', 'r = 0.6, x = +0.4.'),
      step('Draw a <b>Ruler</b> line from the centre through the load to the scales.', 'ruler', 'Start on the centre; it snaps.'),
      answer('Read the load position on the wavelengths-toward-generator scale (middle ring).',
        'The middle ring starts at 0 on the left (short) and grows clockwise.', read(g).toward_generator, 0.006, false, 'λ', { reading: 'wtg' }),
      step('Pick <b>Line</b> and turn clockwise by 0.150 λ (54°).', 'move',
        'Drag clockwise around the |Γ| circle. You can type the exact length in the Network tab, on the last move.',
        { index: 0, kinds: ['line'], length: 0.15 }),
      answer('Read Z<sub>in</sub>: the real part in ohms.', 'Read r at the new point and multiply by 50 Ω.', zin.re, 0.04, true, 'Ω', { reading: 'unitz', at: 'end' }),
      answer('Read Z<sub>in</sub>: the imaginary part in ohms.', 'Read x at the new point and multiply by 50 Ω. Mind the sign.', zin.im, 2, false, 'Ω', { reading: 'unitz', at: 'end' }),
    ] });

  out.push({ key: 'lmatch', title: 'L-network match', z0: 50, f0: 1, load: [25, -40],
    brief: 'Match Z<sub>L</sub> = 25 − j40 Ω to 50 Ω at 1 GHz with two lumped elements. The first element must land on a circle that leads to the centre.',
    steps: [
      step('Plot the load at z = 0.5 − j0.8.', 'load', 'r = 0.5, x = −0.8 (lower half).'),
      step('Add the element next to the load. A <b>Series</b> move must land on the g = 1 circle; a <b>Shunt</b> move on r = 1.', 'move',
        'Both circles are drawn bold while a move tool is active. The move snaps to them.', { index: 0, kinds: ['series', 'shunt'], ends: 'pivot' }),
      step('Add the second element so the path ends in the centre.', 'match',
        'From the g = 1 circle use a shunt element; from r = 1 use a series element.', { most: 2 }),
    ] });

  out.push({ key: 'stub', title: 'Single-stub match', z0: 50, f0: 2, load: [100, 80],
    brief: 'Match Z<sub>L</sub> = 100 + j80 Ω to 50 Ω at 2 GHz with a length of line followed by an open shunt stub.',
    steps: [
      step('Plot the load at z = 2 + j1.6.', 'load', 'r = 2, x = +1.6.'),
      step('Draw its |Γ| circle with the <b>Compass</b>.', 'compass', 'Needle on the centre, pencil on the load.'),
      step('Use <b>Line</b> to turn clockwise until you reach the g = 1 circle.', 'move',
        'Where your compass circle meets the bold g = 1 circle. The line snaps there.', { index: 0, kinds: ['line'], ends: 'g1' }),
      step('Add an open <b>Stub</b> that cancels the susceptance and reaches the centre.', 'match',
        'A stub slides along the g = 1 circle. Set the stub end to open in the box under the chart.', { most: 2 }),
    ] });

  out.push({ key: 'qwt', title: 'Quarter-wave transformer', z0: 50, f0: 2, load: [100, 0],
    brief: 'Match a 100 Ω load to 50 Ω at 2 GHz with a quarter-wave line. This is the Matching lab of the desktop app, done by hand.',
    steps: [
      step('Plot the load at z = 2.', 'load', 'On the real axis at r = 2.'),
      answer('Enter the transformer impedance Z<sub>c</sub> = √(Z₀ Z<sub>L</sub>).', '√(50 × 100).', Math.sqrt(5000), 0.01, true, 'Ω'),
      step('Pick <b>Line</b>, type your answer in the Z<sub>c</sub> box under the chart, then turn 0.25 λ.', 'move',
        'With Zc ≠ Z₀ the path is a circle that is not centred on the chart. It still closes after 0.5 λ.',
        { index: 0, kinds: ['line'], length: 0.25, zc: Math.sqrt(5000), ends: 'center' }),
    ] });

  out.forEach((ex, i) => { ex.n = i + 1; ex.gamma = gammaOf(ex.load[0], ex.load[1], ex.z0); });
  return out;
}

export const EXERCISES = build();
export const BY_KEY = Object.fromEntries(EXERCISES.map(ex => [ex.key, ex]));

/** scene: { z0, load (C or null), moves: [Move], points: [C], items } */
export function sceneOf(z0, load, moves, items) {
  const points = load ? [load] : [];
  for (const m of load ? moves : []) points.push(apply(points.at(-1), m));
  return { z0, load, moves: load ? moves : [], points, items, end: points.at(-1) ?? null };
}
const of = (scene, type) => scene.items.filter(i => i.type === type);
const P = v => cx(v[0], v[1]);

function on(g, which) {
  if (which === 'g1') return Math.abs(admittance(g).re - 1) < 0.04;
  if (which === 'r1') return Math.abs(to_z(g).re - 1) < 0.04;
  if (which === 'center') return g.abs() < NEAR;
  return true;
}

export function passed(ex, i, scene, answers) {
  const s = ex.steps[i], target = ex.gamma;
  switch (s.kind) {
    case 'answer': return !!answers?.[i]?.ok;
    case 'load': return !!scene.load && scene.load.sub(target).abs() < NEAR;
    case 'compass': return of(scene, 'compass').some(c => P(c.c).abs() < NEAR && Math.abs(c.r - target.abs()) < NEAR);
    case 'ruler':
      for (const r of of(scene, 'ruler')) {
        for (const [start, tip] of [[P(r.a), P(r.b)], [P(r.b), P(r.a)]]) {
          if (start.abs() < NEAR * 1.3 && tip.abs() >= target.abs() - NEAR) {
            const d = Math.atan2(tip.im, tip.re) - Math.atan2(target.im, target.re) + Math.PI;
            const turn = Math.abs(((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
            if (turn * 180 / Math.PI < 3) return true;
          }
        }
      }
      return false;
    case 'reflect': return of(scene, 'reflect').some(r => P(r.g).sub(target).abs() < NEAR);
    case 'mark': return of(scene, 'mark').some(m => P(m.g).sub(s.target).abs() < NEAR);
    case 'move': {
      if (scene.moves.length <= s.index) return false;
      const m = scene.moves[s.index], land = scene.points[s.index + 1];
      if (!s.kinds.includes(m.kind)) return false;
      if (s.length !== null && Math.abs(m.value - s.length) > 0.004) return false;
      if (s.zc !== null && Math.abs(m.zc * scene.z0 / s.zc - 1) > 0.02) return false;
      const ends = s.ends === 'pivot' ? (m.kind === 'series' ? 'g1' : 'r1') : s.ends;
      return on(land, ends);
    }
    case 'match': return !!scene.end && scene.end.abs() < NEAR && scene.moves.length > 0 && scene.moves.length <= s.most;
  }
  throw new Error(s.kind);
}

export const progress = (ex, scene, answers) => ex.steps.map((_, i) => passed(ex, i, scene, answers));

/** Compare a typed reading with the expected value. */
export function checkAnswer(s, text) {
  const found = String(text).replace(/−/g, '-').match(/[-+]?\d*[.,]?\d+(?:[eE][-+]?\d+)?/);
  if (!found) return { value: null, ok: false, message: 'Type a number.' };
  const value = parseFloat(found[0].replace(',', '.'));
  const error = Math.abs(value - s.answer);
  const allowed = s.relative ? s.tol * Math.abs(s.answer) : s.tol;
  if (error <= allowed) return { value, ok: true, message: 'Correct.' };
  const miss = s.relative && s.answer
    ? `off by ${Math.round(100 * error / Math.abs(s.answer))} %`
    : `off by ${fmtG(error, 3)}${s.unit && !'°λ'.includes(s.unit) ? ' ' + s.unit : s.unit}`;
  return { value, ok: false, message: `Not yet: ${miss}. Read again.` };
}

const zText = z => minus(`${+z.re.toFixed(2)} ${z.im >= 0 ? '+' : '-'} j${+Math.abs(z.im).toFixed(2)}`);

/** A specific hint for a common mistake on the current step, or null. */
export function diagnose(ex, i, scene) {
  const s = ex.steps[i];
  if (s.kind === 'load' && scene.load) {
    const z = to_z(scene.load);
    if (!isInf(z)) return `Your point reads z = ${zText(z)}. You want ${zText(to_z(ex.gamma))}.`;
  }
  if (s.kind === 'move' && scene.moves.length > s.index) {
    const m = scene.moves[s.index], land = scene.points[s.index + 1];
    if (!s.kinds.includes(m.kind)) return `This step needs a ${s.kinds.join(' or ')} move. Undo it and pick that tool.`;
    if (s.length !== null && Math.abs(m.value - s.length) > 0.004)
      return `Your line is ${num(m.value, 3)} λ. Make it ${num(s.length, 3)} λ: type it on the last move in the Network tab.`;
    if (s.zc !== null && Math.abs(m.zc * scene.z0 / s.zc - 1) > 0.02)
      return `This line has Zc = ${num(m.zc * scene.z0, 1)} Ω. Undo it, set Zc first, then draw it again.`;
    if (s.ends === 'g1' || (s.ends === 'pivot' && m.kind === 'series'))
      return `Your move ends at g = ${num(admittance(land).re, 2)}. Stop on the g = 1 circle; the end snaps to it.`;
    if (s.ends === 'pivot') return `Your move ends at r = ${num(to_z(land).re, 2)}. Stop on the r = 1 circle; the end snaps to it.`;
    if (s.ends === 'center') return `Your line ends at |Γ| = ${num(land.abs(), 3)}. Check Zc and the length.`;
  }
  // Only once the student has added an element of their own for this step.
  const before = ex.steps.slice(0, i).filter(x => x.kind === 'move').length;
  if (s.kind === 'match' && scene.end && scene.moves.length > before) {
    if (scene.moves.length > s.most) return `Use at most ${s.most} elements. Remove the extra moves with Undo or Remove last.`;
    return `The path ends at |Γ| = ${num(scene.end.abs(), 3)}. Aim for the centre dot; it snaps.`;
  }
  return null;
}

/** Items and moves that solve an exercise (the desktop app's ghost solution). */
export function solution(ex) {
  const g = ex.gamma;
  const rim = g.abs() > 1e-9 ? g.scale(1 / g.abs()) : cx(1);
  const ruler = { type: 'ruler', a: [0, 0], b: [rim.re, rim.im] };
  const compass = { type: 'compass', c: [0, 0], r: g.abs() };
  let items = [], moves = [];
  switch (ex.key) {
    case 'plot': items = [ruler]; break;
    case 'vswr': items = [compass, { type: 'mark', g: [g.abs(), 0], label: 'S' }]; break;
    case 'admittance': items = [compass, { type: 'reflect', g: [g.re, g.im] }]; break;
    case 'line': items = [ruler]; moves = [new Move('line', 0.15)]; break;
    case 'lmatch': moves = l_networks(g)[0][1]; break;
    case 'stub': items = [compass]; moves = single_stubs(g, 'open')[0][1]; break;
    case 'qwt': moves = quarter_wave(g); break;
  }
  return { items, moves };
}

/** The one move that finishes a match from a point on g = 1 or r = 1, if any. */
function finisher(end, stub, z0, zcOhms) {
  if (on(end, 'g1')) {
    const b = -admittance(end).im;
    return stub ? new Move('stub', stub_length(b, zcOhms / z0, 'open'), zcOhms / z0, 'open') : new Move('shunt', b);
  }
  if (!stub && on(end, 'r1')) return new Move('series', -to_z(end).im);
  return null;
}

/**
 * What "Show me" draws for a step, in the solver's demo format:
 * { start, moves, upto, animate, guide, extraGuide, notes, lines, circles }, or a reading
 * construction { reading, at } for steps that ask for a value.
 */
export function watch(ex, i, scene, zcOhms) {
  const s = ex.steps[i], g = ex.gamma;
  const base = { start: g, moves: [], upto: 0, animate: -1, guide: null, notes: [], lines: [], circles: [] };
  const rim = g.scale(1 / Math.max(1e-9, g.abs()));
  switch (s.kind) {
    case 'answer':
      if (!s.reading || !scene.load) return null;
      return { reading: s.reading, at: s.at };
    case 'load': return { ...base, notes: [[g, `z = ${zText(to_z(g))}`]] };
    case 'ruler': return { ...base, lines: [[cx(0), rim.scale(1.08)]], notes: [[g, '']] };
    case 'compass': return { ...base, circles: [[cx(0), g.abs()]], notes: [[cx(0), ''], [g, '']] };
    case 'mark': return { ...base, circles: [[cx(0), g.abs()]], notes: [[s.target, 'S']] };
    case 'reflect': return { ...base, lines: [[g, g.neg()]], notes: [[g.neg(), 'y']] };
    case 'move': {
      const { moves } = solution(ex);
      const guide = s.ends === 'pivot' ? (moves[0].kind === 'series' ? 'g1' : 'r1') : s.ends === 'center' ? null : s.ends || null;
      return { ...base, moves, upto: s.index, animate: s.index, guide, extraGuide: s.kinds.includes('line') ? 'vswr' : null,
        notes: s.ends === 'center' ? [[cx(0), 'matched']] : [] };
    }
    case 'match': {
      const stub = ex.key === 'stub';
      const last = scene.end && scene.moves.length ? finisher(scene.end, stub, scene.z0, zcOhms) : null;
      if (last) return { ...base, start: scene.end, moves: [last], animate: 0, notes: [[cx(0), 'matched']] };
      const { moves } = solution(ex);
      return { ...base, moves, upto: moves.length - 1, animate: moves.length - 1, notes: [[cx(0), 'matched']] };
    }
  }
  return null;
}

/** The tool a step is done with, to offer a one-tap "Use" button. */
export function toolFor(s) {
  if (['load', 'compass', 'ruler', 'mark', 'reflect'].includes(s.kind)) return s.kind;
  if (s.kind === 'move') return s.kinds.length === 1 ? s.kinds[0] : null;
  if (s.kind === 'match') return null;
  return null;
}
