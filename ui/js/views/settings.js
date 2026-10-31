import * as S from '../store.js';
import * as bridge from '../bridge.js';
import { h, ago } from '../util.js';
import { displayCode } from '../arenas.js';
import { teamLogo } from '../components.js';
import { openUpdate } from './update.js';
import { RATING_METHODS } from '../stats.js';
import { METHOD_NOTES } from '../formulas.js';

function overlay(content) {
  const root = document.getElementById('overlay-root');
  const close = () => { root.replaceChildren(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  const o = h('div', { class: 'overlay', onclick: (e) => { if (e.target === o) close(); } }, h('div', { class: 'card modal' }, content(close)));
  root.replaceChildren(o);
  return close;
}
export { overlay };

const TAB_KEY = 'nbadash.settingsTab';
let settingsTab = 'general';
try { const v = localStorage.getItem(TAB_KEY); if (['general', 'data', 'sync'].includes(v)) settingsTab = v; } catch (e) { /* ignore */ }

const hr = () => h('hr', { style: { border: 0, borderTop: '1px solid var(--line)' } });

function generalTab(close, repaint) {
  const s = S.state.settings;
  const favs = S.favSet();
  return [
    S.inLauncher()
      ? h('p', null, h('b', null, 'Theme '), h('small', null, 'Follows DashLauncher.'))
      : h('p', null, h('b', null, 'Theme '),
        [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([t, label]) => h('button', { class: `btn ${s.theme === t ? 'primary' : ''}`, type: 'button', style: { marginRight: '6px' }, onclick: () => { S.saveSettings({ theme: t }); repaint(); } }, label))),
    hr(),
    h('p', null, h('b', null, 'Check for Updates')),
    h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.updateCheck !== false ? true : null, onchange: (e) => S.saveSettings({ updateCheck: e.target.checked }) }),
      ' Check GitHub for a new version when the app starts '), h('button', { class: 'btn', type: 'button', style: { marginLeft: '8px' }, onclick: () => { close(); openUpdate(); } }, `v${S.state.version || '?'} - Check for updates`)),
    hr(),
    h('p', null, h('b', null, 'Favorites '), favs.size ? [...favs].map((a) => h('span', { style: { marginRight: '6px' } }, teamLogo(a, 26))) : h('small', null, 'none yet \u2013 star a team in the banner')),
  ];
}

function dataTab() {
  const s = S.state.settings;
  return [
    ratingsPanel(),
    hr(),
    salaryPanel(),
    h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.showForm !== false ? true : null, onchange: (e) => S.saveSettings({ showForm: e.target.checked }) }),
      ' Show the Form rating (DARKO-style) on Leaderboards and player pages')),
    h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.showSwings ? true : null, onchange: (e) => S.saveSettings({ showSwings: e.target.checked }) }),
      ' Show win / loss moves in Standings (where each team playing today would move with a win or a loss)')),
    hr(),
    h('p', null, h('b', null, 'Data cache '), h('small', null, S.state.cacheDir || '(dev preview)')),
    syncPanel(),
  ];
}

function syncTab() {
  return [nightlyPanel(), hr(), timingPanel()];
}

export function openSettings() {
  overlay((close) => {
    const body = h('div', { class: 'settings-body', role: 'tabpanel' });
    const tabs = h('div', { class: 'seg settings-tabs', role: 'tablist', 'aria-label': 'Settings sections' });
    const paint = () => {
      tabs.replaceChildren(...[['general', 'General'], ['data', 'Data'], ['sync', 'Sync']].map(([k, label]) => h('button', {
        type: 'button', role: 'tab', 'aria-selected': settingsTab === k ? 'true' : 'false', class: settingsTab === k ? 'active' : '',
        onclick: () => { settingsTab = k; try { localStorage.setItem(TAB_KEY, k); } catch (e) { /* ignore */ } paint(); } }, label)));
      body.replaceChildren(...(settingsTab === 'data' ? dataTab() : settingsTab === 'sync' ? syncTab() : generalTab(close, paint)));
    };
    paint();
    return h('div', null,
      h('h2', null, 'Settings'),
      tabs,
      body,
      h('p', { style: { textAlign: 'right' } }, h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Done')));
  });
}

void displayCode;

// Nightly sync: a Windows scheduled task (current user, no admin rights) that runs the cache sync at a time the person picks.
// Off until they turn it on; it contacts ESPN on its own, so enabling needs the same acknowledgement as automatic refresh.
function nightlyPanel() {
  const box = h('div');
  let st = null, busy = false, msg = '', ackOn = false;
  const call = async (cmd, args) => {
    busy = true; paint();
    try {
      const r = await bridge.request(cmd, args, 45000);
      st = { exists: !!r.exists, time: r.time || '' };
      msg = r.ok === false ? `Could not change the task${r.message ? ': ' + r.message : ''}` : (cmd === 'schedule.remove' ? 'Nightly sync turned off.' : cmd === 'schedule.set' ? `Nightly sync set for ${r.time}.` : '');
    } catch (e) { msg = e.message || 'Could not reach the scheduler.'; }
    busy = false; paint();
  };
  const paint = () => {
    const time = h('input', { type: 'time', class: 'tune-input', style: { width: '110px' }, value: st?.time || '04:00', 'aria-label': 'Nightly sync time', required: true });
    const valid = () => /^([01]\d|2[0-3]):[0-5]\d$/.test(time.value);
    const head = h('p', null, h('b', null, 'Nightly sync '),
      st === null ? h('small', null, 'checking\u2026') : st.exists ? h('small', null, `scheduled daily at ${st.time} (this computer\u2019s local time)`) : h('small', null, 'off'));
    if (!S.state.host) { box.replaceChildren(head, h('small', null, 'Available in the desktop app.')); return; }
    let controls;
    if (st && st.exists) {
      controls = h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, time,
        h('button', { class: 'btn', type: 'button', disabled: busy ? true : null, onclick: () => { if (valid()) call('schedule.set', { time: time.value }); } }, 'Change time'),
        h('button', { class: 'btn', type: 'button', disabled: busy ? true : null, onclick: () => call('schedule.remove') }, 'Turn off'));
    } else if (st) {
      const ack = h('input', { type: 'checkbox', checked: ackOn ? true : null });
      const go = h('button', { class: 'btn primary', type: 'button', disabled: (busy || !ackOn) ? true : null, onclick: () => { if (valid()) call('schedule.set', { time: time.value }); } }, 'Schedule nightly sync');
      ack.addEventListener('change', () => { ackOn = ack.checked; go.disabled = busy || !ackOn; });
      controls = h('div', null,
        h('small', null, 'Runs the cache sync once a day (about 35 requests to ESPN for rosters, schedules, standings, injuries and new box scores), even if you are not using the app. Missed runs start when the PC is next awake and online. Like automatic refresh, this contacts ESPN without you pressing anything, which ESPN may not welcome.'),
        h('div', { style: { margin: '8px 0', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', null, 'Run daily at '), time),
        h('label', null, ack, ' I understand and accept this risk'),
        h('div', { style: { marginTop: '8px' } }, go));
    }
    box.replaceChildren(...[head, controls, msg ? h('small', { style: { display: 'block', marginTop: '6px' } }, msg) : null].filter(Boolean));
  };
  paint();
  bridge.request('schedule.get').then((r) => { st = { exists: !!r.exists, time: r.time || '' }; paint(); }).catch(() => { st = { exists: false, time: '' }; msg = 'Could not read the scheduled task.'; paint(); });
  return box;
}

// Automatic refresh is opt-in. Off (default): ESPN is contacted only when the person presses refresh, opens a box score or runs a sync.
// On: the person has accepted the warning and can tune how often the app polls. Values are clamped and saved on change.
function timingPanel() {
  const box = h('div');
  let confirming = false;
  const paint = () => {
    const s = S.state.settings;
    if (!s.autoRefresh) {
      const ack = h('input', { type: 'checkbox' });
      const go = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: () => { S.saveSettings({ autoRefresh: true }); confirming = false; paint(); } }, 'Turn on automatic refresh');
      ack.addEventListener('change', () => { go.disabled = !ack.checked; });
      box.replaceChildren(
        h('p', null, h('b', null, 'Data refresh: manual '), h('small', null, 'NBADash only contacts ESPN when you press the refresh button (top right, or F5), open a box score, or run a sync from the Data tab.')),
        confirming
          ? h('div', { class: 'card pad warn' },
              h('b', null, 'Before you turn this on'),
              h('p', null, 'Automatic refresh polls ESPN\u2019s servers repeatedly while the app is open. ESPN has no official public API and does not publish limits for it. Polling too often can get your connection rate-limited or blocked by ESPN, and could lead to a longer ban. You are responsible for the cadence you choose; the defaults are deliberately gentle.'),
              h('label', null, ack, ' I understand and accept this risk'),
              h('div', { style: { marginTop: '8px', display: 'flex', gap: '8px' } }, go, h('button', { class: 'btn', type: 'button', onclick: () => { confirming = false; paint(); } }, 'Cancel')))
          : h('button', { class: 'btn', type: 'button', onclick: () => { confirming = true; paint(); } }, 'Enable automatic refresh\u2026'));
      return;
    }
    const rows = Object.entries(S.TUNING).map(([key, [def, min, max, label, unit, help]]) => {
      const input = h('input', { type: 'number', min, max, step: 1, value: s[key] ?? def, class: 'tune-input', 'aria-label': label, 'data-key': key,
        onchange: (e) => { let v = Math.round(Number(e.target.value)); if (!Number.isFinite(v)) v = def; v = Math.min(max, Math.max(min, v)); e.target.value = v; S.saveSettings({ [key]: v }); } });
      return h('label', { class: 'tune-row', title: help }, h('span', null, label, h('small', null, help)), h('span', { class: 'tune-val' }, input, ' ', unit));
    });
    box.replaceChildren(
      h('p', null, h('b', null, 'Data refresh: automatic '), h('button', { class: 'btn', type: 'button', style: { marginLeft: '8px' }, onclick: () => { S.saveSettings({ autoRefresh: false }); paint(); } }, 'Switch back to manual')),
      h('p', null, h('small', { class: 'warn-text' }, 'Automatic refresh can get you rate-limited or banned by ESPN if set too aggressively.')),
      h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.autoWatch ? true : null, onchange: (e) => S.saveSettings({ autoWatch: e.target.checked }) }),
        ' Automatically watch live box scores for my favorite teams')),
      h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.autoHistory !== false ? true : null, onchange: (e) => S.saveSettings({ autoHistory: e.target.checked }) }),
        ' Fill in missing season days automatically at startup')),
      h('p', null, h('b', null, 'Refresh timing '), h('button', { class: 'btn', type: 'button', style: { marginLeft: '8px' }, onclick: () => {
        S.saveSettings({ ...S.TUNE_DEFAULTS }); document.querySelectorAll('.tune-input').forEach((i) => { i.value = S.TUNE_DEFAULTS[i.dataset.key]; });
      } }, 'Reset to defaults')),
      h('div', { class: 'tune' }, rows),
      h('small', null, 'Live, idle and standings changes apply immediately; the sync values apply to the next sync, including the nightly task.'));
  };
  paint();
  const unsub = S.subscribe((t) => { if (!box.isConnected) { unsub(); return; } if (t.has('recount') || t.has('league')) paint(); });
  return box;
}


// Salaries for the Best / Worst Value cards: one ESPN request per player, only when pressed.
function salaryPanel() {
  const box = h('div', { class: 'rate-panel' });
  const paint = () => {
    const sal = S.state.salaries, J = S.state.salaryJob;
    const known = sal ? Object.values(sal.players || {}).filter((v) => v && v.salary > 0).length : 0;
    const none = sal ? Object.values(sal.players || {}).filter((v) => v === null).length : 0;
    const status = J && J.running ? `Loading salaries… ${J.n} of ${J.total} players (${J.found} found).`
      : sal && sal.fetchedAt ? `${known} salaries loaded ${String(sal.fetchedAt).slice(0, 10)}${none ? `; ESPN has no contract this season for ${none} (shown without a value)` : ''}.`
      : 'Not loaded yet.';
    box.replaceChildren(
      h('p', { style: { marginBottom: '6px' } }, h('b', null, 'Salaries '), h('small', null, 'For the Best Value and Worst Value cards on Leaderboards. From ESPN’s contracts data: one request per rostered player (about 500, one per second, roughly 9 minutes), favourite teams first. Saved for the season.')),
      h('p', null, h('small', null, status), ' ',
        h('button', { class: 'btn', type: 'button', disabled: (J && J.running) || S.state.halted ? true : null,
          onclick: () => S.fetchSalaries({ onlyMissing: false }).catch((e) => { S.state.salaryJob = { running: false, error: e.message }; paint(); }) }, sal && sal.fetchedAt ? 'Reload all salaries' : 'Load salaries from ESPN'),
        sal && sal.fetchedAt ? [' ', h('button', { class: 'btn', type: 'button', disabled: (J && J.running) || S.state.halted ? true : null, title: 'Only players with no saved answer yet (new signings, trades)',
          onclick: () => S.fetchSalaries({ onlyMissing: true }).catch(() => {}) }, 'Load new players only')] : null));
  };
  S.loadSalaries().then(paint);
  paint();
  const unsub = S.subscribe((t) => { if (!box.isConnected) { unsub(); return; } if (t.has('salaries')) paint(); });
  return box;
}

// Which possession formula the team ratings (ORtg, DRtg, Net) use.
function ratingsPanel() {
  const box = h('div', { class: 'rate-panel' });
  const paint = () => {
    const cur = S.state.settings.ratingMethod || 'native';
    box.replaceChildren(
      h('p', { style: { marginBottom: '6px' } }, h('b', null, 'Ratings formula '), h('small', null, 'Which source\u2019s Offensive, Defensive and Net Rating to match. Hover any rating for the full formula.')),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Ratings formula' }, Object.entries(RATING_METHODS).map(([k, label]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': cur === k ? 'true' : 'false', class: cur === k ? 'active' : '',
        onclick: () => { S.saveSettings({ ratingMethod: k }); paint(); } }, label))),
      h('p', null, h('small', null, METHOD_NOTES[cur])),
      cur === 'nba' ? onCourtBox() : '');
  };
  // NBA.com player ratings need on-court counts; box scores saved before v0.18 don't have them.
  const onCourtBox = () => {
    const lg = S.state.league.data, missing = (lg && lg.noOc) ? lg.noOc.length : 0, R = S.state.recount;
    if (R && R.running) return h('p', null, h('small', null, `Counting on-court ratings\u2026 ${R.n} of ${R.total} games.`));
    if (!missing) return h('p', null, h('small', null, R && R.total ? `On-court ratings counted for ${R.ok} older games.` : 'Every saved game has on-court counts.'));
    return h('p', null, h('small', null, `${missing} saved game${missing === 1 ? '' : 's'} from before on-court counting. Players who played in them show \u2013 for ORtg and DRtg until they are counted. `),
      h('button', { class: 'btn', type: 'button', disabled: S.state.halted ? true : null, title: `Fetches those ${missing} box scores from ESPN again, one per second`,
        onclick: () => S.recountOnCourt().catch((e) => { S.state.recount = { running: false, error: e.message }; paint(); }) }, `Count them (${missing} request${missing === 1 ? '' : 's'}, ~${Math.ceil(missing / 60)} min)`));
  };
  paint();
  return box;
}

// Live status for the sync buttons: progress bar, current step, last result. Repaints on every 'sync' event.
function syncPanel() {
  const box = h('div', { class: 'syncpanel' });
  const modes = [['favorites', 'Update favorites now', 'Roster, schedule, standings and injuries for your favorite teams, plus recent box scores'],
                 ['all', 'Update everything', 'Everything that is out of date: stale teams, new finished games and their box scores'],
                 ['force', 'Force full refresh', 'Re-download all 30 teams regardless of age (takes several minutes)'],
                 ['history', 'Fill in season history', 'One scoreboard per day since opening night, for the Week pages (a few seconds per week; runs on its own the first time)'],
                 ['historyBoxes', 'Download full season history', 'Also downloads every missing box score for the season so far (about 8 KB per game; can be cancelled and resumed)']];
  const paint = () => {
    if (!box.isConnected && box.dataset.mounted) { unsub(); return; }
    box.dataset.mounted = '1';
    const sy = S.state.sync;
    const status = sy.running
      ? h('div', null, h('b', null, `${sy.pct ? sy.pct + '% \u00b7 ' : ''}${sy.text || 'Starting...'}`), h('div', { class: 'bar' }, h('i', { style: { width: `${sy.pct || 3}%` } })), h('button', { class: 'btn', type: 'button', onclick: () => bridge.request('sync.cancel') }, 'Cancel update'))
      : h('small', null, sy.summary ? `Last result: ${sy.summary}` : `Last sync ${sy.lastRun ? ago(Date.parse(sy.lastRun)) : 'never'}`);
    box.replaceChildren(
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        modes.map(([m, label, tip]) => h('button', { class: 'btn', type: 'button', title: tip, disabled: sy.running ? true : null, onclick: () => S.runSync(m) }, label))),
      h('div', { style: { marginTop: '10px', minHeight: '38px' } }, status));
  };
  const unsub = S.subscribe((t) => { if (t.has('sync')) paint(); });
  paint();
  return box;
}
