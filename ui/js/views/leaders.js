import * as S from '../store.js';
import { h } from '../util.js';
import { emptyState, leaderCardGrid, leaderRowSections } from '../components.js';
import { leagueLeaders, leagueLosers } from '../stats.js';
import { calc } from '../formulas.js';

const KEY = 'nbadash.leadersView';
let mode = 'cards';
const TAB_KEY = 'nbadash.leadersTab';
let tab = 'leaders';        // 'leaders' | 'losers'
try { const v = localStorage.getItem(TAB_KEY); if (v === 'leaders' || v === 'losers') tab = v; } catch (e) { /* ignore */ }
try { const v = localStorage.getItem(KEY); if (v === 'cards' || v === 'rows') mode = v; } catch (e) { /* storage can be unavailable */ }
let memo = { rev: -1, tab: '', cards: null };

export function mount(ctx) { S.loadLeague().then(() => draw(ctx)); draw(ctx); }
export function update(topics, ctx) { if (topics.has('league')) draw(ctx); }

function draw({ el }) {
  const L = S.state.league;
  const lg = L.data;
  const games = lg ? Object.values(lg.teams).reduce((a, t) => a + t.games, 0) / 2 : 0;
  const toggle = h('div', { class: 'seg', role: 'group', 'aria-label': 'View' },
    [['cards', 'Card view'], ['rows', 'Row view']].map(([k, label]) => h('button', {
      type: 'button', class: mode === k ? 'active' : '', onclick: () => {
        mode = k; try { localStorage.setItem(KEY, k); } catch (e) { /* ignore */ }
        draw({ el });
      } }, label)));
  const tabs = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Leaders or Losers' },
    [['leaders', 'Leaders'], ['losers', 'Losers']].map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': tab === k ? 'true' : 'false', class: tab === k ? 'active' : '', onclick: () => {
        tab = k; try { localStorage.setItem(TAB_KEY, k); } catch (e) { /* ignore */ }
        draw({ el });
      } }, label)));
  const head = h('div', { class: 'section-head' },
    h('h2', null, tab === 'losers' ? 'Leaderboards \u00b7 Losers' : 'Leaderboards', h('small', null, lg ? `Season to date \u00b7 ${Math.round(games)} game${Math.round(games) === 1 ? '' : 's'}` : '')), h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } }, tabs, toggle));

  let body;
  if (!lg || (!games && L.loading)) body = emptyState('Building league stats\u2026', L.total ? `${L.n} of ${L.total} box scores` : '');
  else if (!games) body = emptyState('No saved box scores yet', 'League leaders are built from saved box scores. Run Update everything in Settings.');
  else {
    if (memo.rev !== L.rev || memo.tab !== tab || !memo.cards) memo = { rev: L.rev, tab, cards: (tab === 'losers' ? leagueLosers : leagueLeaders)(lg, 5) };
    const note = h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      tab === 'losers' ? 'The five worst per category, the mirror image of Leaders. ' : 'Top 5 per category. ',
      'Players with more games get a ', h('span', calc('gpedge'), 'small edge'), ' in close races. Players need 10+ minutes a game and at least half of their team\u2019s games. Hover a category name for its formula.',
      L.loading ? ` Updating\u2026 ${L.n} of ${L.total} new box scores.` : '');
    body = h('div', null, note, mode === 'cards' ? leaderCardGrid(memo.cards, { showTeam: true }) : leaderRowSections(memo.cards, { worst: tab === 'losers' }));
  }
  el.replaceChildren(head, body);
}
