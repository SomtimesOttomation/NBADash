// Strength of schedule for the games a team has left: how hard its remaining opponents are, by rating, not record.
// Uses the saved schedules (dates, home/road) and the league's SRS; no extra requests.

export const SOS = { shrinkGames: 15, homeEdge: 1.25, b2bPenalty: 1.0, earlyGames: 20, nextN: 10 };

const opp = (g, abbr) => {
  let home = g.home, away = g.away;
  const m = /^\s*(\S+)\s*@\s*(\S+)\s*$/.exec(g.name || '');
  if (m) { away = away || m[1]; home = home || m[2]; }
  if (home === abbr) return { team: away, home: true };
  if (away === abbr) return { team: home, home: false };
  return null;
};
const dayNum = (iso) => Math.floor(Date.parse(iso) / 864e5);

// files: Map abbr -> team file ({ games: [{ date, state, home, away, name }] }); rows: teamRows() output (srs, games)
export function remainingSchedule(files, rows) {
  const rating = new Map(rows.map((r) => [r.abbr, Number.isFinite(r.srs) ? r.srs * (r.games / (r.games + SOS.shrinkGames)) : 0]));
  const avgGp = rows.length ? rows.reduce((a, r) => a + r.games, 0) / rows.length : 0;
  const out = new Map();
  for (const [abbr, f] of files) {
    if (!f || !f.games) continue;
    const all = [...f.games].filter((g) => g.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    let prevDay = null;
    const left = [];
    for (const g of all) {
      const d = dayNum(g.date);
      const o = opp(g, abbr);
      if (g.state !== 'post' && o && o.team) {
        const b2b = prevDay != null && d - prevDay === 1;
        const diff = (rating.get(o.team) || 0) + (o.home ? -SOS.homeEdge : SOS.homeEdge) + (b2b ? SOS.b2bPenalty : 0);
        left.push({ diff, home: o.home, b2b, team: o.team, date: g.date });
      }
      prevDay = d;
    }
    const avg = (list) => (list.length ? list.reduce((a, x) => a + x.diff, 0) / list.length : NaN);
    out.set(abbr, {
      left: left.length, home: left.filter((x) => x.home).length, road: left.filter((x) => !x.home).length, b2b: left.filter((x) => x.b2b).length,
      all: avg(left), next: avg(left.slice(0, SOS.nextN)), games: left,
    });
  }
  // ranks: 1 = hardest
  const rank = (k) => { const list = [...out.entries()].filter(([, v]) => Number.isFinite(v[k])).sort((a, b) => b[1][k] - a[1][k]); list.forEach(([a], i) => { out.get(a)[`${k}Rank`] = i + 1; }); return list.length; };
  const n = rank('all'); rank('next');
  for (const v of out.values()) v.of = n;
  return { teams: out, early: avgGp < SOS.earlyGames, avgGp };
}

export const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
