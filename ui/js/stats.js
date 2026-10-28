// Box-score maths: per-game lines, season aggregates, leaders, and player of the game. Pure functions, no DOM.

const n0 = (v) => { const n = parseFloat(String(v ?? '').replace('+', '')); return Number.isFinite(n) ? n : 0; };
const pair = (v) => { const m = /^(\d+)\s*-\s*(\d+)$/.exec(String(v ?? '').trim()); return m ? [+m[1], +m[2]] : [0, 0]; };

export const emptyTot = () => ({ min: 0, pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, oreb: 0, dreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, pm: 0 });

// Turns one stat row into a numbers object using the box score's own column labels.
export function lineOf(labels, stats) {
  const idx = {};
  labels.forEach((l, i) => { idx[String(l).toUpperCase()] = i; });
  const at = (...names) => { for (const nm of names) if (idx[nm] != null) return stats[idx[nm]]; return undefined; };
  const t = emptyTot();
  t.min = n0(at('MIN'));
  t.pts = n0(at('PTS'));
  [t.fgm, t.fga] = pair(at('FG'));
  [t.tpm, t.tpa] = pair(at('3PT', '3P'));
  [t.ftm, t.fta] = pair(at('FT'));
  t.reb = n0(at('REB')); t.oreb = n0(at('OREB')); t.dreb = n0(at('DREB'));
  if (!t.reb) t.reb = t.oreb + t.dreb;
  t.ast = n0(at('AST')); t.stl = n0(at('STL')); t.blk = n0(at('BLK')); t.tov = n0(at('TO', 'TOV'));
  t.pf = n0(at('PF')); t.pm = n0(at('+/-'));
  return t;
}

export function addTot(a, b) { for (const k of Object.keys(a)) a[k] += b[k] || 0; return a; }

export const played = (p) => !p.dnp && Array.isArray(p.stats) && p.stats.length > 0 && p.stats.some((s) => s !== '' && s !== '--');

// Team totals: the box's own totals row when it has a value (it includes team rebounds and the like), else the sum of players.
export function teamTotals(team) {
  const sum = emptyTot();
  const lines = [];
  for (const p of team.players) if (played(p)) { const l = lineOf(team.labels, p.stats); lines.push(l); addTot(sum, l); }
  const tot = lineOf(team.labels, team.totals || []);
  const out = emptyTot();
  for (const k of Object.keys(out)) out[k] = k === 'pm' ? 0 : (tot[k] > 0 ? tot[k] : sum[k]);
  out.min = sum.min;
  if (out.oreb + out.dreb > out.reb) out.reb = out.oreb + out.dreb;
  return out;
}

export const gameScore = (t) => t.pts + 0.4 * t.fgm - 0.7 * t.fga - 0.4 * (t.fta - t.ftm) + 0.7 * t.oreb + 0.3 * t.dreb + t.stl + 0.7 * t.ast + 0.7 * t.blk - 0.4 * t.pf - t.tov;

const sq = (x) => x * x;
const fin = (x) => (Number.isFinite(x) ? x : NaN);

// Dean Oliver's individual offensive rating (points produced per 100 individual possessions).
export function ortg(p, T, O) {
  const MP = p.min, tMP = T.min;
  if (!(MP > 0) || !(tMP > 0) || p.fga + p.fta + p.tov === 0 || !(T.fgm > 0) || !(T.fga - p.fga > 0) || !(T.fgm - p.fgm > 0)) return NaN;
  const tFT = T.fta ? T.ftm / T.fta : 0, pFT = p.fta ? p.ftm / p.fta : 0;
  const share = MP / (tMP / 5);
  const qAST = share * (1.14 * ((T.ast - p.ast) / T.fgm)) +
    ((((T.ast / tMP) * MP * 5 - p.ast) / ((T.fgm / tMP) * MP * 5 - p.fgm)) * (1 - share));
  const qa = Number.isFinite(qAST) ? qAST : 0;
  const base = p.fga > 0 ? (1 - 0.5 * ((p.pts - p.ftm) / (2 * p.fga)) * qa) : 0;
  const fgPart = p.fga > 0 ? p.fgm * base : 0;
  const astPart = 0.5 * (((T.pts - T.ftm) - (p.pts - p.ftm)) / (2 * (T.fga - p.fga))) * p.ast;
  const ftPart = (1 - sq(1 - pFT)) * 0.4 * p.fta;
  const tScPoss = T.fgm + (1 - sq(1 - tFT)) * T.fta * 0.4;
  const tOrbPct = T.oreb / (T.oreb + O.dreb);
  const tPlayPct = tScPoss / (T.fga + T.fta * 0.4 + T.tov);
  const tOrbW = ((1 - tOrbPct) * tPlayPct) / ((1 - tOrbPct) * tPlayPct + tOrbPct * (1 - tPlayPct));
  const orbPart = p.oreb * tOrbW * tPlayPct;
  const k = 1 - (T.oreb / tScPoss) * tOrbW * tPlayPct;
  const scPoss = (fgPart + astPart + ftPart) * k + orbPart;
  const fgxPoss = (p.fga - p.fgm) * (1 - 1.07 * tOrbPct);
  const ftxPoss = sq(1 - pFT) * 0.4 * p.fta;
  const totPoss = scPoss + fgxPoss + ftxPoss + p.tov;
  const pFg = p.fga > 0 ? 2 * (p.fgm + 0.5 * p.tpm) * base : 0;
  const pAst = 2 * ((T.fgm - p.fgm + 0.5 * (T.tpm - p.tpm)) / (T.fgm - p.fgm)) * 0.5 *
    (((T.pts - T.ftm) - (p.pts - p.ftm)) / (2 * (T.fga - p.fga))) * p.ast;
  const pOrb = p.oreb * tOrbW * tPlayPct * (T.pts / (T.fgm + (1 - sq(1 - tFT)) * 0.4 * T.fta));
  const pprod = (pFg + pAst + p.ftm) * k + pOrb;
  return totPoss > 0 ? fin(100 * pprod / totPoss) : NaN;
}

// Dean Oliver's individual defensive rating (points allowed per 100 possessions; lower is better).
export function drtg(p, T, O) {
  const MP = p.min, tMP = T.min;
  if (!(MP > 0) || !(tMP > 0) || !(O.fga > 0) || !(T.pf > 0)) return NaN;
  const oFT = O.fta ? O.ftm / O.fta : 0;
  const dOrbPct = O.oreb / (O.oreb + T.dreb);
  const dFgPct = O.fgm / O.fga;
  const fmWt = (dFgPct * (1 - dOrbPct)) / (dFgPct * (1 - dOrbPct) + (1 - dFgPct) * dOrbPct);
  const stops1 = p.stl + p.blk * fmWt * (1 - 1.07 * dOrbPct) + p.dreb * (1 - fmWt);
  const stops2 = (((O.fga - O.fgm - T.blk) / tMP) * fmWt * (1 - 1.07 * dOrbPct) + ((O.tov - T.stl) / tMP)) * MP +
    (p.pf / T.pf) * 0.4 * O.fta * sq(1 - oFT);
  const stops = stops1 + stops2;
  const tPoss = 0.5 * ((T.fga + 0.4 * T.fta - 1.07 * (T.oreb / (T.oreb + O.dreb)) * (T.fga - T.fgm) + T.tov) +
    (O.fga + 0.4 * O.fta - 1.07 * (O.oreb / (O.oreb + T.dreb)) * (O.fga - O.fgm) + O.tov));
  const stopPct = (stops * O.min) / (tPoss * MP);
  const dPts = O.pts / (O.fgm + (1 - sq(1 - oFT)) * O.fta * 0.4);
  const tDr = 100 * O.pts / tPoss;
  return fin(tDr + 0.2 * (100 * dPts * (1 - stopPct) - tDr));
}

// ---------------------------------------------------------------- season aggregate for one team
export function aggregate(boxes, abbr) {
  const players = new Map();
  const T = emptyTot(), O = emptyTot();
  let games = 0, last = null;
  const sorted = [...boxes].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  for (const box of sorted) {
    const mine = box.teams.find((t) => t.team === abbr);
    const theirs = box.teams.find((t) => t.team !== abbr);
    if (!mine || !theirs) continue;
    games++;
    addTot(T, teamTotals(mine)); addTot(O, teamTotals(theirs));
    const starters = [];
    for (const p of mine.players) {
      if (!played(p)) continue;
      const l = lineOf(mine.labels, p.stats);
      if (!(l.min > 0) && !l.pts && !l.reb && !l.ast) continue;
      let e = players.get(p.id);
      if (!e) { e = { id: p.id, name: p.name, team: abbr, pos: p.pos, jersey: p.jersey, gp: 0, gs: 0, score: 0, dd: 0, tot: emptyTot() }; players.set(p.id, e); }
      e.gp++; e.name = p.name; e.pos = p.pos || e.pos; e.jersey = p.jersey || e.jersey;
      addTot(e.tot, l);
      e.score += gameScore(l);
      if ([l.pts, l.reb, l.ast, l.stl, l.blk].filter((x) => x >= 10).length >= 2) e.dd++;
      if (p.starter) { e.gs++; starters.push(p.id); }
    }
    last = { id: box.id, date: box.date, starters };
  }
  return { abbr, games, T, O, players: [...players.values()], lastStarters: last ? last.starters : [], lastGameId: last ? last.id : null };
}

// ---------------------------------------------------------------- leaders
const per = (p, k) => p.tot[k] / p.gp;
const pct = (m, a) => (a > 0 ? (100 * m) / a : NaN);

// minGames-scaled qualification keeps tiny samples out early in the season
// NBA.com statistical minimums, scaled to team games played: 300 FG / 125 FT / 82 3P made and 70% of games over 82 games.
export const NBA_MIN = { gpShare: 0.7, fg: 300 / 82, ft: 125 / 82, tp: 82 / 82 };
export const nbaMin = (k, games) => Math.ceil(NBA_MIN[k] * games - 1e-9);
export const LEADER_DEFS = [
  { key: 'ptsStarters', loser: 'Fewest Points (Starters)', loserOnly: true, title: 'Points (Starters)', unit: 'PPG', v: (p) => per(p, 'pts'), f: 1,
    ok: (p) => p.gs * 2 >= p.gp, sub: (p) => `${p.gs} GS \u00b7 ${p.gp} GP` },
  { key: 'pts', loser: 'Fewest Points', title: 'Points', unit: 'PPG', v: (p) => per(p, 'pts'), f: 1 },
  { key: 'reb', title: 'Rebounds', unit: 'RPG', v: (p) => per(p, 'reb'), f: 1 },
  { key: 'ast', title: 'Assists', unit: 'APG', v: (p) => per(p, 'ast'), f: 1 },
  { key: 'tpm', title: '3-Pointers Made', unit: '3PM/G', v: (p) => per(p, 'tpm'), f: 1 },
  { key: 'fgp', loser: 'Worst Field Goal %', title: 'Field Goal %', unit: 'FG%', v: (p) => pct(p.tot.fgm, p.tot.fga), f: 1, suffix: '%', ok: (p, a) => p.tot.fga >= 3 * a.games, okNba: (p, a) => p.tot.fgm >= nbaMin('fg', a.games), sub: (p) => `${p.tot.fgm}/${p.tot.fga} FG` },
  { key: 'tpp', loser: 'Worst 3-Point %', title: '3-Point %', unit: '3P%', v: (p) => pct(p.tot.tpm, p.tot.tpa), f: 1, suffix: '%', ok: (p, a) => p.tot.tpa >= 1 * a.games, okNba: (p, a) => p.tot.tpm >= nbaMin('tp', a.games), okWorst: (p) => p.tot.tpa >= 10, sub: (p) => `${p.tot.tpm}/${p.tot.tpa} 3PT` },
  { key: 'ftp', loser: 'Worst Free Throw %', title: 'Free Throw %', unit: 'FT%', v: (p) => pct(p.tot.ftm, p.tot.fta), f: 1, suffix: '%', ok: (p, a) => p.tot.fta >= 1 * a.games, okNba: (p, a) => p.tot.ftm >= nbaMin('ft', a.games), okWorst: (p) => p.tot.fta >= 5, sub: (p) => `${p.tot.ftm}/${p.tot.fta} FT` },
  { key: 'stl', title: 'Steals', unit: 'SPG', v: (p) => per(p, 'stl'), f: 1 },
  { key: 'blk', title: 'Blocks', unit: 'BPG', v: (p) => per(p, 'blk'), f: 1 },
  { key: 'stocks', title: 'Stocks (Steals + Blocks)', unit: 'per game', v: (p) => (p.tot.stl + p.tot.blk) / p.gp, f: 1 },
  { key: 'ortg', loser: 'Worst Offensive Rating', title: 'Offensive Rating', unit: 'pts / 100 poss', v: (p, a) => ortg(p.tot, a.T, a.O), f: 1, ok: (p, a) => p.tot.min >= 10 * a.games, note: 'Dean Oliver estimate' },
  { key: 'drtg', loser: 'Worst Defensive Rating', title: 'Defensive Rating', unit: 'lower is better', v: (p, a) => drtg(p.tot, a.T, a.O), f: 1, low: true, ok: (p, a) => p.tot.min >= 10 * a.games, note: 'Dean Oliver estimate' },
  { key: 'pm', loser: 'Worst Plus / Minus', title: 'Plus / Minus', unit: 'per game', v: (p) => per(p, 'pm'), f: 1, signed: true },
  { key: 'efg', loser: 'Worst Effective FG%', title: 'Effective FG%', unit: 'eFG%', v: (p) => (p.tot.fga > 0 ? (100 * (p.tot.fgm + 0.5 * p.tot.tpm)) / p.tot.fga : NaN), f: 1, suffix: '%', ok: (p, a) => p.tot.fga >= 3 * a.games, okNba: (p, a) => p.tot.fgm >= nbaMin('fg', a.games), sub: (p) => `${p.tot.fgm}/${p.tot.fga} FG \u00b7 ${p.tot.tpm} 3PM`, note: '3-pointers count 1.5x' },
  { key: 'splits', loser: 'Worst Shooting Splits', title: 'Shooting Splits', unit: 'FG% / 3P% / FT%', v: (p) => (pct(p.tot.fgm, p.tot.fga) + pct(p.tot.tpm, p.tot.tpa) + pct(p.tot.ftm, p.tot.fta)) / 3, f: 1, suffix: '%',
    ok: (p, a) => p.tot.fga >= 3 * a.games && p.tot.tpa >= a.games && p.tot.fta >= a.games,
    okNba: (p, a) => p.tot.fgm >= nbaMin('fg', a.games) && p.tot.tpm >= nbaMin('tp', a.games) && p.tot.ftm >= nbaMin('ft', a.games), text: (p) => [pct(p.tot.fgm, p.tot.fga), pct(p.tot.tpm, p.tot.tpa), pct(p.tot.ftm, p.tot.fta)].map((x) => Math.round(x)).join(' / '),
    note: 'ranked by the average of the three' },
  { key: 'eff', loser: 'Lowest Efficiency', title: 'Efficiency', unit: 'EFF per game', v: (p) => (p.tot.pts + p.tot.reb + p.tot.ast + p.tot.stl + p.tot.blk - (p.tot.fga - p.tot.fgm) - (p.tot.fta - p.tot.ftm) - p.tot.tov) / p.gp, f: 1, note: 'pts + reb + ast + stl + blk - misses - turnovers' },
  { key: 'form', title: 'In Form (DARKO-style)', loser: 'Out of Form (DARKO-style)', unit: 'vs league avg', v: (p) => p.form, f: 1, signed: true, noEdge: true, leagueOnly: true,
    sub: (p) => `${p.formTrend > 0.3 ? '\u2191' : p.formTrend < -0.3 ? '\u2193' : '\u2192'} ${p.gp} GP` },
  { key: 'tov', loser: 'Most Turnovers', title: 'Turnovers', unit: 'TOV per game', v: (p) => per(p, 'tov'), f: 1, low: true, loserOnly: true },
  { key: 'pf', loser: 'Most Fouls', title: 'Fouls', unit: 'PF per game', v: (p) => per(p, 'pf'), f: 1, low: true, loserOnly: true },
  { key: 'min', title: 'Minutes', unit: 'MPG', v: (p) => per(p, 'min'), f: 1 },
];

// Ranks players for every category. ctxFor(p) gives that player's team context {games, T, O}.
// minMpg: minutes per game played needed to appear at all; minGpShare: share of team games the player must have played.
// worst: the Losers view. Same qualification, reversed order, and only the categories where a low number means a player is bad at the game.
// Small edge for a bigger sample: each value is pulled toward the pool average as if half an average game were added,
// so a player with more games ranks ahead of one with fewer games and a near-identical number. The value shown is unchanged.
export const GP_WEIGHT = 0.5;
export function gpAdjust(rows, valueOf, gamesOf, k = GP_WEIGHT) {
  const vals = rows.map(valueOf).filter(Number.isFinite);
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return (r) => { const v = valueOf(r), n = gamesOf(r); return k > 0 && n > 0 ? (n * v + k * mean) / (n + k) : v; };
}

export function rankAll(players, ctxFor, top, { minMpg = 8, minGpShare = 0, worst = false, gpWeight = 0, league = false, form = false, official = false } = {}) {
  return LEADER_DEFS.filter((d) => (worst ? d.loser : !d.loserOnly) && (!d.leagueOnly || (league && form))).map((d) => {
    const rows = players
      .filter((p) => {
        const c = ctxFor(p);
        return c && c.games > 0 && p.gp > 0 && p.gp >= Math.ceil(minGpShare * c.games) && p.tot.min / p.gp >= minMpg && (official && !worst && d.okNba ? d.okNba(p, c) : (!d.ok || d.ok(p, c))) && (!worst || !d.okWorst || d.okWorst(p));
      })
      .map((p) => ({ p, value: d.v(p, ctxFor(p)) }))
      .filter((r) => Number.isFinite(r.value));
    const adj = gpAdjust(rows, (r) => r.value, (r) => r.p.gp, d.noEdge ? 0 : gpWeight);
    rows.forEach((r) => { r.rank = adj(r); });
    return { key: d.key, title: worst ? d.loser : d.title, unit: d.unit, f: d.f, suffix: d.suffix || '', signed: !!d.signed, note: d.note || '', rows: rows
      .sort((a, b) => ((!!d.low !== worst) ? a.rank - b.rank : b.rank - a.rank) || b.p.tot.min - a.p.tot.min)   // ties: the player with more minutes ranks first
      .slice(0, top)
      .map((r) => ({ id: r.p.id, name: r.p.name, team: r.p.team, jersey: r.p.jersey, value: r.value, text: d.text ? d.text(r.p) : '', sub: d.sub ? d.sub(r.p) : `${r.p.gp} GP` })) };
  });
}

export function leaders(agg, top = 3) { return rankAll(agg.players, () => agg, top); }

// ---------------------------------------------------------------- league-wide, built one saved box score at a time
export const LEAGUE_VERSION = 5;   // 5: per-game log per player (Form rating)
export const LEAGUE_VERSION_PREV = 4;   // 4: rebuild once to add counted possessions (Native ratings) and opponents faced (SRS)

// ---------------------------------------------------------------- possessions (team ratings formula setting)
// Basketball-Reference / Dean Oliver: 0.4 x FTA and a weighted offensive-rebound adjustment, team and opponent averaged.
export function possBref(T, O) {
  const side = (A, B) => A.fga + 0.4 * A.fta - 1.07 * (A.oreb + B.dreb > 0 ? A.oreb / (A.oreb + B.dreb) : 0) * (A.fga - A.fgm) + A.tov;
  return 0.5 * (side(T, O) + side(O, T));
}
// NBA.com-style estimate: FGA - ORB + TOV + 0.436 x FTA, team and opponent averaged.
export function possNba(T, O) {
  const side = (A) => A.fga - A.oreb + A.tov + 0.436 * A.fta;
  return 0.5 * (side(T) + side(O));
}
export const RATING_METHODS = {
  native: 'Native (counted possessions)',
  bref: 'Basketball-Reference',
  nba: 'NBA.com',
};
export const newLeague = () => ({ version: LEAGUE_VERSION, done: [], teams: {}, players: {} });

// A box is usable once both teams have at least one player line with numbers in it.
export const boxComplete = (box) => !!box && Array.isArray(box.teams) && box.teams.length === 2
  && box.teams.every((t) => Array.isArray(t.players) && t.players.some((p) => played(p)));

export function leagueAdd(lg, box) {
  if (!boxComplete(box)) return false;
  for (let i = 0; i < 2; i++) {
    const mine = box.teams[i], theirs = box.teams[1 - i];
    const te = lg.teams[mine.team] || (lg.teams[mine.team] = { games: 0, T: emptyTot(), O: emptyTot(), nat: { o: 0, d: 0, counted: 0 }, opp: {} });
    if (!te.nat) te.nat = { o: 0, d: 0, counted: 0 };
    if (!te.opp) te.opp = {};
    te.games++;
    te.opp[theirs.team] = (te.opp[theirs.team] || 0) + 1;      // opponents faced, for strength of schedule
    const gT = teamTotals(mine), gO = teamTotals(theirs);
    addTot(te.T, gT); addTot(te.O, gO);
    // Native: possessions counted from the play-by-play when the saved box score has them, else this game's estimate
    const cp = box.poss || {};
    const mineP = Number(cp[mine.team]), theirP = Number(cp[theirs.team]);
    if (mineP > 0 && theirP > 0) { te.nat.o += mineP; te.nat.d += theirP; te.nat.counted++; } else { const e = possBref(gT, gO); te.nat.o += e; te.nat.d += e; }
    for (const p of mine.players) {
      if (!played(p)) continue;
      const l = lineOf(mine.labels, p.stats);
      if (!(l.min > 0) && !l.pts && !l.reb && !l.ast) continue;
      const key = `${p.id}:${mine.team}`;       // a traded player gets one line per team
      let e = lg.players[key];
      if (!e) e = lg.players[key] = { id: p.id, name: p.name, team: mine.team, pos: p.pos, jersey: p.jersey, gp: 0, gs: 0, score: 0, dd: 0, tot: emptyTot() };
      e.gp++; e.name = p.name; e.pos = p.pos || e.pos; e.jersey = p.jersey || e.jersey;
      (e.log || (e.log = [])).push([dayNum(box.date), Math.round(l.min), Math.round(gameScore(l) * 10) / 10, l.pm]);   // per-game line for the Form rating
      addTot(e.tot, l);
      e.score += gameScore(l);
      if ([l.pts, l.reb, l.ast, l.stl, l.blk].filter((x) => x >= 10).length >= 2) e.dd++;
      if (p.starter) e.gs++;
    }
  }
  return true;
}

// League leaders: stricter than the team view (10+ minutes a game, and at least half of the team's games played).
export function leagueLeaders(lg, top = 5, { form = true } = {}) {
  if (form) applyForm(lg);
  return rankAll(Object.values(lg.players), (p) => (lg.teams[p.team] ? { games: lg.teams[p.team].games, T: lg.teams[p.team].T, O: lg.teams[p.team].O } : null), top, { minMpg: 0, minGpShare: NBA_MIN.gpShare, gpWeight: GP_WEIGHT, league: true, form, official: true });
}

export function leagueLosers(lg, top = 5, { form = true } = {}) {
  if (form) applyForm(lg);
  return rankAll(Object.values(lg.players), (p) => (lg.teams[p.team] ? { games: lg.teams[p.team].games, T: lg.teams[p.team].T, O: lg.teams[p.team].O } : null), top, { minMpg: 10, minGpShare: 0.5, worst: true, gpWeight: GP_WEIGHT, league: true, form });
}

export function fmtValue(v, card) {
  const s = v.toFixed(card.f);
  return (card.signed && v > 0 ? '+' : '') + s + card.suffix;
}

// ---------------------------------------------------------------- player of the game
// ESPN has no "player of the game" field, so it is computed: Game Score ranks everyone on both teams
// (it rewards points, rebounds, assists, steals and blocks and charges misses and turnovers); ties go to plus/minus.
export function playersOfGame(box, top = 3) {
  const out = [];
  for (const team of box.teams) {
    const other = box.teams.find((t) => t !== team);
    if (!other) continue;
    const T = teamTotals(team), O = teamTotals(other);
    for (const p of team.players) {
      if (!played(p)) continue;
      const l = lineOf(team.labels, p.stats);
      if (!(l.min > 0) && !l.pts) continue;
      out.push({ id: p.id, name: p.name, team: team.team, jersey: p.jersey, pos: p.pos, line: l, score: gameScore(l), ortg: ortg(l, T, O), drtg: drtg(l, T, O) });
    }
  }
  out.sort((a, b) => b.score - a.score || b.line.pm - a.line.pm || b.line.min - a.line.min);
  return out.slice(0, top);
}

// ---------------------------------------------------------------- roster ordering
const POS = { PG: 1, G: 1.5, SG: 2, GF: 2.5, SF: 3, F: 3.5, PF: 4, FC: 4.5, C: 5 };
export const posRank = (pos) => POS[String(pos || '').toUpperCase()] ?? 6;

// ---------------------------------------------------------------- Form rating (inspired by DARKO, not DARKO)
// A Kalman filter over each player's games in date order: every game nudges the rating, recent games count more,
// a game with few minutes counts less, and a small sample is pulled toward the league average.
// Game value = Game Score per 36 minutes + 0.3 x plus-minus per 36. Shown relative to the league average (0 = average).
const dayNum = (d) => { const s = String(d || '').slice(0, 10).replace(/-/g, ''); return /^\d{8}$/.test(s) ? Number(s) : 0; };
export const FORM = { prior: 25, noise: 64, drift: 0.6, pmWeight: 0.3 };
const dayGap = (a, b) => { if (!a || !b) return 1; const t = (n) => Date.UTC(Math.floor(n / 1e4), Math.floor(n / 100) % 100 - 1, n % 100); return Math.max(1, (t(b) - t(a)) / 864e5); };
export function applyForm(lg) {
  const all = Object.values(lg.players || {});
  const val = (g) => (g[1] > 0 ? (g[2] * 36) / g[1] + FORM.pmWeight * ((g[3] * 36) / g[1]) : NaN);
  // league average game value, minutes-weighted
  let sw = 0, sv = 0;
  for (const p of all) for (const g of p.log || []) { const v = val(g); if (Number.isFinite(v) && g[1] >= 5) { sv += v * g[1]; sw += g[1]; } }
  const mean = sw ? sv / sw : 0;
  for (const p of all) {
    const games = (p.log || []).filter((g) => g[1] > 0).sort((a, b) => a[0] - b[0]);
    let x = mean, P = FORM.prior, prevDay = 0;
    const hist = [];
    for (const g of games) {
      P += FORM.drift * Math.min(10, dayGap(prevDay, g[0]));      // ratings can drift between games, more over long gaps
      const R = (FORM.noise * 36) / Math.max(g[1], 6);               // short stints are noisy
      const K = P / (P + R);
      x += K * (val(g) - x); P *= (1 - K);
      prevDay = g[0]; hist.push(x);
    }
    p.form = games.length ? x - mean : NaN;
    p.formTrend = hist.length > 5 ? x - hist[hist.length - 6] : 0;
  }
  return mean;
}
