import * as S from '../store.js';
import { h, fmtKey } from '../util.js';
import { gameCard, sortEvents, sectionHead, emptyState, avatar, headshotUrl, playerLink, teamLogo } from '../components.js';
import { lineOf, played, gameScore } from '../stats.js';
import { displayCode } from '../arenas.js';
import { calc } from '../formulas.js';

let week = 0;
export function mount(ctx) {
  week = Math.max(1, parseInt(ctx.arg, 10) || 1);
  Promise.all(S.weekDayKeys(week).map((k) => S.loadDay(k))).then(() => loadWeekBoxes(ctx));
  S.loadStandings().then(() => draw(ctx));
  draw(ctx);
}

// Players of the week from the saved box scores of that week's finished games.
let weekBoxes = { week: 0, boxes: [] };
async function loadWeekBoxes(ctx) {
  const w = week;
  await S.refreshCachedBoxes();
  const ids = S.weekDayKeys(w).flatMap((k) => (S.state.days.get(k)?.events || []).filter((e) => e.state === 'post').map((e) => e.id))
    .filter((id) => S.state.cachedBoxIds.has(String(id)));
  const boxes = (await Promise.all(ids.map((id) => S.loadBoxFile(id)))).filter(Boolean);
  if (w === week) { weekBoxes = { week: w, boxes }; draw(ctx); }
}

// Best: highest Game Score per game. Worst is kept fair: only rotation players (20+ minutes a game, and at least
// 2 games or every game their team played that week), so end-of-bench and garbage-time minutes never count.
export const POW = { minMpg: 20, minGames: 2, garbageMin: 8 };
function playersOfWeek(boxes, only) {
  const P = new Map(), teamGames = new Map();
  for (const b of boxes) for (const t of b.teams) {
    teamGames.set(t.team, (teamGames.get(t.team) || 0) + 1);
    for (const p of t.players) {
      if (!played(p)) continue;
      const l = lineOf(t.labels, p.stats);
      if (!(l.min >= POW.garbageMin)) continue;                       // a few garbage-time minutes are not a real game
      const e = P.get(p.id) || { id: p.id, name: p.name, team: t.team, gp: 0, min: 0, gs: 0, pts: 0, reb: 0, ast: 0, fgm: 0, fga: 0 };
      e.gp++; e.min += l.min; e.gs += gameScore(l); e.pts += l.pts; e.reb += l.reb; e.ast += l.ast; e.fgm += l.fgm; e.fga += l.fga; e.team = t.team;
      P.set(p.id, e);
    }
  }
  const all = [...P.values()].filter((e) => !only || only.has(e.team)).map((e) => ({ ...e, v: e.gs / e.gp, mpg: e.min / e.gp }));
  const rotation = all.filter((e) => e.mpg >= POW.minMpg && e.gp >= Math.min(POW.minGames, teamGames.get(e.team) || 1));
  const best = rotation.slice().sort((a, b) => b.v - a.v || b.min - a.min).slice(0, 3);
  const worst = rotation.filter((e) => !best.includes(e)).sort((a, b) => a.v - b.v || b.min - a.min).slice(0, 3);
  return { best, worst, n: rotation.length };
}

function powCard(title, list, worst) {
  return h('section', { class: 'card leader-card pow-card' },
    h('header', null, h('h3', null, h('span', calc('gamescore'), title)), h('small', null, 'Game Score per game')),
    list.length ? h('ol', null, list.map((e, i) => h('li', { class: i === 0 ? 'first' : '' },
      h('span', { class: 'rk' }, i + 1), avatar(e.name, headshotUrl(e.id), i === 0 ? 44 : 32),
      h('span', { class: 'nm' }, h('b', null, playerLink(e.id, e.name)),
        h('small', null, h('span', { class: 'nm-team' }, teamLogo(e.team, 14), `${displayCode(e.team)} \u00b7 ${e.gp} GP \u00b7 ${(e.pts / e.gp).toFixed(1)} PTS \u00b7 ${(e.reb / e.gp).toFixed(1)} REB \u00b7 ${(e.ast / e.gp).toFixed(1)} AST \u00b7 ${e.fga ? Math.round(100 * e.fgm / e.fga) : 0}% FG \u00b7 ${Math.round(e.mpg)} MIN`))),
      h('span', { class: 'val' }, e.v.toFixed(1)))))
      : h('p', { class: 'muted pad' }, worst ? 'Not enough rotation players yet' : 'No finished games yet'));
}
export function update(topics, ctx) { if (['days', 'favorites', 'watch', 'teams', 'box', 'standings'].some((t) => topics.has(t))) draw(ctx); }

function draw({ el }) {
  const keys = S.weekDayKeys(week).slice().reverse().filter((k) => S.state.cachedDayKeys.includes(k) || S.state.days.has(k));
  const out = [sectionHead(`Week ${week}`, S.weekRangeLabel(week))];
  let games = 0;
  for (const k of keys) {
    const d = S.state.days.get(k);
    if (!d) continue;
    const events = sortEvents(d.events);
    if (!events.length) continue;
    games += events.length;
    out.push(sectionHead(fmtKey(k), `${events.length} game${events.length === 1 ? '' : 's'}`), h('div', { class: 'grid' }, events.map((e) => gameCard(e))));
  }
  if (weekBoxes.week === week && weekBoxes.boxes.length) {
    // split by conference when the standings are cached; league-wide otherwise
    const confs = (S.state.standings && S.state.standings.conferences) || [];
    const east = confs.find((c) => /east/i.test(c.name || '')), west = confs.find((c) => c !== east);
    let cards;
    if (east && west) {
      const set = (c) => new Set(c.teams.map((t) => t.abbr));
      const E = playersOfWeek(weekBoxes.boxes, set(east)), W = playersOfWeek(weekBoxes.boxes, set(west));
      cards = [powCard('East \u00b7 Best of the week', E.best, false), powCard('West \u00b7 Best of the week', W.best, false),
        powCard('East \u00b7 Worst of the week', E.worst, true), powCard('West \u00b7 Worst of the week', W.worst, true)];
    } else {
      const r = playersOfWeek(weekBoxes.boxes);
      cards = [powCard('Best of the week', r.best, false), powCard('Worst of the week', r.worst, true)];
    }
    out.splice(1, 0, h('div', { class: 'pow pow-split' }, cards),
      h('p', { class: 'muted pow-note' }, `From ${weekBoxes.boxes.length} saved box score${weekBoxes.boxes.length === 1 ? '' : 's'}. Worst only counts rotation players: 20+ minutes a game and at least 2 games (or every game their team played), and games under 8 minutes are ignored.`));
  }
  if (!games) out.push(emptyState('No games saved for this week', 'Use "Fill in season history" in settings to download them.'));
  el.replaceChildren(...out);
}
