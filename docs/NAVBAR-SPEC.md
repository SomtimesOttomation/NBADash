# Navigation bar spec (shared by all dashes)

Reference implementation: NBADash v0.21.2 (`ui/index.html`, `ui/css/app.css`, `ui/js/app.js`); the Glass section is from the next NBADash release.
Every dash that runs in DashLauncher (NBADash, F1Dash, FADash, ...) uses this bar so they look and behave the same.

## Layout

```
┌───────────────────────────── top bar: brand · section tabs · version · theme ─────────────────────────────┐
├───────────────────────────── week/round bar (optional, per dash) ─────────────────────────────────────────┤
                ┌──────────────────────────────────────────────────────────────────────────────┐
                │ [<] [>] [⌂] [⟳] │ [ Search ...                         ] │ Live · 2m [⚙]     │
                └──────────────────────────────────────────────────────────────────────────────┘
                 back fwd home refresh   search (max 483px)                 status   settings
```

Order, left to right, is fixed:

| # | Element | id | Notes |
|---|---------|----|-------|
| 1 | Back | `btn-back` | Chevron SVG |
| 2 | Forward | `btn-fwd` | Chevron SVG |
| 3 | Home | `btn-home` (`<a href="#/" data-route="home">`) | House SVG; gets `.active` on the home route |
| 4 | Refresh | `btn-refresh` | Circular-arrow SVG; spins while refreshing |
| 5 | Separator | `.np-sep` | |
| 6 | Search | `.psearch` > `#psearch` | Dash decides what it searches (players, drivers, clubs) |
| 7 | Separator | `.np-sep` | |
| 8 | Live status | `<button id="live-status">` (`.live-status.np-live`) | Text button; also the pause switch |
| 9 | Settings | `btn-settings` | Gear SVG |

The top bar keeps only the brand, section tabs, version and theme button. Refresh, live status and Settings are **not** in the top bar.

## Page order and docking

Top to bottom, every element a direct child of the page chrome:

1. `#topbar` (brand, section tabs, version, theme)
2. `#haltbar` (hidden unless data traffic is paused; see below)
3. `#syncbar` (optional; hidden unless a sync is running; see below)
4. `#banner` (optional, per dash)
5. `#weekbar` (optional, per dash)
6. `.navpill-row` containing `#navpill`
7. `main#view`

Rules that make the bar sit flush:

- The bar is the next sibling after the week/round bar (or after the banner or top bar if there is none). It is not inside the top bar, the week bar or the view.
- The element directly above `.navpill-row` must have `margin-bottom: 0`. Any margin there shows as a gap above the bar.
- A hidden bar must take no space. Either give each bar its own rule (NBADash: `.weekbar[hidden]`, `.syncbar[hidden]`, `.haltbar[hidden]` each `{ display: none }`) or use one global rule `[hidden] { display: none !important }`. A bar with `display: flex` otherwise overrides the `hidden` attribute and still pushes the bar down.

### `#haltbar` (required)

Shown while data traffic is paused (live status button or DashLauncher's stop button). Markup: a text span, then a primary `Resume` button that sends `traffic.resume`.

- Full-width flex row, centred, `gap: 12px`, `padding: 8px 16px`, `font-size: 13px`.
- Background `color-mix(in srgb, var(--live) 14%, var(--surface))`, `border-bottom: 1px solid var(--line)`.
- Sits flush under the top bar, with no margin and no rounded corners.
- Text: "Data refresh stopped. <Dash name> will not fetch data until you resume."

### `#syncbar` (optional)

Shows progress of a manual sync, if the dash has one. NBADash values, for dashes that use it:

- `position: relative`, `height: 26px`, background `var(--surface2)`, `border-bottom: 1px solid var(--line)`, `font-size: 12px`, `overflow: hidden`.
- Fill: absolutely positioned, width = progress, `color-mix(in srgb, var(--accent2) 28%, transparent)`; red (`--live` at 30%) on failure; a 30% wide sliding fill while progress is unknown.
- Text: `padding: 4px 20px`, one line, ellipsis.

## Look

- Bar is centred in a row (`.navpill-row`, padding `0 16px 10px`) directly under the week/round bar, or under the top bar if a dash has none. It sits flush: no gap above.
- Bar (`.navpill`): square corners (`border-radius: 0`), `1px solid var(--line)` on all four sides including the top, background `var(--surface)`, padding 4px, gap 2px.
- Buttons (`.np-btn`): 34 × 34 px, `border-radius: 4px`, transparent background, colour `var(--text)`; hover background `var(--surface2)`; `.active` colour `var(--accent)`.
- Icons: inline SVG, 22 × 22, `viewBox 0 0 24 24`, stroke `currentColor`, stroke-width 2.4, round caps and joins, no fill. `display: block`.
- Separators: 1 × 20 px, `var(--line)`, margin `0 6px 0 4px`.
- Search input: width `min(483px, 46vw)`, no border, `border-radius: 4px`, padding `8px 14px`, transparent, and **it never has a background of its own, not even on focus**; no outline. Results drop-down is centred under the input.
  - Focus look: put the background on the wrapper, `.psearch:focus-within { background: var(--surface2); border-radius: 4px; }`. The ghost text sits behind the input, so any background on the input itself (including `:focus`) hides the suggestion while the person types.
  - Ghost completion text (`.psearch-ghost`, the grey suggestion behind the typed text): uses the input's font family and font size (`font: inherit`; a 1px smaller ghost lines up on the first letter and drifts apart after it), and `padding: 9px 14px`. The horizontal 14px matches the input. The vertical 9px is 1px more than the input's 8px because the ghost uses `line-height: normal` while the input's line is 20.3px. If a dash changes the input font or line height, re-check the two texts overlap exactly (type a few letters; the typed text must sit exactly over the ghost).
- Live status: a `<button>` with no border or background, 34px tall, padding `0 10px`, 13px text, `var(--muted)`, no wrapping, `border-radius: 4px`; hover background `var(--surface2)`.
  - `.on` (an event is live): bold, colour `var(--live)`, with a 10px dot before the text that blinks hard: 0.9s ease-in-out loop between full opacity, scale 1.1 and an 8px `var(--live)` glow, and 15% opacity at scale 0.7. With reduced motion, the loop slows to 2.4s.
  - `.halted` (paused): bold, colour `var(--warn)`, text `Paused`, with a small pause mark (two 3px bars) before the text. No blinking.

## Behaviour

- **Back**: steps back through the dash's own `#/` route history. If there is nothing to go back to, goes Home. Also Alt+Left and mouse button 3 (back).
- **Forward**: `history.forward()`. Also Alt+Right and mouse button 4 (forward).
- **Home**: `#/`.
- **Refresh**: refreshes live data only; adds `.spin` (0.8s linear rotate) until done. F5 triggers it.
- **Live status** text, in priority order: `Paused` when data traffic is paused → `Offline` (on error, error text in the tooltip) → `Manual · updated 2m ago` / `Manual refresh` when auto-refresh is off → `Live` when any event is in progress → `Updated 2m ago`.
- **Live status click = pause switch**: one click stops all data traffic (running sync, live refresh, queued box score and player requests), exactly like DashLauncher's kill switch. The page sends `traffic.stop`; the backend runs its own `Stop-DashTraffic`. The dash's "data refresh stopped" bar with a Resume button appears. A second click (or Resume) sends `traffic.resume`. Update checks keep working while paused; saved settings don't change. Tooltip: `Click to pause all data traffic` / `All data traffic is paused. Click to resume.`; `aria-pressed` is `true` while paused.
- **Settings**: opens the dash's Settings panel.
- Keyboard focus and `aria-label`s on every button; the bar has `role="navigation" aria-label="Page navigation"`.

## Glass

Optional look for dashes that run in DashLauncher 0.14.0 or later with the person's **Glass** setting on (Windows 11 Acrylic). The launcher makes the dash's view transparent; the blurred desktop sits behind the page. Reference implementation: NBADash (`:root[data-glass]` block at the end of `ui/css/app.css`; `applyTheme()` in `ui/js/store.js`). A dash that ignores glass looks exactly as before.

**Switch.** On `host.theme` (`{ theme, glass }`) set `<html data-glass="1">` when `glass` is true and remove the attribute when it is false or missing. Only in launcher mode: standalone never sets it. Everything below lives under `:root[data-glass]`, so removing the attribute restores the solid look.

**Tokens** (re-declare under `:root[data-glass]`, and again for dark in the same two places the dash already switches dark: the `prefers-color-scheme` rule for `system` and `[data-theme="dark"]`):

| Token | Light | Dark |
|---|---|---|
| `--bg` | `transparent` | `transparent` |
| `--surface` (cards, bars, tiles) | `rgba(255,255,255,.62)` | `rgba(30,36,52,.62)` |
| `--surface2` (hover, group rows) | `rgba(238,240,245,.55)` | `rgba(44,52,74,.55)` |
| `--line` (borders) | `rgba(19,23,34,.12)` | `rgba(255,255,255,.12)` |
| `--glass-strong` (nav bar, table headers) | `rgba(255,255,255,.82)` | `rgba(24,29,42,.82)` |
| `--glass-pop` (pop-ups, modals, drop-downs) | `rgba(255,255,255,.94)` | `rgba(24,29,42,.94)` |
| `--blur` / `--blur-strong` | `24px` / `40px` | same |

Body background is `transparent` (so `--bg: transparent` is enough if the body uses it). Text colours, scores and team colours are **not** changed: they stay solid.

**Frost.** `backdrop-filter: blur(var(--blur)) saturate(1.4)` (with the `-webkit-` prefix) on cards, game cards, top bar, banner, week bar, `#haltbar`, `#syncbar` and the banner tiles.

**Navigation bar (the strongest frost).** `.navpill { background: var(--glass-strong); backdrop-filter: blur(var(--blur-strong)) saturate(1.4); }`. Everything else about the bar is unchanged: same size, square corners, 1px `var(--line)` border, flush under the week bar, buttons and separators as listed above. The `.navpill-row` behind it uses `--bg`, so it becomes transparent too (nothing there needs its own rule). Hover and the search focus look keep using `--surface2`, which stays translucent; the ghost text rule (input never has a background) is unaffected.

**Readability rules.**
- Tables get the strongest frost: sticky header cells use `--glass-strong` (a translucent header over scrolling rows is unreadable), and the table gets `backdrop-filter: blur(var(--blur-strong))`.
- Pop-ups (search results, hover cards, modals, compare bar, scroll buttons) use `--glass-pop`, nearly opaque, with the strong blur.
- Never reduce text contrast to make the glass show more; if a wallpaper makes text hard to read, raise the opacity of the surface, not the text.
- Sticky or fixed elements need their own background; a transparent sticky element shows the content scrolling under it.

**Testing.** In a browser, run the mock with a launcher preview and a busy page background behind the transparent page (NBADash: `?mock=1&launcher=1&glass=1`, add `&theme=light` for light). Check: the attribute appears only with glass; standalone and launcher-without-glass look unchanged; light and dark; table headers, search results and the nav bar readable over a striped background.

## Changes since first version

- v0.13.0: bar added (back, forward, home, search); square corners; flush with the week bar; top border; 22px icons.
- v0.13.1: refresh, live status and Settings moved from the top bar into the bar.
- v0.15.0: live status is a button that pauses and resumes all data traffic; stronger blink while live; `Paused` state.
- v0.21.0 (spec only, from NHLDash's docking): added page order and docking rules (no margin above the bar, hidden bars take no space); `#haltbar` and `#syncbar` styles; ghost completion padding `9px 14px` (NBADash had `9px 15px`, 1px off); ghost uses the input's font; the focus background goes on the wrapper, because an input background hid the suggestion (a bug in NBADash from v0.13.0 to v0.21.1).
- Glass (DashLauncher 0.14.0 setting; NBADash next release): new Glass section for the opt-in Acrylic look. The navigation bar gets `--glass-strong` and the strong blur, nothing else about it changes.
