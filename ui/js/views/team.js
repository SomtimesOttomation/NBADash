import * as S from '../store.js';
import { h, fmtKey, fmtTime, etKey, num } from '../util.js';
import { ARENAS, displayCode } from '../arenas.js';
import { teamLogo, teamColor, starButton, gameCard, sectionHead, emptyState, avatar, leaderCardGrid } from '../components.js';
import { leaders, posRank } from '../stats.js';

let tab = 'roster';

export function mount(ctx) {
  S.loadTeamFile(ctx.arg).then(() => draw(ctx));
  S.state.cachedDayKeys.slice(0, 40).forEach((k) => S.loadDay(k));     // so finished games can be completed from cached scoreboards
  S.loadInjuries(); S.loadStandings();
  S.loadSeason(ctx.arg).then(() => draw(ctx));
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has('sync') && !S.state.sync.running && !S.state.teamFiles.has(ctx.arg)) { S.loadTeamFile(ctx.arg).then(() => S.loadSeason(ctx.arg)).then(() => draw(ctx)); }
  if (['teamfile', 'days', 'injuries', 'standings', 'favorites', 'sync', 'season'].some((t) => topics.has(t))) draw(ctx);
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
        h('dt', null, 'Head coach'), h('dd', null, file?.headCoach || '—'))));

  const tabs = h('div', { class: 'tabs' }, [['roster', 'Roster'], ['leaders', 'Leaders'], ['schedule', 'Schedule'], ['results', 'Box scores']].map(([k, label]) =>
    h('button', { class: tab === k ? 'active' : '', type: 'button', onclick: () => { tab = k; draw({ el, arg }); } }, label)));

  let body;
  if (!file) body = emptyState('No cached data for this team yet', 'Run a sync from settings, or it will arrive as the nightly sync trickles in.');
  else if (tab === 'roster') body = roster(file);
  else if (tab === 'leaders') body = leadersView(arg, file);
  else if (tab === 'schedule') body = schedule(arg, file, false);
  else body = schedule(arg, file, true);
  const stale = file && file.games.length && file.games.some((g) => !g.name);
  const notice = stale ? h('div', { class: 'card pad', style: { marginBottom: '14px' } },
    'This team\u2019s saved schedule is missing opponent details. ',
    h('button', { class: 'btn primary', type: 'button', disabled: S.state.sync.running ? true : null, onclick: () => S.runSync('team', arg) },
      S.state.sync.running ? 'Updating\u2026' : 'Update this team now')) : null;
  el.replaceChildren(hero, tabs, ...(notice ? [notice] : []), body);
}

function injuryMap(abbr) {
  const m = new Map();
  const inj = S.state.injuries?.teams.find((x) => displayCode(x.team) === displayCode(abbr) || x.team === abbr);
  inj?.players.forEach((p) => m.set(String(p.id), p));
  return m;
}

function seasonOf(abbr) { return S.state.season.get(abbr); }

function roster(file) {
  const inj = injuryMap(file.abbr);
  const se = seasonOf(file.abbr);
  const agg = se && se.agg && se.agg.games ? se.agg : null;
  const stat = new Map(agg ? agg.players.map((p) => [String(p.id), p]) : []);
  const startIds = new Set(agg ? agg.lastStarters.map(String) : []);
  const byPos = (a, b) => posRank(a.pos) - posRank(b.pos) || (parseInt(a.jersey, 10) || 99) - (parseInt(b.jersey, 10) || 99);
  const starters = file.players.filter((p) => startIds.has(String(p.id))).sort(byPos);
  const bench = file.players.filter((p) => !startIds.has(String(p.id))).sort(byPos);

  const avg = (p, k) => { const s = stat.get(String(p.id)); return s && s.gp ? (s.tot[k] / s.gp).toFixed(1) : '\u2013'; };
  const row = (p) => {
    const i = inj.get(String(p.id));
    return h('tr', null,
      h('td', null, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } },
        avatar(p.name, p.headshot, 32),
        h('b', null, p.name), ' ', i ? h('span', { class: `chip ${/out/i.test(i.status) ? 'out' : 'dtd'}`, title: i.comment || '' }, i.status) : null)),
      h('td', null, p.jersey ? `#${p.jersey}` : ''), h('td', null, p.pos), h('td', null, p.height), h('td', null, p.weight), h('td', null, p.age ?? ''), h('td', null, p.years ?? ''),
      h('td', null, avg(p, 'pts')), h('td', null, avg(p, 'reb')), h('td', null, avg(p, 'ast')));
  };
  const group = (name, extra) => h('tr', { class: `grp ${extra || ''}` }, h('td', { colspan: 10 }, name));
  const head = ['Player', '#', 'Pos', 'Ht', 'Wt', 'Age', 'Exp', 'PPG', 'RPG', 'APG'];
  const body = starters.length
    ? [group('Starters (last game\u2019s starting five, by position)'), starters.map(row), group('Bench', 'bench'), bench.map(row)]
    : [group(se && se.loading ? 'Roster (loading starters\u2026)' : 'Roster (starters appear after the first saved box score)'), [...file.players].sort(byPos).map(row)];
  return h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
    h('thead', null, h('tr', null, head.map((c) => h('th', null, c)))), h('tbody', null, body)));
}

function leadersView(abbr, file) {
  const se = seasonOf(abbr);
  if (!se || se.loading) return emptyState('Loading season data\u2026', se && se.total ? `${se.loaded} of ${se.total} games` : '');
  const agg = se.agg;
  if (!agg || !agg.games) return emptyState('No saved box scores yet', 'Leaders are built from saved box scores. Run Update favorites now or Update everything in Settings.');
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
