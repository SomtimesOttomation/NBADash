import * as S from '../store.js';
import { h, debounce } from '../util.js';
import { avatar, headshotUrl } from '../components.js';
import { displayCode } from '../arenas.js';

// Player search box in the top bar: searches the cached rosters instantly, and asks ESPN when that finds little.
const RECENT_KEY = 'nbadash.recentPlayers';
const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
const clearRecents = () => { try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } };
const remember = (it) => {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: it.id, name: it.name, headshot: it.headshot, team: it.team, sub: it.sub }, ...recents().filter((r) => r.id !== it.id)].slice(0, 6))); } catch { /* ignore */ }
};

// Bold the part of the name the person has typed ("luk" in Luka Doncic).
function highlight(name, q) {
  const words = S.fold(q).split(' ').filter(Boolean);
  if (!words.length) return name;
  const parts = []; let i = 0;
  const lower = S.fold(name);                          // same length as the name for plain letters; fall back to plain text if not
  if (lower.length !== name.length) return name;
  while (i < name.length) {
    const hit = words.find((w) => lower.startsWith(w, i) && (i === 0 || lower[i - 1] === ' '));
    if (hit) { parts.push(h('mark', null, name.slice(i, i + hit.length))); i += hit.length; } else { parts.push(name[i]); i++; }
  }
  return parts;
}

export function initPlayerSearch() {
  const input = document.getElementById('psearch');
  const box = document.getElementById('psearch-results');
  if (!input || !box) return;
  let items = [];          // rows currently shown: { id, name, headshot, sub, team }
  let active = -1;
  let remoteQ = '';
  const ghost = document.getElementById('psearch-ghost');

  const close = () => { box.hidden = true; active = -1; };
  const go = (it) => { remember(it); input.value = ''; ghost.textContent = ''; close(); input.blur(); location.hash = `#/player/${it.id}`; };

  const rowFor = (it, i) => {
    const added = S.inCompare(it.id);
    return h('li', { class: `ps-row ${i === active ? 'active' : ''}`, role: 'option', onmousedown: (e) => e.preventDefault(), onclick: () => go(it) },
      avatar(it.name, it.headshot || headshotUrl(it.id), 34),
      h('span', { class: 'ps-name' }, h('b', null, highlight(it.name, input.value)), h('small', null, it.sub)),
      h('button', { class: `ps-add ${added ? 'on' : ''}`, type: 'button', title: added ? 'Remove from comparison' : 'Add to comparison',
        onclick: (e) => { e.stopPropagation(); if (S.toggleCompare(it) === false) alert_full(); draw(); } }, added ? '✓ Compare' : '+ Compare'));
  };
  const alert_full = () => { input.title = `You can compare up to ${S.COMPARE_MAX} players`; };

  function compute() {
    const q = input.value.trim();
    const local = S.searchPlayers(q).map((p) => ({ id: p.id, name: p.name, headshot: p.headshot, team: p.abbr,
      sub: [displayCode(p.abbr), p.pos, p.jersey ? `#${p.jersey}` : ''].filter(Boolean).join(' · ') }));
    const seen = new Set(local.map((x) => x.id));
    const remote = (S.state.psearch.q === q ? S.state.psearch.items : []).filter((r) => !seen.has(r.id)).map((r) => ({ id: r.id, name: r.name, headshot: r.headshot, team: '',
      sub: [r.team, r.pos, r.retired ? 'retired' : ''].filter(Boolean).join(' · ') }));
    items = [...local, ...remote];
    return { q, nLocal: local.length };
  }

  function draw() {
    const { q, nLocal } = compute();
    setGhost(q);
    if (!q) {
      // nothing typed yet: offer the players opened recently
      const rec = recents();
      if (!rec.length || document.activeElement !== input) { close(); return; }
      items = rec; box.hidden = false;
      box.replaceChildren(h('ul', { role: 'listbox' }, h('li', { class: 'ps-note ps-recent-head' }, h('span', null, 'Recent'),
        h('button', { class: 'ps-clear', type: 'button', title: 'Clear recent searches', onmousedown: (e) => e.preventDefault(), onclick: (e) => { e.stopPropagation(); clearRecents(); draw(); } }, 'Clear')),
        items.map(rowFor)));
      return;
    }
    box.hidden = false;
    const loading = S.state.psearch.q === q && S.state.psearch.loading;
    box.replaceChildren(h('ul', { role: 'listbox' },
      items.length ? items.map(rowFor) : h('li', { class: 'ps-empty' }, loading ? 'Searching ESPN…' : (q.length < 2 ? 'Keep typing…' : 'No players found')),
      items.length && loading ? h('li', { class: 'ps-empty' }, 'Searching ESPN for more…') : null,
      nLocal && items.length > nLocal ? h('li', { class: 'ps-note' }, 'More from ESPN above this line') : null));
  }

  // Grey completion text after what was typed: the top suggestion's name, accepted with Tab or the right arrow.
  function setGhost(q) {
    const top = items[0];
    if (!q || !top || S.fold(top.name).indexOf(S.fold(q)) !== 0 || S.fold(q).length !== q.length || top.name.length <= q.length) { ghost.textContent = ''; return; }
    ghost.replaceChildren(h('span', { style: { visibility: 'hidden' } }, q), top.name.slice(q.length));
  }

  const askRemote = debounce(() => {
    const q = input.value.trim();
    if (q.length < 3 || q === remoteQ) return;
    if (S.searchPlayers(q).length >= 3) return;          // the rosters already answer it
    remoteQ = q; S.remoteSearch(q);
  }, 450);

  input.addEventListener('focus', async () => { await S.buildPlayerIndex(); draw(); });
  input.addEventListener('input', async () => { await S.buildPlayerIndex(); active = -1; draw(); askRemote(); });
  input.addEventListener('blur', () => setTimeout(() => { close(); ghost.textContent = ''; }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if ((e.key === 'Tab' || e.key === 'ArrowRight') && ghost.textContent && input.selectionStart === input.value.length) {
      e.preventDefault();
      input.value = items[0].name; active = 0; draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active >= 0 ? active : 0];
      if (it) go(it);
    } else if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement === document.body) { e.preventDefault(); input.focus(); }
  });
  S.subscribe((t) => { if ((t.has('psearch') || t.has('compare')) && !box.hidden) draw(); });
}
