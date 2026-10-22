// App state, cache access and live-event handling. Views subscribe to topics and re-render.
import * as bridge from './bridge.js';
import { etKey, addDaysKey, asArray, fmtKey } from './util.js';
import { toEspnCode } from './arenas.js';
import { aggregate, newLeague, leagueAdd, LEAGUE_VERSION } from './stats.js';

// user-adjustable timing: [default, min, max, label, unit, help]
export const TUNING = {
  liveSeconds:      [30, 10, 300, 'Live scores', 'seconds', 'How often scores and the watched box score refresh while a game is live or about to start'],
  idleMinutes:      [10, 1, 120, 'Scoreboard when idle', 'minutes', 'How often today\'s scoreboard is checked when nothing is live'],
  oldDayHours:      [6, 1, 48, 'Finished earlier days', 'hours', 'How often a past day whose games are all final is re-checked'],
  tableLiveMinutes: [15, 5, 120, 'Standings and injuries (games live)', 'minutes', 'Refresh interval while games are live'],
  tableStaleHours:  [6, 1, 48, 'Standings and injuries (idle)', 'hours', 'Refresh only when the saved copy is older than this'],
  teamFreshHours:   [20, 1, 168, 'Team files (sync)', 'hours', 'Rosters, coaches and schedules newer than this are skipped by a sync'],
  tableFreshHours:  [4, 1, 48, 'Standings and injuries (sync)', 'hours', 'A sync skips them if the saved copy is newer than this'],
  backfillDays:     [7, 1, 30, 'Sync catch-up window', 'days', 'How many days back a normal sync looks for missed games'],
};
export const TUNE_DEFAULTS = Object.fromEntries(Object.entries(TUNING).map(([k, v]) => [k, v[0]]));
export const state = {
  ready: false,
  host: bridge.isHost,
  sample: false,
  cacheDir: '',
  version: '',
  teams: [],
  byAbbr: new Map(),
  byId: new Map(),
  settings: { favorites: [], theme: 'system', liveSeconds: 30, autoWatch: true, updateCheck: true, autoHistory: true, ...TUNE_DEFAULTS },
  days: new Map(),          // 'yyyymmdd' -> { key, events, allFinal, source, at }
  cachedDayKeys: [],
  teamFiles: new Map(),     // abbr -> file | null
  standings: null,
  injuries: null,
  boxes: new Map(),         // eventId -> box
  live: { ok: true, at: 0, error: '', interval: 0, anyLive: false },
  watch: new Set(),
  sync: { running: false, lastRun: null, lastCompleteDate: null, line: '', text: '', pct: 0, exitCode: null, summary: '', finishedAt: 0 },
  flash: new Map(),         // 'eventId:side' -> timestamp of last score change
  cachedBoxIds: new Set(),
  season: new Map(),        // abbr -> { agg, loaded, total, loading }
  league: { data: null, loading: false, n: 0, total: 0, rev: 0 },
  players: new Map(),       // id -> { player, loading, error }
  psearch: { q: '', items: [], loading: false },
  compare: [],              // [{ id, name, headshot, team }]
  update: { phase: 'idle', info: null, pct: 0, text: '', error: '', quiet: false, note: null },
};

// ---- season weeks: ESPN's "Week 1" is Oct 20-26, 2026 (opening night is a Tuesday); each week runs 7 days from there
export const SEASON_START = '20261020';
const keyToUtc = (k) => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8));
export const weekOfKey = (k) => Math.floor((keyToUtc(k) - keyToUtc(SEASON_START)) / 86400000 / 7) + 1;
export const weekDayKeys = (n) => Array.from({ length: 7 }, (_, i) => addDaysKey(SEASON_START, (n - 1) * 7 + i));
export const weekRangeLabel = (n) => { const d = weekDayKeys(n); const f = (k) => fmtKey(k, { weekday: undefined }); return `${f(d[0])} - ${f(d[6])}`; };
// weeks that have at least one saved day, ascending; the link only appears once there is data
export const weeksWithData = () => [...new Set(state.cachedDayKeys.filter((k) => k >= SEASON_START).map(weekOfKey))].sort((a, b) => a - b);
export const todayKey = () => etKey(new Date());
export const yesterdayKey = () => addDaysKey(todayKey(), -1);

// ---- change notification ----------------------------------------------------
const subs = new Set();
let queued = new Set();
let raf = 0;

export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

export function notify(...topics) {
  topics.forEach((t) => queued.add(t));
  if (raf) return;
  raf = requestAnimationFrame(() => {
    const t = queued; queued = new Set(); raf = 0;
    subs.forEach((fn) => { try { fn(t); } catch (e) { console.error(e); } });
  });
}

// ---- helpers ------------------------------------------------------------------
async function readCache(path) {
  try {
    const d = await bridge.request('cache.read', { path });
    return d ?? null;
  } catch (e) {
    console.warn('cache.read failed', path, e.message);
    return null;
  }
}

function normEvent(ev) {
  const e = { ...ev };
  e.id = String(e.id);
  e.sides = asArray(e.sides).map((s) => ({
    ...s,
    lines: asArray(s.lines),
    leaders: asArray(s.leaders),
  }));
  return e;
}

function normDay(d, source) {
  return {
    key: String(d.date),
    events: asArray(d.events).map(normEvent),
    allFinal: !!d.allFinal,
    source,
    at: Date.parse(d.fetchedAt || d.syncedAt || '') || Date.now(),
  };
}

function normBox(b) {
  b.teams = asArray(b.teams).map((t) => ({
    ...t,
    labels: asArray(t.labels),
    totals: asArray(t.totals),
    players: asArray(t.players).map((p) => ({ ...p, stats: asArray(p.stats) })),
  }));
  b.teamStats = asArray(b.teamStats).map((t) => ({ ...t, stats: asArray(t.stats) }));
  return b;
}

export const side = (ev, which) => ev.sides.find((s) => s.side === which);
export const favSet = () => new Set(state.settings.favorites.map(toEspnCode));
export const isFav = (abbr) => favSet().has(abbr);
export const team = (abbr) => state.byAbbr.get(abbr);

export function allEvents() {
  const out = [];
  state.days.forEach((d) => out.push(...d.events));
  return out;
}
export const findEvent = (id) => allEvents().find((e) => e.id === String(id));
export const teamEvents = (abbr) => allEvents().filter((e) => e.sides.some((s) => s.abbr === abbr));

export function orderedTeams() {
  const fav = favSet();
  const byName = (a, b) => a.name.localeCompare(b.name);
  const f = state.teams.filter((t) => fav.has(t.abbr)).sort(byName);
  const rest = state.teams.filter((t) => !fav.has(t.abbr)).sort(byName);
  return { favorites: f, others: rest, all: [...f, ...rest] };
}

// ---- live events from the host --------------------------------------------------
function onScoreboard(d) {
  const key = String(d.date);
  const prev = state.days.get(key);
  const next = normDay(d, 'live');
  if (prev) {
    const old = new Map();
    prev.events.forEach((e) => e.sides.forEach((s) => old.set(`${e.id}:${s.side}`, s.score)));
    next.events.forEach((e) => e.sides.forEach((s) => {
      const k = `${e.id}:${s.side}`;
      if (old.has(k) && old.get(k) !== s.score && e.state === 'in') state.flash.set(k, Date.now());
    }));
  }
  state.days.set(key, next);
  notify('days');
  autoWatch();
}

function onBox(d) {
  state.boxes.set(String(d.eventId), d.box);
  notify('box', `box:${d.eventId}`);
}

function onLive(d) {
  state.live = { ...state.live, ...d };
  notify('live');
}

function onSync(d) {
  const wasRunning = state.sync.running;
  state.sync = { ...state.sync, ...d };
  if (wasRunning && d.running === false) state.sync.finishedAt = Date.now();
  if (d.running === false) { state.season.clear(); loadLeague(); refreshCachedBoxes(); refreshCachedDays(); loadStandings(true); loadInjuries(true); state.teamFiles.clear(); playerIndex = null; }
  notify('sync');
}

// ---- players: local search index, player pages, compare list ----------------------------------
let playerIndex = null;
export const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

export async function buildPlayerIndex() {
  if (playerIndex) return playerIndex;
  const files = await Promise.all(state.teams.map((t) => loadTeamFile(t.abbr)));
  const seen = new Set();
  playerIndex = [];
  files.forEach((f, i) => {
    if (!f) return;
    f.players.forEach((p) => {
      const id = String(p.id);
      if (seen.has(id)) return;
      seen.add(id);
      playerIndex.push({ id, name: p.name, abbr: state.teams[i].abbr, pos: p.pos || '', jersey: p.jersey || '', headshot: p.headshot || '', key: fold(p.name) });
    });
  });
  return playerIndex;
}

// Every word typed must start some word of the name ("luka don" finds Luka Doncic). Names that start with the text come first.
export function searchPlayers(q, limit = 8) {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length || !playerIndex) return [];
  const hits = [];
  for (const p of playerIndex) {
    const nameWords = p.key.split(' ');
    if (!words.every((w) => nameWords.some((nw) => nw.startsWith(w)))) continue;
    hits.push({ p, score: (p.key.startsWith(words[0]) ? 0 : 2) + (nameWords[nameWords.length - 1].startsWith(words[words.length - 1]) ? 0 : 1) });
  }
  return hits.sort((a, b) => a.score - b.score || a.p.name.localeCompare(b.p.name)).slice(0, limit).map((x) => x.p);
}

export function remoteSearch(q) {
  state.psearch = { q, items: [], loading: true };
  notify('psearch');
  bridge.request('player.search', { q }).then((ok) => { if (!ok && state.psearch.q === q) { state.psearch.loading = false; notify('psearch'); } })
    .catch(() => { if (state.psearch.q === q) { state.psearch.loading = false; notify('psearch'); } });
}

export async function loadPlayer(id, force) {
  id = String(id);
  const cur = state.players.get(id);
  if (cur && cur.player && !force) return cur;
  const entry = { player: cur?.player || null, loading: true, error: '' };
  state.players.set(id, entry);
  notify('player', `player:${id}`);
  try {
    const r = await bridge.request('player.get', { id });
    if (r && r.player) entry.player = normPlayer(r.player);
    entry.loading = !!(r && r.pending);          // pending: the host is fetching it, the 'player' event delivers it
    if (!r) entry.error = 'No data for this player.';
  } catch (e) { entry.loading = false; entry.error = e.message; }
  notify('player', `player:${id}`);
  return entry;
}

function normPlayer(p) {
  p.seasons = asArray(p.seasons).map((r) => ({ ...r, avg: asArray(r.avg), tot: asArray(r.tot), misc: asArray(r.misc) }));
  ['avgLabels', 'totLabels', 'miscLabels'].forEach((k) => { p[k] = asArray(p[k]); });
  p.career = { avg: asArray(p.career?.avg), tot: asArray(p.career?.tot), misc: asArray(p.career?.misc) };
  return p;
}

function onPlayer(d) {
  const id = String(d.id);
  if (d.error) state.players.set(id, { player: state.players.get(id)?.player || null, loading: false, error: d.error });
  else state.players.set(id, { player: normPlayer(d.player), loading: false, error: '' });
  notify('player', `player:${id}`);
}
function onPSearch(d) {
  if (d.q !== state.psearch.q) return;
  state.psearch = { q: d.q, items: asArray(d.items), loading: false };
  notify('psearch');
}

// compare list (kept between launches in this browser profile; max 5 players)
export const COMPARE_MAX = 5;
function loadCompare() { try { return asArray(JSON.parse(localStorage.getItem('nbadash.compare'))).slice(0, COMPARE_MAX); } catch { return []; } }
function saveCompare() { try { localStorage.setItem('nbadash.compare', JSON.stringify(state.compare)); } catch { /* ignore */ } }
export const inCompare = (id) => state.compare.some((c) => c.id === String(id));
export function toggleCompare(meta) {
  const id = String(meta.id);
  if (inCompare(id)) state.compare = state.compare.filter((c) => c.id !== id);
  else if (state.compare.length < COMPARE_MAX) state.compare = [...state.compare, { id, name: meta.name, headshot: meta.headshot || '', team: meta.team || '' }];
  else return false;
  saveCompare(); notify('compare');
  return true;
}
export function clearCompare() { state.compare = []; saveCompare(); notify('compare'); }

// ---- app updates (the host runs the GitHub check / download in a child process and reports back) ----------
function onUpdate(d) {
  const u = state.update;
  if (d.running) {
    u.phase = d.action === 'Stage' ? 'downloading' : 'checking';
    u.pct = d.pct || 0; u.text = d.text || '';
  } else {
    const r = d.result || {};
    u.pct = 0; u.text = ''; u.error = '';
    if (r.status === 'error') { u.phase = 'error'; u.error = r.error || 'The update did not finish.'; }
    else { u.phase = r.status || 'idle'; u.info = r; }
  }
  notify('update');
}

export async function checkUpdate({ quiet = false } = {}) {
  const u = state.update;
  if (u.phase === 'checking' || u.phase === 'downloading') return;
  u.quiet = quiet; u.phase = 'checking'; u.error = ''; u.pct = 0; u.text = 'Asking GitHub for the latest release...';
  notify('update');
  try { await bridge.request('update.check'); } catch (e) { u.phase = 'error'; u.error = e.message; notify('update'); }
}
export async function downloadUpdate() {
  const u = state.update;
  u.quiet = false; u.phase = 'downloading'; u.pct = 0; u.text = 'Starting...'; notify('update');
  try { await bridge.request('update.stage'); } catch (e) { u.phase = 'error'; u.error = e.message; notify('update'); }
}
export async function cancelUpdate() {
  try { await bridge.request('update.cancel'); } catch { /* ignore */ }
  state.update.phase = state.update.info?.status === 'available' ? 'available' : 'idle';
  notify('update');
}
export async function installUpdate() {
  try { await bridge.request('update.apply'); } catch (e) { state.update.phase = 'error'; state.update.error = e.message; notify('update'); }
}
export const updateReady = () => state.update.phase === 'available' || state.update.phase === 'staged';

function onStandings(d) { state.standings = d; notify('standings'); }
function onInjuries(d) { state.injuries = d; notify('injuries'); }

function autoWatch() {
  if (!state.settings.autoWatch) return;
  const fav = favSet();
  for (const e of allEvents()) {
    if (e.state === 'in' && e.sides.some((s) => fav.has(s.abbr)) && !state.watch.has(e.id)) setWatch(e.id, true);
  }
}

// ---- actions -------------------------------------------------------------------------
export async function setWatch(id, on) {
  id = String(id);
  if (on) state.watch.add(id); else state.watch.delete(id);
  notify('watch');
  try { await bridge.request('watch.set', { id, on }); } catch (e) { console.warn(e.message); }
}

export function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || 'system';
  notify('theme');
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (patch.favorites) state.settings.favorites = asArray(patch.favorites).map(toEspnCode);
  if ('theme' in patch) applyTheme();
  notify('settings', 'favorites');
  try { await bridge.request('settings.save', { settings: state.settings }); } catch (e) { console.warn(e.message); }
}

// Start a sync and show it immediately; the host then streams progress ({running, pct, text}) as 'sync' events.
export async function runSync(mode, team) {
  if (state.sync.running) return false;
  state.sync = { ...state.sync, running: true, pct: 0, text: 'Starting...', exitCode: null, summary: '', finishedAt: 0 };
  notify('sync');
  let started = false;
  try { started = await bridge.request('sync.run', { mode, team }); } catch (e) { console.warn(e.message); }
  if (!started) {
    state.sync = { ...state.sync, running: false, text: '', exitCode: -1, summary: 'Could not start the sync' };
    notify('sync');
  }
  return started;
}

export function toggleFavorite(abbr) {
  const fav = favSet();
  if (fav.has(abbr)) fav.delete(abbr); else fav.add(abbr);
  const list = [...fav];
  // keep any team the person starred first at the front only visually; storage order is irrelevant
  saveSettings({ favorites: list });
  if (!fav.has(abbr)) return;
  // A newly starred team: ask the host to refresh it right away (favorites first).
  runSync('favorites');
}

// ---- loading ------------------------------------------------------------------------------
export async function loadDay(key) {
  const cur = state.days.get(key);
  if (cur && cur.source === 'live') return cur;
  const d = await readCache(`scoreboards/${key}.json`);
  if (d) { state.days.set(key, normDay(d, 'cache')); notify('days'); }
  return state.days.get(key) || null;
}

export async function refreshCachedDays() {
  try {
    const names = await bridge.request('cache.list', { dir: 'scoreboards' });
    state.cachedDayKeys = asArray(names).map((n) => n.replace('.json', '')).filter((n) => /^\d{8}$/.test(n)).sort().reverse();
    notify('days');
  } catch (e) { /* ignore */ }
}

// First run (or any run with gaps): quietly fetch one scoreboard per missing day since opening night.
let historyTried = false;
function autoHistory() {
  if (historyTried || !state.host || state.sample || state.settings.autoHistory === false) return;
  historyTried = true;
  const have = new Set(state.cachedDayKeys);
  const last = yesterdayKey();
  for (let k = SEASON_START; k <= last; k = addDaysKey(k, 1)) {
    if (!have.has(k)) { setTimeout(() => { if (!state.sync.running) runSync('history'); }, 6000); return; }
  }
}

export async function loadTeamFile(abbr) {
  if (state.teamFiles.has(abbr)) return state.teamFiles.get(abbr);
  const f = await readCache(`teams/${abbr}.json`);
  const file = f ? { ...f, players: asArray(f.players), games: asArray(f.games) } : null;
  state.teamFiles.set(abbr, file);
  notify('teamfile', `teamfile:${abbr}`);
  return file;
}

export async function loadStandings(force) {
  if (state.standings && !force) return state.standings;
  const s = await readCache('standings.json');
  if (s) { s.conferences = asArray(s.conferences).map((c) => ({ ...c, teams: asArray(c.teams) })); state.standings = s; notify('standings'); }
  return state.standings;
}

export async function loadInjuries(force) {
  if (state.injuries && !force) return state.injuries;
  const s = await readCache('injuries.json');
  if (s) { s.teams = asArray(s.teams).map((t) => ({ ...t, players: asArray(t.players) })); state.injuries = s; notify('injuries'); }
  return state.injuries;
}

export async function refreshCachedBoxes() {
  try {
    const names = await bridge.request('cache.list', { dir: 'boxscores' });
    state.cachedBoxIds = new Set(asArray(names).map((n) => n.replace('.json', '')));
  } catch (e) { /* ignore */ }
}

// Reads a saved box score without asking ESPN for it.
export async function loadBoxFile(id) {
  id = String(id);
  if (state.boxes.has(id)) return state.boxes.get(id);
  const b = await readCache(`boxscores/${id}.json`);
  if (!b) return null;
  normBox(b);
  state.boxes.set(id, b);
  return b;
}

// Season totals for one team, built from every saved box score of its finished games. Runs 6 reads at a time.
export async function loadSeason(abbr, force) {
  const cur = state.season.get(abbr);
  if (cur && !force && (cur.agg || cur.loading)) return cur;
  const entry = { agg: null, loaded: 0, total: 0, loading: true };
  state.season.set(abbr, entry);
  const file = await loadTeamFile(abbr);
  await refreshCachedBoxes();
  const ids = new Set();
  (file ? file.games : []).forEach((g) => { if (g.state === 'post' && g.id) ids.add(String(g.id)); });
  allEvents().forEach((e) => { if (e.state === 'post' && e.sides.some((s) => s.abbr === abbr)) ids.add(e.id); });
  const have = [...ids].filter((id) => state.cachedBoxIds.has(id) || state.boxes.has(id));
  entry.total = ids.size;
  const boxes = [];
  let next = 0;
  const worker = async () => {
    while (next < have.length) {
      const id = have[next++];
      const b = await loadBoxFile(id);
      if (b && b.teams.some((t) => t.team === abbr)) boxes.push(b);
      entry.loaded++;
      if (entry.loaded % 8 === 0) notify('season');
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, have.length) }, worker));
  entry.agg = aggregate(boxes, abbr);
  entry.have = boxes.length;
  entry.loading = false;
  notify('season', `season:${abbr}`);
  return entry;
}

// League-wide season totals, kept in cache\league-stats.json and topped up one new saved box score at a time.
export async function loadLeague() {
  const L = state.league;
  if (L.loading) return L;
  L.loading = true; L.n = 0; L.total = 0;
  notify('league');
  try {
    let data = await readCache('league-stats.json');
    if (!data || data.version !== LEAGUE_VERSION || !data.players || !data.teams) data = newLeague();
    await refreshCachedBoxes();
    const done = new Set(data.done);
    const todo = [...state.cachedBoxIds].filter((id) => !done.has(id));
    L.total = todo.length;
    L.data = data;                                   // show what we already have while the rest loads
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const id = todo[next++];
        const b = await readCache(`boxscores/${id}.json`);
        if (b) { normBox(b); leagueAdd(data, b); }
        data.done.push(id);
        L.n++;
        if (L.n % 10 === 0) { L.rev++; notify('league'); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, todo.length) }, worker));
    if (todo.length) {
      try { await bridge.request('cache.write', { path: 'league-stats.json', text: JSON.stringify(data) }); } catch (e) { console.warn('league save failed', e.message); }
    }
  } finally {
    L.loading = false; L.rev++;
    notify('league');
  }
  return L;
}

export async function ensureBox(id) {
  id = String(id);
  if (state.boxes.has(id)) return state.boxes.get(id);
  const r = await bridge.request('box.get', { id });
  if (r && r.pending) return null;            // arrives later as a 'box' event
  if (r) {
    normBox(r);
    state.boxes.set(id, r);
    notify('box', `box:${id}`);
  }
  return r || null;
}

export async function init() {
  await bridge.ready();
  const info = await bridge.request('init');
  state.settings = { ...state.settings, ...(info.settings || {}) };
  state.settings.favorites = asArray(state.settings.favorites).map(toEspnCode);
  state.sync = { ...state.sync, ...(info.sync || {}) };
  state.cacheDir = info.cacheDir || '';
  state.version = info.version || '';
  state.sample = !!info.sample;
  state.update.note = info.updateNote || null;
  applyTheme();

  bridge.on('scoreboard', onScoreboard);
  bridge.on('box', (d) => { normBox(d.box); onBox(d); });
  bridge.on('live', onLive);
  bridge.on('sync', onSync);
  bridge.on('update', onUpdate);
  bridge.on('player', onPlayer);
  bridge.on('psearch', onPSearch);
  state.compare = loadCompare();
  bridge.on('standings', (d) => { d.conferences = asArray(d.conferences).map((c) => ({ ...c, teams: asArray(c.teams) })); onStandings(d); });
  bridge.on('injuries', (d) => { d.teams = asArray(d.teams).map((t) => ({ ...t, players: asArray(t.players) })); onInjuries(d); });

  const teams = asArray(await readCache('teams.json'));
  state.teams = teams;
  state.byAbbr = new Map(teams.map((t) => [t.abbr, t]));
  state.byId = new Map(teams.map((t) => [String(t.id), t]));
  state.ready = true;
  notify('teams', 'favorites');

  loadDay(yesterdayKey());
  loadDay(todayKey());
  refreshCachedDays().then(autoHistory);
  loadStandings();
  loadInjuries();
  if (state.host && state.settings.updateCheck !== false && !state.update.note) setTimeout(() => checkUpdate({ quiet: true }), 4000);
  // first-run default: the person's team is a good starting favorite only if they have none
  return state;
}
