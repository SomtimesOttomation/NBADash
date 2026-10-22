// Mock host used when the page runs in a normal browser (no WebView2). Synthetic data only.
import { etKey, addDaysKey, keyToUtcNoon } from '../js/util.js';

const TEAMS = [
  ['ATL','Atlanta Hawks','C8102E'],['BOS','Boston Celtics','007A33'],['BKN','Brooklyn Nets','000000'],['CHA','Charlotte Hornets','1D1160'],
  ['CHI','Chicago Bulls','CE1141'],['CLE','Cleveland Cavaliers','860038'],['DAL','Dallas Mavericks','00538C'],['DEN','Denver Nuggets','0E2240'],
  ['DET','Detroit Pistons','C8102E'],['GS','Golden State Warriors','1D428A'],['HOU','Houston Rockets','CE1141'],['IND','Indiana Pacers','002D62'],
  ['LAC','LA Clippers','C8102E'],['LAL','Los Angeles Lakers','552583'],['MEM','Memphis Grizzlies','5D76A9'],['MIA','Miami Heat','98002E'],
  ['MIL','Milwaukee Bucks','00471B'],['MIN','Minnesota Timberwolves','0C2340'],['NO','New Orleans Pelicans','0C2340'],['NY','New York Knicks','006BB6'],
  ['OKC','Oklahoma City Thunder','007AC1'],['ORL','Orlando Magic','0077C0'],['PHI','Philadelphia 76ers','006BB6'],['PHX','Phoenix Suns','1D1160'],
  ['POR','Portland Trail Blazers','E03A3E'],['SAC','Sacramento Kings','5A2D81'],['SA','San Antonio Spurs','C4CED4'],['TOR','Toronto Raptors','CE1141'],
  ['UTAH','Utah Jazz','002B5C'],['WSH','Washington Wizards','002B5C'],
].map(([abbr, name, color], i) => ({ id: String(i + 1), abbr, name, location: name.split(' ').slice(0, -1).join(' '), nickname: name.split(' ').slice(-1)[0], color, altColor: 'FFFFFF', logo: '' }));

let emit = () => {};
const today = etKey(new Date());
const yest = addDaysKey(today, -1);
let settings = { favorites: ['TOR'], theme: 'system', liveSeconds: 30, autoWatch: true };
const watch = new Set();
const stats = { requests: 0, bytes: 0, wireBytes: 0, errors: 0, byKind: {} };
const started = Date.now();
let syncing = false;
let leagueFile = null;

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function mkDay(key, state, offset) {
  const r = rng(+key.slice(4) + offset);
  const order = TEAMS.map((t) => t.abbr).sort(() => r() - 0.5);
  if (key === today || key === yest) { // keep a favorite in the mix
    const i = order.indexOf('TOR'); order.splice(i, 1); order.unshift('TOR');
  }
  const events = [];
  for (let i = 0; i < 10; i += 2) {
    const a = order[i], hm = order[i + 1];
    const st = state === 'mixed' ? ['in', 'in', 'post', 'pre', 'pre'][i / 2] : state;
    const sc = () => Math.round(80 + r() * 45);
    const t = (n) => TEAMS.find((x) => x.abbr === n);
    const mkSide = (side, abbr) => {
      const q = st === 'pre' ? [] : [Math.round(20 + r() * 12), Math.round(20 + r() * 12), Math.round(20 + r() * 12), st === 'post' ? Math.round(20 + r() * 12) : 0].slice(0, st === 'in' ? 3 : 4);
      return { side, abbr, name: t(abbr).name, score: st === 'pre' ? '' : String(q.reduce((x, y) => x + y, 0)), winner: false, record: `${Math.floor(r() * 3)}-${Math.floor(r() * 3)}`, lines: q.map(String),
        leaders: st === 'pre' ? [] : [{ cat: 'points', player: 'Player ' + abbr, playerId: String((TEAMS.find((t) => t.abbr === abbr) || {}).id) + '0', value: String(15 + Math.floor(r() * 20)) }] };
    };
    const d = keyToUtcNoon(key); d.setUTCHours(23 + (i / 2) * 0.5, i % 4 ? 30 : 0);
    events.push({ id: `${key}${i}`, date: d.toISOString(), name: `${a} @ ${hm}`, state: st, detail: st === 'in' ? '3rd Quarter' : st === 'post' ? 'Final' : 'Scheduled',
      period: st === 'in' ? 3 : st === 'post' ? 4 : 0, clock: st === 'in' ? '5:42' : '', venue: `${t(hm).name} Arena`, sides: [mkSide('away', a), mkSide('home', hm)] });
  }
  return { date: key, allFinal: state === 'post', syncedAt: new Date().toISOString(), fetchedAt: new Date().toISOString(), events };
}

const days = { [today]: mkDay(today, 'mixed', 1), [yest]: mkDay(yest, 'post', 2), [addDaysKey(yest, -1)]: mkDay(addDaysKey(yest, -1), 'post', 3) };

function teamFile(abbr) {
  const t = TEAMS.find((x) => x.abbr === abbr);
  const players = Array.from({ length: 15 }, (_, i) => ({ id: `${t.id}${i}`, name: `${t.nickname} Player ${i + 1}`, jersey: String(i + 1), pos: ['PG', 'SG', 'SF', 'PF', 'C'][i % 5], height: `6' ${i % 12}"`, weight: `${190 + i * 4} lbs`, age: 20 + i, years: i % 10, headshot: '' }));
  const games = Object.values(days).flatMap((d) => d.events).filter((e) => e.sides.some((s) => s.abbr === abbr))
    .map((e) => ({ id: e.id, date: e.date, state: e.state, status: e.detail, home: e.sides[1].abbr, away: e.sides[0].abbr, homeScore: e.sides[1].score, awayScore: e.sides[0].score, venue: e.venue }));
  return { abbr, id: t.id, name: t.name, record: '1-1', espnArena: '', headCoach: 'Coach Example', players, games, syncedAt: new Date().toISOString() };
}


// ---- players (mock of the host's compacted ESPN player file)
const AVG_LABELS = ['GP', 'GS', 'MIN', 'FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'OR', 'DR', 'REB', 'AST', 'BLK', 'STL', 'PF', 'TO', 'PTS'];
const TOT_LABELS = ['FG', 'FG%', '3PT', '3P%', 'FT', 'FT%', 'OR', 'DR', 'REB', 'AST', 'BLK', 'STL', 'PF', 'TO', 'PTS'];
const MISC_LABELS = ['DD2', 'TD3', 'DQ', 'EJECT', 'TECH', 'FLAG', 'AST/TO', 'STL/TO', 'SC-EFF', 'SH-EFF'];
function mockPlayer(id) {
  const seed = [...String(id)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7);
  const r = (k, lo, hi) => lo + (((seed * (k + 3) * 2654435761) >>> 0) % 1000) / 1000 * (hi - lo);
  let name = 'Michael Jordan', abbr = '', pos = 'SG', jersey = '23', retired = true;
  for (const t of TEAMS) { const p = teamFile(t.abbr).players.find((x) => x.id === String(id)); if (p) { name = p.name; abbr = t.abbr; pos = p.pos; jersey = p.jersey; retired = false; } }
  const team = TEAMS.find((t) => t.abbr === abbr);
  const row = (year, played) => {
    const gp = played ? Math.round(r(year, 8, 78)) : 0; const pts = r(year + 1, 6, 30), reb = r(year + 2, 2, 12), ast = r(year + 3, 1, 10);
    const avg = [String(gp), String(Math.round(gp * 0.8)), r(year + 4, 18, 36).toFixed(1), `${(pts / 2.3).toFixed(1)}-${(pts / 1.1).toFixed(1)}`, r(year + 5, 40, 58).toFixed(1), '1.5-4.0', r(year + 6, 28, 42).toFixed(1), '3.0-3.8', r(year + 7, 70, 90).toFixed(1),
      r(year + 8, 0.5, 3).toFixed(1), r(year + 9, 2, 8).toFixed(1), reb.toFixed(1), ast.toFixed(1), r(year + 10, 0.2, 1.6).toFixed(1), r(year + 11, 0.5, 1.8).toFixed(1), r(year + 12, 1.5, 3).toFixed(1), r(year + 13, 1, 4).toFixed(1), pts.toFixed(1)];
    const tot = ['300-600', '48.0', '80-200', '35.0', '120-150', '80.0', '100', '300', '400', '350', '40', '60', '150', '120', String(Math.round(pts * gp))];
    const misc = ['5', '0', '0', '0', '3', '0', '2.1', '0.8', '1.2', '0.55'];
    return { year, season: `${year - 1}-${String(year).slice(2)}`, teamId: team ? String(team.id) : '', team: 'team', avg, tot, misc };
  };
  const played = (seed % 4) !== 0;                    // some mock players have no games yet this season
  const seasons = [2024, 2025, 2026, 2027].map((y) => row(y, y < 2027 || played)).filter((s) => s.avg[0] !== '0');
  return { syncedAt: new Date().toISOString(), season: 2027, seasonName: '2026-27',
    bio: { id: String(id), name, jersey, pos, posName: { PG: 'Point Guard', SG: 'Shooting Guard', SF: 'Small Forward', PF: 'Power Forward', C: 'Center' }[pos] || pos, teamId: team ? String(team.id) : '', team: abbr, teamName: team ? team.name : '',
      headshot: '', height: `6' ${Math.round(r(1, 3, 11))}"`, weight: `${Math.round(r(2, 190, 260))} lbs`, age: Math.round(r(3, 20, 35)), dob: '1998-04-12', birthPlace: 'Springfield, USA', draft: '2019: Rd 1, Pk 12 (TOR)', experience: '7th Season', college: retired ? 'North Carolina' : '', citizenship: '', status: retired ? 'Retired' : 'Active', debutYear: 2019 },
    avgLabels: AVG_LABELS, totLabels: TOT_LABELS, miscLabels: MISC_LABELS, seasons,
    career: { avg: row(2000, true).avg, tot: row(2000, true).tot, misc: row(2000, true).misc } };
}

function box(id) {
  const ev = Object.values(days).flatMap((d) => d.events).find((e) => e.id === id);
  if (!ev || ev.state === 'pre') return null;
  const labels = ['MIN', 'PTS', 'FG', '3PT', 'FT', 'REB', 'AST', 'TO', 'STL', 'BLK', 'OREB', 'DREB', 'PF', '+/-'];
  const r = rng(+id.slice(-6) || 7);
  const mk = (s) => {
    const players = Array.from({ length: 10 }, (_, i) => {
      const dnp = i === 9;
      const fga = 4 + Math.floor(r() * 12), fgm = Math.floor(fga * (0.3 + r() * 0.3)), tpa = Math.floor(fga / 3), tpm = Math.min(tpa, Math.floor(r() * 3)), fta = Math.floor(r() * 6), ftm = Math.floor(fta * 0.8);
      const reb = Math.floor(r() * 10), oreb = Math.floor(reb / 3);
      const pts = fgm * 2 + tpm + ftm;
      return { id: `${TEAMS.find((x) => x.abbr === s.abbr).id}${i}`, name: `${s.abbr} Player ${i + 1}`, jersey: String(i + 1), pos: ['PG', 'SG', 'SF', 'PF', 'C'][i % 5], starter: i < 5, dnp, reason: dnp ? "COACH'S DECISION" : '',
        stats: dnp ? [] : [String(34 - i * 3), String(pts), `${fgm}-${fga}`, `${tpm}-${tpa}`, `${ftm}-${fta}`, String(reb), String(Math.floor(r() * 8)), String(Math.floor(r() * 4)), String(Math.floor(r() * 3)), String(Math.floor(r() * 3)), String(oreb), String(reb - oreb), String(Math.floor(r() * 5)), String(Math.floor(r() * 30) - 15)] };
    });
    const sum = (k) => players.filter((p) => !p.dnp).reduce((a, p) => a + (k === 'pair' ? 0 : 0), 0);
    void sum;
    return { team: s.abbr, labels, players, totals: [] };
  };
  return { id, date: ev.date, name: ev.name, venue: ev.venue, city: 'Mock City', attendance: '18,000',
    teams: ev.sides.map(mk),
    teamStats: ev.sides.map((s) => ({ team: s.abbr, stats: [{ name: 'fieldGoalsMade-fieldGoalsAttempted', value: '38-85' }, { name: 'fieldGoalPct', value: '45' }, { name: 'totalRebounds', value: '44' }, { name: 'totalTurnovers', value: '12' }] })),
    syncedAt: new Date().toISOString() };
}

function count(kind, bytes) {
  stats.requests++; stats.bytes += bytes; stats.wireBytes += Math.round(bytes / 5);
  stats.byKind[kind] = stats.byKind[kind] || { requests: 0, bytes: 0 };
  stats.byKind[kind].requests++; stats.byKind[kind].bytes += bytes;
}

function tick() {
  const d = days[today];
  d.events.filter((e) => e.state === 'in').forEach((e) => {
    const s = e.sides[Math.random() < .5 ? 0 : 1]; s.score = String(+s.score + (Math.random() < .5 ? 2 : 3));
  });
  d.fetchedAt = new Date().toISOString();
  count('scoreboard', 202000);
  emit('scoreboard', JSON.parse(JSON.stringify(d)));
  emit('live', { ok: true, at: Date.now(), error: '', anyLive: true });
  watch.forEach((id) => { const b = box(id); if (b) { count('boxscore', 463000); emit('box', { eventId: id, box: b }); } });
}

export function attach(e) { emit = e; setInterval(tick, 4000); }

export async function request(cmd, args) {
  await new Promise((r) => setTimeout(r, 15));
  switch (cmd) {
    case 'init': return { settings, sync: { running: false, lastRun: new Date().toISOString() }, cacheDir: '(mock)', version: '0.2.0', sample: true };
    case 'cache.read': {
      const p = args.path; let m;
      if (p === 'teams.json') return TEAMS;
      if ((m = p.match(/^scoreboards\/(\d{8})\.json$/))) return days[m[1]] || null;
      if ((m = p.match(/^boxscores\/(\d+)\.json$/))) return box(m[1]);
      if ((m = p.match(/^teams\/(\w+)\.json$/))) return TEAMS.some((t) => t.abbr === m[1]) ? teamFile(m[1]) : null;
      if (p === 'league-stats.json') return leagueFile;
      if (p === 'standings.json') {
        const mk = (names) => names.map((a, i) => ({ abbr: a, name: a, stats: { wins: String(5 - (i % 5)), losses: String(i % 5), winPercent: String(((5 - (i % 5)) / 5).toFixed(3)), gamesBehind: String(i % 5), Home: '3-1', Road: '2-2', 'Last Ten Games': '5-5', streak: 'W1' } }));
        const ab = TEAMS.map((t) => t.abbr);
        return { syncedAt: new Date().toISOString(), conferences: [{ name: 'Eastern Conference', teams: mk(ab.slice(0, 15)) }, { name: 'Western Conference', teams: mk(ab.slice(15)) }] };
      }
      if (p === 'injuries.json') return { syncedAt: new Date().toISOString(), teams: [{ team: 'TOR', teamId: '28', players: [{ id: '280', name: 'Raptors Player 1', status: 'Out', date: '', comment: 'Ankle' }, { id: '282', name: 'Raptors Player 3', status: 'Day-To-Day', comment: 'Knee' }] }] };
      return null;
    }
    case 'cache.list': return args.dir === 'boxscores'
      ? Object.values(days).flatMap((d) => d.events).filter((e) => e.state !== 'pre').map((e) => `${e.id}.json`)
      : Object.keys(days).map((k) => `${k}.json`);
    case 'box.get': { const b = box(args.id); if (b) count('boxscore', 463000); return b; }
    case 'watch.set': if (args.on) watch.add(args.id); else watch.delete(args.id); return true;
    case 'settings.save': settings = args.settings; return true;
    case 'cache.write': leagueFile = JSON.parse(args.text); return true;
    case 'sync.cancel': return true;
    case 'sync.run': {
      if (syncing) return false;
      syncing = true; let pct = 0;
      const steps = ['Contacting ESPN', 'Team TOR (1 of 30)', 'Team BOS (2 of 30)', 'Standings', 'Injuries', 'Games for Oct 21', 'Box score CHI @ TOR'];
      emit('sync', { running: true, pct: 0, text: 'Starting...' });
      const t = setInterval(() => {
        pct += 15;
        if (pct >= 100) { clearInterval(t); syncing = false; emit('sync', { running: false, pct: 100, exitCode: 0, summary: '139 requests, 1,730 KB on the wire, 14 box scores, 0 errors', lastRun: new Date().toISOString() }); return; }
        emit('sync', { running: true, pct, text: steps[Math.min(steps.length - 1, Math.floor(pct / 15))] });
      }, 700);
      return true;
    }
    case 'update.check': {
      emit('update', { running: true, action: 'Check', pct: 2, text: 'Asking GitHub for the latest release...' });
      setTimeout(() => emit('update', { running: false, action: 'Check', result: { status: 'available', current: '0.2.0', latest: '0.3.0', tag: 'v0.3.0', published: '2026-10-30T12:00:00Z', size: 74000, installable: true,
        notes: '### Feature\n- Player search\n- Compare players\n\n### Bug/Fix\n- Box score columns line up' } }), 900);
      return true;
    }
    case 'update.stage': {
      let p = 5; emit('update', { running: true, action: 'Stage', pct: p, text: 'Downloading...' });
      const t = setInterval(() => { p += 19; if (p >= 100) { clearInterval(t); emit('update', { running: false, action: 'Stage', result: { status: 'staged', current: '0.2.0', latest: '0.3.0' } }); return; } emit('update', { running: true, action: 'Stage', pct: p, text: `Downloading ${(p / 20).toFixed(1)} of 5.0 MB` }); }, 500);
      return true;
    }
    case 'update.cancel': return true;
    case 'update.apply': return true;
    case 'player.get': return { player: mockPlayer(args.id) };
    case 'player.search': {
      setTimeout(() => emit('psearch', { q: args.q, ok: true, items: /jord/i.test(args.q) ? [{ id: '893', name: 'Michael Jordan', team: 'Chicago Bulls', jersey: '23', pos: 'SG', active: false, retired: true, headshot: '' }] : [] }), 500);
      return true;
    }
    case 'live.refresh': tick(); return true;
    case 'traffic.get': return { uptimeSec: (Date.now() - started) / 1000, ...stats, last: 'scoreboard' };
    default: throw new Error('mock: unknown ' + cmd);
  }
}
