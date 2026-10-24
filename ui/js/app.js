import * as S from './store.js';
import * as bridge from './bridge.js';
import { h, ago } from './util.js';
import { renderBanner, renderWeekBar } from './components.js';
import * as home from './views/home.js';
import * as teamV from './views/team.js';
import * as gameV from './views/game.js';
import * as standings from './views/standings.js';
import * as leadersV from './views/leaders.js';
import * as rankingsV from './views/rankings.js';
import * as txV from './views/transactions.js';
import { openSettings } from './views/settings.js';
import { openTraffic } from './views/traffic.js';
import { openUpdate } from './views/update.js';
import * as playerV from './views/player.js';
import * as weekV from './views/week.js';
import * as compareV from './views/compare.js';
import { initPlayerSearch } from './views/psearch.js';
import { renderCompareBar } from './views/cmpbar.js';

const $ = (s) => document.querySelector(s);
const view = $('#view');
let current = null; // { mod, update }

export function toast(msg) {
  const t = h('div', { class: 'toast' }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 3500);
}

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [name, arg] = hash.split('/');
  const map = { '': home, team: teamV, game: gameV, standings, leaders: leadersV, rankings: rankingsV, transactions: txV, player: playerV, compare: compareV, week: weekV };
  const mod = map[name] || home;
  const routeName = map[name] ? (name || 'home') : 'home';
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === routeName));
  current?.cleanup?.();
  view.replaceChildren();
  const ctx = { el: view, arg: arg ? decodeURIComponent(arg) : '' };
  current = { mod, ctx, cleanup: mod.mount(ctx) };
  renderBanner($('#banner'), routeName === 'team' ? ctx.arg : '');
  renderWeekBar($('#weekbar'), routeName === 'week' ? +ctx.arg : 0);
  window.scrollTo(0, 0);
}

function themeIcon() {
  const t = S.state.settings.theme;
  $('#btn-theme').textContent = t === 'dark' ? '☾' : t === 'light' ? '☀' : '◐';
  $('#btn-theme').title = `Theme: ${t} (click to change)`;
}

// ---- updates: one quiet nudge when the startup check finds something; the version chip carries the rest
let nudged = '';
function updateToast() {
  const u = S.state.update;
  if (u.phase === 'available' && u.quiet && nudged !== u.info?.latest) { nudged = u.info.latest; toast(`Version ${u.info.latest} is available. Click the version number to update.`); }
}

// ---- sync progress strip --------------------------------------------------------------------
let lastRunning = false;
function syncBar() {
  const bar = $('#syncbar'), sy = S.state.sync;
  const fill = bar.querySelector('.syncbar-fill'), txt = bar.querySelector('.syncbar-text');
  if (sy.running) {
    bar.hidden = false; bar.classList.remove('fail');
    bar.classList.toggle('indeterminate', !sy.pct);
    fill.style.width = `${sy.pct || 0}%`;
    txt.textContent = `Updating data \u00b7 ${sy.pct ? sy.pct + '% \u00b7 ' : ''}${sy.text || sy.line || ''}`;
  } else if (lastRunning) {
    const ok = sy.exitCode === 0 || sy.exitCode == null;
    bar.classList.remove('indeterminate'); bar.classList.toggle('fail', !ok);
    fill.style.width = '100%';
    txt.textContent = ok ? `Update finished${sy.summary ? ' \u00b7 ' + sy.summary : ''}` : `Update finished with errors${sy.summary ? ' \u00b7 ' + sy.summary : ''}`;
    toast(txt.textContent);
    setTimeout(() => { if (!S.state.sync.running) bar.hidden = true; }, 6000);
  }
  lastRunning = !!sy.running;
}

function liveStatus() {
  const el = $('#live-status');
  const l = S.state.live;
  const anyLive = S.allEvents().some((e) => e.state === 'in');
  el.className = `live-status ${anyLive ? 'on' : ''} ${l.error ? 'err' : ''}`;
  const manual = !S.state.settings.autoRefresh;
  el.textContent = l.error ? 'Offline' : manual ? (l.at ? `Manual \u00b7 updated ${ago(l.at)}` : 'Manual refresh') : anyLive ? 'Live' : (l.at ? `Updated ${ago(l.at)}` : '');
  el.title = l.error || '';
}

// secret: five clicks on the brand within 3 seconds opens the traffic panel; otherwise it goes home
let clicks = [];
$('#brand').addEventListener('click', () => {
  const now = Date.now();
  clicks = clicks.filter((t) => now - t < 3000).concat(now);
  if (clicks.length >= 5) { clicks = []; openTraffic(); } else if (clicks.length === 1) location.hash = '#/';
});

$('#btn-theme').addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(S.state.settings.theme) + 1) % 3];
  S.saveSettings({ theme: next });
});
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-version').addEventListener('click', openUpdate);

function versionChip() {
  const b = $('#btn-version'), u = S.state.update;
  b.textContent = S.state.version ? `v${S.state.version}` : '';
  b.hidden = !S.state.version;
  b.classList.toggle('has-update', S.updateReady());
  b.title = u.phase === 'available' ? `Version ${u.info?.latest} is available` : u.phase === 'staged' ? 'Update downloaded: click to install' : 'Check for updates';
}
$('#btn-refresh').addEventListener('click', async () => {
  const b = $('#btn-refresh'); b.classList.add('spin');
  try { await bridge.request('live.refresh'); } catch (e) { toast(e.message); }
  b.classList.remove('spin');
});
document.addEventListener('keydown', (e) => { if (e.key === 'F5') { e.preventDefault(); $('#btn-refresh').click(); } });

S.subscribe((topics) => {
  if (topics.has('theme') || topics.has('settings')) themeIcon();
  if (topics.has('settings')) liveStatus();
  if (topics.has('teams') || topics.has('favorites')) renderBanner($('#banner'), location.hash.startsWith('#/team/') ? decodeURIComponent(location.hash.slice(7)) : '');
  if (topics.has('days')) renderWeekBar($('#weekbar'), location.hash.startsWith('#/week/') ? +location.hash.slice(7) : 0);
  if (topics.has('live') || topics.has('days')) liveStatus();
  if (topics.has('sync')) syncBar();
  if (topics.has('update')) { versionChip(); updateToast(); }
  if (topics.has('compare')) renderCompareBar($('#cmpbar'));
  current?.mod.update?.(topics, current.ctx);
});
setInterval(liveStatus, 15000);

window.addEventListener('hashchange', route);
S.init().then(() => {
  themeIcon(); liveStatus(); route(); versionChip(); initPlayerSearch(); renderCompareBar($('#cmpbar'));
  const n = S.state.update.note;
  if (n) toast(n.ok ? `Updated to v${n.to}.` : `The update to v${n.to} did not work (${n.reason || 'unknown reason'}). v${n.from} was restored.`);
}).catch((e) => {
  view.replaceChildren(h('div', { class: 'empty' }, h('h3', null, 'Could not start'), h('p', null, e.message)));
});
