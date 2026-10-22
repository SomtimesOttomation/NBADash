import * as S from '../store.js';
import { h } from '../util.js';
import { emptyState, leaderCardGrid, leaderRowSections } from '../components.js';
import { leagueLeaders } from '../stats.js';

const KEY = 'nbadash.leadersView';
let mode = 'cards';
try { const v = localStorage.getItem(KEY); if (v === 'cards' || v === 'rows') mode = v; } catch (e) { /* storage can be unavailable */ }
let memo = { rev: -1, cards: null };

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
  const head = h('div', { class: 'section-head' },
    h('h2', null, 'League Leaders', h('small', null, lg ? `Season to date \u00b7 ${Math.round(games)} game${Math.round(games) === 1 ? '' : 's'}` : '')), toggle);

  let body;
  if (!lg || (!games && L.loading)) body = emptyState('Building league stats\u2026', L.total ? `${L.n} of ${L.total} box scores` : '');
  else if (!games) body = emptyState('No saved box scores yet', 'League leaders are built from saved box scores. Run Update everything in Settings.');
  else {
    if (memo.rev !== L.rev || !memo.cards) memo = { rev: L.rev, cards: leagueLeaders(lg, 5) };
    const note = h('p', { class: 'muted', style: { margin: '0 0 12px' } },
      'Top 5 per category. Players need 10+ minutes a game and at least half of their team\u2019s games. ',
      'Offensive and defensive ratings are Dean Oliver estimates; Game Score is Hollinger\u2019s.',
      L.loading ? ` Updating\u2026 ${L.n} of ${L.total} new box scores.` : '');
    body = h('div', null, note, mode === 'cards' ? leaderCardGrid(memo.cards, { showTeam: true }) : leaderRowSections(memo.cards));
  }
  el.replaceChildren(head, body);
}
