// Share links: the chart travels inside the link (#c=…), so nothing is stored on a server.
const KINDS = ['series', 'shunt', 'line', 'stub'];

const round = v => (typeof v === 'number' ? +v.toPrecision(7) : Array.isArray(v) ? v.map(round)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(code) {
  const bin = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

/** kind: 'all' (the whole chart) or 'problem' (Z₀, f₀ and the load only). */
export function encode(state, kind) {
  const data = { v: 1, z0: state.z0, f0: state.f0, load: state.load ? [state.load.re, state.load.im] : null };
  if (kind === 'all') Object.assign(data, { moves: state.moves, items: state.items, opts: state.opts, grid: state.grid });
  return toBase64Url(JSON.stringify(round(data)));
}

const finite = v => typeof v === 'number' && Number.isFinite(v);
const pair = v => Array.isArray(v) && v.length === 2 && v.every(finite);
const FIELDS = { compass: { c: pair, r: finite, a: finite }, ruler: { a: pair, b: pair }, mark: { g: pair }, reflect: { g: pair } };
const OPTIONAL = { compass: ['a'] };
function itemOk(i) {
  const f = i && FIELDS[i.type];
  if (!f) return false;
  return Object.entries(f).every(([k, ok]) => (i[k] === undefined && OPTIONAL[i.type]?.includes(k)) || ok(i[k]));
}

/** The shared chart, checked field by field, or null when the link is damaged. */
export function decode(code) {
  let d;
  try { d = JSON.parse(fromBase64Url(code)); } catch { return null; }
  if (!d || d.v !== 1 || !(d.z0 > 0) || !(d.f0 > 0)) return null;
  if (d.load !== null && !(pair(d.load) && Math.hypot(...d.load) <= 1 + 1e-6)) return null;
  const moves = d.moves ?? [];
  const items = d.items ?? [];
  if (!Array.isArray(moves) || !moves.every(m => m && KINDS.includes(m.kind) && finite(m.value) && (m.zc === undefined || m.zc > 0) && (m.end === undefined || ['open', 'short'].includes(m.end)))) return null;
  if (!Array.isArray(items) || !items.every(itemOk)) return null;
  const opts = d.opts && d.opts.zc > 0 ? { zc: d.opts.zc, end: d.opts.end === 'short' ? 'short' : 'open' } : null;
  return {
    z0: d.z0, f0: d.f0, load: d.load,
    moves: moves.map(m => ({ kind: m.kind, value: m.value, zc: m.zc ?? d.z0, end: m.end ?? 'open' })),
    // Only the fields the chart draws; a mark label is one letter (it reaches toasts as HTML).
    items: items.map(i => {
      const keep = { type: i.type };
      for (const k of Object.keys(FIELDS[i.type])) if (i[k] !== undefined) keep[k] = i[k];
      if (i.type === 'mark') keep.label = /^[A-Z•]$/.test(i.label) ? i.label : '•';
      return keep;
    }),
    opts, grid: ['z', 'y', 'zy'].includes(d.grid) ? d.grid : null, problem: !d.moves && !d.items,
  };
}
