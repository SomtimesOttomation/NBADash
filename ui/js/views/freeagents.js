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

let roster = null;         // saved rosters: { byId: id -> team, byName: folded name -> { id, team } }

async function loadRoster() {
  const idx = await S.buildPlayerIndex();
  roster = { byId: new Map(idx.map((p) => [p.id, p.abbr])), byName: new Map(idx.map((p) => [S.fold(p.name), { id: p.id, team: p.abbr }])) };
}

export function mount(ctx) {
  Promise.all([S.loadTransactions(), S.loadFreeAgents(), S.loadEspnTx(), S.loadLeague(), loadRoster()])
    .then(() => S.checkFASigned()).then(() => draw(ctx)).catch(() => draw(ctx));
  draw(ctx);
}
export function update(topics, ctx) {
  if (topics.has('teamfile') || topics.has('sync')) loadRoster().then(() => draw(ctx));
  if (['transactions', 'fa', 'league', 'settings'].some((t) => topics.has(t))) draw(ctx);
}

const dayKey = (d) => String(d || '').slice(0, 10).replace(/-/g, '');
const daysSince = (k) => { if (!/^\d{8}$/.test(k)) return null; const t = Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8)); return Math.max(0, Math.floor((Date.now() - t) / 864e5)); };

// One row per player: the latest release we know of (our own roster log or ESPN's official notes), his last team,
// his season numbers, and whether he has signed since.
function buildRows() {
  const tx = S.state.transactions ? S.state.transactions.events : [];
  const official = S.state.espnTx ? S.state.espnTx.moves : [];
  const watch = S.state.fa ? S.state.fa.watch : {};
  const lg = S.state.league.data;
  const form = S.state.settings.showForm !== false;
  if (lg && form) applyForm(lg);
  // name -> id, from everything that carries both (ESPN's notes have names only)
  const idByName = new Map();
  const learn = (id, name) => { if (id && name && !idByName.has(S.fold(name))) idByName.set(S.fold(name), String(id)); };
  if (lg) Object.values(lg.players).forEach((p) => learn(p.id, p.name));
  tx.forEach((e) => learn(e.id, e.name));
  Object.entries(watch).forEach(([id, w]) => learn(id, w.name));
  if (roster) roster.byName.forEach((v, k) => { if (!idByName.has(k)) idByName.set(k, v.id); });
  // newest move per player, keyed by id when known, else by name
  const moves = [
    ...tx.map((e) => ({ id: String(e.id), name: e.name, pos: e.pos, type: e.type, team: e.type === 'released' ? e.from : e.to, date: dayKey(e.date), src: 'log' })),
    ...official.map((m) => ({ id: idByName.get(S.fold(m.name)) || '', name: m.name, pos: '', type: m.type, team: m.team, date: dayKey(m.date), src: 'espn', note: m.note })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const keyOf = (m) => m.id || `n:${S.fold(m.name)}`;
  const latest = new Map();
  for (const m of moves) if (!latest.has(keyOf(m))) latest.set(keyOf(m), m);
  const keys = new Set([...[...latest.entries()].filter(([, m]) => m.type === 'released').map(([k]) => k), ...Object.keys(watch)]);
  const rows = [];
  for (const k of keys) {
    const id = k.startsWith('n:') ? '' : k;
    const m = latest.get(k), w = id ? watch[id] : null;
    const released = m && m.type === 'released' ? m : null;
    const name = (released && released.name) || (w && w.name) || '';
    const onTeam = roster ? (id ? roster.byId.get(id) : (roster.byName.get(S.fold(name)) || {}).team) : undefined;
    if (onTeam && !w) continue;                                   // signed again and not watched: no longer a free agent
    const lines = lg && id ? Object.values(lg.players).filter((p) => String(p.id) === id) : [];
    const gp = lines.reduce((a, p) => a + p.gp, 0);
    const tot = (x) => lines.reduce((a, p) => a + p.tot[x], 0);
    const best = lines.filter((p) => Number.isFinite(p.form)).sort((a, b) => b.gp - a.gp)[0];
    const waivedKey = released ? released.date : '';
    rows.push({
      id, name: name || (lines[0] && lines[0].name) || id,
      pos: (released && released.pos) || (lines[0] && lines[0].pos) || '',
      lastTeam: (released && released.team) || (w && w.lastTeam) || (lines[0] && lines[0].team) || '',
      waived: waivedKey, src: released ? released.src : '', unsigned: onTeam ? null : daysSince(waivedKey || (w && w.added) || ''),
      gp, mpg: gp ? tot('min') / gp : NaN, ppg: gp ? tot('pts') / gp : NaN, form: best ? best.form : NaN,
      team: onTeam || '', watched: !!w, note: (w && w.note) || '', signedAt: (w && w.signedAt) || '',
    });
  }
  const useful = (r) => (Number.isFinite(r.form) ? r.form * 2 : 0) + (Number.isFinite(r.mpg) ? r.mpg / 4 : 0) + (Number.isFinite(r.ppg) ? r.ppg / 2 : 0);
  rows.sort((a, b) => (sort === 'useful' ? useful(b) - useful(a) : String(b.waived || '').localeCompare(String(a.waived || ''))) || a.name.localeCompare(b.name));
  return rows;
}

// The button that loads ESPN's official waivers and signings (a handful of requests, one per second, only when pressed).
function officialBar(redraw) {
  const T = S.state.espnTx, P = S.state.txh;
  const busy = P && P.running;
  const status = busy ? `Loading ESPN transactions\u2026 page ${P.page || 1}${P.pages ? ` of ${P.pages}` : ''} (${P.count || 0} entries)`
    : P && P.ok === false ? `Could not load ESPN transactions${P.error ? `: ${P.error}` : ''}.`
    : T && T.fetchedAt ? `Official ESPN transactions loaded ${String(T.fetchedAt).slice(0, 10)} (${T.count} entries${T.complete ? '' : ', incomplete'}).`
    : 'Players waived before NBADash started tracking can be loaded from ESPN\u2019s official transactions list.';
  return h('div', { class: 'card pad fa-official' }, h('span', null, status), ' ',
    h('button', { class: 'btn', type: 'button', disabled: busy || S.state.halted ? true : null, title: 'Downloads ESPN\u2019s NBA transactions list: usually under 20 requests, one per second',
      onclick: () => S.fetchEspnTx().catch((e) => { S.state.txh = { running: false, ok: false, error: e.message }; redraw(); }) },
    busy ? 'Loading\u2026' : T && T.fetchedAt ? 'Update from ESPN' : 'Load official waivers from ESPN'));
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
    'Players waived or released who are not on an NBA roster now, from the Transactions log and (once loaded) ESPN\u2019s official list. Add anyone with ☆ Watch on a player page, ',
    'and they are marked Signed when they appear on a roster after a sync. Moves outside the NBA (G League, overseas) are not in ESPN’s data: use the note field.');
  const bar = officialBar(() => draw({ el }));
  if (!rows.length) {
    el.replaceChildren(head, note, bar, emptyState(view === 'watch' ? 'You are not watching anyone yet' : 'No free agents recorded yet',
      view === 'watch' ? 'Open a player page and press ☆ Watch as free agent.' : 'Waivers show up here as syncs pick them up. Players cut before tracking began can be added from their player page.'));
    return;
  }
  const cols = ['', 'Player', 'Last team', 'Waived', 'Unsigned', 'GP', 'MPG', 'PPG', ...(form ? ['Form'] : []), 'Status', 'Note'];
  const table = h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl fa' },
    h('thead', null, h('tr', null, cols.map((c) => h('th', null, c === 'Form' ? h('span', calc('form', 'player'), c) : c)))),
    h('tbody', null, rows.map((r) => h('tr', { class: r.team ? 'fa-signed' : '' },
      h('td', null, h('button', { class: `icon-btn fa-star ${r.watched ? 'on' : ''}`, type: 'button', disabled: r.id ? null : true,
        title: !r.id ? 'Search for this player and use Watch on his page (ESPN\u2019s note has no player id)' : r.watched ? 'Stop watching' : 'Watch this player',
        onclick: () => S.toggleWatchFA({ id: r.id, name: r.name, lastTeam: r.lastTeam }) }, r.watched ? '\u2605' : '\u2606')),
      h('td', null, h('span', { class: 'fa-name' }, avatar(r.name, r.id ? headshotUrl(r.id) : '', 28), h('b', null, r.id ? playerLink(r.id, r.name) : r.name), h('small', { class: 'muted' }, ` ${r.pos}`))),
      h('td', null, r.lastTeam ? h('span', { class: 'tx-team' }, teamLogo(r.lastTeam, 18), displayCode(r.lastTeam)) : '–'),
      h('td', null, r.waived ? [fmtKey(r.waived), r.src === 'espn' ? h('small', { class: 'muted', title: 'From ESPN\u2019s official transactions list' }, ' ESPN') : null] : h('span', { class: 'muted' }, 'not recorded')),
      h('td', null, r.unsigned == null ? '–' : `${r.unsigned} day${r.unsigned === 1 ? '' : 's'}`),
      h('td', null, r.gp || '–'), h('td', null, f1(r.mpg)), h('td', null, f1(r.ppg)),
      ...(form ? [h('td', null, Number.isFinite(r.form) ? `${r.form > 0 ? '+' : ''}${r.form.toFixed(1)}` : '–')] : []),
      h('td', null, r.team ? h('span', { class: 'chip tx-signed' }, `Signed: ${displayCode(r.team)}${r.signedAt ? ` · ${fmtKey(r.signedAt)}` : ''}`) : h('span', { class: 'chip' }, 'Free agent')),
      h('td', null, r.watched ? h('input', { class: 'fa-note', type: 'text', value: r.note, maxlength: 300, placeholder: 'e.g. signed in Turkey', 'aria-label': `Note for ${r.name}`,
        onchange: (e) => S.setFANote(r.id, e.target.value) }) : ''))))));
  el.replaceChildren(head, note, bar, table);
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
