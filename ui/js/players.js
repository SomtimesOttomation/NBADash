// Helpers for ESPN player data (bio + per-season averages/totals/misc as compacted by the host).

// The row for a season. A traded player has one row per team plus a combined "Totals" row; prefer the combined one.
export function seasonRow(p, year) {
  if (!p) return null;
  const rows = p.seasons.filter((r) => r.year === year);
  if (!rows.length) return null;
  return rows.find((r) => /totals/i.test(r.team) || !r.teamId) || rows[rows.length - 1];
}
export const currentRow = (p) => seasonRow(p, p?.season);

const LABELS = { avg: 'avgLabels', tot: 'totLabels', misc: 'miscLabels' };
// kind: 'avg' | 'tot' | 'misc'; arr: the row's values for that kind
export function pick(p, kind, arr, label) {
  if (!arr || !arr.length) return null;
  const i = p[LABELS[kind]].indexOf(label);
  return i < 0 || arr[i] == null || arr[i] === '' ? null : String(arr[i]);
}

export const isPct = (label) => /%$/.test(label);
export const show = (label, v) => (v == null ? '–' : isPct(label) ? `${v}%` : v);
export const numeric = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

export function heightCm(s) {
  const m = String(s || '').match(/(\d+)'\s*(\d+)?/);
  return m ? Math.round((parseInt(m[1], 10) * 12 + parseInt(m[2] || '0', 10)) * 2.54) : null;
}
export function weightKg(s) {
  const m = String(s || '').match(/(\d+)\s*lb/i);
  return m ? Math.round(parseInt(m[1], 10) * 0.45359237) : null;
}
export const heightText = (s) => (s ? `${s}${heightCm(s) ? ` (${heightCm(s)} cm)` : ''}` : '–');
export const weightText = (s) => (s ? `${s}${weightKg(s) ? ` (${weightKg(s)} kg)` : ''}` : '–');
export function dobText(iso) {
  const d = new Date(`${iso}T12:00:00`);
  return isNaN(d) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Rows of the compare table. lower = a smaller number wins.
export const COMPARE_ROWS = [
  { group: 'Scoring and playmaking', rows: [
    { kind: 'avg', label: 'PTS', name: 'Points' }, { kind: 'avg', label: 'AST', name: 'Assists' }, { kind: 'avg', label: 'TO', name: 'Turnovers', lower: true },
    { kind: 'misc', label: 'AST/TO', name: 'Assist to turnover' }, { kind: 'avg', label: 'MIN', name: 'Minutes' }] },
  { group: 'Rebounding and defense', rows: [
    { kind: 'avg', label: 'REB', name: 'Rebounds' }, { kind: 'avg', label: 'OR', name: 'Offensive rebounds' }, { kind: 'avg', label: 'DR', name: 'Defensive rebounds' },
    { kind: 'avg', label: 'STL', name: 'Steals' }, { kind: 'avg', label: 'BLK', name: 'Blocks' }, { kind: 'avg', label: 'PF', name: 'Fouls', lower: true }] },
  { group: 'Shooting', rows: [
    { kind: 'avg', label: 'FG%', name: 'Field goal %' }, { kind: 'avg', label: '3P%', name: '3-point %' }, { kind: 'avg', label: 'FT%', name: 'Free throw %' },
    { kind: 'avg', label: 'FG', name: 'FG made-attempted', plain: true }, { kind: 'avg', label: '3PT', name: '3PT made-attempted', plain: true }, { kind: 'avg', label: 'FT', name: 'FT made-attempted', plain: true }] },
  { group: 'Games', rows: [
    { kind: 'avg', label: 'GP', name: 'Games played' }, { kind: 'avg', label: 'GS', name: 'Games started' },
    { kind: 'misc', label: 'DD2', name: 'Double-doubles' }, { kind: 'misc', label: 'TD3', name: 'Triple-doubles' }] },
];
