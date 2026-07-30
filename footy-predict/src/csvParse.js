// Parses a simple CSV of match results into the same shape computeStats()
// (in footballData.js) already expects — so uploaded data flows through
// the exact same stats/prediction pipeline as the API-fetched leagues,
// with no separate math path to maintain.
//
// Expected columns (header row required, case-insensitive, any order):
//   home_team, away_team, home_goals, away_goals
//
// Extra columns are ignored. Blank lines are skipped. Throws a clear error
// naming the row number if something's malformed, rather than silently
// dropping bad data.

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

  const matches = lines.slice(1).map((line, i) => {
    const rowNum = i + 2; // +2: 1-indexed, plus the header row itself
    const cells = line.split(",").map((c) => c.trim());
    const homeTeam = cells[homeTeamIdx], awayTeam = cells[awayTeamIdx];
    const homeGoals = Number(cells[homeGoalsIdx]), awayGoals = Number(cells[awayGoalsIdx]);

    if (!homeTeam || !awayTeam) throw new Error(`Row ${rowNum}: missing team name.`);
    if (!Number.isFinite(homeGoals) || !Number.isFinite(awayGoals)) throw new Error(`Row ${rowNum}: goals must be numbers.`);
    if (homeGoals < 0 || awayGoals < 0) throw new Error(`Row ${rowNum}: goals can't be negative.`);

    return { homeTeam: { name: homeTeam }, awayTeam: { name: awayTeam }, score: { fullTime: { home: homeGoals, away: awayGoals } } };
  });

  return matches;
}

// Every distinct team name appearing in a parsed match list, alphabetical.
function teamNamesIn(matches) {
  const names = new Set();
  matches.forEach((m) => { names.add(m.homeTeam.name); names.add(m.awayTeam.name); });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

module.exports = { parseMatchesCsv, teamNamesIn };
