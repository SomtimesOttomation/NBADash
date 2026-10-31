import * as S from '../store.js';
import { h, ago } from '../util.js';
import { displayCode } from '../arenas.js';
import { teamLogo, sectionHead, emptyState } from '../components.js';
import { eastWestReport } from './eastwest.js';

export function mount(ctx) { S.loadStandings().then(() => draw(ctx)); S.loadDay(S.todayKey()).then(() => draw(ctx)); S.loadLeague().then(() => draw(ctx)); draw(ctx); }
export function update(topics, ctx) { if (topics.has('standings') || topics.has('favorites') || topics.has('days') || topics.has('live') || topics.has('settings') || topics.has('league') || topics.has('settings')) draw(ctx); }

const COLS = [['W', 'wins'], ['L', 'losses'], ['PCT', 'winPercent'], ['GB', 'gamesBehind'], ['HOME', 'Home'], ['AWAY', 'Road'], ['L10', 'Last Ten Games'], ['STRK', 'streak']];
const pick = (stats, key) => {
  const k = Object.keys(stats).find((x) => x.toLowerCase() === key.toLowerCase());
  return k ? stats[k] : '';
};

// Win percentage first. Teams on the same percentage (everyone 1-0 on opening week) rank by games above .500, so 2-0 is ahead of 1-0
// and 0-0 is ahead of 0-1, which is the same order as games behind. Anything still level keeps ESPN's own order.
export function sortStandings(teams) {
  const n = (st, k) => { const v = parseFloat(pick(st, k)); return Number.isFinite(v) ? v : 0; };
  return teams.map((t, i) => ({ t, i, pct: n(t.stats, 'winPercent'), diff: n(t.stats, 'wins') - n(t.stats, 'losses'), w: n(t.stats, 'wins') }))
    .sort((a, b) => (b.pct - a.pct) || (b.diff - a.diff) || (b.w - a.w) || (a.i - b.i)).map((x) => x.t);
}

// Today's games not yet final: where each team would sit in its conference with a win or a loss, everything else
// unchanged (an opponent from the same conference gets the opposite result). Uses the same order as the table.
function swings(conf) {
  const day = S.state.days.get(S.todayKey());
  const games = (day ? day.events : []).filter((e) => e.state === 'pre' || e.state === 'in');
  const now = sortStandings(conf.teams).map((t) => t.abbr);
  const out = new Map();
  const bump = (t, w) => {
    const st = { ...t.stats };
    const k = (name) => Object.keys(st).find((x) => x.toLowerCase() === name) || name;
    const W = (parseFloat(st[k('wins')]) || 0) + (w ? 1 : 0), L = (parseFloat(st[k('losses')]) || 0) + (w ? 0 : 1);
    st[k('wins')] = String(W); st[k('losses')] = String(L); st[k('winpercent')] = String(W + L ? W / (W + L) : 0);
    return { ...t, stats: st };
  };
  const rankIf = (abbr, win, opp) => {
    const teams = conf.teams.map((t) => (t.abbr === abbr ? bump(t, win) : t.abbr === opp ? bump(t, !win) : t));
    return sortStandings(teams).findIndex((t) => t.abbr === abbr);
  };
  for (const g of games) {
    const [a, b] = g.sides.map((s) => s.abbr);
    for (const [me, opp] of [[a, b], [b, a]]) {
      if (!now.includes(me)) continue;
      const cur = now.indexOf(me);
      out.set(me, { win: cur - rankIf(me, true, opp), loss: cur - rankIf(me, false, opp), live: g.state === 'in' });
    }
  }
  return out;
}
const move = (n) => (n > 0 ? h('span', { class: 'sw-up' }, `▲${n}`) : n < 0 ? h('span', { class: 'sw-dn' }, `▼${-n}`) : h('span', { class: 'sw-eq' }, '–'));
const swingTag = (s) => h('small', { class: `sw ${s.live ? 'live' : ''}`, title: `Playing today${s.live ? ' (live)' : ''}: with a win ${s.win > 0 ? `up ${s.win}` : s.win < 0 ? `down ${-s.win}` : 'no change'}, with a loss ${s.loss < 0 ? `down ${-s.loss}` : s.loss > 0 ? `up ${s.loss}` : 'no change'}. Other games today not counted.` },
  '(W ', move(s.win), ' · L ', move(s.loss), ')');

function draw({ el }) {
  const st = S.state.standings;
  if (!st) { el.replaceChildren(emptyState('Standings not cached yet', 'They arrive with the next sync.')); return; }
  const fav = S.favSet();
  const out = [h('div', { class: 'section-head' }, h('h2', null, 'Standings', h('small', null, `Updated ${ago(Date.parse(st.syncedAt))}`)))];
  const wrap = h('div', { class: 'two' });
  for (const c of st.conferences) {
    const teams = sortStandings(c.teams);
    const sw = S.state.settings.showSwings ? swings(c) : new Map();
    wrap.append(h('div', null, sectionHead(c.name),
      h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Team'), COLS.map(([l]) => h('th', null, l)))),
        h('tbody', null, teams.map((t, i) => h('tr', { class: fav.has(t.abbr) ? 'me' : '', style: { cursor: 'pointer' }, onclick: () => { location.hash = `#/team/${t.abbr}`; } },
          h('td', null, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } }, h('small', null, i + 1), teamLogo(t.abbr, 24), h('b', null, displayCode(t.abbr)), sw.has(t.abbr) ? swingTag(sw.get(t.abbr)) : null)),
          COLS.map(([, k]) => h('td', null, pick(t.stats, k))))))))));
  }
  out.push(wrap, eastWestReport());
  el.replaceChildren(...out);
}
