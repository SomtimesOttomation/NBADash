import * as S from '../store.js';
import { h, fmtKey } from '../util.js';
import { gameCard, sortEvents, sectionHead, emptyState, skeletonCards } from '../components.js';
import { signedNotice } from './freeagents.js';

export function mount(ctx) { draw(ctx); S.loadDay(S.todayKey()); S.loadDay(S.yesterdayKey()); S.loadFreeAgents().then(() => draw(ctx)); }
export function update(topics, ctx) {
  if (['days', 'favorites', 'watch', 'teams', 'sync', 'box', 'fa'].some((t) => topics.has(t))) draw(ctx);
}

function section(key, title, ctx) {
  const d = S.state.days.get(key);
  if (!d) return null;
  return { key, title, events: sortEvents(d.events) };
}

function draw({ el }) {
  const today = S.todayKey(), yest = S.yesterdayKey();
  const sections = [section(today, 'Today', el), section(yest, 'Last night', el)].filter(Boolean);
  const out = [];
  const fav = S.favSet();
  const favGames = sections.flatMap((s) => s.events).filter((e) => e.sides.some((x) => fav.has(x.abbr)));
  if (fav.size === 0) out.push(h('div', { class: 'card pad', style: { marginBottom: '18px' } },
    h('b', null, 'Pick your teams. '), 'Click the ☆ on any logo above: favorites move to the front and their games are shown first.'));
  for (const s of sections) {
    const live = s.events.filter((e) => e.state === 'in').length;
    out.push(sectionHead(s.title, `${fmtKey(s.key)} · ${s.events.length} game${s.events.length === 1 ? '' : 's'}${live ? ` · ${live} live` : ''}`));
    out.push(s.events.length
      ? h('div', { class: 'grid' }, s.events.map((e) => gameCard(e)))
      : emptyState('No games', 'Nothing scheduled for this day.'));
  }
  if (!S.state.settings.autoRefresh && S.state.host) {
    out.unshift(h('div', { class: 'card pad', style: { marginBottom: '18px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' } },
      h('span', null, h('b', null, 'Automatic refresh is off. '), 'Scores only update when you ask. Use the ', h('b', null, '\u21bb'), ' button (or F5) for the latest scores, or '),
      h('button', { class: 'btn', type: 'button', onclick: () => S.runSync('all') }, 'Run a full sync'),
      h('button', { class: 'btn', type: 'button', onclick: () => import('./settings.js').then((m) => m.openSettings()) }, 'Automatic refresh options')));
  }
  if (!sections.length) out.push(S.state.ready ? emptyState('Nothing cached yet', S.state.settings.autoRefresh ? 'Run a sync (settings) or wait for live scores to load.' : 'Press the refresh button (top right) or run a full sync to download scores and teams.') : skeletonCards(6));
  const fa = signedNotice();
  if (fa) out.unshift(fa);
  el.replaceChildren(...out);
  void favGames;
}
