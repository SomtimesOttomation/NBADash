// Formula hover cards: every calculated number in the app can explain itself.
// Mark any element with data-calc="<key>" (and optionally data-calc-scope="team"|"player"); hovering or focusing it shows the card.
import * as S from './store.js';
import { h } from './util.js';
import { RATING_METHODS } from './stats.js';

export const METHOD_NOTES = {
  native: 'Counts the real possessions in each game from the play-by-play saved with the box score. Most accurate. Games saved before this was added, or without play-by-play, use the Basketball-Reference estimate instead.',
  bref: 'Basketball-Reference’s estimate (Dean Oliver): 0.4 × free throws and a weighted offensive-rebound adjustment, averaged with the opponent’s count. Within about 2 possessions a game of the real count.',
  nba: 'The NBA.com-style estimate: FGA − ORB + TOV + 0.436 × FTA, averaged with the opponent’s count. Simple, and tends to overcount by a few possessions a game, so ratings read slightly low.',
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
  ortg: (scope) => (scope === 'player' ? {
    title: 'Offensive Rating (player)',
    formula: 'ORtg = 100 × Points Produced / Individual Possessions',
    why: 'Dean Oliver’s method, the one Basketball-Reference uses. Points Produced credits made shots, a share of assisted baskets and offensive rebounds; Individual Possessions adds the misses and turnovers the player used. Always this method: NBA.com’s player ratings need on-court tracking that box scores don’t have.',
  } : {
    title: 'Offensive Rating (team)', formula: `ORtg = 100 × Points / Poss\n\n${POSS[method()]}`,
    why: 'Points scored per 100 possessions. Using possessions instead of games removes the effect of pace, so fast and slow teams compare fairly.', note: methodLine(),
  }),
  drtg: (scope) => (scope === 'player' ? {
    title: 'Defensive Rating (player)',
    formula: 'DRtg = Team DRtg + 0.2 × (100 × Opp pts per scoring poss × (1 − Stop%) − Team DRtg)',
    why: 'Dean Oliver’s estimate of points allowed per 100 possessions while on the floor. Stops come from steals, blocks, defensive rebounds and a share of forced misses and turnovers. Box scores don’t record who guarded whom, so it leans heavily on the team’s defense. Lower is better.',
  } : {
    title: 'Defensive Rating (team)', formula: `DRtg = 100 × Opponent points / Poss\n\n${POSS[method()]}`,
    why: 'Points allowed per 100 possessions. Lower is better.', note: methodLine(),
  }),
  net: () => ({ title: 'Net Rating', formula: 'Net = ORtg − DRtg', why: 'How many points per 100 possessions a team outscores opponents by. The single best quick measure of how good a team has been.', note: methodLine() }),
  diff: () => ({ title: 'Point Differential', formula: 'Diff = (Points − Points allowed) / Games', why: 'Average winning (or losing) margin. Simple, but fast-paced games inflate it; Net Rating corrects for pace.' }),
  efg: () => ({ title: 'Effective FG%', formula: 'eFG% = (FGM + 0.5 × 3PM) / FGA', why: 'Field goal percentage that gives a made three the 1.5× credit it earns in points. The most important of the Four Factors.' }),
  eff: () => ({ title: 'Efficiency (EFF)', formula: 'EFF = (PTS + REB + AST + STL + BLK − missed FG − missed FT − TOV) / Games', why: 'The NBA’s classic all-in-one box score number. Easy to read; rewards volume more than shooting efficiency.' }),
  splits: () => ({ title: 'Shooting Splits', formula: 'FG% / 3P% / FT%', why: 'Ranked by the average of the three percentages. To qualify a player needs at least 3 field goal attempts, 1 three-point attempt and 1 free throw attempt per team game.' }),
  stocks: () => ({ title: 'Stocks', formula: 'Stocks = (STL + BLK) / Games', why: 'Steals plus blocks: a quick measure of defensive events.' }),
  pm: () => ({ title: 'Plus / Minus', formula: '+/- = Team points − Opponent points while on the floor, per game', why: 'Straight from the box score. Noisy over small samples and heavily tied to teammates.' }),
  gamescore: () => ({ title: 'Game Score', formula: 'GmSc = PTS + 0.4×FGM − 0.7×FGA − 0.4×(FTA − FTM) + 0.7×ORB + 0.3×DRB + STL + 0.7×AST + 0.7×BLK − 0.4×PF − TOV', why: 'John Hollinger’s single-game rating, used to pick Player of the Game. Around 10 is average, 40 is a great night.' }),
  grade: () => ({
    title: 'Report Card grade',
    formula: 'Overall = 30% Net Rating + 35% Offense + 35% Defense\nOffense = 20% ORtg + 32% eFG% + 20% TOV% + 16% ORB% + 12% FT rate\nDefense = same five, for what opponents did',
    why: 'Each input is turned into a percentile against the other teams, then weighted. The weights follow Dean Oliver’s Four Factors (shooting matters most). Grades are a curve: roughly the top 10% get an A. Teams with more games get a small edge.', note: methodLine(),
  }),
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
