// Reads ESPN's transaction notes ("Waived Gs Bruce Brown and Dink Pate.") into one move per player.
// The feed is free text with no player ids or move types, so this is deliberately forgiving: anything it cannot
// read is kept as the original sentence and simply not used for the Free Agents list.

const POS = '(?:[GFC](?:-[GFC])?s?\\.?|guards?|forwards?|centers?)';
const POS_RE = new RegExp(`^${POS}\\s+`, 'i');

// Split a note into sentences without breaking on "Jr.", "Sr.", "II.", "Gs." and similar.
function sentences(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
    .replace(/\b(Jr|Sr|St|Gs|Fs|Cs|Mr|Dr)\.(?=\s|$)/g, '$1․')          // protect abbreviations (one-dot leader)
    .replace(/\.\.+/g, '.');                                                   // "Jr.." at the end of a note
  return t.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.replace(/․/g, '.').replace(/\.$/, '').trim()).filter(Boolean);
}

// "G Bruce Brown and Dink Pate" / "Fs Cris Carroll, Taye Fields and Dillon Jones" -> names
function names(list) {
  return String(list || '')
    .replace(/\s+(?:to|from|off|on)\s+.*$/i, '')                // trailing "to a two-way contract", "off waivers"
    .split(/\s*,\s*|\s+and\s+/i)
    .map((n) => n.replace(POS_RE, '').replace(/^(?:the\s+contract\s+of\s+)/i, '').trim())
    .map((n) => n.replace(POS_RE, '').trim())
    .filter((n) => /^[A-Z][A-Za-z.'’-]+(?:\s+[A-Z0-9][A-Za-z.'’-]*)+$/.test(n));
}

const RULES = [
  // [pattern, type]; the first capture group is the player list
  [/^(?:waived|released|requested waivers on)\s+(.+)$/i, 'released'],
  [/^claimed\s+(.+?)\s+off waivers/i, 'signed'],
  [/^(?:re-)?signed\s+(.+?)(?:\s+to\s+(?:a|an)\s+(.+))?$/i, 'signed'],
];

// One ESPN entry -> [{ type, name, team, date, note }]
export function parseEntry(e) {
  const team = e.team && (e.team.abbreviation || e.team.abbr) ? String(e.team.abbreviation || e.team.abbr) : '';
  const date = String(e.date || '').slice(0, 10);
  const out = [];
  for (const s of sentences(e.description)) {
    for (const [re, type] of RULES) {
      const m = re.exec(s);
      if (!m) continue;
      const deal = (m[2] || '').toLowerCase();
      if (type === 'signed' && /extension/.test(deal)) break;          // an extension is not a roster move
      for (const n of names(m[1])) out.push({ type, name: n, team, date, note: s });
      break;
    }
  }
  return out;
}

export function parseAll(entries) {
  return (entries || []).flatMap(parseEntry);
}
