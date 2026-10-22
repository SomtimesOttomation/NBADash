// Seed list of current arenas, keyed by ESPN's team abbreviation.
// ESPN's franchise venue is stale for some teams (it still lists old arenas), so the team page prefers the
// venue found on the team's own home games, then this table, then ESPN's franchise venue.
// Naming rights change often: edit here if a name is out of date.
export const ARENAS = {
  ATL: 'State Farm Arena',
  BOS: 'TD Garden',
  BKN: 'Barclays Center',
  CHA: 'Spectrum Center',
  CHI: 'United Center',
  CLE: 'Rocket Arena',
  DAL: 'American Airlines Center',
  DEN: 'Ball Arena',
  DET: 'Little Caesars Arena',
  GS: 'Chase Center',
  HOU: 'Toyota Center',
  IND: 'Gainbridge Fieldhouse',
  LAC: 'Intuit Dome',
  LAL: 'Crypto.com Arena',
  MEM: 'FedExForum',
  MIA: 'Kaseya Center',
  MIL: 'Fiserv Forum',
  MIN: 'Target Center',
  NO: 'Smoothie King Center',
  NY: 'Madison Square Garden',
  OKC: 'Paycom Center',
  ORL: 'Kia Center',
  PHI: 'Xfinity Mobile Arena',
  PHX: 'Mortgage Matchup Center',
  POR: 'Moda Center',
  SAC: 'Golden 1 Center',
  SA: 'Frost Bank Center',
  TOR: 'Scotiabank Arena',
  UTAH: 'Delta Center',
  WSH: 'Capital One Arena',
};

// ESPN uses short codes for a few teams; show the codes fans expect.
const DISPLAY = { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };
export const displayCode = (abbr) => DISPLAY[abbr] || abbr;

// Normalizes anything a person might type or save (NYK, GSW...) to ESPN's code.
const TO_ESPN = { NYK: 'NY', GSW: 'GS', SAS: 'SA', NOP: 'NO', UTA: 'UTAH', WAS: 'WSH' };
export const toEspnCode = (code) => TO_ESPN[String(code).toUpperCase()] || String(code).toUpperCase();
