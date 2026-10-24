// Game Flow: win probability and score margin over the game, plus momentum numbers (runs, droughts, ties, comebacks, clutch).
// Built from box.flow, which the host fills from the play-by-play and ESPN's win probability series already in the game summary.
import * as S from '../store.js';
import { h } from '../util.js';
import { displayCode } from '../arenas.js';
import { teamColor, sectionHead } from '../components.js';
import { calc } from '../formulas.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
  kids.flat().forEach((k) => k != null && e.append(typeof k === 'string' ? document.createTextNode(k) : k));
  return e;
};

const periodOf = (t) => (t <= 2880 ? Math.min(4, Math.floor(Math.max(0, t - 1) / 720) + 1) : 5 + Math.floor((t - 2881) / 300));
const periodStart = (p) => (p <= 4 ? (p - 1) * 720 : 2880 + (p - 5) * 300);
const periodLen = (p) => (p <= 4 ? 720 : 300);
const pLabel = (p) => (p <= 4 ? `Q${p}` : p === 5 ? 'OT' : `${p - 4}OT`);
const clockAt = (t) => { const p = periodOf(t); const left = Math.max(0, periodStart(p) + periodLen(p) - t); return `${pLabel(p)} ${Math.floor(left / 60)}:${String(Math.round(left % 60)).padStart(2, '0')}`; };
const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// Colours: each team's own colour, unless the two are too alike, then the away team goes grey.
function colours(home, away) {
  const c = (a) => teamColor(S.team(a));
  const rgb = (hex) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const hc = c(home), ac = c(away), a = rgb(hc), b = rgb(ac);
  const close = a && b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 90;
  return { home: hc, away: close ? '#8b93a1' : ac };
}

// Momentum numbers from the flow points: [t, home margin, home win %].
export function flowStats(flow) {
  const pts = flow.pts || [];
  const ev = [];                     // scoring events: { t, team: 'home'|'away', pts, before }
  for (let i = 1; i < pts.length; i++) {
    const d = pts[i][1] - pts[i - 1][1];
    if (d) ev.push({ t: pts[i][0], team: d > 0 ? 'home' : 'away', pts: Math.abs(d), before: pts[i - 1][1] });
  }
  const end = Math.max(flow.end || 0, pts.length ? pts[pts.length - 1][0] : 0);
  // runs: points by one team before the other scores again
  const run = { home: { pts: 0 }, away: { pts: 0 } };
  let cur = null;
  for (const e of ev) {
    if (!cur || cur.team !== e.team) cur = { team: e.team, pts: 0, from: e.t, to: e.t };
    cur.pts += e.pts; cur.to = e.t;
    if (cur.pts > run[e.team].pts) run[e.team] = { ...cur };
  }
  // droughts: longest stretch without scoring
  const drought = {};
  for (const side of ['home', 'away']) {
    let last = 0, best = { s: 0 };
    for (const e of ev.filter((x) => x.team === side)) { if (e.t - last > best.s) best = { s: e.t - last, from: last, to: e.t }; last = e.t; }
    if (end - last > best.s) best = { s: end - last, from: last, to: end };
    drought[side] = best;
  }
  // ties and lead changes (after tip-off)
  let ties = 0, changes = 0, leader = 0;
  for (const p of pts) {
    if (p[0] === 0) continue;
    const sgn = Math.sign(p[1]);
    if (p[1] === 0 && pts.indexOf(p) > 0 && pts[pts.indexOf(p) - 1][1] !== 0) ties++;
    if (sgn && leader && sgn !== leader) changes++;
    if (sgn) leader = sgn;
  }
  // largest lead and biggest comeback
  const maxHome = Math.max(0, ...pts.map((p) => p[1])), maxAway = Math.max(0, ...pts.map((p) => -p[1]));
  const final = pts.length ? pts[pts.length - 1][1] : 0;
  const comeback = final > 0 ? maxAway : final < 0 ? maxHome : 0;
  // clutch: last 5 minutes of the 4th or overtime with the score within 5
  const clutch = { home: 0, away: 0, any: false };
  for (const e of ev) {
    const p = periodOf(e.t);
    if (p >= 4 && periodStart(p) + periodLen(p) - e.t <= 300 && Math.abs(e.before) <= 5) { clutch[e.team] += e.pts; clutch.any = true; }
  }
  return { ev, run, drought, ties, changes, maxHome, maxAway, final, comeback, clutch, end };
}

function chart(flow, col) {
  const W = 760, H = 300, padL = 34, padR = 10, top = 10, wpH = 130, gap = 26, mgH = 110;
  const end = Math.max(2880, flow.end || 0);
  const x = (t) => padL + ((W - padL - padR) * t) / end;
  const pts = flow.pts || [];
  const hasWp = pts.some((p) => p[2] >= 0);
  const g = [];
  // quarter lines and labels
  const periods = []; for (let p = 1; periodStart(p) < end; p++) periods.push(p);
  periods.forEach((p) => {
    const x0 = x(periodStart(p));
    g.push(sv('line', { x1: x0, x2: x0, y1: top, y2: top + wpH + gap + mgH, class: 'gf-grid' }));
    g.push(sv('text', { x: x(periodStart(p) + periodLen(p) / 2), y: H - 4, class: 'gf-axis', 'text-anchor': 'middle' }, pLabel(p)));
  });
  // win probability (home on top)
  if (hasWp) {
    const y = (w) => top + wpH * (1 - w);
    g.push(sv('line', { x1: padL, x2: W - padR, y1: y(0.5), y2: y(0.5), class: 'gf-mid' }));
    [1, 0.5, 0].forEach((w) => g.push(sv('text', { x: padL - 4, y: y(w) + 4, class: 'gf-axis', 'text-anchor': 'end' }, w === 0.5 ? '50%' : '100%')));
    const wp = pts.filter((p) => p[2] >= 0);
    const line = wp.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[2]).toFixed(1)}`).join('');
    const area = (side) => `M${x(wp[0][0])},${y(0.5)}${wp.map((p) => `L${x(p[0]).toFixed(1)},${y(side === 'home' ? Math.max(0.5, p[2]) : Math.min(0.5, p[2])).toFixed(1)}`).join('')}L${x(wp[wp.length - 1][0])},${y(0.5)}Z`;
    g.push(sv('path', { d: area('home'), fill: col.home, 'fill-opacity': 0.18 }));
    g.push(sv('path', { d: area('away'), fill: col.away, 'fill-opacity': 0.18 }));
    g.push(sv('path', { d: line, fill: 'none', stroke: 'var(--text)', 'stroke-width': 1.6 }));
    g.push(sv('text', { x: padL + 4, y: top + 12, class: 'gf-tag', fill: col.home }, `${displayCode(flow.home)} win %`));
    g.push(sv('text', { x: padL + 4, y: top + wpH - 4, class: 'gf-tag', fill: col.away }, `${displayCode(flow.away)} win %`));
    if (flow.swing) g.push(sv('circle', { cx: x(flow.swing.t), cy: y(Math.max(0, Math.min(1, (wp.find((p) => p[0] >= flow.swing.t) || wp[wp.length - 1])[2]))), r: 4.5, class: 'gf-swing' }));
  }
  // score margin as bars per point (home above, away below)
  const m0 = top + (hasWp ? wpH + gap : 0) + mgH / 2;
  const maxM = Math.max(5, ...pts.map((p) => Math.abs(p[1])));
  const ym = (m) => m0 - (mgH / 2) * (m / maxM);
  g.push(sv('line', { x1: padL, x2: W - padR, y1: m0, y2: m0, class: 'gf-mid' }));
  g.push(sv('text', { x: padL - 4, y: ym(maxM) + 4, class: 'gf-axis', 'text-anchor': 'end' }, `+${maxM}`));
  g.push(sv('text', { x: padL - 4, y: ym(-maxM) + 4, class: 'gf-axis', 'text-anchor': 'end' }, `+${maxM}`));
  const step = pts.map((p, i) => `${i ? `L${x(p[0]).toFixed(1)},${ym(pts[i - 1][1]).toFixed(1)}` : `M${x(p[0]).toFixed(1)},${m0}`}L${x(p[0]).toFixed(1)},${ym(p[1]).toFixed(1)}`).join('');
  const last = pts.length ? x(pts[pts.length - 1][0]) : padL;
  const clip = (id, y0, y1) => sv('clipPath', { id }, sv('rect', { x: 0, y: Math.min(y0, y1), width: W, height: Math.abs(y1 - y0) }));
  const uid = `gf${Math.random().toString(36).slice(2, 7)}`;
  g.push(sv('defs', null, clip(`${uid}h`, ym(maxM) - 2, m0), clip(`${uid}a`, m0, ym(-maxM) + 2)));
  const marea = `${step}L${last.toFixed(1)},${m0}Z`;
  g.push(sv('path', { d: marea, fill: col.home, 'fill-opacity': 0.55, 'clip-path': `url(#${uid}h)` }));
  g.push(sv('path', { d: marea, fill: col.away, 'fill-opacity': 0.55, 'clip-path': `url(#${uid}a)` }));
  g.push(sv('text', { x: padL + 4, y: ym(maxM) + 10, class: 'gf-tag', fill: col.home }, `${displayCode(flow.home)} lead`));
  g.push(sv('text', { x: padL + 4, y: ym(-maxM) - 2, class: 'gf-tag', fill: col.away }, `${displayCode(flow.away)} lead`));
  return sv('svg', { viewBox: `0 0 ${W} ${H}`, class: 'gf-chart', role: 'img', 'aria-label': 'Win probability and score margin over the game' }, g);
}

export function gameFlow(box) {
  const flow = box && box.flow;
  if (!flow || !flow.pts || flow.pts.length < 3) return null;
  const col = colours(flow.home, flow.away);
  const st = flowStats(flow);
  const espn = (k, abbr) => { const t = (box.teamStats || []).find((x) => x.team === abbr); return t ? t.stats.find((s) => s.name === k)?.value : null; };
  const H = displayCode(flow.home), A = displayCode(flow.away);
  const both = (fmt) => [fmt('away', flow.away, A), fmt('home', flow.home, H)];
  const rows = [
    ['Largest lead', (side, abbr) => espn('largestLead', abbr) ?? String(side === 'home' ? st.maxHome : st.maxAway)],
    ['Time leading', (side, abbr) => { const v = espn('leadPercentage', abbr); return v != null ? `${v}%` : '–'; }],
    ['Longest run', (side) => (st.run[side].pts ? `${st.run[side].pts}-0 (${clockAt(st.run[side].from)})` : '–')],
    ['Longest scoring drought', (side) => (st.drought[side].s ? `${dur(st.drought[side].s)} (${clockAt(st.drought[side].to)})` : '–')],
  ];
  if (st.clutch.any) rows.push(['Clutch points', (side) => String(st.clutch[side]), 'clutch']);
  const tbl = h('table', { class: 'tbl gf-tbl' },
    h('thead', null, h('tr', null, h('th', null, ''), h('th', null, A), h('th', null, H))),
    h('tbody', null, rows.map(([label, fn, k]) => h('tr', null, h('td', null, k ? h('span', calc(k), label) : label), ...both(fn).map((v) => h('td', null, v))))));
  const lead = espn('leadChanges', flow.home) ?? String(st.changes);
  const facts = [
    `Lead changes: ${lead}`,
    `Times tied: ${st.ties}`,
    st.comeback >= 8 ? `Comeback: ${st.final > 0 ? H : A} came back from ${st.comeback} down` : null,
  ].filter(Boolean);
  const sw = flow.swing && Math.abs(flow.swing.d) >= 0.05 ? h('p', { class: 'gf-swing-text' },
    h('span', calc('swing'), 'Biggest swing'), `: ${clockAt(flow.swing.t)}, ${flow.swing.text} (${flow.swing.d > 0 ? H : A} win chance +${Math.round(Math.abs(flow.swing.d) * 100)} pts)`) : null;
  return h('section', { class: 'gf' },
    sectionHead('Game flow', h('span', calc('winprob'), 'Win probability from ESPN')),
    h('div', { class: 'card gf-card' }, chart(flow, col), sw, h('p', { class: 'muted gf-facts' }, facts.join(' · ')), tbl));
}
