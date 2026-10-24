// Team-level numbers for the Team Rankings page: category leaders/losers and the Report Card grades.
// Everything is computed from the league totals already built from saved box scores (lg.teams[abbr] = { games, T, O }).

import { gpAdjust, possBref, possNba } from './stats.js';

const rate = (n, d) => (d > 0 ? n / d : NaN);

// Offensive / defensive possessions for one team under the chosen ratings formula.
export function teamPoss(t, method) {
  if (method === 'nba') { const p = possNba(t.T, t.O); return { o: p, d: p, counted: 0 }; }
  if (method === 'native' && t.nat && t.nat.o > 0 && t.nat.d > 0) return { o: t.nat.o, d: t.nat.d, counted: t.nat.counted || 0 };
  const p = possBref(t.T, t.O); return { o: p, d: p, counted: 0 };
}

export function teamRows(lg, method = 'native') {
  const rows = [];
  for (const [abbr, t] of Object.entries(lg.teams || {})) {
    const { T, O, games } = t;
    if (!games || !(T.fga > 0) || !(O.fga > 0)) continue;
    const P = teamPoss(t, method);
    if (!(P.o > 0) || !(P.d > 0)) continue;
    const ortg = (100 * T.pts) / P.o, drtg = (100 * O.pts) / P.d;
    rows.push({
      abbr, games, poss: P.o / games, counted: P.counted,
      ppg: T.pts / games, oppg: O.pts / games, diff: (T.pts - O.pts) / games,
      ortg, drtg, net: ortg - drtg,
      fgp: 100 * rate(T.fgm, T.fga), tpp: 100 * rate(T.tpm, T.tpa), ftp: 100 * rate(T.ftm, T.fta),
      efg: 100 * rate(T.fgm + 0.5 * T.tpm, T.fga),
      reb: T.reb / games, ast: T.ast / games, stl: T.stl / games, blk: T.blk / games, tov: T.tov / games,
      // Dean Oliver's Four Factors, for the team and against it (the "d" versions are what opponents did)
      f: {
        oEfg: 100 * rate(T.fgm + 0.5 * T.tpm, T.fga), oTov: 100 * rate(T.tov, T.fga + 0.44 * T.fta + T.tov),
        oOrb: 100 * rate(T.oreb, T.oreb + O.dreb), oFtr: 100 * rate(T.ftm, T.fga),
        dEfg: 100 * rate(O.fgm + 0.5 * O.tpm, O.fga), dTov: 100 * rate(O.tov, O.fga + 0.44 * O.fta + O.tov),
        dDrb: 100 * rate(T.dreb, T.dreb + O.oreb), dFtr: 100 * rate(O.ftm, O.fga),
      },
    });
  }
  return rows;
}

// [key, title, loser title, unit, decimals, suffix, signed, lowerIsBetter]
export const TEAM_DEFS = [
  ['diff', 'Point Differential', 'Worst Point Differential', 'per game', 1, '', true, false],
  ['ppg', 'Points Per Game', 'Fewest Points Per Game', 'PPG', 1, '', false, false],
  ['oppg', 'Points Allowed', 'Most Points Allowed', 'lower is better', 1, '', false, true],
  ['ortg', 'Offensive Rating', 'Worst Offensive Rating', 'pts / 100 poss', 1, '', false, false],
  ['drtg', 'Defensive Rating', 'Worst Defensive Rating', 'lower is better', 1, '', false, true],
  ['net', 'Net Rating', 'Worst Net Rating', 'per 100 poss', 1, '', true, false],
  ['efg', 'Effective FG%', 'Worst Effective FG%', 'eFG%', 1, '%', false, false],
  ['fgp', 'Field Goal %', 'Worst Field Goal %', 'FG%', 1, '%', false, false],
  ['tpp', '3-Point %', 'Worst 3-Point %', '3P%', 1, '%', false, false],
  ['ftp', 'Free Throw %', 'Worst Free Throw %', 'FT%', 1, '%', false, false],
  ['reb', 'Rebounds', 'Fewest Rebounds', 'RPG', 1, '', false, false],
  ['ast', 'Assists', 'Fewest Assists', 'APG', 1, '', false, false],
  ['stl', 'Steals', 'Fewest Steals', 'SPG', 1, '', false, false],
  ['blk', 'Blocks', 'Fewest Blocks', 'BPG', 1, '', false, false],
  ['tov', 'Fewest Turnovers', 'Most Turnovers', 'TOV per game', 1, '', false, true],
];

export function teamCards(rows, worst, top = 5) {
  return TEAM_DEFS.map(([key, title, loserTitle, unit, f, suffix, signed, low]) => {
    const pool = rows.filter((r) => Number.isFinite(r[key]));
    const adj = gpAdjust(pool, (r) => r[key], (r) => r.games);   // small edge to teams with more games played
    const list = pool.map((r) => ({ r, k: adj(r) })).sort((a, b) => ((low !== worst) ? a.k - b.k : b.k - a.k)).map((x) => x.r)
      .slice(0, top).map((r) => ({ abbr: r.abbr, value: r[key], sub: `${r.games} GP` }));
    return { key, title: worst ? loserTitle : title, unit, f, suffix, signed, rows: list };
  });
}

// ---------------------------------------------------------------- Report Card
// Percentile of a team on one measure among all teams (1 = best in the league, 0 = worst).
function pctile(rows, get0, low) {
  const get = gpAdjust(rows, get0, (r) => r.games);   // same small edge for more games played
  const vals = rows.map((r) => ({ r, v: get(r) }));
  const out = new Map();
  for (const x of vals) {
    const better = vals.filter((y) => (low ? y.v > x.v : y.v < x.v)).length;
    const equal = vals.filter((y) => y.v === x.v).length;
    out.set(x.r.abbr, rows.length > 1 ? (better + (equal - 1) / 2) / (rows.length - 1) : 0.5);
  }
  return out;
}

// Share of the league each grade covers, best to worst (a curve: grades are relative to the other 29 teams).
const BANDS = [[0.10, 'A'], [0.20, 'A-'], [0.30, 'B+'], [0.43, 'B'], [0.57, 'B-'], [0.70, 'C+'], [0.80, 'C'], [0.90, 'C-'], [0.97, 'D'], [1.0, 'F']];
export const GRADE_WEIGHTS = { net: 0.30, offense: 0.35, defense: 0.35, offenseParts: { ortg: 0.20, eFG: 0.32, tov: 0.20, reb: 0.16, ft: 0.12 }, defenseParts: { drtg: 0.20, eFG: 0.32, tov: 0.20, reb: 0.16, ft: 0.12 } };

function gradesFor(scoreByAbbr) {
  const ordered = [...scoreByAbbr.entries()].sort((a, b) => b[1] - a[1]);
  const n = ordered.length, out = new Map();
  ordered.forEach(([abbr], i) => { const fr = (i + 1) / n; out.set(abbr, { rank: i + 1, grade: (BANDS.find((b) => fr <= b[0] + 1e-9) || BANDS[BANDS.length - 1])[1] }); });
  return out;
}

export function reportCard(rows) {
  if (!rows.length) return [];
  const P = {
    net: pctile(rows, (r) => r.net, false),
    ortg: pctile(rows, (r) => r.ortg, false), drtg: pctile(rows, (r) => r.drtg, true),
    oEfg: pctile(rows, (r) => r.f.oEfg, false), oTov: pctile(rows, (r) => r.f.oTov, true), oOrb: pctile(rows, (r) => r.f.oOrb, false), oFtr: pctile(rows, (r) => r.f.oFtr, false),
    dEfg: pctile(rows, (r) => r.f.dEfg, true), dTov: pctile(rows, (r) => r.f.dTov, false), dDrb: pctile(rows, (r) => r.f.dDrb, false), dFtr: pctile(rows, (r) => r.f.dFtr, true),
  };
  const W = GRADE_WEIGHTS, op = W.offenseParts, dp = W.defenseParts;
  const off = new Map(), def = new Map(), all = new Map();
  for (const r of rows) {
    const a = r.abbr;
    const o = op.ortg * P.ortg.get(a) + op.eFG * P.oEfg.get(a) + op.tov * P.oTov.get(a) + op.reb * P.oOrb.get(a) + op.ft * P.oFtr.get(a);
    const d = dp.drtg * P.drtg.get(a) + dp.eFG * P.dEfg.get(a) + dp.tov * P.dTov.get(a) + dp.reb * P.dDrb.get(a) + dp.ft * P.dFtr.get(a);
    off.set(a, o); def.set(a, d);
    all.set(a, W.net * P.net.get(a) + W.offense * o + W.defense * d);
  }
  const gAll = gradesFor(all), gOff = gradesFor(off), gDef = gradesFor(def);
  return rows.map((r) => ({ ...r, overall: gAll.get(r.abbr), offGrade: gOff.get(r.abbr).grade, defGrade: gDef.get(r.abbr).grade, score: all.get(r.abbr) }))
    .sort((a, b) => a.overall.rank - b.overall.rank);
}

export const fmtTeamValue = (v, c) => `${c.signed && v > 0 ? '+' : ''}${v.toFixed(c.f)}${c.suffix}`;
