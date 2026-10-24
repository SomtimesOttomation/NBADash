import * as S from '../store.js';
import { h } from '../util.js';
import { emptyState, teamLogo, teamName } from '../components.js';
import { displayCode } from '../arenas.js';
import { teamRows, teamCards, reportCard, fmtTeamValue } from '../teamstats.js';

const TAB_KEY = 'nbadash.rankingsTab', SHOW_KEY = 'nbadash.gradesEarly';
let tab = 'leaders';
let early = false;
try { const v = localStorage.getItem(TAB_KEY); if (['leaders', 'losers', 'report'].includes(v)) tab = v; } catch (e) { /* ignore */ }
try { early = localStorage.getItem(SHOW_KEY) === '1'; } catch (e) { /* ignore */ }
let memo = { rev: -1, rows: null, report: null };

// Grades unlock once Week 3 is over (Week 4 starts).
export const gradesUnlockKey = () => S.weekDayKeys(4)[0];
export const gradesUnlocked = () => S.todayKey() >= gradesUnlockKey();

export function mount(ctx) { S.loadLeague().then(() => draw(ctx)); draw(ctx); }
export function update(topics, ctx) { if (topics.has('league')) draw(ctx); }

const teamCell = (abbr) => h('a', { class: 'tr-team', href: `#/team/${abbr}` }, teamLogo(abbr, 22), h('b', null, displayCode(abbr)), h('small', null, teamName(abbr)));

function cardGrid(cards) {
  return h('div', { class: 'leaders-grid' }, cards.map((c) => h('section', { class: 'card leader-card' },
    h('header', null, h('h3', null, c.title), h('small', null, c.unit)),
    c.rows.length ? h('ol', null, c.rows.map((r, i) => h('li', { class: i === 0 ? 'first' : '' },
      h('span', { class: 'rk' }, i + 1),
      teamLogo(r.abbr, i === 0 ? 40 : 28),
      h('span', { class: 'nm' }, h('b', null, h('a', { href: `#/team/${r.abbr}` }, teamName(r.abbr))), h('small', null, r.sub)),
      h('span', { class: 'val' }, fmtTeamValue(r.value, c)))))
      : h('p', { class: 'muted pad' }, 'Not enough data yet'))));
}

const gcls = (g) => `grade g-${g[0].toLowerCase()}`;
const gradeBadge = (g) => h('span', { class: gcls(g) }, g);

function reportTable(rep) {
  const f1 = (v) => v.toFixed(1), sg = (v) => (v > 0 ? '+' : '') + v.toFixed(1);
  return h('div', { class: 'card tr-wrap' }, h('table', { class: 'tr-table' },
    h('thead', null, h('tr', null, ['#', 'Team', 'Overall', 'Offense', 'Defense', 'Net', 'ORtg', 'DRtg', 'eFG%', 'GP'].map((t, i) => h('th', { class: i > 1 ? 'num' : '' }, t)))),
    h('tbody', null, rep.map((r) => h('tr', null,
      h('td', { class: 'rk' }, r.overall.rank), h('td', null, teamCell(r.abbr)),
      h('td', { class: 'num' }, gradeBadge(r.overall.grade)), h('td', { class: 'num' }, gradeBadge(r.offGrade)), h('td', { class: 'num' }, gradeBadge(r.defGrade)),
      h('td', { class: 'num' }, sg(r.net)), h('td', { class: 'num' }, f1(r.ortg)), h('td', { class: 'num' }, f1(r.drtg)), h('td', { class: 'num' }, f1(r.efg)), h('td', { class: 'num' }, r.games))))));
}

function draw({ el }) {
  const L = S.state.league, lg = L.data;
  const games = lg ? Object.values(lg.teams).reduce((a, t) => a + t.games, 0) / 2 : 0;
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Team Rankings' },
    [['leaders', 'Leaders'], ['losers', 'Losers'], ['report', 'Report Card']].map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', class: tab === k ? 'active' : '', onclick: () => {
        tab = k; try { localStorage.setItem(TAB_KEY, k); } catch (e) { /* ignore */ }
        draw({ el });
      } }, label)));
  const title = { leaders: 'Team Rankings', losers: 'Team Rankings · Losers', report: 'Report Card' }[tab];
  const head = h('div', { class: 'section-head' },
    h('h2', null, title, h('small', null, lg ? `Season to date · ${Math.round(games)} game${Math.round(games) === 1 ? '' : 's'}` : '')), tabs);

  let body;
  if (!lg || (!games && L.loading)) body = emptyState('Building team stats…', L.total ? `${L.n} of ${L.total} box scores` : '');
  else if (!games) body = emptyState('No saved box scores yet', 'Team rankings are built from saved box scores. Run Update everything in Settings.');
  else {
    if (memo.rev !== L.rev || !memo.rows) memo = { rev: L.rev, rows: teamRows(lg), report: null };
    if (tab === 'report') {
      const unlocked = gradesUnlocked();
      const show = unlocked || early;
      const toggle = unlocked ? null : h('label', { class: 'tr-toggle' },
        h('input', { type: 'checkbox', checked: early, onchange: (e) => { early = e.target.checked; try { localStorage.setItem(SHOW_KEY, early ? '1' : '0'); } catch (x) { /* ignore */ } draw({ el }); } }),
        ' Show grades anyway');
      const note = h('p', { class: 'muted', style: { margin: '0 0 12px' } },
        unlocked
          ? 'Grades are a curve against the other teams: net rating, then offense and defense built from rating, shooting, turnovers, rebounding and free throws (Dean Oliver’s Four Factors).'
          : `Grades unlock after Week 3 (from ${S.weekRangeLabel(4).split(' - ')[0]}), when teams have played enough games for them to mean something.`,
        toggle ? ' ' : '', toggle);
      if (!show) {
        body = h('div', null, note, emptyState('Grades start after Week 3', 'Turn on “Show grades anyway” to preview them early. Early grades swing a lot.'));
      } else {
        if (!memo.report) memo.report = reportCard(memo.rows);
        body = h('div', null, note, early && !unlocked ? h('p', { class: 'tr-warn' }, 'Early preview — small sample, expect big swings.') : null, reportTable(memo.report));
      }
    } else {
      const cards = teamCards(memo.rows, tab === 'losers', 5);
      body = h('div', null, h('p', { class: 'muted', style: { margin: '0 0 12px' } },
        tab === 'losers' ? 'The five worst teams per category, the mirror image of Leaders.' : 'Top 5 teams per category. Teams with more games played get a small edge in close races. Ratings are points per 100 possessions (estimated); for allowed points and defensive rating, lower is better.',
        L.loading ? ` Updating… ${L.n} of ${L.total} new box scores.` : ''), cardGrid(cards));
    }
  }
  el.replaceChildren(head, body);
}
