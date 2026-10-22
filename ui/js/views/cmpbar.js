import * as S from '../store.js';
import { h } from '../util.js';
import { avatar, headshotUrl } from '../components.js';

// The tray at the bottom of the window listing the players picked for comparison.
export function renderCompareBar(el) {
  const list = S.state.compare;
  el.hidden = list.length === 0;
  document.body.classList.toggle('has-cmpbar', list.length > 0);
  if (!list.length) { el.replaceChildren(); return; }
  const ids = list.map((c) => c.id);
  el.replaceChildren(h('div', { class: 'cmpbar-in' },
    h('b', { class: 'cmpbar-title' }, 'Compare'),
    h('div', { class: 'cmpbar-chips' }, list.map((c) => h('span', { class: 'cmp-chip' },
      avatar(c.name, c.headshot || headshotUrl(c.id), 24),
      h('a', { href: `#/player/${c.id}` }, c.name),
      h('button', { type: 'button', title: 'Remove', onclick: () => S.toggleCompare(c) }, '×')))),
    h('small', { class: 'muted' }, list.length < 2 ? 'Add one more player to compare' : ''),
    h('button', { class: 'btn', type: 'button', onclick: () => S.clearCompare() }, 'Clear'),
    h('button', { class: 'btn primary', type: 'button', disabled: list.length < 2 ? true : null, onclick: () => { location.hash = `#/compare/${ids.join(',')}`; } }, `Compare (${list.length})`)));
}
