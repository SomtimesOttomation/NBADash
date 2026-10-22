import * as S from '../store.js';
import { h, ago } from '../util.js';
import { displayCode } from '../arenas.js';
import { teamLogo, sectionHead, emptyState } from '../components.js';

export function mount(ctx) { S.loadStandings().then(() => draw(ctx)); draw(ctx); }
export function update(topics, ctx) { if (topics.has('standings') || topics.has('favorites')) draw(ctx); }

const COLS = [['W', 'wins'], ['L', 'losses'], ['PCT', 'winPercent'], ['GB', 'gamesBehind'], ['HOME', 'Home'], ['AWAY', 'Road'], ['L10', 'Last Ten Games'], ['STRK', 'streak']];
const pick = (stats, key) => {
  const k = Object.keys(stats).find((x) => x.toLowerCase() === key.toLowerCase());
  return k ? stats[k] : '';
};

function draw({ el }) {
  const st = S.state.standings;
  if (!st) { el.replaceChildren(emptyState('Standings not cached yet', 'They arrive with the next sync.')); return; }
  const fav = S.favSet();
  const out = [h('div', { class: 'section-head' }, h('h2', null, 'Standings', h('small', null, `Updated ${ago(Date.parse(st.syncedAt))}`)))];
  const wrap = h('div', { class: 'two' });
  for (const c of st.conferences) {
    const teams = [...c.teams].sort((a, b) => parseFloat(pick(b.stats, 'winPercent')) - parseFloat(pick(a.stats, 'winPercent')));
    wrap.append(h('div', null, sectionHead(c.name),
      h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Team'), COLS.map(([l]) => h('th', null, l)))),
        h('tbody', null, teams.map((t, i) => h('tr', { class: fav.has(t.abbr) ? 'me' : '', style: { cursor: 'pointer' }, onclick: () => { location.hash = `#/team/${t.abbr}`; } },
          h('td', null, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, h('small', null, i + 1), teamLogo(t.abbr, 24), h('b', null, displayCode(t.abbr)))),
          COLS.map(([, k]) => h('td', null, pick(t.stats, k))))))))));
  }
  out.push(wrap);
  el.replaceChildren(...out);
}
