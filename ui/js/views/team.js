import * as S from '../store.js';
import { h, fmtKey, fmtTime, etKey, num } from '../util.js';
import { ARENAS, displayCode } from '../arenas.js';
import { teamLogo, teamColor, starButton, gameCard, sectionHead, emptyState, avatar, leaderCardGrid } from '../components.js';
import { leaders, posRank } from '../stats.js';
import { teamRows, reportCard } from '../teamstats.js';
import { gradesUnlocked } from './rankings.js';
import { txTable } from './transactions.js';
import { calc } from '../formulas.js';
import { remainingSchedule, ordinal } from '../sos.js';

let tab = 'roster';
let sosShown = '';         // team whose schedule square has been clicked open
let sosMemo = { key: '', res: null };
let gradeShown = '';      // team whose grade square has been clicked open
let gradeMemo = { rev: -1, method: '', rep: null };

export function mount(ctx) {
  S.loadTeamFile(ctx.arg).then(() => draw(ctx));
  S.state.cachedDayKeys.slice(0, 40).forEach((k) => S.loadDay(k));     // so finished games can be completed from cached scoreboards
  S.loadInjuries(); S.loadStandings();
  S.loadSeason(ctx.arg).then(() => draw(ctx));
  S.loadLeague().then(() => draw(ctx));
  S.loadTransactions();
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has('sync') && !S.state.sync.running && !S.state.teamFiles.has(ctx.arg)) { S.loadTeamFile(ctx.arg).then(() => S.loadSeason(ctx.arg)).then(() => draw(ctx)); }
  if (['teamfile', 'days', 'injuries', 'standings', 'favorites', 'sync', 'season', 'league', 'transactions', 'settings'].some((t) => topics.has(t))) draw(ctx);
}

function arenaOf(abbr, file) {
  if (file) {
    const counts = {};
    file.games.filter((g) => g.home === abbr && g.venue).forEach((g) => { counts[g.venue] = (counts[g.venue] || 0) + 1; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return ARENAS[abbr] || (file && file.espnArena) || '—';
}

function draw({ el, arg }) {
  const t = S.team(arg);
  if (!t) { el.replaceChildren(emptyState('Unknown team', arg)); return; }
  const file = S.state.teamFiles.get(arg);
  const st = S.state.standings?.conferences.flatMap((c) => c.teams.map((x) => ({ ...x, conf: c.name }))).find((x) => x.abbr === arg);
  const rec = (file && file.record) || (st && (st.stats.overall || st.stats.Overall)) || '';
  const hero = h('section', { class: 'card hero', style: { '--tc': teamColor(t) } },
    teamLogo(arg, 96),
    h('div', null,
      h('h1', null, t.name, ' ', starButton(arg)),
      h('div', { class: 'meta' }, [rec, st && `${st.conf}`].filter(Boolean).join(' · ')),
      h('dl', { class: 'kv', style: { marginTop: '8px' } },
        h('dt', null, 'Arena'), h('dd', null, arenaOf(arg, file)),
        h('dt', null, 'Head coach'), h('dd', null, file?.headCoach || '—'))),
    h('div', { class: 'hero-boxes' }, sosBox(arg, () => draw({ el, arg })), gradeBox(arg, () => draw({ el, arg }))));

  const tabs = h('div', { class: 'tabs' }, [['roster', 'Roster'], ['leaders', 'Leaders'], ['schedule', 'Schedule'], ['results', 'Box scores'], ['tx', 'Transactions']].map(([k, label]) =>
    h('button', { class: tab === k ? 'active' : '', type: 'button', onclick: () => { tab = k; draw({ el, arg }); } }, label)));

  let body;
  if (!file) body = emptyState('No cached data for this team yet', 'Run a sync from settings, or it will arrive as the nightly sync trickles in.');
  else if (tab === 'roster') body = roster(file);
  else if (tab === 'leaders') body = leadersView(arg, file);
  else if (tab === 'tx') body = txTable(teamTx(arg), { emptyText: 'No transactions recorded for this team yet' });
  else if (tab === 'schedule') body = schedule(arg, file, false);
  else body = schedule(arg, file, true);
  const stale = file && file.games.length && file.games.some((g) => !g.name);
  const notice = stale ? h('div', { class: 'card pad', style: { marginBottom: '14px' } },
    'This team\u2019s saved schedule is missing opponent details. ',
    h('button', { class: 'btn primary', type: 'button', disabled: S.state.sync.running ? true : null, onclick: () => S.runSync('team', arg) },
      S.state.sync.running ? 'Updating\u2026' : 'Update this team now')) : null;
  el.replaceChildren(hero, tabs, ...(notice ? [notice] : []), body);
}

// Team grade from the Report Card: a black ? square until clicked, then the current grade.
function teamGrade(abbr) {
  const L = S.state.league;
  if (!L.data) return null;
  const method = S.state.settings.ratingMethod || 'native';
  if (gradeMemo.rev !== L.rev || gradeMemo.method !== method || !gradeMemo.rep) gradeMemo = { rev: L.rev, method, rep: reportCard(teamRows(L.data, method)) };
  return gradeMemo.rep.find((r) => r.abbr === abbr) || null;
}

// Remaining strength of schedule: needs every team's saved schedule (for ranks) and the league's SRS.
function teamSos(abbr) {
  const L = S.state.league;
  if (!L.data) return null;
  const files = new Map(S.state.teams.map((t) => [t.abbr, S.state.teamFiles.get(t.abbr)]));
  const loaded = [...files.values()].filter(Boolean).length;
  const method = S.state.settings.ratingMethod || 'native';
  const key = `${L.rev}|${loaded}|${method}`;
  if (sosMemo.key !== key) sosMemo = { key, res: remainingSchedule(files, teamRows(L.data, method)) };
  return { ...sosMemo.res, me: sosMemo.res.teams.get(abbr), all: loaded >= S.state.teams.length };
}

function sosBox(abbr, redraw) {
  const open = sosShown === abbr;
  const toggle = () => {
    sosShown = open ? '' : abbr;
    if (!open) { S.loadLeague(); S.state.teams.forEach((t) => S.loadTeamFile(t.abbr)); }      // all schedules, for the ranking
    redraw();
  };
  const attrs = { ...calc('sos'), class: `grade-box ${open ? 'open' : ''}`, type: 'button', onclick: toggle };
  if (!open) return h('button', attrs, h('span', { class: 'gb-q' }, '?'), h('small', null, 'Strength of Schedule'));
  const r = teamSos(abbr);
  if (!r || !r.me || !r.all) return h('button', attrs, h('span', { class: 'gb-q' }, '\u2013'), h('small', null, 'Loading\u2026'));
  const m = r.me;
  if (!m.left) return h('button', attrs, h('span', { class: 'gb-q' }, '\u2013'), h('small', null, 'No games left'));
  const tone = m.allRank <= 10 ? 'hard' : m.allRank > m.of - 10 ? 'easy' : 'mid';
  return h('button', attrs,
    h('span', { class: `sos-val sos-${tone}` }, `${m.all > 0 ? '+' : ''}${m.all.toFixed(1)}`),
    h('small', null, `${ordinal(m.allRank)} hardest of ${m.of}`),
    h('span', { class: 'gb-parts' }, `Next ${Math.min(10, m.left)}: ${ordinal(m.nextRank)}`),
    h('small', { class: 'gb-sub' }, `${m.left} left \u00b7 ${m.b2b} B2B`),
    r.early ? h('small', { class: 'gb-early' }, 'Early season') : null);
}

function gradeBox(abbr, redraw) {
  const open = gradeShown === abbr;
  const g = open ? teamGrade(abbr) : null;
  const toggle = () => { gradeShown = open ? '' : abbr; redraw(); };
  const attrs = { ...calc('grade'), class: `grade-box ${open ? 'open' : ''}`, type: 'button', onclick: toggle };
  if (!open) return h('button', attrs, h('span', { class: 'gb-q' }, '?'), h('small', null, 'Team grade'));
  if (!g) return h('button', attrs, h('span', { class: 'gb-q' }, '–'), h('small', null, S.state.league.loading ? 'Loading…' : 'No games yet'));
  return h('button', attrs,
    h('span', { class: `grade g-${g.overall.grade[0].toLowerCase()} gb-grade` }, g.overall.grade),
    h('small', null, `#${g.overall.rank} of ${gradeMemo.rep.length}`),
    h('span', { class: 'gb-parts' }, 'Off ', h('span', { class: `grade g-${g.offGrade[0].toLowerCase()}` }, g.offGrade), ' Def ', h('span', { class: `grade g-${g.defGrade[0].toLowerCase()}` }, g.defGrade)),
    gradesUnlocked() ? null : h('small', { class: 'gb-early' }, 'Before Week 3'));
}

const teamTx = (abbr) => (S.state.transactions ? S.state.transactions.events.filter((e) => e.from === abbr || e.to === abbr) : []);

// players who joined this team in the last 14 days (signed or traded in), for the roster's New tag
function newArrivals(abbr) {
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  return new Set(teamTx(abbr).filter((e) => e.to === abbr && e.date >= cutoff).map((e) => String(e.id)));
}

const injuryMap = (abbr) => S.injuriesFor(abbr);

function seasonOf(abbr) { return S.state.season.get(abbr); }

function roster(file) {
  const inj = injuryMap(file.abbr);
  const fresh = newArrivals(file.abbr);
  const se = seasonOf(file.abbr);
  const agg = se && se.agg && se.agg.games ? se.agg : null;
  const stat = new Map(agg ? agg.players.map((p) => [String(p.id), p]) : []);
  const startIds = new Set(agg ? agg.lastStarters.map(String) : []);
  const byPos = (a, b) => posRank(a.pos) - posRank(b.pos) || (parseInt(a.jersey, 10) || 99) - (parseInt(b.jersey, 10) || 99);
  const starters = file.players.filter((p) => startIds.has(String(p.id))).sort(byPos);
  const bench = file.players.filter((p) => !startIds.has(String(p.id))).sort(byPos);

  const avg = (p, k) => { const s = stat.get(String(p.id)); return s && s.gp ? (s.tot[k] / s.gp).toFixed(1) : '\u2013'; };
  const pctOf = (p, m, a) => { const s = stat.get(String(p.id)); return s && s.tot[a] > 0 ? (100 * s.tot[m] / s.tot[a]).toFixed(1) : '\u2013'; };
  const pmOf = (p) => { const s = stat.get(String(p.id)); if (!s || !s.gp) return '\u2013'; const v = s.tot.pm / s.gp; return (v > 0 ? '+' : '') + v.toFixed(1); };
  const row = (p) => {
    const i = S.injuryOf(inj, p.id, p.name);
    return h('tr', null,
      h('td', null, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } },
        avatar(p.name, p.headshot, 32),
        h('a', { href: `#/player/${p.id}`, class: 'plink' }, h('b', null, p.name)), ' ', fresh.has(String(p.id)) ? h('span', { class: 'chip new', title: 'Joined in the last 14 days' }, 'New') : null, i ? h('span', { class: `chip ${/out/i.test(i.status) ? 'out' : 'dtd'}`, title: i.comment || '' }, i.status) : null)),
      h('td', null, p.jersey ? `#${p.jersey}` : ''), h('td', null, p.pos),
      h('td', null, avg(p, 'pts')), h('td', null, avg(p, 'ast')),
      h('td', null, pctOf(p, 'fgm', 'fga')), h('td', null, pctOf(p, 'tpm', 'tpa')), h('td', null, pctOf(p, 'ftm', 'fta')),
      h('td', null, avg(p, 'reb')), h('td', null, avg(p, 'blk')), h('td', null, avg(p, 'stl')),
      h('td', null, avg(p, 'tov')), h('td', null, avg(p, 'pf')), h('td', null, pmOf(p)));
  };
  const head = ['Player', '#', 'Pos', 'PPG', 'APG', 'FG%', '3P%', 'FT%', 'RPG', 'BPG', 'SPG', 'TOV', 'PF', '+/-'];
  const tips = { PF: 'Fouls per game', TOV: 'Turnovers per game', '+/-': 'Plus / minus per game' };
  const group = (name, extra) => h('tr', { class: `grp ${extra || ''}` }, h('td', { colspan: head.length }, name));
  const body = starters.length
    ? [group('Starters (last game\u2019s starting five, by position)'), starters.map(row), group('Bench', 'bench'), bench.map(row)]
    : [group(se && se.loading ? 'Roster (loading starters\u2026)' : 'Roster (starters appear after the first saved box score)'), [...file.players].sort(byPos).map(row)];
  return h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl roster' },
    h('thead', null, h('tr', null, head.map((c) => h('th', { title: tips[c] || null }, c)))), h('tbody', null, body)));
}

function leadersView(abbr, file) {
  const se = seasonOf(abbr);
  if (!se || se.loading) return emptyState('Loading season data\u2026', se && se.total ? `${se.loaded} of ${se.total} games` : '');
  const agg = se.agg;
  if (!agg || !agg.games) return emptyState('No saved box scores yet', 'Leaders are built from saved box scores. Run Update favorites now or Update everything in Settings > Data.');
  const cards = leaders(agg);
  const missing = se.total - se.have;
  const note = h('p', { class: 'muted', style: { margin: '0 0 12px' } },
    `Season to date \u00b7 ${agg.games} game${agg.games === 1 ? '' : 's'}`, missing > 0 ? ` (${missing} finished game${missing === 1 ? '' : 's'} without a saved box score yet)` : '',
    ' \u00b7 Offensive and defensive ratings are Dean Oliver estimates; Game Score is Hollinger\u2019s.');
  const grid = leaderCardGrid(cards);
  return h('div', null, note, grid);
}

// The schedule feed sometimes lacks an opponent code or score. Fill the gaps from the game name
// ("CHI @ TOR") and from cached scoreboards, which always carry both teams and scores.
function fixGame(g) {
  const o = { ...g };
  const m = /^\s*(\S+)\s*@\s*(\S+)\s*$/.exec(g.name || '');
  if (m) { o.away = o.away || m[1]; o.home = o.home || m[2]; }
  const ev = S.findEvent(g.id);
  if (ev) {
    const h2 = S.side(ev, 'home'), a2 = S.side(ev, 'away');
    if (h2) { o.home = o.home || h2.abbr; if (o.homeScore == null || o.homeScore === '') o.homeScore = h2.score; }
    if (a2) { o.away = o.away || a2.abbr; if (o.awayScore == null || o.awayScore === '') o.awayScore = a2.score; }
    if (ev.state === 'post') o.state = 'post';
  }
  return o;
}

function schedule(abbr, file, finished) {
  const games = file.games.map(fixGame).filter((g) => (g.state === 'post') === finished);
  if (finished) games.reverse();
  if (!games.length) return emptyState(finished ? 'No games played yet' : 'No upcoming games');
  const rows = games.map((g) => {
    const home = g.home === abbr;
    const opp = home ? g.away : g.home;

    const mine = num(home ? g.homeScore : g.awayScore), theirs = num(home ? g.awayScore : g.homeScore);
    const res = g.state === 'post' ? `${mine > theirs ? 'W' : 'L'} ${mine}–${theirs}` : fmtTime(g.date);
    return h('tr', { style: { cursor: 'pointer' }, onclick: () => { location.hash = `#/game/${g.id}`; } },
      h('td', null, fmtKey(etKey(new Date(g.date)))),
      h('td', null, opp ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, home ? 'vs' : '@', teamLogo(opp, 24), h('b', null, displayCode(opp))) : h('span', { class: 'muted' }, 'Opponent unknown \u2013 update this team')),
      h('td', { style: { color: g.state === 'post' ? (mine > theirs ? 'var(--good)' : 'var(--live)') : '' } }, res));
  });
  return h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, ['Date', 'Opponent', finished ? 'Result' : 'Tip-off'].map((c) => h('th', null, c)))), h('tbody', null, rows.filter(Boolean))));
}
