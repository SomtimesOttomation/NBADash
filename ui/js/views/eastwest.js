// East-West Report: how the two conferences compare, from the games between them and schedule-adjusted ratings.
// Everything comes from the saved box scores (league-stats.json) and the standings; no extra requests.
import * as S from '../store.js';
import { h } from '../util.js';
import { displayCode } from '../arenas.js';
import { teamLogo } from '../components.js';
import { teamRows } from '../teamstats.js';
import { calc } from '../formulas.js';
import { sortStandings } from './standings.js';

const isEast = (c) => /east/i.test(c.name || c.abbreviation || '');
const sg = (v) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '–');

export function eastWest(lg, st, method) {
  const confs = st.conferences;
  const E = confs.find(isEast), W = confs.find((c) => c !== E);
  if (!E || !W) return null;
  const east = new Set(E.teams.map((t) => t.abbr)), west = new Set(W.teams.map((t) => t.abbr));
  // head to head, counted from the East side
  let w = 0, l = 0, pf = 0, pa = 0;
  for (const a of east) {
    const vs = lg.teams[a] && lg.teams[a].vs;
    if (!vs) continue;
    for (const [o, r] of Object.entries(vs)) if (west.has(o)) { w += r[0]; l += r[1]; pf += r[2]; pa += r[3]; }
  }
  const rows = teamRows(lg, method);
  const srs = new Map(rows.map((r) => [r.abbr, r.srs]));
  const avg = (set) => { const v = [...set].map((a) => srs.get(a)).filter(Number.isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN; };
  const top = [...rows].sort((a, b) => b.srs - a.srs).slice(0, 10);
  const seeds = (C) => sortStandings(C.teams).slice(0, 10).map((t) => ({ abbr: t.abbr, rec: `${pickStat(t, 'wins')}-${pickStat(t, 'losses')}`, srs: srs.get(t.abbr) }));
  return {
    h2h: { w, l, games: w + l, diff: w + l ? (pf - pa) / (w + l) : NaN },
    srsE: avg(east), srsW: avg(west),
    topE: top.filter((r) => east.has(r.abbr)).length, topW: top.filter((r) => west.has(r.abbr)).length,
    seedsE: seeds(E), seedsW: seeds(W),
  };
}
function pickStat(t, key) { const k = Object.keys(t.stats || {}).find((x) => x.toLowerCase() === key.toLowerCase()); return k ? t.stats[k] : '0'; }

function lead(e, w, fmt, unit = '') {
  if (!Number.isFinite(e) || !Number.isFinite(w) || e === w) return 'Even';
  return `${e > w ? 'East' : 'West'} by ${fmt(Math.abs(e - w))}${unit}`;
}

export function eastWestReport() {
  const lg = S.state.league.data, st = S.state.standings;
  const head = h('div', { class: 'section-head' }, h('h2', null, 'East-West Report', h('small', null, 'How the conferences compare')));
  if (!st || !lg || !Object.keys(lg.teams || {}).length) return h('section', { class: 'ewr' }, head, h('p', { class: 'muted' }, S.state.league.loading ? 'Building league stats…' : 'Needs saved box scores. Run Update everything in Settings > Data.'));
  const r = eastWest(lg, st, S.state.settings.ratingMethod || 'native');
  if (!r) return '';
  const { h2h } = r;
  const share = h2h.games ? h2h.w / h2h.games : 0.5;
  const bar = h('div', { class: 'ewr-bar', role: 'img', 'aria-label': `East ${h2h.w}, West ${h2h.l} in games between the conferences` },
    h('div', { class: 'ewr-e', style: { width: `${(share * 100).toFixed(1)}%` } }, h('span', null, `East ${h2h.w}`)),
    h('div', { class: 'ewr-w' }, h('span', null, `West ${h2h.l}`)));
  const h2hText = !h2h.games ? 'No East vs West games saved yet'
    : h2h.w === h2h.l ? `Level at ${h2h.w}-${h2h.l} head-to-head` : `${h2h.w > h2h.l ? 'East' : 'West'} leads ${Math.max(h2h.w, h2h.l)}-${Math.min(h2h.w, h2h.l)} head-to-head`;
  const tile = (label, key, value, sub) => h('div', { class: 'ewr-tile' }, h('small', null, h('span', calc(key, 'team'), label)), h('b', null, value), h('small', { class: 'muted' }, sub));
  const tiles = h('div', { class: 'ewr-tiles' },
    tile('Head-to-head margin', 'ewh2h', !h2h.games ? '–' : Math.abs(h2h.diff) < 0.05 ? 'Even' : `${h2h.diff > 0 ? 'East' : 'West'} +${Math.abs(h2h.diff).toFixed(1)}`, h2h.games ? `points per game, ${h2h.games} games` : ''),
    tile('Average SRS', 'ewsrs', `${sg(r.srsE)} / ${sg(r.srsW)}`, `East / West · ${lead(r.srsE, r.srsW, (v) => v.toFixed(1), ' pts')}`),
    tile('Top 10 teams by SRS', 'ewtop', `${r.topE} / ${r.topW}`, `East / West`));
  const n = Math.max(r.seedsE.length, r.seedsW.length);
  const side = (s, other) => (s ? h('span', { class: `ewr-team ${Number.isFinite(s.srs) && Number.isFinite(other?.srs) && s.srs > other.srs ? 'better' : ''}` },
    teamLogo(s.abbr, 20), h('b', null, displayCode(s.abbr)), h('small', null, s.rec), h('small', { class: 'muted' }, sg(s.srs))) : h('span'));
  const seeds = h('div', { class: 'card ewr-seeds' },
    h('div', { class: 'ewr-seed-head' }, h('span', null, 'East'), h('small', null, h('span', calc('ewseeds', 'team'), 'Seed vs seed')), h('span', null, 'West')),
    Array.from({ length: n }, (_, i) => h('div', { class: 'ewr-seed' }, side(r.seedsE[i], r.seedsW[i]), h('span', { class: 'ewr-rank' }, i + 1), side(r.seedsW[i], r.seedsE[i]))));
  return h('section', { class: 'ewr' }, head,
    h('div', { class: 'card ewr-main' }, h('p', { class: 'ewr-headline' }, h('span', calc('ewh2h', 'team'), h2hText)), bar, tiles),
    seeds);
}
