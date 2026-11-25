// Smith chart maths for a positive, real reference impedance.
// A line-by-line port of smith.py from the desktop app. tests/web/smith.html
// checks it against values written by tools/smith_web_vectors.py.

export const TOL = 1e-12;

// ---- complex numbers -------------------------------------------------------
export class C {
  constructor(re = 0, im = 0) { this.re = re; this.im = im; }
  static of(v) { return v instanceof C ? v : typeof v === 'number' ? new C(v, 0) : new C(v[0], v[1]); }
  add(b) { b = C.of(b); return new C(this.re + b.re, this.im + b.im); }
  sub(b) { b = C.of(b); return new C(this.re - b.re, this.im - b.im); }
  mul(b) { b = C.of(b); return new C(this.re * b.re - this.im * b.im, this.re * b.im + this.im * b.re); }
  div(b) {
    b = C.of(b);
    const d = b.re * b.re + b.im * b.im;
    return new C((this.re * b.re + this.im * b.im) / d, (this.im * b.re - this.re * b.im) / d);
  }
  scale(k) { return new C(this.re * k, this.im * k); }
  neg() { return new C(-this.re, -this.im); }
  abs() { return isInf(this) ? Infinity : Math.hypot(this.re, this.im); }
  phase() { return Math.atan2(this.im, this.re); }
  toString() { return `${this.re}${this.im < 0 ? '-' : '+'}${Math.abs(this.im)}j`; }
}
export const cx = (re, im = 0) => new C(re, im);
export const expj = t => new C(Math.cos(t), Math.sin(t));
export const isInf = z => !Number.isFinite(z.re) && !Number.isNaN(z.re) || !Number.isFinite(z.im) && !Number.isNaN(z.im);
export const INF = new C(Infinity, 0);
const ONE = cx(1), MINUS_ONE = cx(-1);

// Python's float % (result takes the divisor's sign) and math.remainder.
export function mod(a, b) {
  let r = a % b;
  if (r !== 0 && (r < 0) !== (b < 0)) r += b;
  return r;
}
const remainder = (x, y) => x - Math.round(x / y) * y;

// ---- readings --------------------------------------------------------------
export function read(gamma) {
  const g = C.of(gamma);
  const mag = g.abs();
  const angle = mag > TOL ? Math.atan2(g.im, g.re) * 180 / Math.PI : null;
  const z = ONE.sub(g).abs() < TOL ? INF : ONE.add(g).div(ONE.sub(g));
  const y = ONE.add(g).abs() < TOL ? INF : ONE.sub(g).div(ONE.add(g));
  const reflected = mag ** 2;
  let gen = null, load = null;
  if (angle !== null) {
    gen = mod((180 - angle) / 720, 0.5);
    load = mod((angle - 180) / 720, 0.5);
  }
  return {
    gamma: g, magnitude: mag, angle, z, y,
    vswr: mag >= 1 - TOL ? Infinity : (1 + mag) / (1 - mag),
    return_loss: mag <= TOL ? Infinity : -20 * Math.log10(mag),
    mismatch_loss: reflected >= 1 - TOL ? Infinity : -10 * Math.log10(1 - reflected),
    reflected_power: reflected,
    toward_generator: gen, toward_load: load,
  };
}

export function rotate(gamma, wavelengths) {
  return C.of(gamma).mul(expj(-4 * Math.PI * wavelengths));
}

export function delta_generator(anchor, point) {
  anchor = C.of(anchor); point = C.of(point);
  if (anchor.abs() <= TOL || point.abs() <= TOL) return null;
  const shift = remainder(point.phase() - anchor.phase(), 2 * Math.PI);
  return mod(-shift / (4 * Math.PI), 0.5);
}

/** Map an impedance in ohms to the passive Smith disk. Throws on bad input. */
export function from_impedance(value, reference) {
  const v = C.of(value);
  if (!(reference > 0) || v.re < 0 || ![reference, v.re, v.im].every(Number.isFinite))
    throw new RangeError('Enter a finite impedance with nonnegative resistance and a positive reference.');
  return v.sub(reference).div(v.add(reference));
}

// ---- network moves, normalized to the chart reference -----------------------
export const MOVE_KINDS = ['series', 'shunt', 'line', 'stub'];

export function to_z(gamma) {
  const g = C.of(gamma);
  return ONE.sub(g).abs() < TOL ? INF : ONE.add(g).div(ONE.sub(g));
}
export function to_gamma(z) {
  z = C.of(z);
  if (isInf(z)) return cx(1);
  return z.sub(1).div(z.add(1));
}
/** Normalized admittance: the impedance of the reflected point −Γ. */
export const admittance = gamma => to_z(C.of(gamma).neg());
export function from_admittance(y) {
  y = C.of(y);
  return isInf(y) ? cx(-1) : to_gamma(y).neg();
}

/** One element added on the generator side of the present point. */
export class Move {
  constructor(kind, value, zc = 1, end = 'open') { this.kind = kind; this.value = value; this.zc = zc; this.end = end; }
  static fromDict(d, z0) { return new Move(d.kind, +d.value, +(d.zc ?? z0) / z0, d.end ?? 'open'); }
  toDict(z0) { return { kind: this.kind, value: this.value, zc: this.zc * z0, end: this.end }; }
}

export function stub_susceptance(length, zc = 1, end = 'open', k = 1) {
  const t = Math.tan(2 * Math.PI * length * k);
  if (end === 'open') return t / zc;
  return Math.abs(t) < 1e-12 ? null : -1 / (zc * t);
}

export function stub_length(susceptance, zc = 1, end = 'open') {
  let theta;
  if (end === 'open') theta = Math.atan(susceptance * zc);
  else theta = Math.abs(susceptance) < 1e-15 ? Math.PI / 2 : Math.atan(-1 / (susceptance * zc));
  return mod(theta, Math.PI) / (2 * Math.PI);
}

/** Reactance or susceptance of the same L or C at k times the design frequency. */
export const scaled = (value, k) => value >= 0 ? value * k : value / k;

export function apply(gamma, move, k = 1, t = 1) {
  const g = C.of(gamma);
  const v = move.value * t;
  if (move.kind === 'series') {
    const z = to_z(g);
    return isInf(z) ? cx(1) : to_gamma(z.add(cx(0, scaled(v, k))));
  }
  if (move.kind === 'shunt') {
    const y = admittance(g);
    return isInf(y) ? cx(-1) : from_admittance(y.add(cx(0, scaled(v, k))));
  }
  if (move.kind === 'line') {
    const theta = 2 * Math.PI * v * k;
    if (Math.abs(move.zc - 1) < 1e-12) return g.mul(expj(-2 * theta));
    const z = to_z(g);
    let local = isInf(z) ? cx(1) : z.sub(move.zc).div(z.add(move.zc));
    local = local.mul(expj(-2 * theta));
    return to_gamma(ONE.sub(local).abs() < TOL ? INF : ONE.add(local).div(ONE.sub(local)).scale(move.zc));
  }
  if (move.kind === 'stub') {
    const b = stub_susceptance(v, move.zc, move.end, k);
    const y = admittance(g);
    if (b === null || isInf(y)) return cx(-1);
    return from_admittance(y.add(cx(0, b)));
  }
  throw new Error(`Unknown move ${move.kind}`);
}

/** The move as the student draws it: a stub slides along its constant-g circle. */
export function drawn(move, k = 1) {
  if (move.kind !== 'stub') return move;
  const b = stub_susceptance(move.value, move.zc, move.end, k);
  return new Move('shunt', b === null ? 0 : b);
}

export function path(gamma, move, samples = 96) {
  const shown = drawn(move);
  return Array.from({ length: samples }, (_, i) => apply(gamma, shown, 1, i / (samples - 1)));
}

export function circle_through(a, b, c) {
  a = C.of(a); b = C.of(b); c = C.of(c);
  const d = 2 * (a.re * (b.im - c.im) + b.re * (c.im - a.im) + c.re * (a.im - b.im));
  if (Math.abs(d) < 1e-12) return null;
  const sa = a.re ** 2 + a.im ** 2, sb = b.re ** 2 + b.im ** 2, sc = c.re ** 2 + c.im ** 2;
  const centre = cx((sa * (b.im - c.im) + sb * (c.im - a.im) + sc * (a.im - b.im)) / d,
                    (sa * (c.re - b.re) + sb * (a.re - c.re) + sc * (b.re - a.re)) / d);
  return [centre, a.sub(centre).abs()];
}

/** Centre and radius of the circle a move of this kind travels along. */
export function move_circle(gamma, kind, zc = 1) {
  const g = C.of(gamma);
  if (kind === 'series') {
    const r = to_z(g).re;
    return Number.isFinite(r) ? [cx(r / (1 + r)), 1 / (1 + r)] : null;
  }
  if (kind === 'shunt' || kind === 'stub') {
    const gc = admittance(g).re;
    return Number.isFinite(gc) ? [cx(-gc / (1 + gc)), 1 / (1 + gc)] : null;
  }
  if (Math.abs(zc - 1) < 1e-12) return g.abs() > 1e-9 ? [cx(0), g.abs()] : null;
  const pts = [0, 1 / 6, 1 / 3].map(l => apply(g, new Move('line', l, zc)));
  return circle_through(...pts);
}

export function circle_hits(c1, r1, c2, r2) {
  c1 = C.of(c1); c2 = C.of(c2);
  const d = c2.sub(c1).abs();
  if (d < 1e-12 || d > r1 + r2 + 1e-12 || d < Math.abs(r1 - r2) - 1e-12) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - a * a, 0));
  const unit = c2.sub(c1).scale(1 / d);
  const base = c1.add(unit.scale(a));
  const off = cx(0, h).mul(unit);
  return h > 1e-9 ? [base.add(off), base.sub(off)] : [base];
}

export function axis_hits(c, r) {
  c = C.of(c);
  const h2 = r * r - c.im ** 2;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  return h > 1e-9 ? [cx(c.re - h), cx(c.re + h)] : [cx(c.re)];
}

// The two circles every two-element match passes through.
export const R1 = [cx(0.5), 0.5];
export const G1 = [cx(-0.5), 0.5];

const sign = (x, s) => (s < 0 || Object.is(s, -0) ? -Math.abs(x) : Math.abs(x));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Value of the move that ends closest to a point the student points at. */
export function project(gamma, kind, target, zc = 1, end = 'open') {
  const g = C.of(gamma), d = C.of(target);
  if (kind === 'line') {
    if (Math.abs(zc - 1) < 1e-12) {
      if (g.abs() < 1e-9 || d.abs() < 1e-9) return 0;
      return mod(g.phase() - d.phase(), 2 * Math.PI) / (4 * Math.PI);
    }
    let best = 0, bestErr = Infinity;
    for (let i = 0; i < 720; i++) {
      const length = i / 1440;
      const err = apply(g, new Move('line', length, zc)).sub(d).abs();
      if (err < bestErr) { bestErr = err; best = length; }
    }
    return best;
  }
  const circle = move_circle(g, kind);
  if (circle === null) return 0;
  const [centre, radius] = circle;
  const offset = d.sub(centre);
  const landing = centre.add((offset.abs() > 1e-12 ? offset.scale(1 / offset.abs()) : cx(1)).scale(radius));
  if (kind === 'series') {
    const start = to_z(g), endZ = to_z(landing);
    const reach = !isInf(endZ) ? endZ.im : sign(1e3, landing.im || 1);
    return clamp(reach, -1e3, 1e3) - start.im;
  }
  const start = admittance(g), endY = admittance(landing);
  const reach = !isInf(endY) ? endY.im : sign(1e3, -landing.im || 1);
  const change = clamp(reach, -1e3, 1e3) - start.im;
  return kind === 'shunt' ? change : stub_length(change, zc, end);
}

// Python's format(value, '.Ng').
export function fmtG(value, digits) {
  if (value === 0) return '0';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  const exp = Math.floor(Math.log10(Math.abs(Number(value.toPrecision(digits)))));
  if (exp < -4 || exp >= digits) {
    let [m, e] = value.toExponential(digits - 1).split('e');
    if (m.includes('.')) m = m.replace(/0+$/, '').replace(/\.$/, '');
    const n = Number(e);
    return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
  }
  let s = value.toFixed(Math.max(0, digits - 1 - exp));
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s;
}
const title = s => s[0].toUpperCase() + s.slice(1).toLowerCase();

/** Element name, value with units, and the normalized step it makes. f is in GHz. */
export function describe(move, z0, f) {
  const w = 2 * Math.PI * f * 1e9;
  if (move.kind === 'series') {
    const x = move.value * z0;
    if (Math.abs(x) < 1e-12) return ['Series element', '0', 'Δx = 0'];
    if (x > 0) return ['Series L', `${fmtG(x / w * 1e9, 3)} nH`, `Δx = +${move.value.toFixed(3)}`];
    return ['Series C', `${fmtG(-1 / (w * x) * 1e12, 3)} pF`, `Δx = −${(-move.value).toFixed(3)}`];
  }
  if (move.kind === 'shunt') {
    const b = move.value / z0;
    if (Math.abs(b) < 1e-15) return ['Shunt element', '0', 'Δb = 0'];
    if (b > 0) return ['Shunt C', `${fmtG(b / w * 1e12, 3)} pF`, `Δb = +${move.value.toFixed(3)}`];
    return ['Shunt L', `${fmtG(-1 / (w * b) * 1e9, 3)} nH`, `Δb = −${(-move.value).toFixed(3)}`];
  }
  const detail = `Zc = ${fmtG(move.zc * z0, 4)} Ω`;
  const len = `${move.value.toFixed(4)} λ  (${(360 * move.value).toFixed(1)}°)`;
  if (move.kind === 'line') return ['Line', len, detail];
  return [`${title(move.end)} stub`, len, detail];
}

/** Two-element L-network matches to the chart centre, listed load side first. */
export function l_networks(gamma) {
  const z = to_z(gamma);
  const found = [];
  if (isInf(z) || z.re <= 1e-9) return found;
  const { re: r, im: x } = z;
  if (r <= 1) for (const s of [1, -1]) {
    const pivot = s * Math.sqrt(r * (1 - r));
    found.push(['Series, then shunt', [new Move('series', pivot - x), new Move('shunt', pivot / r)]]);
  }
  const y = ONE.div(z);
  const { re: g, im: b } = y;
  if (g <= 1) for (const s of [1, -1]) {
    const pivot = s * Math.sqrt(g * (1 - g));
    found.push(['Shunt, then series', [new Move('shunt', pivot - b), new Move('series', pivot / g)]]);
  }
  const keyOf = (name, moves) => moves.map(m => Math.round(m.value * 1e9) / 1e9).join('|') + '|' + name;
  const unique = [], seen = new Set();
  for (const [name, moves] of found) {
    const key = keyOf(name, moves);
    if (!seen.has(key)) { seen.add(key); unique.push([name, moves]); }
  }
  return unique;
}

/** Line-then-stub matches. The line has the chart impedance and the stub impedance zc. */
export function single_stubs(gamma, end = 'open', zc = 1) {
  const g = C.of(gamma);
  const rho = g.abs();
  if (rho >= 1 - 1e-9) return [];
  const found = [];
  for (const phase of [Math.acos(-rho), -Math.acos(-rho)]) {
    const length = rho > 1e-9 ? mod((g.phase() - phase) / (4 * Math.PI), 0.5) : 0;
    const landing = expj(phase).scale(rho);
    const b = admittance(landing).im;
    found.push([`Line, then ${end} stub`, [new Move('line', length), new Move('stub', stub_length(-b, zc, end), zc, end)]]);
  }
  return found;
}

/** Quarter-wave transformer for a real load, or null. */
export function quarter_wave(gamma) {
  const z = to_z(gamma);
  if (isInf(z) || Math.abs(z.im) > 1e-6 || z.re <= 0) return null;
  return [new Move('line', 0.25, Math.sqrt(z.re))];
}

/** Load reflection at k times the design frequency. */
export function load_at(gamma, k, model) {
  if (model === 'fixed' || Math.abs(k - 1) < 1e-15) return C.of(gamma);
  const z = to_z(gamma);
  if (isInf(z)) return C.of(gamma);
  return to_gamma(cx(z.re, scaled(z.im, k)));
}

export function network_sweep(gamma, moves, ks, model = 'series') {
  return ks.map(k => {
    let g = load_at(gamma, k, model);
    for (const m of moves) g = apply(g, m, k);
    return g;
  });
}
