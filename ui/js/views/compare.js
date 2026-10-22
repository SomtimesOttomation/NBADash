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

  // First pass: who wins each row (ties win nothing), so the overall leader can be shown in the header and the table.
  const lines = [];
  COMPARE_ROWS.forEach((g) => g.rows.forEach((def) => {
    const vals = players.map((p, i) => (rows[i] ? pick(p, def.kind, def.kind === 'misc' ? rows[i].misc : rows[i].avg, def.label) : null));
    if (vals.every((v) => v == null)) return;
    const nums = vals.map(numeric);
    const good = nums.filter((n) => n != null);
    const best = def.plain || good.length < 2 ? null : (def.lower ? Math.min(...good) : Math.max(...good));
    const winners = best != null && good.filter((n) => n === best).length < good.length ? nums.map((n) => n === best) : nums.map(() => false);
    lines.push({ group: g.group, def, vals, nums, winners, max: good.length ? Math.max(...good) : 0 });
  }));
  const wins = players.map((_, i) => lines.filter((l) => l.winners[i]).length);
  const decided = lines.filter((l) => l.winners.some(Boolean)).length;
  const top = Math.max(...wins);
  const leads = wins.map((w) => top > 0 && w === top);

  const head = h('tr', null, h('th', null, ''), players.map((p, i) => {
    const b = p.bio;
    return h('th', { class: `cmp-head ${leads[i] ? 'leader' : ''}` },
      h('button', { class: 'cmp-x', type: 'button', title: 'Remove from comparison', onclick: () => {
        S.toggleCompare({ id: b.id }); const rest = S.state.compare.map((c) => c.id);
        location.hash = rest.length >= 2 ? `#/compare/${rest.join(',')}` : rest.length === 1 ? `#/player/${rest[0]}` : '#/';
      } }, '\u00d7'),
      leads[i] ? h('span', { class: 'lead-badge' }, 'Leader') : null,
      h('a', { href: `#/player/${b.id}`, class: 'cmp-who' }, avatar(b.name, b.headshot || headshotUrl(b.id), 72), h('b', null, b.name)),
      h('small', { class: 'muted' }, b.team ? h('span', { class: 'inline-team' }, teamLogo(b.team, 14), displayCode(b.team)) : '', [b.pos, b.jersey ? `#${b.jersey}` : ''].filter(Boolean).join(' \u00b7 ')),
      h('small', { class: 'wins' }, decided ? `Best in ${wins[i]} of ${decided} stats` : ''));
  }));

  const text = (label, fn) => h('tr', { class: 'bio-row' }, h('th', { scope: 'row' }, label), players.map((p) => h('td', null, fn(p.bio) || '\u2013')));
  const bio = [h('tr', { class: 'grp' }, h('td', { colspan: players.length + 1 }, 'Bio')),
    text('Age', (b) => (b.age != null ? String(b.age) : '')), text('Height', (b) => heightText(b.height)), text('Weight', (b) => weightText(b.weight)),
    text('Experience', (b) => b.experience), text('Draft', (b) => b.draft)];

  const stats = [h('tr', { class: 'grp' }, h('td', { colspan: players.length + 1 }, basisName))];
  if (basis !== 'career') {
    stats.push(h('tr', { class: 'bio-row' }, h('th', { scope: 'row' }, 'Season'), players.map((p, i) => h('td', null, rows[i] ? rows[i].label : h('span', { class: 'muted' }, 'No games')))));
  }
  let lastGroup = '';
  lines.forEach((l) => {
    if (l.group !== lastGroup) { lastGroup = l.group; stats.push(h('tr', { class: 'grp sub' }, h('td', { colspan: players.length + 1 }, l.group))); }
    stats.push(h('tr', null, h('th', { scope: 'row' }, l.def.name),
      l.vals.map((v, i) => h('td', { class: l.winners[i] ? (leads[i] ? 'best lead' : 'best') : '' },
        v == null ? '\u2013' : h('span', { class: 'cmp-val' },
          !l.def.plain && l.nums[i] != null && l.max > 0 ? h('i', { class: 'cmp-bar', style: { width: `${Math.max(2, Math.round((l.nums[i] / l.max) * 100))}%` } }) : null,
          h('b', null, show(l.def.label, v)))))));
  });

  const failNote = failed.length ? h('p', { class: 'muted' }, `Could not load ${failed.length} player${failed.length > 1 ? 's' : ''}; showing the rest.`) : null;
  el.replaceChildren(
    h('div', { class: 'sect-head' }, h('h1', null, 'Compare players'), seg),
    ...(failNote ? [failNote] : []),
    h('section', { class: 'card scroll-x' }, h('table', { class: 'tbl cmp' }, h('thead', null, head), h('tbody', null, bio, stats))),
    h('p', { class: 'muted pad', style: { fontSize: '12px' } }, 'The best number in each row is green; the strong green cells belong to the overall leader, the player who is best in the most rows (lower is better for turnovers and fouls). Stats come from ESPN.'));
}
