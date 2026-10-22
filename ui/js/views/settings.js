import * as S from '../store.js';
import * as bridge from '../bridge.js';
import { h, ago } from '../util.js';
import { displayCode } from '../arenas.js';
import { teamLogo } from '../components.js';
import { openUpdate } from './update.js';

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

export function openSettings() {
  overlay((close) => {
    const s = S.state.settings;
    const sync = S.state.sync;
    const favs = S.favSet();
    return h('div', null,
      h('h2', null, 'Settings'),
      h('p', null, h('b', null, 'Theme '),
        ['system', 'light', 'dark'].map((t) => h('button', { class: `btn ${s.theme === t ? 'primary' : ''}`, type: 'button', style: { marginRight: '6px' }, onclick: () => { S.saveSettings({ theme: t }); close(); } }, t))),
      h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.autoWatch ? true : null, onchange: (e) => S.saveSettings({ autoWatch: e.target.checked }) }),
        ' Automatically watch live box scores for my favorite teams')),
      h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.updateCheck !== false ? true : null, onchange: (e) => S.saveSettings({ updateCheck: e.target.checked }) }),
        ' Check GitHub for a new version when the app starts '), h('button', { class: 'btn', type: 'button', style: { marginLeft: '8px' }, onclick: () => { close(); openUpdate(); } }, `v${S.state.version || '?'} - Check for updates`)),
      h('p', null, h('b', null, 'Favorites '), favs.size ? [...favs].map((a) => h('span', { style: { marginRight: '6px' } }, teamLogo(a, 26))) : h('small', null, 'none yet – star a team in the banner')),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--line)' } }),
      h('p', null, h('b', null, 'Data cache '), h('small', null, S.state.cacheDir || '(dev preview)')),
      syncPanel(),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--line)' } }),
      timingPanel(),
      h('p', { style: { textAlign: 'right' } }, h('button', { class: 'btn primary', type: 'button', onclick: close }, 'Done')));
  });
}
void displayCode;

// Adjustable refresh timing. Values are clamped to the allowed range and saved when the field loses focus.
function timingPanel() {
  const s = S.state.settings;
  const rows = Object.entries(S.TUNING).map(([key, [def, min, max, label, unit, help]]) => {
    const input = h('input', { type: 'number', min, max, step: 1, value: s[key] ?? def, class: 'tune-input', 'aria-label': label, 'data-key': key,
      onchange: (e) => { let v = Math.round(Number(e.target.value)); if (!Number.isFinite(v)) v = def; v = Math.min(max, Math.max(min, v)); e.target.value = v; S.saveSettings({ [key]: v }); } });
    return h('label', { class: 'tune-row', title: help }, h('span', null, label, h('small', null, help)), h('span', { class: 'tune-val' }, input, ' ', unit));
  });
  return h('div', null,
    h('p', null, h('b', null, 'Refresh timing '), h('button', { class: 'btn', type: 'button', style: { marginLeft: '8px' }, onclick: () => {
      S.saveSettings({ ...S.TUNE_DEFAULTS }); document.querySelectorAll('.tune-input').forEach((i) => { i.value = S.TUNE_DEFAULTS[i.dataset.key]; });
    } }, 'Reset to defaults')),
    h('p', null, h('label', null, h('input', { type: 'checkbox', checked: s.autoHistory !== false ? true : null, onchange: (e) => S.saveSettings({ autoHistory: e.target.checked }) }),
      ' Fill in missing season days automatically at startup')),
    h('div', { class: 'tune' }, rows),
    h('small', null, 'Faster live refresh means more requests to ESPN; the defaults are polite. Live, idle and standings changes apply immediately; the sync values apply to the next sync, including the nightly task.'));
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
