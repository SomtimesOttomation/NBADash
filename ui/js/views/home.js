import * as S from '../store.js';
import { h, fmtKey } from '../util.js';
import { gameCard, sortEvents, sectionHead, emptyState, skeletonCards } from '../components.js';

export function mount(ctx) { draw(ctx); S.loadDay(S.todayKey()); S.loadDay(S.yesterdayKey()); }
export function update(topics, ctx) {
  if (['days', 'favorites', 'watch', 'teams', 'sync'].some((t) => topics.has(t))) draw(ctx);
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
  if (!sections.length) out.push(S.state.ready ? emptyState('Nothing cached yet', 'Run a sync (settings) or wait for live scores to load.') : skeletonCards(6));
  el.replaceChildren(...out);
  void favGames;
}
