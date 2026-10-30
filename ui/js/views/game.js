import * as S from '../store.js';
import { calc } from '../formulas.js';
import { h, fmtKey, etKey } from '../util.js';
import { displayCode } from '../arenas.js';
import { gameCard, emptyState, sectionHead, statusPill, avatar, teamLogo, playerLink } from '../components.js';
import { playersOfGame } from '../stats.js';
import { gameFlow } from './gameflow.js';

let which = 0;

export function mount(ctx) {
  S.ensureBox(ctx.arg).then((b) => { (b ? b.teams.map((t) => t.team) : []).forEach((a) => S.loadTeamFile(a)); draw(ctx); }).catch(() => draw(ctx));
  S.loadInjuries();
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has('days') || topics.has(`box:${ctx.arg}`) || topics.has('watch') || topics.has('teamfile') || topics.has('injuries')) draw(ctx);
}

function draw({ el, arg }) {
  const ev = S.findEvent(arg);
  const box = S.state.boxes.get(String(arg));
  const out = [];
  if (ev) out.push(gameCard(ev, { wide: true }));
  else if (box) out.push(h('div', { class: 'card pad' }, h('h2', null, box.name), h('small', null, [box.venue, box.city].filter(Boolean).join(', '))));
  if (ev?.state === 'in' && !S.state.watch.has(ev.id)) {
    const auto = S.state.settings.autoRefresh;
    out.push(h('div', { class: 'card pad', style: { marginTop: '12px' } }, auto ? 'Live box score is off for this game. ' : 'Automatic refresh is off. ',
      h('button', { class: 'btn primary', type: 'button', onclick: () => S.setWatch(ev.id, true) }, auto ? 'Watch it' : 'Fetch the box score now')));
  }
  if (ev && ev.sides.some((s) => s.lines.length)) out.push(lineScore(ev));
  const pog = box ? pyramid(box) : null;
  if (pog) out.push(pog);
  const flow = box ? gameFlow(box) : null;
  if (flow) out.push(flow);
  if (!box) {
    out.push(emptyState(ev?.state === 'pre' ? 'Game has not started' : 'Box score not available yet',
      ev?.state === 'in' ? 'Press Watch to start fetching it live.' : 'It will be filled in by the nightly sync or when you open it online.'));
  } else {
    out.push(sectionHead('Box score', box.attendance ? `Attendance ${box.attendance}` : ''));
    out.push(h('div', { class: 'tabs' }, box.teams.map((t, i) =>
      h('button', { class: which === i ? 'active' : '', type: 'button', onclick: () => { which = i; draw({ el, arg }); } }, displayCode(t.team)))));
    const t = box.teams[Math.min(which, box.teams.length - 1)];
    if (t) out.push(playersTable(t, box));
    if (box.teamStats.length) out.push(teamStats(box));
  }
  el.replaceChildren(...out);
}

// Top three players of the game in one centred row: 1st, 2nd, 3rd. ESPN has no such field, so it is computed (see stats.js).
function pyramid(box) {
  const top = playersOfGame(box, 3, S.state.settings.ratingMethod || 'native');
  if (top.length < 3) return null;
  const heads = new Map();
  box.teams.forEach((t) => { const f = S.state.teamFiles.get(t.team); if (f) f.players.forEach((p) => heads.set(String(p.id), p.headshot)); });
  const fmt = (v) => (Number.isFinite(v) ? Math.round(v) : '\u2013');
  const card = (p, i) => h('div', { class: `pog-card rank${i + 1}` },
    h('span', { class: 'pog-badge' }, i === 0 ? '\u2605 Player of the game' : i === 1 ? '2nd' : '3rd'),
    avatar(p.name, heads.get(String(p.id)), 80),
    h('b', { class: 'pog-name' }, playerLink(p.id, p.name)),
    h('span', { class: 'pog-team' }, teamLogo(p.team, 20), displayCode(p.team), p.pos ? ` \u00b7 ${p.pos}` : ''),
    h('span', { class: 'pog-line' }, `${p.line.pts} PTS \u00b7 ${p.line.reb} REB \u00b7 ${p.line.ast} AST`),
    h('span', { class: 'pog-line' }, `${p.line.stl} STL \u00b7 ${p.line.blk} BLK \u00b7 ${p.line.fgm}/${p.line.fga} FG`),
    h('small', { class: 'muted' }, `Game Score ${p.score.toFixed(1)} \u00b7 ORtg ${fmt(p.ortg)} \u00b7 DRtg ${fmt(p.drtg)}`));
  return h('section', { class: 'pog' },
    h('h2', { class: 'pog-title' }, h('span', calc('gamescore'), 'Players of the game')),
    h('div', { class: 'pog-row' }, card(top[0], 0), card(top[1], 1), card(top[2], 2)),
    h('p', { class: 'pog-note' }, 'Calculated by this dashboard, not an official award or an ESPN stat. Players on both teams are ranked by Game Score: ',
      'points + 0.4\u00d7FGM \u2212 0.7\u00d7FGA \u2212 0.4\u00d7(FTA\u2212FTM) + 0.7\u00d7OREB + 0.3\u00d7DREB + STL + 0.7\u00d7AST + 0.7\u00d7BLK \u2212 0.4\u00d7PF \u2212 TO. Ties go to plus/minus. ',
      'ORtg and DRtg are Dean Oliver estimates (points produced / allowed per 100 possessions).'));
}

function lineScore(ev) {
  const n = Math.max(...ev.sides.map((s) => s.lines.length), 4);
  const head = ['', ...Array.from({ length: n }, (_, i) => (i < 4 ? i + 1 : i === 4 ? 'OT' : `${i - 3}OT`)), 'T'];
  return h('div', { class: 'card scroll-x', style: { marginTop: '12px' } }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, head.map((c) => h('th', null, c)))),
    h('tbody', null, ev.sides.map((s) => h('tr', null, h('td', null, h('b', null, displayCode(s.abbr))),
      ...Array.from({ length: n }, (_, i) => h('td', null, s.lines[i] ?? '')), h('td', null, h('b', null, s.score ?? '')))))));
}

// Box score for one team. ESPN lists only the players dressed for the game, so anyone else on the roster is added under
// "Inactive", with the game's injury report (or the league injury list) saying why when it is known.
function inactiveRows(t, box) {
  const file = S.state.teamFiles.get(t.team);
  const inBox = new Set(t.players.map((p) => String(p.id)));
  const gameInj = new Map(box.injuries.filter((i) => i.team === t.team).map((i) => [String(i.id), i]));
  const league = S.injuriesFor(t.team);
  const fromRoster = file ? file.players.filter((p) => !inBox.has(String(p.id))) : [];
  // injured players the roster file does not have yet (newly signed, or the roster has not been synced)
  const extra = [...gameInj.values()].filter((i) => !inBox.has(String(i.id)) && !fromRoster.some((p) => String(p.id) === String(i.id)));
  const people = [...fromRoster.map((p) => ({ id: p.id, name: p.name })), ...extra.map((i) => ({ id: i.id, name: i.name }))];
  return people.map((p) => {
    const g = gameInj.get(String(p.id));
    const l = S.injuryOf(league, p.id, p.name);
    const status = g ? g.status : l ? l.status : '';
    const why = g ? [g.detail, g.returnDate ? `expected back ${fmtKey(String(g.returnDate).slice(0, 10).replace(/-/g, ''))}` : ''].filter(Boolean).join(' \u00b7 ') : (l && l.comment) || '';
    const chip = status ? h('span', { class: `chip ${/out/i.test(status) ? 'out' : 'dtd'}` }, status) : h('span', { class: 'chip' }, 'Inactive');
    return { status, el: (cols) => h('tr', { class: 'muted inactive' }, h('td', null, playerLink(p.id, p.name)), h('td', { colspan: cols, style: { textAlign: 'left' } }, chip, why ? ` ${why}` : '')) };
  }).sort((a, b) => (a.status ? 0 : 1) - (b.status ? 0 : 1));
}

function playersTable(t, box) {
  const lab = t.labels;
  const starters = t.players.filter((p) => p.starter), bench = t.players.filter((p) => !p.starter);
  const row = (p) => p.dnp
    ? h('tr', { class: 'muted' }, h('td', null, playerLink(p.id, p.name)), h('td', { colspan: lab.length, style: { textAlign: 'left' } }, p.reason || 'DNP'))
    : h('tr', null, h('td', null, h('b', null, playerLink(p.id, p.name)), ' ', h('small', null, p.pos || '')), ...lab.map((_, i) => h('td', null, p.stats[i] ?? '')));
  const group = (name, cls) => h('tr', { class: `grp ${cls || ''}` }, h('td', { colspan: lab.length + 1 }, name));
  const inactive = box ? inactiveRows(t, box) : [];
  return h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, 'Player'), lab.map((c) => h('th', null, c)))),
    h('tbody', null, group('Starters'), starters.map(row), group('Bench', 'bench'), bench.map(row),
      inactive.length ? [group('Inactive (not dressed for this game)', 'inactive'), inactive.map((r) => r.el(lab.length))] : null,
      h('tr', null, h('td', null, h('b', null, 'Totals')), ...lab.map((_, i) => h('td', null, h('b', null, t.totals[i] ?? '')))))));
}

// ESPN's team stat keys are raw camelCase; show the useful ones with readable labels, in a sensible order.
const TEAM_STATS = [
  ['fieldGoalsMade-fieldGoalsAttempted', 'FG'], ['fieldGoalPct', 'FG %', '%'],
  ['threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT'], ['threePointFieldGoalPct', '3PT %', '%'],
  ['freeThrowsMade-freeThrowsAttempted', 'FT'], ['freeThrowPct', 'FT %', '%'],
  ['totalRebounds', 'Rebounds'], ['offensiveRebounds', 'Offensive rebounds'], ['defensiveRebounds', 'Defensive rebounds'],
  ['assists', 'Assists'], ['steals', 'Steals'], ['blocks', 'Blocks'], ['totalTurnovers', 'Turnovers'], ['fouls', 'Fouls'],
  ['pointsInPaint', 'Points in the paint'], ['fastBreakPoints', 'Fast-break points'], ['turnoverPoints', 'Points off turnovers'],
];

function teamStats(box) {
  const [a, b] = box.teamStats;
  if (!a || !b) return h('span');
  const get = (t, k) => t.stats.find((s) => s.name === k)?.value;
  const rows = TEAM_STATS.filter(([k]) => get(a, k) != null || get(b, k) != null);
  if (!rows.length) return h('span');
  const fmt = (v, suf) => (v == null || v === '' ? '' : v + (suf || ''));
  return h('div', { class: 'card scroll-x', style: { marginTop: '14px' } }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, h('th', null, 'Team stats'), h('th', null, displayCode(a.team)), h('th', null, displayCode(b.team)))),
    h('tbody', null, rows.map(([k, label, suf]) => h('tr', null, h('td', null, label), h('td', null, fmt(get(a, k), suf)), h('td', null, fmt(get(b, k), suf)))))));
}
void fmtKey; void etKey; void statusPill;
