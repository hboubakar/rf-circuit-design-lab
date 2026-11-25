// The network the moves describe, as a schematic from the source (left) to the load (right).
import { describe } from './smith.js';

const W = 360, H = 132, TOP = 38, BOTTOM = 98;

const ground = (x, y) => [14, 9, 4].map((w, i) => `<path d="M${x - w / 2} ${y + i * 3}h${w}"/>`).join('');

function inductor(x, y, vertical) {
  // Four bumps of a coil, 28 px long.
  const n = 4, step = 7;
  let d = vertical ? `M${x} ${y - 14}` : `M${x - 14} ${y}`;
  for (let i = 0; i < n; i++) d += vertical ? ` a3.5 3.5 0 0 1 0 ${step}` : ` a3.5 3.5 0 0 1 ${step} 0`;
  return `<path class="part" d="${d}"/>`;
}
function capacitor(x, y, vertical) {
  return vertical
    ? `<path class="part" d="M${x - 9} ${y - 3}h18M${x - 9} ${y + 3}h18"/><path class="mask" d="M${x - 10} ${y - 2}h20v4h-20z"/>`
    : `<path class="part" d="M${x - 3} ${y - 9}v18M${x + 3} ${y - 9}v18"/><path class="mask" d="M${x - 2} ${y - 10}h4v20h-4z"/>`;
}

/** SVG markup for the schematic; moves are listed load side first. */
export function ladderSVG(moves, z0, f0) {
  const n = moves.length;
  const left = 34, right = W - 40;
  const slot = (right - left - 30) / Math.max(n, 1);
  const xs = moves.map((_, i) => right - 22 - (i + 0.5) * slot);
  const gaps = [];
  moves.forEach((m, i) => { if (m.kind === 'series' || m.kind === 'line') gaps.push([xs[i] - 17, xs[i] + 17]); });
  const edges = [left, ...gaps.sort((a, b) => a[0] - b[0]).flat(), right];
  let wire = '';
  for (let i = 0; i < edges.length; i += 2) wire += `M${edges[i]} ${TOP}H${edges[i + 1]}`;
  let out = `<path class="wire" d="${wire}M${left} ${TOP}V${TOP + 16}M${left} ${TOP + 40}V${BOTTOM}M${right} ${TOP}V${TOP + 12}M${right} ${TOP + 44}V${BOTTOM}"/>`;
  out += `<circle class="source" cx="${left}" cy="${TOP + 28}" r="12"/><path class="wire" d="M${left - 6} ${TOP + 28}q3 -6 6 0t6 0"/>`;
  out += `<text class="lbl" x="${left}" y="${TOP - 14}" text-anchor="middle">Z₀</text>`;
  out += `<rect class="load" x="${right - 8}" y="${TOP + 12}" width="16" height="32" rx="2"/><text class="lbl load-t" x="${right}" y="${TOP + 32}" text-anchor="middle">Zₗ</text>`;
  out += `<g class="wire">${ground(left, BOTTOM)}${ground(right, BOTTOM)}</g>`;
  if (!n) out += `<text class="empty" x="${W / 2}" y="${TOP + 34}" text-anchor="middle">Add a move to build the network</text>`;
  moves.forEach((m, i) => {
    const x = xs[i];
    const [name, value] = describe(m, z0, f0);
    const sym = name.endsWith('L') ? 'L' : 'C';
    let g = '';
    if (m.kind === 'series') g += sym === 'L' ? inductor(x, TOP, false) : capacitor(x, TOP, false) + `<path class="wire" d="M${x - 17} ${TOP}H${x - 3}M${x + 3} ${TOP}H${x + 17}"/>`;
    if (m.kind === 'series' && sym === 'L') g += `<path class="wire" d="M${x - 17} ${TOP}H${x - 14}M${x + 14} ${TOP}H${x + 17}"/>`;
    if (m.kind === 'shunt') {
      const cy = TOP + 30;
      g += sym === 'L'
        ? `<path class="wire" d="M${x} ${TOP}V${cy - 14}M${x} ${cy + 14}V${BOTTOM}"/>${inductor(x, cy, true)}`
        : `<path class="wire" d="M${x} ${TOP}V${cy - 3}M${x} ${cy + 3}V${BOTTOM}"/>${capacitor(x, cy, true)}`;
      g += `<g class="wire">${ground(x, BOTTOM)}</g>`;
    }
    if (m.kind === 'line') g += `<rect class="tline" x="${x - 17}" y="${TOP - 7}" width="34" height="14" rx="3"/>`;
    if (m.kind === 'stub') {
      g += `<path class="wire" d="M${x} ${TOP}V${TOP + 10}"/><rect class="tline" x="${x - 6}" y="${TOP + 10}" width="12" height="38" rx="3"/>`;
      g += m.end === 'short' ? `<path class="wire" d="M${x} ${TOP + 48}V${BOTTOM}"/><g class="wire">${ground(x, BOTTOM)}</g>`
        : `<text class="tiny" x="${x}" y="${TOP + 62}" text-anchor="middle">open</text>`;
    }
    if (m.kind !== 'series') g += `<circle class="node" cx="${x}" cy="${TOP}" r="2.6"/>`;
    g += `<circle class="num" cx="${x}" cy="14" r="8"/><text class="num-t" x="${x}" y="17.5" text-anchor="middle">${i + 1}</text>`;
    if (slot >= 46) g += `<text class="val" x="${x}" y="${H - 8}" text-anchor="middle">${value.split('  ')[0]}</text>`;
    out += `<g class="part-group">${g}</g>`;
  });
  return `<svg class="ladder" viewBox="0 0 ${W} ${H}" role="img" aria-label="Matching network schematic">${out}</svg>`;
}
