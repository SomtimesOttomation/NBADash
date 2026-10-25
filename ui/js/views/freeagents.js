// Free Agents: players NBADash has seen waived or released who are not on any NBA roster now, plus a personal watch list.
// Built from the Transactions log, the saved rosters and the league stats; no extra requests.
import * as S from '../store.js';
import { h, fmtKey } from '../util.js';
import { emptyState, teamLogo, avatar, headshotUrl, playerLink } from '../components.js';
import { displayCode } from '../arenas.js';
import { applyForm } from '../stats.js';
import { calc } from '../formulas.js';

const SORT_KEY = 'nbadash.faSort', VIEW_KEY = 'nbadash.faView';
let sort = 'recent';      // 'recent' | 'useful'
let view = 'all';         // 'all' | 'watch'
try { const v = localStorage.getItem(SORT_KEY); if (v === 'recent' || v === 'useful') sort = v; } catch (e) { /* ignore */ }
try { const v = localStorage.getItem(VIEW_KEY); if (v === 'all' || v === 'watch') view = v; } catch (e) { /* ignore */ }
let where = null;          // id -> team, from the saved rosters
let whereRev = -1;

export function mount(ctx) {
  Promise.all([S.loadTransactions(), S.loadFreeAgents(), S.loadLeague(), S.rosterIndex().then((m) => { where = m; })])
    .then(() => S.checkFASigned()).then(() => draw(ctx)).catch(() => draw(ctx));
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has('teamfile') || topics.has('sync')) { S.rosterIndex().then((m) => { where = m; whereRev++; draw(ctx); }); }
  if (['transactions', 'fa', 'league', 'settings'].some((t) => topics.has(t))) draw(ctx);
}

const dayKey = (d) => String(d || '').slice(0, 10).replace(/-/g, '');
const daysSince = (k) => { if (!/^\d{8}$/.test(k)) return null; const t = Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); return Math.max(0, Math.floor((Date.now() - t) / 864e5)); };

// One row per player: the latest release we know of, his last team, his season numbers, and whether he has signed since.
function buildRows() {
  const tx = S.state.transactions ? S.state.transactions.events : [];
  const watch = S.state.fa ? S.state.fa.watch : {};
  const lg = S.state.league.data;
  const form = S.state.settings.showForm !== false;
  if (lg && form) applyForm(lg);
  const latest = new Map();          // id -> newest event for that player (the log is newest first)
  for (const e of tx) if (!latest.has(String(e.id))) latest.set(String(e.id), e);
  const ids = new Set([...[...latest.values()].filter((e) => e.type === 'released').map((e) => String(e.id)), ...Object.keys(watch)]);
  const rows = [];
  for (const id of ids) {
    const e = latest.get(id), w = watch[id];
    const onTeam = where ? where.get(id) : undefined;
    const released = e && e.type === 'released' ? e : null;
    if (onTeam && !w) continue;                                   // signed again and not watched: no longer a free agent
    const lines = lg ? Object.values(lg.players).filter((p) => String(p.id) === id) : [];
    const gp = lines.reduce((a, p) => a + p.gp, 0);
    const tot = (k) => lines.reduce((a, p) => a + p.tot[k], 0);
    const best = lines.filter((p) => Number.isFinite(p.form)).sort((a, b) => b.gp - a.gp)[0];
    const waivedKey = released ? dayKey(released.date) : '';
    rows.push({
      id, name: (released && released.name) || (w && w.name) || (lines[0] && lines[0].name) || id,
      pos: (released && released.pos) || (lines[0] && lines[0].pos) || '',
      lastTeam: (released && released.from) || (w && w.lastTeam) || (lines[0] && lines[0].team) || '',
      waived: waivedKey, unsigned: onTeam ? null : daysSince(waivedKey || (w && w.added) || ''),
      gp, mpg: gp ? tot('min') / gp : NaN, ppg: gp ? tot('pts') / gp : NaN, form: best ? best.form : NaN,
      team: onTeam || '', watched: !!w, note: (w && w.note) || '', signedAt: (w && w.signedAt) || '',
    });
  }
  const useful = (r) => (Number.isFinite(r.form) ? r.form * 2 : 0) + (Number.isFinite(r.mpg) ? r.mpg / 4 : 0) + (Number.isFinite(r.ppg) ? r.ppg / 2 : 0);
  rows.sort((a, b) => (sort === 'useful' ? useful(b) - useful(a) : String(b.waived || '').localeCompare(String(a.waived || ''))) || a.name.localeCompare(b.name));
  return rows;
}

const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : '–');

function draw({ el }) {
  const form = S.state.settings.showForm !== false;
  const seg = (items, cur, set, label) => h('div', { class: 'seg', role: 'tablist', 'aria-label': label }, items.map(([k, t]) => h('button', {
    type: 'button', role: 'tab', 'aria-selected': cur === k ? 'true' : 'false', class: cur === k ? 'active' : '', onclick: () => { set(k); draw({ el }); } }, t)));
  const head = h('div', { class: 'section-head' }, h('h2', null, 'Free Agents'),
    h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
      seg([['all', 'All'], ['watch', 'Watching']], view, (k) => { view = k; try { localStorage.setItem(VIEW_KEY, k); } catch (e) { /* ignore */ } }, 'Show'),
      seg([['recent', 'Recently waived'], ['useful', 'Most useful']], sort, (k) => { sort = k; try { localStorage.setItem(SORT_KEY, k); } catch (e) { /* ignore */ } }, 'Sort')));
  if (!S.state.transactions || !S.state.fa) { el.replaceChildren(head, emptyState('Loading…')); return; }
  let rows = buildRows();
  if (view === 'watch') rows = rows.filter((r) => r.watched);
  const note = h('p', { class: 'muted', style: { margin: '0 0 12px' } },
    'Players NBADash has seen waived or released who are not on an NBA roster now, from the Transactions log. Add anyone with ☆ Watch on a player page, ',
    'and they are marked Signed when they appear on a roster after a sync. Moves outside the NBA (G League, overseas) are not in ESPN’s data: use the note field.');
  if (!rows.length) {
    el.replaceChildren(head, note, emptyState(view === 'watch' ? 'You are not watching anyone yet' : 'No free agents recorded yet',
      view === 'watch' ? 'Open a player page and press ☆ Watch as free agent.' : 'Waivers show up here as syncs pick them up. Players cut before tracking began can be added from their player page.'));
    return;
  }
  const cols = ['', 'Player', 'Last team', 'Waived', 'Unsigned', 'GP', 'MPG', 'PPG', ...(form ? ['Form'] : []), 'Status', 'Note'];
  const table = h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl fa' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c === 'Form' ? h('span', calc('form', 'player'), c) : c)))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.team ? 'fa-signed' : '' },
      h('td', null, h('button', { class: `icon-btn fa-star ${r.watched ? 'on' : ''}`, type: 'button', title: r.watched ? 'Stop watching' : 'Watch this player',
        onclick: () => S.toggleWatchFA({ id: r.id, name: r.name, lastTeam: r.lastTeam }) }, r.watched ? '★' : '☆')),
      h('td', null, h('span', { class: 'fa-name' }, avatar(r.name, headshotUrl(r.id), 28), h('b', null, playerLink(r.id, r.name)), h('small', { class: 'muted' }, ` ${r.pos}`))),
      h('td', null, r.lastTeam ? h('span', { class: 'tx-team' }, teamLogo(r.lastTeam, 18), displayCode(r.lastTeam)) : '–'),
      h('td', null, r.waived ? fmtKey(r.waived) : h('span', { class: 'muted' }, 'not recorded')),
      h('td', null, r.unsigned == null ? '–' : `${r.unsigned} day${r.unsigned === 1 ? '' : 's'}`),
      h('td', null, r.gp || '–'), h('td', null, f1(r.mpg)), h('td', null, f1(r.ppg)),
      ...(form ? [h('td', null, Number.isFinite(r.form) ? `${r.form > 0 ? '+' : ''}${r.form.toFixed(1)}` : '–')] : []),
      h('td', null, r.team ? h('span', { class: 'chip tx-signed' }, `Signed: ${displayCode(r.team)}${r.signedAt ? ` · ${fmtKey(r.signedAt)}` : ''}`) : h('span', { class: 'chip' }, 'Free agent')),
      h('td', null, r.watched ? h('input', { class: 'fa-note', type: 'text', value: r.note, maxlength: 300, placeholder: 'e.g. signed in Turkey', 'aria-label': `Note for ${r.name}`,
        onchange: (e) => S.setFANote(r.id, e.target.value) }) : ''))))));
  el.replaceChildren(head, note, table);
}

// Home page notice: watched players who signed since the person last looked.
export function signedNotice() {
  const watch = S.state.fa ? S.state.fa.watch : {};
  const fresh = Object.entries(watch).filter(([, w]) => w.signedTeam && !w.seen);
  if (!fresh.length) return null;
  return h('div', { class: 'card pad fa-notice' },
    h('b', null, 'Free agent watch: '),
    fresh.map(([id, w], i) => [i ? ', ' : '', playerLink(id, w.name), ` signed with ${displayCode(w.signedTeam)}`]),
    ' ', h('button', { class: 'btn', type: 'button', onclick: () => fresh.forEach(([id]) => S.dismissFASigned(id)) }, 'Dismiss'),
    ' ', h('a', { href: '#/freeagents' }, 'Free Agents'));
}
