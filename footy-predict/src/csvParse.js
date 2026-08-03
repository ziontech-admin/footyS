// Parses a CSV of match results into the same shape computeStats()
// (in footballData.js) already expects — so uploaded data flows through
// the exact same stats/prediction pipeline as the API-fetched leagues,
// with no separate math path to maintain.
//
// Required columns (header row required, case-insensitive, any order):
//   home_team, away_team, home_goals, away_goals
//
// Optional columns — include whichever ones you have data for, in any
// combination. Each pair populates the same statistics field the API path
// uses, so corners/fouls/shots/possession predictions work identically
// whether the data came from football-data.org or a hand-typed CSV:
//   home_corners, away_corners       → corner_kicks
//   home_fouls, away_fouls           → fouls
//   home_shots, away_shots           → shots
//   home_possession, away_possession → ball_possession (as a percentage, e.g. 66)
//
// Missing optional columns simply mean that market won't have predictions
// for teams whose only data came from this upload — same graceful
// degradation as everywhere else in this app, not an error.
//
// Extra unrecognized columns are ignored. Blank lines are skipped. Throws a
// clear error naming the row number if something's malformed, rather than
// silently dropping bad data.

const OPTIONAL_STAT_COLUMNS = [
  { home: "home_corners", away: "away_corners", field: "corner_kicks" },
  { home: "home_fouls", away: "away_fouls", field: "fouls" },
  { home: "home_shots", away: "away_shots", field: "shots" },
  { home: "home_possession", away: "away_possession", field: "ball_possession" },
];

function parseMatchesCsv(csvText) {
  const lines = String(csvText).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) throw new Error("CSV needs a header row plus at least one match row.");

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (name) => {
    const idx = header.indexOf(name);
    if (idx === -1) throw new Error(`Missing required column "${name}". Expected: home_team, away_team, home_goals, away_goals.`);
    return idx;
  };
  const homeTeamIdx = col("home_team"), awayTeamIdx = col("away_team");
  const homeGoalsIdx = col("home_goals"), awayGoalsIdx = col("away_goals");

  // Optional stat columns: only tracked if BOTH home and away columns for
  // that stat are present — a lopsided pair (only home_corners, no
  // away_corners) is treated as not provided at all, since a one-sided
  // stat can't feed the same-shape home/away structure the rest of the
  // app expects.
  const optionalCols = OPTIONAL_STAT_COLUMNS
    .map((spec) => ({ ...spec, homeIdx: header.indexOf(spec.home), awayIdx: header.indexOf(spec.away) }))
    .filter((spec) => spec.homeIdx !== -1 && spec.awayIdx !== -1);

  const matches = lines.slice(1).map((line, i) => {
    const rowNum = i + 2; // +2: 1-indexed, plus the header row itself
    const cells = line.split(",").map((c) => c.trim());
    const homeTeam = cells[homeTeamIdx], awayTeam = cells[awayTeamIdx];
    const homeGoals = Number(cells[homeGoalsIdx]), awayGoals = Number(cells[awayGoalsIdx]);

    if (!homeTeam || !awayTeam) throw new Error(`Row ${rowNum}: missing team name.`);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) throw new Error(`Row ${rowNum}: goals must be numbers.`);
    if (homeGoals < 0 || awayGoals < 0) throw new Error(`Row ${rowNum}: goals can't be negative.`);

    const match = { homeTeam: { name: homeTeam }, awayTeam: { name: awayTeam }, score: { fullTime: { home: homeGoals, away: awayGoals } } };

    // Populate statistics only from columns present for THIS row — a blank
    // cell for an otherwise-tracked column just skips that one stat for
    // that one match, rather than failing the whole upload.
    optionalCols.forEach(({ field, homeIdx, awayIdx }) => {
      const homeVal = cells[homeIdx], awayVal = cells[awayIdx];
      if (homeVal === "" || awayVal === "" || homeVal === undefined || awayVal === undefined) return;
      const homeNum = Number(homeVal), awayNum = Number(awayVal);
      if (!Number.isFinite(homeNum) || !Number.isFinite(awayNum)) throw new Error(`Row ${rowNum}: "${field}" values must be numbers.`);
      if (!match.homeTeam.statistics) match.homeTeam.statistics = {};
      if (!match.awayTeam.statistics) match.awayTeam.statistics = {};
      match.homeTeam.statistics[field] = homeNum;
      match.awayTeam.statistics[field] = awayNum;
    });

    return match;
  });

  return matches;
}

// Every distinct team name appearing in a parsed match list, alphabetical.
function teamNamesIn(matches) {
  const names = new Set();
  matches.forEach((m) => { names.add(m.homeTeam.name); names.add(m.awayTeam.name); });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

module.exports = { parseMatchesCsv, teamNamesIn, OPTIONAL_STAT_COLUMNS };
