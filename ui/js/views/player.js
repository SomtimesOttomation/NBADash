import * as S from '../store.js';
import { h } from '../util.js';
import { teamLogo, teamColor, avatar, emptyState, headshotUrl } from '../components.js';
import { displayCode } from '../arenas.js';
import { currentRow, seasonRow, pick, show, heightText, weightText, dobText } from '../players.js';
import { applyForm } from '../stats.js';
import { calc } from '../formulas.js';

export function mount(ctx) {
  S.loadPlayer(ctx.arg);
  S.loadFreeAgents();
  if (S.state.settings.showForm !== false) S.loadLeague();
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has(`player:${ctx.arg}`) || topics.has('compare') || topics.has('teams') || topics.has('league') || topics.has('settings') || topics.has('fa')) draw(ctx);
}

const TILES = ['PTS', 'REB', 'AST', 'STL', 'BLK', 'FG%', '3P%', 'FT%'];

function abbrOfTeamId(id) { const t = S.state.byId.get(String(id)); return t ? t.abbr : ''; }

function photo(b) {
  const t = S.team(b.team);
  const wrap = h('div', { class: 'pl-photo', style: { '--tc': teamColor(t) } });
  const img = h('img', { src: b.headshot || headshotUrl(b.id), alt: b.name, decoding: 'async' });
  img.addEventListener('error', () => { img.remove(); wrap.append(avatar(b.name, '', 120)); });
  wrap.append(img);
  return wrap;
}

function bioTable(b) {
  const born = [b.dob ? dobText(b.dob) : '', b.birthPlace].filter(Boolean).join(' · ');
  const rows = [
    ['Team', b.team ? h('a', { href: `#/team/${b.team}`, class: 'inline-team' }, teamLogo(b.team, 20), b.teamName || displayCode(b.team)) : '–'],
    ['Position', [b.posName || b.pos, b.jersey ? `#${b.jersey}` : ''].filter(Boolean).join(' · ') || '–'],
    ['Height', heightText(b.height)],
    ['Weight', weightText(b.weight)],
    ['Age', b.age != null ? String(b.age) : '–'],
    ['Born', born || '–'],
    ['Draft', b.draft || '–'],
    ['Experience', b.experience || '–'],
    b.college ? ['College', b.college] : null,
    b.citizenship ? ['Country', b.citizenship] : null,
    ['Status', b.status || '–'],
  ].filter(Boolean);
  return h('table', { class: 'tbl bio' }, h('tbody', null, rows.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, k), h('td', null, v)))));
}

function seasonTables(p) {
  const cur = currentRow(p);
  const name = p.seasonName || 'This season';
  if (!cur) {
    const prev = seasonRow(p, p.season - 1);
    return h('section', { class: 'card pad' },
      h('h2', null, `${name} season`),
      h('p', { class: 'muted' }, `${p.bio.name} has not played a game in ${name} yet.`),
      prev ? h('p', { class: 'muted' }, `Last season (${prev.season}): ${['PTS', 'REB', 'AST'].map((l) => `${show(l, pick(p, 'avg', prev.avg, l))} ${l}`).join(' · ')}`) : null);
  }
  const tiles = h('div', { class: 'stat-tiles' }, TILES.map((l) => h('div', { class: 'tile' }, h('b', null, show(l, pick(p, 'avg', cur.avg, l))), h('small', null, l))));
  const perGame = h('table', { class: 'tbl' }, h('thead', null, h('tr', null, p.avgLabels.map((l) => h('th', null, l)))),
    h('tbody', null, h('tr', null, p.avgLabels.map((l, i) => h('td', null, show(l, cur.avg[i]))))));
  const totals = cur.tot.length ? h('table', { class: 'tbl' }, h('thead', null, h('tr', null, p.totLabels.map((l) => h('th', null, l)))),
    h('tbody', null, h('tr', null, p.totLabels.map((l, i) => h('td', null, show(l, cur.tot[i])))))) : null;
  const gp = pick(p, 'avg', cur.avg, 'GP');
  return h('section', { class: 'card pad' },
    h('h2', null, `${name} season`, h('small', { class: 'muted', style: { marginLeft: '10px' } }, gp ? `${gp} game${gp === '1' ? '' : 's'} played` : '')),
    tiles,
    h('h3', { class: 'sub' }, 'Per game'), h('div', { class: 'scroll-x' }, perGame),
    totals ? [h('h3', { class: 'sub' }, 'Totals'), h('div', { class: 'scroll-x' }, totals)] : null);
}

function history(p) {
  const cols = ['GP', 'GS', 'MIN', 'FG%', '3P%', 'FT%', 'REB', 'AST', 'STL', 'BLK', 'TO', 'PTS'];
  const rows = p.seasons.slice().sort((a, b) => b.year - a.year);
  const teamCell = (r) => {
    if (/totals/i.test(r.team) || !r.teamId) return 'TOT';
    const a = abbrOfTeamId(r.teamId);
    return a ? h('span', { class: 'inline-team' }, teamLogo(a, 16), displayCode(a)) : String(r.team).replace(/-/g, ' ');
  };
  const line = (r) => h('tr', null, h('td', null, r.season), h('td', null, teamCell(r)), cols.map((l) => h('td', null, show(l, pick(p, 'avg', r.avg, l)))));
  return h('section', { class: 'card pad' }, h('h2', null, 'Career by season'),
    h('div', { class: 'scroll-x' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Season'), h('th', { style: { textAlign: 'left' } }, 'Team'), cols.map((l) => h('th', null, l)))),
      h('tbody', null, rows.map(line),
        p.career.avg.length ? h('tr', { class: 'grp' }, h('td', null, 'Career'), h('td', null, ''), cols.map((l) => h('td', { style: { textTransform: 'none' } }, show(l, pick(p, 'avg', p.career.avg, l))))) : null))));
}

// Form rating (DARKO-style) from the league's saved box scores; the latest team's line for a traded player.
let formMemo = { rev: -1 };
function formChip(id) {
  const L = S.state.league;
  if (S.state.settings.showForm === false || !L.data) return null;
  if (formMemo.rev !== L.rev) { applyForm(L.data); formMemo = { rev: L.rev }; }
  const lines = Object.values(L.data.players).filter((p) => String(p.id) === String(id) && Number.isFinite(p.form));
  if (!lines.length) return null;
  const last = (p) => Math.max(0, ...(p.log || []).map((g) => g[0]));
  const p = lines.sort((a, b) => last(b) - last(a))[0];
  const gp = lines.reduce((a, x) => a + x.gp, 0);
  const arrow = p.formTrend > 0.3 ? '\u2191' : p.formTrend < -0.3 ? '\u2193' : '\u2192';
  return h('div', { class: 'form-chip', style: { marginTop: '8px' } },
    h('span', calc('form', 'player'), 'Form'), ' ',
    h('b', { class: p.form >= 0 ? 'pos' : 'neg' }, `${p.form > 0 ? '+' : ''}${p.form.toFixed(1)} ${arrow}`),
    h('small', { class: 'muted' }, ` vs league avg \u00b7 ${gp} GP`));
}

function draw({ el, arg }) {
  const e = S.state.players.get(arg);
  const p = e?.player;
  if (!p) {
    if (e && e.error && !e.loading) {
      el.replaceChildren(emptyState('Could not load this player', e.error), h('p', { style: { textAlign: 'center' } }, h('button', { class: 'btn primary', type: 'button', onclick: () => S.loadPlayer(arg, true) }, 'Try again')));
    } else el.replaceChildren(h('div', { class: 'card pad' }, h('div', { class: 'skeleton', style: { height: '220px' } })));
    return;
  }
  const b = p.bio;
  const inCmp = S.inCompare(arg);
  const full = S.state.compare.length >= S.COMPARE_MAX && !inCmp;
  const cmpBtn = h('button', { class: `btn ${inCmp ? '' : 'primary'}`, type: 'button', disabled: full ? true : null, title: full ? `You can compare up to ${S.COMPARE_MAX} players` : '',
    onclick: () => S.toggleCompare({ id: arg, name: b.name, headshot: b.headshot, team: b.team }) }, inCmp ? '✓ In comparison (remove)' : '+ Add to comparison');
  const top = h('section', { class: 'card pl-top' },
    h('div', { class: 'pl-left' }, photo(b),
      h('h1', null, b.name),
      h('div', { class: 'meta' }, [b.team ? displayCode(b.team) : '', b.pos, b.jersey ? `#${b.jersey}` : ''].filter(Boolean).join(' · ')),
      formChip(arg),
      h('div', { style: { marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' } }, cmpBtn,
        h('button', { class: 'btn', type: 'button', title: 'Track this player on the Free Agents page and get told when he signs somewhere',
          onclick: () => S.toggleWatchFA({ id: arg, name: b.name, lastTeam: b.team }) }, S.isWatchedFA(arg) ? '\u2605 Watching (free agents)' : '\u2606 Watch as free agent'))),
    h('div', { class: 'pl-right scroll-x' }, bioTable(b)));
  const stale = e.loading ? h('small', { class: 'muted' }, 'Refreshing from ESPN…') : null;
  el.replaceChildren(top, ...(stale ? [stale] : []), seasonTables(p), history(p));
}
