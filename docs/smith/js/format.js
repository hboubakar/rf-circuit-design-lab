// Number formatting shared by the chart and the readings, matching the desktop app.
import { fmtG, isInf } from './smith.js';

const MINUS = '−';
export const minus = s => s.replace(/-/g, MINUS);

export function num(value, places = 3) {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return '∞';
  const v = Math.abs(value) < 0.5 * 10 ** -places ? 0 : value;
  return minus(v.toFixed(places));
}

/** a + jb with a typographic minus, or ∞. */
export function cplx(z, places = 3) {
  if (isInf(z)) return '∞';
  const tiny = 0.5 * 10 ** -places;
  const re = Math.abs(z.re) < tiny ? 0 : z.re;
  const im = Math.abs(z.im) < tiny ? 0 : z.im;
  const f = v => (Math.abs(v) >= 1e4 ? fmtG(v, 3) : v.toFixed(places));
  return minus(`${f(re)} ${im >= 0 ? '+' : '-'} j${f(Math.abs(im))}`);
}

/** Short label for a grid value: 0.5, 2, 10. */
export const short = v => minus(String(+v.toFixed(3)));

/** Parse a field: accepts −, commas as decimal points, ∞ and "inf". */
export function parse(text) {
  const t = String(text).trim().replace(/−/g, '-').replace(',', '.').toLowerCase();
  if (/^[+-]?(∞|inf|infinity)$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
  if (t === '' || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(t)) return NaN;
  return Number(t);
}
