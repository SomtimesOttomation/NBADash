import * as S from '../store.js';
import { h } from '../util.js';
import { emptyState, teamLogo } from '../components.js';
import { displayCode } from '../arenas.js';

const TYPES = { trade: 'Traded', signed: 'Signed', released: 'Waived / Released' };
const FILTER_KEY = 'nbadash.txFilter';
let filter = 'all';
try { const v = localStorage.getItem(FILTER_KEY); if (v === 'all' || TYPES[v]) filter = v; } catch (e) { /* ignore */ }

export function mount(ctx) { S.loadTransactions().then(() => draw(ctx)); draw(ctx); }
export function update(topics, ctx) { if (topics.has('transactions')) draw(ctx); }

const fmtDate = (d) => { const t = new Date(`${d}T12:00:00`); return Number.isNaN(+t) ? d : t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const teamBit = (abbr) => (abbr ? h('a', { class: 'tx-team', href: `#/team/${abbr}` }, teamLogo(abbr, 20), h('b', null, displayCode(abbr))) : null);

// One table of moves; used by the league page and by the team page's Transactions tab.
export function txTable(events, { emptyText = 'No transactions recorded yet' } = {}) {
  if (!events.length) return emptyState(emptyText, 'Transactions are worked out by comparing saved rosters between syncs, so they start from your first sync after this update. Dates are the day the change was picked up.');
  return h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl tx' },
    h('thead', null, h('tr', null, ['Date', 'Move', 'Player', 'Pos', 'From', 'To'].map((c) => h('th', null, c)))),
    h('tbody', null, events.map((e) => h('tr', null,
      h('td', null, fmtDate(e.date)),
      h('td', null, h('span', { class: `chip tx-${e.type}` }, TYPES[e.type] || e.type)),
      h('td', null, h('a', { class: 'plink', href: `#/player/${e.id}` }, h('b', null, e.name))),
      h('td', null, e.pos || ''),
      h('td', null, teamBit(e.from) || h('span', { class: 'muted' }, e.type === 'signed' ? 'Free agent' : '–')),
      h('td', null, teamBit(e.to) || h('span', { class: 'muted' }, e.type === 'released' ? 'Free agent' : '–')))))));
}

function draw({ el }) {
  const T = S.state.transactions;
  const all = T ? T.events : [];
  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Filter' },
    [['all', 'All'], ['trade', 'Trades'], ['signed', 'Signings'], ['released', 'Waivers']].map(([k, label]) => h('button', {
      type: 'button', role: 'tab', 'aria-selected': filter === k ? 'true' : 'false', class: filter === k ? 'active' : '', onclick: () => {
        filter = k; try { localStorage.setItem(FILTER_KEY, k); } catch (e) { /* ignore */ }
        draw({ el });
      } }, label)));
  const list = filter === 'all' ? all : all.filter((e) => e.type === filter);
  const head = h('div', { class: 'section-head' }, h('h2', null, 'Transactions', h('small', null, T ? `${all.length} recorded` : '')), seg);
  el.replaceChildren(head, T ? txTable(list) : emptyState('Loading…'));
}
