// Shared building blocks: logos, status pills, game cards, the team banner.
import { h, asArray, fmtTime, fmtDayShort, etKey, num } from './util.js';
import * as S from './store.js';
import * as bridge from './bridge.js';
import { displayCode } from './arenas.js';
import { fmtValue } from './stats.js';
import { calc } from './formulas.js';

export const teamColor = (t) => (t && t.color ? `#${t.color}` : '#6b7280');

// ---- logo ------------------------------------------------------------------------------------
export function teamLogo(abbr, size = 40) {
  const t = S.team(abbr);
  const wrap = h('span', { class: 'logo', style: { '--s': `${size}px`, '--tc': teamColor(t) }, 'data-abbr': abbr });
  const img = h('img', { src: bridge.logoUrl(abbr), alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' });
  let tried = false;
  img.addEventListener('error', () => {
    if (!tried && bridge.isHost) { tried = true; img.src = bridge.logoFallbackUrl(abbr); return; }
    img.remove();
    wrap.classList.add('logo-fallback');
    wrap.append(displayCode(abbr).slice(0, 3));
  });
  wrap.append(img);
  return wrap;
}

// Player photo with an initials fallback. `src` may be empty.
export function avatar(name, src, size = 40) {
  const initials = String(name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const wrap = h('span', { class: 'avatar', style: { '--s': `${size}px` }, title: name }, initials);
  if (src) {
    const img = h('img', { src, alt: '', width: size, height: size, decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    wrap.append(img);
  }
  return wrap;
}

export function teamName(abbr) {
  const t = S.team(abbr);
  return t ? t.name : abbr;
}

// ---- status ------------------------------------------------------------------------------------
export function periodLabel(p) {
  p = Number(p) || 0;
  if (p <= 4) return `Q${p}`;
  return p === 5 ? 'OT' : `${p - 4}OT`;
}

export function statusInfo(ev) {
  const today = S.todayKey();
  if (ev.state === 'in') {
    const d = String(ev.detail || '');
    let text;
    if (/half/i.test(d)) text = 'HALFTIME';
    else if (/^end/i.test(d)) {
      // "End of 1st Quarter" -> "END Q1", "End of 2nd OT" -> "END 2OT"
      const m = d.match(/(\d)(?:st|nd|rd|th)\s*(ot|overtime|quarter|qtr)?/i);
      text = m ? (/ot/i.test(m[2] || '') ? `END ${m[1] === '1' ? '' : m[1]}OT` : `END Q${m[1]}`) : d.toUpperCase();
    }
    else text = `${periodLabel(ev.period)}${ev.clock ? ' ' + ev.clock : ''}`;
    return { kind: 'live', text, label: 'LIVE' };
  }
  if (ev.state === 'post') {
    const p = Number(ev.period) || 4;
    return { kind: 'final', text: p > 4 ? `FINAL / ${periodLabel(p)}` : 'FINAL', label: '' };
  }
  const dayKey = etKey(new Date(ev.date));
  const when = dayKey === today ? fmtTime(ev.date) : `${fmtDayShort(ev.date)} ${fmtTime(ev.date)}`;
  const detail = String(ev.detail || '');
  if (/postponed|canceled|cancelled|delayed/i.test(detail)) return { kind: 'pre', text: detail.toUpperCase(), label: '' };
  return { kind: 'pre', text: when, label: '' };
}

export function statusPill(ev) {
  const s = statusInfo(ev);
  return h('span', { class: `pill pill-${s.kind}` },
    s.kind === 'live' ? h('i', { class: 'dot', 'aria-hidden': 'true' }) : null,
    s.kind === 'live' ? h('b', null, 'LIVE') : null,
    h('span', null, s.text));
}

// ---- star ------------------------------------------------------------------------------------------
export function starButton(abbr, cls = '') {
  const on = S.isFav(abbr);
  return h('button', {
    class: `star ${on ? 'on' : ''} ${cls}`, type: 'button',
    title: on ? 'Remove from favorites' : 'Add to favorites', 'aria-pressed': on ? 'true' : 'false',
    onclick: (e) => { e.preventDefault(); e.stopPropagation(); S.toggleFavorite(abbr); },
  }, on ? '★' : '☆');
}

// ---- ordering -----------------------------------------------------------------------------------------
export function sortEvents(events) {
  const fav = S.favSet();
  const rank = (e) => (e.sides.some((s) => fav.has(s.abbr)) ? 0 : 1);
  const st = (e) => (e.state === 'in' ? 0 : e.state === 'pre' ? 1 : 2);
  return [...events].sort((a, b) => rank(a) - rank(b) || st(a) - st(b) || Date.parse(a.date) - Date.parse(b.date));
}

// ---- game card ------------------------------------------------------------------------------------------
function leaderLine(ev) {
  // the points leader of whichever side scored more, then the other side's
  const out = [];
  for (const sd of ev.sides) {
    const l = sd.leaders.find((x) => /point/i.test(x.cat));
    if (l && l.player) out.push([`${sd.abbr === undefined ? '' : displayCode(sd.abbr)} `, playerLink(l.playerId, lastName(l.player)), ` ${l.value}`]);
  }
  return out;
}
// A player's name as a link to their page. Inside clickable cards it must not also trigger the card.
export function playerLink(id, content, attrs = {}) {
  if (!id) return h('span', attrs, content);
  return h('a', { class: `plink ${attrs.class || ''}`.trim(), href: `#/player/${id}`, onclick: (e) => e.stopPropagation() }, content);
}
const lastName = (n) => String(n).split(' ').slice(-1)[0];

function sideRow(ev, sd, opts) {
  const t = S.team(sd.abbr);
  const flash = S.state.flash.get(`${ev.id}:${sd.side}`);
  const justScored = flash && Date.now() - flash < 4000;
  const scoreNum = num(sd.score);
  const other = ev.sides.find((x) => x !== sd);
  const oScore = other ? num(other.score) : NaN;
  const winner = ev.state === 'post' && Number.isFinite(scoreNum) && Number.isFinite(oScore) && scoreNum > oScore;
  const loser = ev.state === 'post' && Number.isFinite(scoreNum) && Number.isFinite(oScore) && scoreNum < oScore;
  const focus = opts.focus === sd.abbr;
  return h('div', { class: `side ${winner ? 'win' : ''} ${loser ? 'lose' : ''} ${focus ? 'focus' : ''}`, style: { '--tc': teamColor(t) } },
    h('a', { class: 'side-team', href: `#/team/${sd.abbr}`, onclick: (e) => e.stopPropagation(), title: sd.name || teamName(sd.abbr) },
      teamLogo(sd.abbr, opts.wide ? 88 : 68),
      h('span', { class: 'side-names' },
        h('b', null, opts.wide ? (sd.name || teamName(sd.abbr)) : displayCode(sd.abbr)),
        h('small', null, [opts.wide ? displayCode(sd.abbr) : '', sd.record ? sd.record : ''].filter(Boolean).join(' · ')))),
    ev.state === 'pre' ? h('span', { class: 'score muted' }, '–')
      : h('span', { class: `score ${justScored ? 'bump' : ''}` }, sd.score ?? '–'));
}

export function gameCard(ev, opts = {}) {
  const away = S.side(ev, 'away') || ev.sides[0];
  const home = S.side(ev, 'home') || ev.sides[1];
  const fav = S.favSet();
  const isFavGame = [away, home].some((s) => s && fav.has(s.abbr));
  const watched = S.state.watch.has(ev.id);
  const leaders = ev.state === 'pre' ? [] : leaderLine(ev);
  const card = h('article', {
    class: `card game ${ev.state} ${opts.wide ? 'wide' : ''} ${isFavGame ? 'fav' : ''}`,
    tabindex: '0', role: 'link', 'aria-label': `${away?.name || ''} at ${home?.name || ''}`,
    onclick: () => { location.hash = `#/game/${ev.id}`; },
    onkeydown: (e) => { if (e.key === 'Enter') location.hash = `#/game/${ev.id}`; },
  },
    h('header', { class: 'game-head' },
      statusPill(ev),
      h('span', { class: 'game-head-right' },
        ev.state === 'in' ? h('button', {
          class: `watch ${watched ? 'on' : ''}`, type: 'button',
          title: S.state.settings.autoRefresh ? (watched ? 'Stop live box score' : 'Watch live box score') : 'Fetch the box score once (automatic refresh is off)',
          onclick: (e) => { e.stopPropagation(); S.setWatch(ev.id, !watched); },
        }, S.state.settings.autoRefresh ? (watched ? '● Watching' : '○ Watch') : '↻ Box score') : null,
        isFavGame ? h('span', { class: 'fav-tag', title: 'Favorite team' }, '★') : null)),
    h('div', { class: 'sides' }, away ? sideRow(ev, away, opts) : null, home ? sideRow(ev, home, opts) : null),
    lastScoreLine(ev),
    h('footer', { class: 'game-foot' },
      leaders.length ? h('span', { class: 'leaders' }, 'Scoring Leaders: ', leaders.map((x, i) => [i ? '   ' : '', x])) :
        h('span', { class: 'venue' }, [ev.venue].filter(Boolean).join(''))));
  return card;
}

// Latest basket for a live game, e.g. "+3  Tyrese Maxey makes 26-foot three point jumper (Joel Embiid assists)  Q2 5:21".
// Comes from the box score fetch, so it only shows once a box score has been loaded for the game.
function lastScoreLine(ev) {
  if (ev.state !== 'in') return null;
  const ls = S.state.boxes.get(String(ev.id))?.lastScore;
  if (!ls || !ls.text) return null;
  const kind = ls.value === 3 ? '3PT' : ls.value === 1 ? 'FT' : ls.value === 2 ? '2PT' : '';
  return h('div', { class: 'lastscore', title: 'Most recent basket' },
    h('span', { class: `ls-pts v${ls.value}` }, `+${ls.value}${kind ? ' ' + kind : ''}`),
    h('span', { class: 'ls-text' }, ls.text),
    h('span', { class: 'ls-when' }, `${periodLabel(ls.period)} ${ls.clock}`));
}

// ---- banner ------------------------------------------------------------------------------------------------
// "Week 1 | Week 2 | ..." under the team banner; only weeks that have saved games are linked.
export function renderWeekBar(el, activeWeek) {
  const weeks = S.weeksWithData();
  el.hidden = weeks.length === 0;
  el.replaceChildren(h('span', { class: 'weekbar-label' }, 'Season'),
    ...weeks.map((n) => h('a', { class: `weeklink ${n === activeWeek ? 'active' : ''}`, href: `#/week/${n}`, title: S.weekRangeLabel(n) }, `Week ${n}`)));
}

export function renderBanner(el, activeAbbr) {
  const { favorites, others } = S.orderedTeams();
  el.replaceChildren();
  const strip = h('div', { class: 'banner-strip', role: 'list' });
  const tile = (t, isFav) => h('a', {
    class: `tile ${isFav ? 'fav' : ''} ${t.abbr === activeAbbr ? 'active' : ''}`, href: `#/team/${t.abbr}`, role: 'listitem',
    title: t.name, style: { '--tc': teamColor(t) },
  }, starButton(t.abbr, 'tile-star'), teamLogo(t.abbr, 92), h('span', { class: 'tile-code' }, displayCode(t.abbr)));
  favorites.forEach((t) => strip.append(tile(t, true)));
  if (favorites.length) strip.append(h('span', { class: 'banner-divider', 'aria-hidden': 'true' }));
  others.forEach((t) => strip.append(tile(t, false)));

  const scroll = (dir) => strip.scrollBy({ left: dir * Math.max(300, strip.clientWidth * 0.8), behavior: 'smooth' });
  const left = h('button', { class: 'banner-btn left', type: 'button', 'aria-label': 'Scroll teams left', onclick: () => scroll(-1) }, '‹');
  const right = h('button', { class: 'banner-btn right', type: 'button', 'aria-label': 'Scroll teams right', onclick: () => scroll(1) }, '›');
  strip.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { strip.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  const update = () => {
    left.classList.toggle('hide', strip.scrollLeft < 8);
    right.classList.toggle('hide', strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 8);
  };
  strip.addEventListener('scroll', update, { passive: true });
  el.append(left, strip, right);
  requestAnimationFrame(() => {
    const active = strip.querySelector('.tile.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
    update();
  });
}

// ---- small pieces ------------------------------------------------------------------------------------------------
export const emptyState = (title, body, action) =>
  h('div', { class: 'empty' }, h('h3', null, title), body ? h('p', null, body) : null, action || null);

export function skeletonCards(n = 3) {
  return h('div', { class: 'grid' }, Array.from({ length: n }, () => h('div', { class: 'card skeleton' })));
}

export function sectionHead(title, sub, right) {
  return h('div', { class: 'section-head' },
    h('h2', null, title, sub ? h('small', null, sub) : null),
    right || null);
}

export { asArray };

// ---- leaders (team and league views) ------------------------------------------------------------------
export const headshotUrl = (id) => `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;
const rowSub = (r, showTeam) => [showTeam && r.team ? displayCode(r.team) : '', r.sub].filter(Boolean).join(' \u00b7 ');

// Card view: one card per category with the top players listed inside.
export function leaderCardGrid(cards, { showTeam = false } = {}) {
  return h('div', { class: 'leaders-grid' }, cards.map((c) => h('section', { class: 'card leader-card' },
    h('header', null, h('h3', null, h('span', calc(c.key, 'player'), c.title)), h('small', null, c.unit)),
    c.rows.length ? h('ol', null, c.rows.map((r, i) => h('li', { class: i === 0 ? 'first' : '' },
      h('span', { class: 'rk' }, i + 1),
      avatar(r.name, headshotUrl(r.id), i === 0 ? 44 : 32),
      h('span', { class: 'nm' }, h('b', null, playerLink(r.id, r.name)), h('small', null, showTeam && r.team
        ? h('span', { class: 'nm-team' }, teamLogo(r.team, 14), rowSub(r, true)) : rowSub(r, false))),
      h('span', { class: 'val' }, r.text || fmtValue(r.value, c)))))
      : h('p', { class: 'muted pad' }, 'Not enough data yet'))));
}

const ORD = ['Leader', '2nd', '3rd', '4th', '5th'];

// Row view: each category is a heading followed by one centred row of player cards (1st to 5th).
export function leaderRowSections(cards, { worst = false } = {}) {
  return h('div', { class: 'lrows' }, cards.map((c) => h('section', { class: 'lrow' },
    h('div', { class: 'section-head' }, h('h2', null, h('span', calc(c.key, 'player'), c.title), h('small', null, c.unit))),
    c.rows.length ? h('div', { class: 'pog-row' }, c.rows.map((r, i) => h('div', { class: `lcard ${i === 0 ? 'first' : ''}` },
      h('span', { class: 'pog-badge' }, i === 0 ? (worst ? '\u25be Worst' : '\u2605 Leader') : ORD[i]),
      avatar(r.name, headshotUrl(r.id), 64),
      h('b', { class: 'lcard-name' }, playerLink(r.id, r.name)),
      h('span', { class: 'pog-team' }, r.team ? teamLogo(r.team, 18) : null, r.team ? displayCode(r.team) : ''),
      h('span', { class: 'lcard-val' }, r.text || fmtValue(r.value, c)),
      h('small', { class: 'muted' }, r.sub))))
      : h('p', { class: 'muted', style: { textAlign: 'center' } }, 'Not enough data yet'))));
}
