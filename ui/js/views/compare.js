import * as S from '../store.js';
import { h } from '../util.js';
import { teamLogo, avatar, emptyState, headshotUrl } from '../components.js';
import { displayCode } from '../arenas.js';
import { currentRow, seasonRow, pick, show, numeric, heightText, weightText, COMPARE_ROWS } from '../players.js';

let basis = 'current';          // current | previous | career

const ids = (arg) => [...new Set(String(arg || '').split(',').map((x) => x.trim()).filter((x) => /^\d+$/.test(x)))].slice(0, S.COMPARE_MAX);

export function mount(ctx) {
  ids(ctx.arg).forEach((id) => S.loadPlayer(id));
  draw(ctx);
}
export function update(topics, ctx) {
  if (ids(ctx.arg).some((id) => topics.has(`player:${id}`)) || topics.has('teams')) draw(ctx);
}

function rowFor(p) {
  if (basis === 'career') return { avg: p.career.avg, misc: p.career.misc, tot: p.career.tot, label: 'Career' };
  const r = basis === 'previous' ? seasonRow(p, p.season - 1) : currentRow(p);
  return r ? { ...r, label: r.season } : null;
}

function draw({ el, arg }) {
  const list = ids(arg);
  if (list.length < 2) {
    el.replaceChildren(emptyState('Pick at least two players', 'Search for a player, open their page and use “Add to comparison”, or use + Compare in the search results.'));
    return;
  }
  const entries = list.map((id) => ({ id, e: S.state.players.get(id) }));
  const loaded = entries.filter((x) => x.e?.player);
  if (loaded.length < entries.length && entries.some((x) => !x.e || x.e.loading)) {
    el.replaceChildren(h('div', { class: 'card pad' }, h('div', { class: 'skeleton', style: { height: '260px' } })));
    return;
  }
  const players = loaded.map((x) => x.e.player);
  const failed = entries.filter((x) => !x.e?.player);
  const rows = players.map(rowFor);
  const seasonName = players[0]?.seasonName || 'This season';
  const basisName = basis === 'career' ? 'Career per game' : basis === 'previous' ? 'Last season per game' : `${seasonName} per game`;

  const seg = h('div', { class: 'seg' }, [['current', seasonName], ['previous', 'Last season'], ['career', 'Career']].map(([k, label]) =>
    h('button', { type: 'button', class: basis === k ? 'active' : '', onclick: () => { basis = k; draw({ el, arg }); } }, label)));

  const head = h('tr', null, h('th', null, ''), players.map((p) => {
    const b = p.bio;
    return h('th', { class: 'cmp-head' },
      h('button', { class: 'cmp-x', type: 'button', title: 'Remove from comparison', onclick: () => {
        S.toggleCompare({ id: b.id }); const rest = S.state.compare.map((c) => c.id);
        location.hash = rest.length >= 2 ? `#/compare/${rest.join(',')}` : rest.length === 1 ? `#/player/${rest[0]}` : '#/';
      } }, '×'),
      h('a', { href: `#/player/${b.id}`, class: 'cmp-who' }, avatar(b.name, b.headshot || headshotUrl(b.id), 72), h('b', null, b.name)),
      h('small', { class: 'muted' }, b.team ? h('span', { class: 'inline-team' }, teamLogo(b.team, 14), displayCode(b.team)) : '', [b.pos, b.jersey ? `#${b.jersey}` : ''].filter(Boolean).join(' · ')));
  }));

  const text = (label, fn) => h('tr', { class: 'bio-row' }, h('th', { scope: 'row' }, label), players.map((p) => h('td', null, fn(p.bio) || '–')));
  const bio = [h('tr', { class: 'grp' }, h('td', { colspan: players.length + 1 }, 'Bio')),
    text('Age', (b) => (b.age != null ? String(b.age) : '')), text('Height', (b) => heightText(b.height)), text('Weight', (b) => weightText(b.weight)),
    text('Experience', (b) => b.experience), text('Draft', (b) => b.draft)];

  const stats = [h('tr', { class: 'grp' }, h('td', { colspan: players.length + 1 }, basisName))];
  if (basis !== 'career') {
    stats.push(h('tr', { class: 'bio-row' }, h('th', { scope: 'row' }, 'Season'), players.map((p, i) => h('td', null, rows[i] ? rows[i].label : h('span', { class: 'muted' }, 'No games')))));
  }
  COMPARE_ROWS.forEach((g) => {
    stats.push(h('tr', { class: 'grp sub' }, h('td', { colspan: players.length + 1 }, g.group)));
    g.rows.forEach((def) => {
      const vals = players.map((p, i) => {
        const r = rows[i];
        return r ? pick(p, def.kind, def.kind === 'misc' ? r.misc : r.avg, def.label) : null;
      });
      if (vals.every((v) => v == null)) return;
      const nums = vals.map(numeric);
      const good = nums.filter((n) => n != null);
      const best = def.plain || good.length < 2 ? null : (def.lower ? Math.min(...good) : Math.max(...good));
      const max = good.length ? Math.max(...good) : 0;
      stats.push(h('tr', null, h('th', { scope: 'row' }, def.name),
        vals.map((v, i) => h('td', { class: best != null && nums[i] === best && good.filter((n) => n === best).length < good.length ? 'best' : '' },
          v == null ? '–' : h('span', { class: 'cmp-val' },
            !def.plain && nums[i] != null && max > 0 ? h('i', { class: 'cmp-bar', style: { width: `${Math.max(2, Math.round((nums[i] / max) * 100))}%` } }) : null,
            h('b', null, show(def.label, v)))))));
    });
  });

  const failNote = failed.length ? h('p', { class: 'muted' }, `Could not load ${failed.length} player${failed.length > 1 ? 's' : ''}; showing the rest.`) : null;
  el.replaceChildren(
    h('div', { class: 'sect-head' }, h('h1', null, 'Compare players'), seg),
    ...(failNote ? [failNote] : []),
    h('section', { class: 'card scroll-x' }, h('table', { class: 'tbl cmp' }, h('thead', null, head), h('tbody', null, bio, stats))),
    h('p', { class: 'muted pad', style: { fontSize: '12px' } }, 'The highlighted number is the best in each row (lower is better for turnovers and fouls). Stats come from ESPN.'));
}
