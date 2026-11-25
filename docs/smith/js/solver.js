// Exact matches from the end of the network, and the steps that teach each one
// on the chart: what to aim for, which circle to follow, and why it works.
import { cx, Move, apply, read, to_z, admittance, l_networks, single_stubs, quarter_wave, describe, mod } from './smith.js';
import { num, cplx } from './format.js';

const NEAR = 0.03;

/** Every exact match we teach, starting from Γ = start. opts: { zc (normalized), end }. */
export function solutions(start, opts) {
  if (!start || start.abs() >= 1 - 1e-9) return [];
  if (start.abs() < NEAR) return [];
  const out = [];
  l_networks(start).forEach(([name, moves], i) => {
    out.push({ family: 'lnet', id: `lnet-${i}`, order: name, moves, guide: name.startsWith('Series') ? 'g1' : 'r1' });
  });
  single_stubs(start, opts.end, opts.zc).forEach(([, moves], i) => {
    out.push({ family: 'stub', id: `stub-${i}`, moves, guide: 'g1' });
  });
  const direct = quarter_wave(start);
  if (direct) out.push({ family: 'qwt', id: 'qwt-0', moves: direct, guide: 'axis' });
  else {
    // A line to the real axis first (at the voltage maximum or minimum), then a λ/4 transformer.
    const phase = Math.atan2(start.im, start.re);
    for (const [target, where] of [[0, 'max'], [Math.PI, 'min']]) {
      const length = mod((phase - target) / (4 * Math.PI), 0.5);
      const landing = apply(start, new Move('line', length));
      const r = to_z(landing).re;
      out.push({ family: 'qwt', id: `qwt-${where}`, where, moves: [new Move('line', length), new Move('line', 0.25, Math.sqrt(r))], guide: 'axis' });
    }
  }
  return out;
}

const turn = v => (v >= 0 ? 'clockwise' : 'anticlockwise');

/** A short title, e.g. "Series L, then shunt C". */
export function title(sol, z0, f0) {
  const names = sol.moves.map(m => {
    const [name] = describe(m, z0, f0);
    if (sol.family === 'qwt' && m.kind === 'line' && Math.abs(m.zc - 1) > 1e-9) return 'λ/4 transformer';
    return name;
  });
  return names.map((n, i) => (i ? n.charAt(0).toLowerCase() + n.slice(1) : n)).join(', then ');
}

/** One-line values, e.g. "10.3 nH · 3.18 pF". */
export function summary(sol, z0, f0) {
  return sol.moves.map(m => {
    const [, value, detail] = describe(m, z0, f0);
    if (m.kind === 'line' && Math.abs(m.zc - 1) > 1e-9) return `${value.split('  ')[0]}, ${detail}`;
    return value.split('  ')[0];
  }).join(' · ');
}

/**
 * The lesson for one solution. Each step: { title, text, upto, animate, guide, notes }.
 * upto: how many moves are already drawn; animate: index of the move drawn now (or -1).
 */
export function lesson(sol, start, z0, f0) {
  const steps = [];
  const pts = [start];
  for (const m of sol.moves) pts.push(apply(pts.at(-1), m));
  const z = to_z(start), r0 = read(start);
  const zText = cplx(z, 2), ohms = cplx(z.scale(z0), 1);

  steps.push({
    title: 'Start at the load',
    text: `The point to match is z = ${zText} (Z = ${ohms} Ω). The goal is the centre of the chart, where z = 1 and Γ = 0.`,
    upto: 0, animate: -1, guide: sol.family === 'lnet' ? null : 'vswr',
    notes: [[start, `z = ${zText}`]],
  });

  if (sol.family === 'lnet') {
    const seriesFirst = sol.order.startsWith('Series');
    const [m1, m2] = sol.moves;
    const p1 = pts[1];
    steps.push({
      title: seriesFirst ? 'Aim for the g = 1 circle' : 'Aim for the r = 1 circle',
      text: seriesFirst
        ? 'The last element will be a shunt one. A shunt element only moves a point along its conductance circle, and the only conductance circle through the centre is <b class="t-yg">g = 1</b>. So the first, series element must land on g = 1.'
        : 'The last element will be a series one. A series element only moves a point along its resistance circle, and the only resistance circle through the centre is <b class="t-zr">r = 1</b>. So the first, shunt element must land on r = 1.',
      upto: 0, animate: -1, guide: seriesFirst ? 'g1' : 'r1', notes: [],
    });
    steps.push(moveStep(m1, start, p1, z0, f0, 1,
      seriesFirst ? `until it meets g = 1, where y = ${cplx(admittance(p1), 2)}` : `until it meets r = 1, where z = ${cplx(to_z(p1), 2)}`,
      seriesFirst ? 'g1' : 'r1'));
    steps.push(moveStep(m2, p1, pts[2], z0, f0, 2, 'to reach the centre', null));
  } else if (sol.family === 'stub') {
    const [line, stub] = sol.moves;
    const p1 = pts[1];
    steps.push({
      title: 'Aim for the g = 1 circle',
      text: `A stub is a shunt element, so it can only reach the centre from the <b class="t-yg">g = 1</b> circle. A line keeps |Γ| = ${num(r0.magnitude, 3)}, so turn along this constant-|Γ| circle until it crosses g = 1.`,
      upto: 0, animate: -1, guide: 'g1', extraGuide: 'vswr', notes: [],
    });
    steps.push(moveStep(line, start, p1, z0, f0, 1, `until it crosses g = 1, where y = ${cplx(admittance(p1), 2)}`, 'g1'));
    steps.push(moveStep(stub, p1, pts[2], z0, f0, 2, 'to reach the centre', null));
  } else {
    const transformer = sol.moves.at(-1);
    const pReal = sol.moves.length > 1 ? pts[1] : start;
    const r = to_z(pReal).re;
    if (sol.moves.length > 1) {
      steps.push({
        title: 'Aim for the real axis',
        text: `A quarter-wave transformer only matches a <b>real</b> impedance. A line keeps |Γ|, so turn clockwise along the circle until it reaches the horizontal axis: on the right at the voltage maximum (r = VSWR), or on the left at the voltage minimum (r = 1/VSWR). This one goes to the ${sol.where === 'max' ? 'maximum' : 'minimum'}.`,
        upto: 0, animate: -1, guide: 'axis', extraGuide: 'vswr', notes: [],
      });
      steps.push(moveStep(sol.moves[0], start, pReal, z0, f0, 1, `to the real axis, where z = ${num(r, 3)}`, 'axis'));
    } else {
      steps.push({
        title: 'The load is already real',
        text: `z = ${num(r, 3)} sits on the horizontal axis, so a quarter-wave transformer can match it directly.`,
        upto: 0, animate: -1, guide: 'axis', notes: [],
      });
    }
    const zcOhm = transformer.zc * z0;
    steps.push({
      title: `Step ${sol.moves.length}: a λ/4 transformer`,
      text: `A quarter-wave line turns R into Zc² / R. Pick Zc = √(R · Z₀) = √(${num(r * z0, 2)} × ${num(z0, 0)}) = <b>${num(zcOhm, 2)} Ω</b>, and the input becomes Zc² / R = Z₀: the centre. On a chart normalized to Zc the point turns half a circle.`,
      upto: sol.moves.length - 1, animate: sol.moves.length - 1, guide: null, notes: [[cx(0), 'matched']],
      formula: 'Zin = Zc² / R  ⇒  Zc = √(R · Z₀)',
    });
  }

  const parts = sol.moves.map((m, i) => {
    const [name, value] = describe(m, z0, f0);
    return `${i + 1}. ${name} ${value.split('  ')[0]}`;
  });
  steps.push({
    title: 'Matched',
    text: `The network, read from the load: ${parts.join(', ')}. The input sits on the centre, so the source sees Z₀ and nothing is reflected at f₀.`,
    upto: sol.moves.length, animate: -1, guide: null, notes: [[cx(0), 'Γ = 0']], done: true,
  });
  return steps;
}

function moveStep(m, from, to, z0, f0, n, where, guide) {
  const [name, value, detail] = describe(m, z0, f0);
  const zFrom = to_z(from), yFrom = admittance(from);
  let text, formula;
  if (m.kind === 'series') {
    text = `Stay on the <b class="t-zr">r = ${num(zFrom.re, 2)}</b> circle and slide ${turn(m.value)} ${where}. The reactance changes by Δx = ${num(m.value, 3)}, ${m.value >= 0 ? 'an inductor' : 'a capacitor'}: <b>${name.replace('Series ', '')} = ${value}</b>.`;
    formula = m.value >= 0 ? `L = Δx · Z₀ / ω = ${num(m.value, 3)} × ${num(z0, 0)} Ω / (2π · ${num(f0, 3)} GHz) = ${value}`
      : `C = 1 / (ω · |Δx| · Z₀) = 1 / (2π · ${num(f0, 3)} GHz × ${num(-m.value, 3)} × ${num(z0, 0)} Ω) = ${value}`;
  } else if (m.kind === 'shunt') {
    text = `Stay on the <b class="t-yg">g = ${num(yFrom.re, 2)}</b> circle and slide ${turn(m.value)} ${where}. The susceptance changes by Δb = ${num(m.value, 3)}, ${m.value >= 0 ? 'a capacitor' : 'an inductor'}: <b>${name.replace('Shunt ', '')} = ${value}</b>.`;
    formula = m.value >= 0 ? `C = Δb / (ω · Z₀) = ${num(m.value, 3)} / (2π · ${num(f0, 3)} GHz × ${num(z0, 0)} Ω) = ${value}`
      : `L = Z₀ / (ω · |Δb|) = ${num(z0, 0)} Ω / (2π · ${num(f0, 3)} GHz × ${num(-m.value, 3)}) = ${value}`;
  } else if (m.kind === 'line') {
    const a = read(from).toward_generator, b = read(to).toward_generator;
    text = `Turn clockwise around the centre at constant |Γ| ${where}. On the λ-toward-generator ring that is from ${num(a, 3)} λ to ${num(b, 3)} λ: a line of <b>${num(m.value, 4)} λ</b> (${num(360 * m.value, 1)}°).`;
    formula = 'd = (end − start) on the λ → generator ring, mod 0.5 λ';
  } else {
    const need = admittance(to).im - yFrom.im;
    text = `Stay on the <b class="t-yg">g = ${num(yFrom.re, 2)}</b> circle and add Δb = ${num(need, 3)} ${where}. ${m.end === 'open' ? 'An open' : 'A short'} stub of ${detail} gives that susceptance with a length of <b>${num(m.value, 4)} λ</b>.`;
    formula = m.end === 'open' ? 'b = tan(2π d/λ) · Z₀ / Zc' : 'b = −cot(2π d/λ) · Z₀ / Zc';
  }
  return { title: `Step ${n}: ${name}`, text, formula, upto: n - 1, animate: n - 1, guide, notes: [[to, n === 2 || to.abs() < NEAR ? '' : String.fromCharCode(64 + n)]] };
}
