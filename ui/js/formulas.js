// Formula hover cards: every calculated number in the app can explain itself.
// Mark any element with data-calc="<key>" (and optionally data-calc-scope="team"|"player"); hovering or focusing it shows the card.
import * as S from './store.js';
import { h } from './util.js';
import { RATING_METHODS } from './stats.js';

export const METHOD_NOTES = {
  native: 'Teams: counts the real possessions in each game from the play-by-play saved with the box score. Players: Dean Oliver\u2019s box-score estimate. Most accurate for teams. Games saved before this was added, or without play-by-play, use the Basketball-Reference estimate instead.',
  bref: 'Matches Basketball-Reference. Players: Dean Oliver\u2019s individual ratings, exactly as Basketball-Reference shows them. Teams: Basketball-Reference’s estimate (Dean Oliver): 0.4 × free throws and a weighted offensive-rebound adjustment, averaged with the opponent’s count. Within about 2 possessions a game of the real count.',
  nba: 'Matches NBA.com. Teams: FGA − ORB + TOV + 0.436 × FTA, averaged with the opponent’s count. Players: on-court ratings, the points scored and allowed per 100 possessions while the player is on the floor, counted from the play-by-play.',
};

const POSS = {
  native: 'Poss = possessions counted from play-by-play\n(a possession ends on a made shot, a defensive rebound,\na turnover, or the last free throw of a trip)',
  bref: 'Poss = ½ × [ (FGA + 0.4×FTA − 1.07×ORB% × (FGA − FGM) + TOV)\n        + same for the opponent ]\nORB% = ORB / (ORB + opponent DRB)',
  nba: 'Poss = ½ × [ (FGA − ORB + TOV + 0.436×FTA)\n        + same for the opponent ]',
};
const method = () => S.state.settings.ratingMethod || 'native';
const methodLine = () => `Formula setting: ${RATING_METHODS[method()]}`;

// key -> (scope) => { title, formula, why, note? }
const DEFS = {
  ortg: (scope) => (scope === 'player' && method() === 'nba' ? {
    title: 'Offensive Rating (player, on-court)', formula: 'ORtg = 100 \u00d7 Team points while he is on the floor\n      / Team possessions while he is on the floor',
    why: 'NBA.com\u2019s player rating: how the team scores with him on the court. Counted from the play-by-play (substitutions and possessions) when the box score is saved. Shows \u2013 until every game he played has been counted.', note: methodLine(),
  } : scope === 'player' ? {
    title: 'Offensive Rating (player)',
    formula: 'ORtg = 100 × Points Produced / Individual Possessions',
    why: 'Dean Oliver’s method, the one Basketball-Reference uses. Points Produced credits made shots, a share of assisted baskets and offensive rebounds; Individual Possessions adds the misses and turnovers the player used. Used with the Native and Basketball-Reference formula settings; the NBA.com setting uses on-court ratings instead.',
  } : {
    title: 'Offensive Rating (team)', formula: `ORtg = 100 × Points / Poss\n\n${POSS[method()]}`,
    why: 'Points scored per 100 possessions. Using possessions instead of games removes the effect of pace, so fast and slow teams compare fairly.', note: methodLine(),
  }),
  drtg: (scope) => (scope === 'player' && method() === 'nba' ? {
    title: 'Defensive Rating (player, on-court)', formula: 'DRtg = 100 \u00d7 Opponent points while he is on the floor\n      / Opponent possessions while he is on the floor',
    why: 'NBA.com\u2019s player rating: points allowed per 100 possessions with him on the court. Lower is better. Counted from the play-by-play when the box score is saved.', note: methodLine(),
  } : scope === 'player' ? {
    title: 'Defensive Rating (player)',
    formula: 'DRtg = Team DRtg + 0.2 × (100 × Opp pts per scoring poss × (1 − Stop%) − Team DRtg)',
    why: 'Dean Oliver’s estimate of points allowed per 100 possessions while on the floor. Stops come from steals, blocks, defensive rebounds and a share of forced misses and turnovers. Box scores don’t record who guarded whom, so it leans heavily on the team’s defense. Lower is better.',
  } : {
    title: 'Defensive Rating (team)', formula: `DRtg = 100 × Opponent points / Poss\n\n${POSS[method()]}`,
    why: 'Points allowed per 100 possessions. Lower is better.', note: methodLine(),
  }),
  net: () => ({ title: 'Net Rating', formula: 'Net = ORtg − DRtg', why: 'How many points per 100 possessions a team outscores opponents by. The single best quick measure of how good a team has been.', note: methodLine() }),
  pace: () => ({ title: 'Pace', formula: `Pace = 48 \u00d7 Poss / (Team minutes \u00f7 5)\n\n${POSS[method()]}`, why: 'Possessions per 48 minutes: how fast a team plays. Neither fast nor slow is better on its own; it explains why points per game can mislead. Dividing team minutes by 5 keeps overtime games from inflating it.', note: methodLine() }),
  srs: () => ({ title: 'Simple Rating System (SRS)', formula: 'SRS = Point differential + SOS\nSOS = average SRS of the opponents faced\n(repeated until the numbers settle; league average = 0)', why: 'Basketball-Reference\u2019s rating: how many points better than an average team, adjusted for who you played. +5 means about 5 points better than average per game.' }),
  sos: () => ({ title: 'Strength of Schedule (SOS)', formula: 'SOS = average SRS of the opponents faced', why: 'Positive means a tougher-than-average schedule so far. Early in the season a few games against good or bad teams swing it a lot.' }),
  winprob: () => ({ title: 'Win probability', formula: 'ESPN\u2019s in-game model, one value per play', why: 'ESPN\u2019s estimate of each team\u2019s chance to win after every play, based on score, time left and team strength. It arrives with the box score, so it costs no extra requests. The shaded side shows who is favoured.' }),
  swing: () => ({ title: 'Biggest swing', formula: 'Largest change in win probability from one play to the next', why: 'The single play that moved the game most, by ESPN\u2019s win probability. A 3 in a tie game late matters more than one in a blowout, and this captures that.' }),
  clutch: () => ({ title: 'Clutch points', formula: 'Points scored in the last 5 minutes of the 4th quarter or overtime\nwhile the score was within 5', why: 'The NBA\u2019s own definition of clutch time. Only shown when the game had a clutch stretch.' }),
  form: () => ({ title: 'Form rating (DARKO-style)', formula: 'Game value = Game Score per 36 + 0.3 \u00d7 (+/- per 36)\nRating = Kalman filter over games in date order:\n  each game nudges it; short stints count less;\n  recent games count more; small samples stay near average\nShown vs league average (0 = average); arrow = last 5 games', why: 'Inspired by DARKO (Kostya Medvedovsky), which tracks how good a player is right now rather than his season average. This is a simple stand-in built from our own box scores, not DARKO itself.' }),
  sos: () => ({ title: 'Remaining strength of schedule', formula: 'Average over the games left of:\n  opponent SRS \u00d7 GP / (GP + 15)\n  + 1.25 on the road, \u2212 1.25 at home\n  + 1.0 on the second night of a back-to-back\nRank 1 = hardest of the 30', why: 'How hard the rest of the season is, in points per game against an average schedule, by opponent strength rather than record. Early in the season opponent ratings are pulled toward average, so the numbers start small and firm up by midseason; they settle once rosters lock after the trade deadline.', note: methodLine() }),
  diff: () => ({ title: 'Point Differential', formula: 'Diff = (Points − Points allowed) / Games', why: 'Average winning (or losing) margin. Simple, but fast-paced games inflate it; Net Rating corrects for pace.' }),
  efg: () => ({ title: 'Effective FG%', formula: 'eFG% = (FGM + 0.5 × 3PM) / FGA', why: 'Field goal percentage that gives a made three the 1.5× credit it earns in points. The most important of the Four Factors.' }),
  eff: () => ({ title: 'Efficiency (EFF)', formula: 'EFF = (PTS + REB + AST + STL + BLK − missed FG − missed FT − TOV) / Games', why: 'The NBA’s classic all-in-one box score number. Easy to read; rewards volume more than shooting efficiency.' }),
  splits: () => ({ title: 'Shooting Splits', formula: 'FG% / 3P% / FT%', why: 'Ranked by the average of the three percentages. To qualify a player needs at least 3 field goal attempts, 1 three-point attempt and 1 free throw attempt per team game.' }),
  stocks: () => ({ title: 'Stocks', formula: 'Stocks = (STL + BLK) / Games', why: 'Steals plus blocks: a quick measure of defensive events.' }),
  pm: () => ({ title: 'Plus / Minus', formula: '+/- = Team points − Opponent points while on the floor, per game', why: 'Straight from the box score. Noisy over small samples and heavily tied to teammates.' }),
  gamescore: () => ({ title: 'Game Score', formula: 'GmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA − FTM) + 0.7×ORB + 0.3×DRB + STL + 0.7×AST + 0.7×BLK − 0.4×PF − TOV', why: 'John Hollinger’s single-game rating, used to pick Player of the Game. Around 10 is average, 40 is a great night.' }),
  ts: () => ({ title: 'True Shooting %', formula: 'TS% = PTS / (2 \u00d7 (FGA + 0.44 \u00d7 FTA))', why: 'Shooting efficiency that counts threes and free throws at their real value. About 57% is league average.' }),
  rookie: () => ({ title: 'Rookie score', formula: 'Score = 30% Game Score + 20% Form rating\n      + 15% PTS + 10% REB + 10% AST\n      + 10% TS% + 5% (STL + BLK)\nEach input is a percentile among ranked rookies (per game).\nRanked: 10+ minutes a game and a quarter of the team\u2019s games.', why: 'Rates each rookie against the other rookies only, 0 to 100. Game Score and Form carry the most weight because they capture the whole box score and how a player is playing right now; the rest reward scoring, playmaking, rebounding, efficiency and defensive events. Rookies with more games get a small edge in close races. With Form turned off its share is spread over the rest.' }),
  grade: () => ({
    title: 'Report Card grade',
    formula: 'Overall = 30% SRS + 35% Offense + 35% Defense\nOffense = 20% ORtg + 32% eFG% + 20% TOV% + 16% ORB% + 12% FT rate\nDefense = same five, for what opponents did',
    why: 'Each input is turned into a percentile against the other teams, then weighted. SRS is the point differential adjusted for strength of schedule, so a team isn\u2019t marked down for facing good opponents. The weights follow Dean Oliver’s Four Factors (shooting matters most). Grades are a curve: roughly the top 10% get an A. Teams with more games get a small edge.', note: methodLine(),
  }),
  nbamin: () => ({ title: 'NBA statistical minimums', formula: 'Per-game cards: played 70% of team games\nFG%, eFG%: 300 FG made per 82 team games  (≈ 3.7 a game)\nFT%: 125 FT made per 82  (≈ 1.5 a game)\n3P%: 82 threes made per 82  (1 a game)\nShooting Splits: all three\nScaled to team games so far, rounded up', why: 'The NBA’s own rule for league leaders (NBA.com statistical minimums). Shooting cards count makes, not attempts, so nobody leads on a handful of shots. Losers keep looser rules (10+ minutes, half the games, attempt minimums) so poor shooters still show up.' }),
  ewh2h: () => ({ title: 'Head-to-head (East vs West)', formula: 'Record = East wins – West wins in games between the conferences\nMargin = (East points − West points) / those games', why: 'The fairest single test: most of each conference’s games are against itself, so overall records and averages come out near even either way. Only East vs West games show which side is stronger. Early in the season the sample is small.' }),
  ewsrs: () => ({ title: 'Average SRS by conference', formula: 'Average of each conference’s team SRS\nSRS = point differential + strength of schedule', why: 'SRS adjusts every team for who it played, so the cross-conference results flow into all 30 ratings. A gap of 2 points means the average team in one conference is about 2 points a game better.' }),
  ewtop: () => ({ title: 'Top 10 by SRS', formula: 'Teams from each conference among the league’s 10 best SRS', why: 'Shows where the contenders are, which an average can hide.' }),
  ewseeds: () => ({ title: 'Seed vs seed', formula: 'Each conference’s teams in standings order, 1 to 10,\nwith record and SRS; the stronger SRS of each pair is highlighted', why: 'Shows depth: whether one conference is better at the top, in the middle or at the play-in line.' }),
  ws: () => ({ title: 'Win Shares (WS)', formula: 'WS = Offensive WS + Defensive WS\nOWS = (Points produced − 0.92 × Lg pts/poss × Offensive poss) / Marginal pts per win\nDWS = (MP / Team MP) × Team poss × (1.08 × Lg pts/poss − DRtg/100) / Marginal pts per win\nMarginal pts per win = 0.32 × Lg pts per game × (Team pace / Lg pace)', why: 'Basketball-Reference’s estimate of how many of his team’s wins a player produced. A team’s players add up to roughly its win total. It builds on the Dean Oliver player ratings, so it counts volume: more minutes, more Win Shares.', note: 'Season total, from saved box scores' }),
  ws48: () => ({ title: 'Win Shares per 48 minutes', formula: 'WS/48 = 48 × WS / Minutes', why: 'Win Shares with playing time taken out, so a bench player and a starter compare fairly. League average is about .100; .200 is All-Star level. Small samples swing a lot early in the season.' }),
  gpedge: () => ({ title: 'Games-played edge', formula: 'Ranked value = (GP × value + 0.5 × league average) / (GP + 0.5)', why: 'Pulls each number slightly toward the average, as if half an average game were added. Breaks near-ties in favor of bigger samples; fades as the season goes on. The number shown is unchanged.' }),
};

export const hasFormula = (key) => !!DEFS[key];

// Attributes to mark an element: h('span', { ...calc('drtg', 'team') }, 'DRtg')
export const calc = (key, scope = 'team') => (DEFS[key] ? { 'data-calc': key, 'data-calc-scope': scope, tabindex: 0, class: 'calc' } : {});

let tip = null;
function show(el) {
  const d = DEFS[el.dataset.calc]; if (!d) return;
  const c = d(el.dataset.calcScope || 'team');
  if (!tip) { tip = h('div', { class: 'calc-tip', role: 'tooltip' }); document.body.append(tip); }
  tip.replaceChildren(h('b', null, c.title), h('pre', null, c.formula), h('p', null, c.why), c.note ? h('small', null, c.note) : null);
  tip.style.display = 'block';
  const r = el.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
  let x = Math.min(window.innerWidth - tw - 10, Math.max(10, r.left + r.width / 2 - tw / 2));
  let y = r.bottom + 8; if (y + th > window.innerHeight - 10) y = Math.max(10, r.top - th - 8);
  tip.style.left = `${x}px`; tip.style.top = `${y}px`;
}
const hide = () => { if (tip) tip.style.display = 'none'; };

export function installCalcTips() {
  document.addEventListener('mouseover', (e) => { const el = e.target.closest && e.target.closest('[data-calc]'); if (el) show(el); else hide(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('[data-calc]'); if (el) show(el); });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('hashchange', hide);
}
