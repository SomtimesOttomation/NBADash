// Rookie Watch: this season's rookies (0 years of NBA experience on the saved team rosters), ranked by a Rookie score
// built from the saved box scores. No extra requests: rosters come from the team files, stats from league-stats.json.
import * as S from '../store.js';
import { h } from '../util.js';
import { emptyState, teamLogo, avatar, playerLink, headshotUrl } from '../components.js';
import { displayCode } from '../arenas.js';
import { applyForm, gpAdjust, GP_WEIGHT } from '../stats.js';
import { calc } from '../formulas.js';

// Weights of the Rookie score; each input is a percentile among the qualified rookies.
export const ROOKIE_WEIGHTS = [
  ['gmsc', 0.30], ['form', 0.20], ['pts', 0.15], ['reb', 0.10], ['ast', 0.10], ['ts', 0.10], ['stocks', 0.05],
];
export const ROOKIE_MIN = { mpg: 10, gpShare: 0.25 };

let rookieIds = null;          // Map id -> roster entry
let memo = { rev: -1, form: null, rows: null };
let sortKey = 'score';
try { const v = localStorage.getItem('nbadash.rookieSort'); if (v) sortKey = v; } catch (e) { /* ignore */ }

async function loadRookies() {
  if (rookieIds) return rookieIds;
  const files = await Promise.all(S.state.teams.map((t) => S.loadTeamFile(t.abbr)));
  const m = new Map();
  files.forEach((f, i) => {
    if (!f) return;
    for (const p of f.players) {
      if (p.years === 0 || p.years === '0') m.set(String(p.id), { ...p, abbr: S.state.teams[i].abbr });
    }
  });
  rookieIds = m;
  return m;
}

export function mount(ctx) {
  Promise.all([S.loadLeague(), loadRookies()]).then(() => draw(ctx));
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has('teamfile')) { rookieIds = null; memo.rev = -1; loadRookies().then(() => draw(ctx)); return; }
  if (topics.has('league') || topics.has('settings')) draw(ctx);
}

const pct = (vals) => { const s = [...vals].sort((a, b) => a - b); return (v) => (s.length < 2 ? 50 : (100 * s.filter((x) => x < v).length + 50 * (s.filter((x) => x === v).length - 1)) / (s.length - 1)); };

export function rookieRows(lg, rookies, { form = true } = {}) {
  if (form) applyForm(lg);
  // one line per rookie, adding up stints with different teams
  const by = new Map();
  for (const p of Object.values(lg.players || {})) {
    const r = rookies.get(String(p.id));
    if (!r) continue;
    let e = by.get(p.id);
    if (!e) by.set(p.id, e = { id: String(p.id), name: r.name || p.name, team: r.abbr || p.team, pos: r.pos || p.pos, age: r.age, headshot: r.headshot, gp: 0, score: 0, form: NaN, formMin: 0, teamGames: 0, tot: {} });
    e.gp += p.gp; e.score += p.score;
    for (const [k, v] of Object.entries(p.tot)) e.tot[k] = (e.tot[k] || 0) + v;
    if (Number.isFinite(p.form) && p.tot.min > e.formMin) { e.form = p.form; e.formMin = p.tot.min; }
    e.teamGames = Math.max(e.teamGames, lg.teams[p.team] ? lg.teams[p.team].games : 0);
  }
  const rows = [...by.values()].map((e) => {
    const t = e.tot, g = e.gp || 1, tsa = 2 * ((t.fga || 0) + 0.44 * (t.fta || 0));
    return { ...e, mpg: t.min / g, pts: t.pts / g, reb: t.reb / g, ast: t.ast / g, stocks: ((t.stl || 0) + (t.blk || 0)) / g,
      ts: tsa > 0 ? (100 * t.pts) / tsa : NaN, gmsc: e.score / g,
      qualified: e.gp > 0 && t.min / g >= ROOKIE_MIN.mpg && e.gp >= Math.ceil(ROOKIE_MIN.gpShare * e.teamGames) };
  });
  const q = rows.filter((r) => r.qualified);
  const weights = ROOKIE_WEIGHTS.filter(([k]) => form || k !== 'form');
  const wsum = weights.reduce((a, [, w]) => a + w, 0);
  const parts = weights.map(([k, w]) => {
    const ok = q.filter((r) => Number.isFinite(r[k]));
    const adj = gpAdjust(ok, (r) => r[k], (r) => r.gp, GP_WEIGHT);
    const p = pct(ok.map(adj));
    return { k, w, f: (r) => (Number.isFinite(r[k]) ? p(adj(r)) : 0) };
  });
  for (const r of q) r.rscore = parts.reduce((a, x) => a + x.w * x.f(r), 0) / wsum;
  q.sort((a, b) => b.rscore - a.rscore || b.tot.min - a.tot.min).forEach((r, i) => { r.rank = i + 1; });
  const rest = rows.filter((r) => !r.qualified).sort((a, b) => b.tot.min - a.tot.min);
  return { ranked: q, rest };
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');
const sg = (v) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(1) : '–');
const COLS = [
  ['score', 'Score', 'rookie', (r) => (r.rank ? Math.round(r.rscore) : '–'), (r) => r.rscore ?? -1],
  ['gp', 'GP', '', (r) => r.gp, (r) => r.gp],
  ['mpg', 'MIN', '', (r) => f1(r.mpg), (r) => r.mpg],
  ['pts', 'PTS', '', (r) => f1(r.pts), (r) => r.pts],
  ['reb', 'REB', '', (r) => f1(r.reb), (r) => r.reb],
  ['ast', 'AST', '', (r) => f1(r.ast), (r) => r.ast],
  ['stocks', 'STL+BLK', 'stocks', (r) => f1(r.stocks), (r) => r.stocks],
  ['ts', 'TS%', 'ts', (r) => f1(r.ts), (r) => (Number.isFinite(r.ts) ? r.ts : -1)],
  ['gmsc', 'GmSc', 'gamescore', (r) => f1(r.gmsc), (r) => r.gmsc],
  ['form', 'Form', 'form', (r) => sg(r.form), (r) => (Number.isFinite(r.form) ? r.form : -99)],
];

const who = (r) => h('span', { class: 'rk-who' },
  avatar(r.name, r.headshot || headshotUrl(r.id), 32),
  h('span', null, playerLink(r.id, h('b', null, r.name)), h('small', null, [r.pos, r.age ? `age ${r.age}` : ''].filter(Boolean).join(' · '))));
const teamCell = (abbr) => h('a', { class: 'tr-team', href: `#/team/${abbr}` }, teamLogo(abbr, 22), h('b', null, displayCode(abbr)));

function podium(top) {
  return h('div', { class: 'rk-podium' }, top.map((r) => h('section', { class: `card rk-card ${r.rank === 1 ? 'first' : ''}` },
    h('span', { class: 'rk-place' }, `#${r.rank}`),
    avatar(r.name, r.headshot || headshotUrl(r.id), r.rank === 1 ? 72 : 56),
    h('div', { class: 'rk-card-name' }, playerLink(r.id, h('b', null, r.name)), h('small', null, `${displayCode(r.team)} · ${r.pos || ''}`)),
    h('div', { class: 'rk-card-line' }, `${f1(r.pts)} PTS · ${f1(r.reb)} REB · ${f1(r.ast)} AST`),
    h('div', { class: 'rk-card-score' }, h('span', calc('rookie', 'player'), 'Rookie score'), h('b', null, Math.round(r.rscore))))));
}

function table(rows, form) {
  const cols = COLS.filter((c) => form || c[0] !== 'form');
  const col = cols.find((c) => c[0] === sortKey) || cols[0];
  const sorted = col[0] === 'score' ? rows : [...rows].sort((a, b) => col[4](b) - col[4](a));
  return h('div', { class: 'card tr-wrap' }, h('table', { class: 'tr-table rk-table' },
    h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Rookie'), h('th', null, 'Team'),
      cols.map(([k, t, ck]) => h('th', { class: `num sortable ${k === col[0] ? 'sorted' : ''}`, title: 'Sort by this column',
        onclick: (e) => { if (e.target.closest('[data-calc]')) return; sortKey = k; try { localStorage.setItem('nbadash.rookieSort', k); } catch (er) { /* ignore */ } redraw(); } },
      ck ? h('span', calc(ck, 'player'), t) : t)))),
    h('tbody', null, sorted.map((r) => h('tr', { class: r.qualified ? '' : 'muted' },
      h('td', { class: 'rk' }, r.rank || ''), h('td', null, who(r)), h('td', null, teamCell(r.team)),
      cols.map((c) => h('td', { class: 'num' }, c[3](r))))))));
}

let lastCtx = null;
const redraw = () => lastCtx && draw(lastCtx);

function draw(ctx) {
  lastCtx = ctx;
  const { el } = ctx;
  const L = S.state.league, lg = L.data;
  const head = h('div', { class: 'section-head' }, h('h2', null, 'Rookie Watch', h('small', null, 'This season’s rookies, ranked')));
  let body;
  if (!rookieIds) body = emptyState('Finding this season’s rookies…', '');
  else if (!rookieIds.size) body = emptyState('No rookies found yet', 'Rookies are read from the saved team rosters. Run Update everything in Settings > Data.');
  else if (!lg || !Object.keys(lg.players || {}).length) body = emptyState(L.loading ? 'Building league stats…' : 'No saved box scores yet', 'Rookie stats are built from saved box scores. Run Update everything in Settings > Data.');
  else {
    const form = S.state.settings.showForm !== false;
    if (memo.rev !== L.rev || memo.form !== form || memo.n !== rookieIds.size || !memo.rows) memo = { rev: L.rev, form, n: rookieIds.size, rows: rookieRows(lg, rookieIds, { form }) };
    const { ranked, rest } = memo.rows;
    const unplayed = rookieIds.size - ranked.length - rest.length;
    const note = h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      `${rookieIds.size} rookies on rosters. Ranked by `, h('span', calc('rookie', 'player'), 'Rookie score'),
      ` (0–100, against the other rookies). To be ranked a rookie needs ${ROOKIE_MIN.mpg}+ minutes a game and a quarter of his team’s games; the rest are listed below, greyed out.`,
      unplayed > 0 ? ` ${unplayed} have not played yet.` : '', ' Click a column to sort.');
    body = h('div', null, note,
      ranked.length && sortKey === 'score' ? podium(ranked.slice(0, 3)) : null,
      ranked.length || rest.length ? table([...ranked, ...rest], form) : emptyState('No rookie has played yet', ''));
  }
  el.replaceChildren(head, body);
}
