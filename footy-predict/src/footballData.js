// Thin wrapper around football-data.org's v4 API, with a simple in-memory
// cache. The free tier is rate-limited, so anything that doesn't change
// minute-to-minute (fixtures, season stats) gets cached for a while rather
// than re-fetched on every page load.

const BASE_URL = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Half-life for exponential form weighting (days). A match halfLife days ago
// contributes half as much as a match today. ~70 days keeps recent form
// important without discarding the rest of the season.
const FORM_HALF_LIFE_DAYS = 70;

const cache = new Map();

async function cachedFetch(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  cache.set(path, { data, at: Date.now() });
  return data;
}

async function upcomingMatches(competitionCode, limit = 10) {
  const data = await cachedFetch(`/competitions/${competitionCode}/matches?status=SCHEDULED`);
  return (data.matches || []).slice(0, limit);
}

async function finishedMatches(competitionCode) {
  const data = await cachedFetch(`/competitions/${competitionCode}/matches?status=FINISHED`);
  return data.matches || [];
}

function formWeight(utcDate, nowMs, halfLifeDays = FORM_HALF_LIFE_DAYS) {
  if (!utcDate) return 1;
  const t = new Date(utcDate).getTime();
  if (Number.isNaN(t)) return 1;
  const daysAgo = Math.max(0, (nowMs - t) / (24 * 60 * 60 * 1000));
  return Math.exp((-Math.LN2 * daysAgo) / halfLifeDays);
}

// Shrink a team's observed average toward the league mean when sample is small.
// k is a prior strength in "virtual games" — with 0 games you get the league avg;
// with many games the estimate is almost fully the team's own rate.
function shrinkToMean(observed, leagueMean, games, k = 4) {
  if (games <= 0) return leagueMean;
  return (observed * games + leagueMean * k) / (games + k);
}

function computeStats(matches, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const halfLifeDays = options.halfLifeDays ?? FORM_HALF_LIFE_DAYS;
  const shrinkK = options.shrinkK ?? 4;

  // Weighted sums + unweighted game counts (for confidence / sample size).
  const teamHomeGF = {}, teamHomeGA = {}, teamHomeW = {}, teamHomeGames = {};
  const teamAwayGF = {}, teamAwayGA = {}, teamAwayW = {}, teamAwayGames = {};
  let totalHomeGoals = 0, totalAwayGoals = 0, totalGames = 0;
  let wHomeGoals = 0, wAwayGoals = 0, wGames = 0;

  matches.forEach((m) => {
    const home = m.homeTeam.name, away = m.awayTeam.name;
    const hg = m.score?.fullTime?.home, ag = m.score?.fullTime?.away;
    if (hg == null || ag == null) return;

    const w = formWeight(m.utcDate, nowMs, halfLifeDays);

    teamHomeGF[home] = (teamHomeGF[home] || 0) + hg * w;
    teamHomeGA[home] = (teamHomeGA[home] || 0) + ag * w;
    teamHomeW[home] = (teamHomeW[home] || 0) + w;
    teamHomeGames[home] = (teamHomeGames[home] || 0) + 1;

    teamAwayGF[away] = (teamAwayGF[away] || 0) + ag * w;
    teamAwayGA[away] = (teamAwayGA[away] || 0) + hg * w;
    teamAwayW[away] = (teamAwayW[away] || 0) + w;
    teamAwayGames[away] = (teamAwayGames[away] || 0) + 1;

    totalHomeGoals += hg;
    totalAwayGoals += ag;
    totalGames += 1;
    wHomeGoals += hg * w;
    wAwayGoals += ag * w;
    wGames += w;
  });

  // League averages: prefer weighted season mean when we have dates; else simple mean.
  const leagueAvgHomeGoals = wGames > 0 ? wHomeGoals / wGames : (totalGames ? totalHomeGoals / totalGames : 1.5);
  const leagueAvgAwayGoals = wGames > 0 ? wAwayGoals / wGames : (totalGames ? totalAwayGoals / totalGames : 1.1);

  const weightedAvg = (sumObj, weightObj, team, fallback) =>
    weightObj[team] > 0 ? sumObj[team] / weightObj[team] : fallback;

  return {
    leagueAvgHomeGoals,
    leagueAvgAwayGoals,
    totalGames,
    formHalfLifeDays: halfLifeDays,
    teamStats: (teamName) => {
      const homeGames = teamHomeGames[teamName] || 0;
      const awayGames = teamAwayGames[teamName] || 0;
      const rawHomeFor = weightedAvg(teamHomeGF, teamHomeW, teamName, leagueAvgHomeGoals);
      const rawHomeAgainst = weightedAvg(teamHomeGA, teamHomeW, teamName, leagueAvgAwayGoals);
      const rawAwayFor = weightedAvg(teamAwayGF, teamAwayW, teamName, leagueAvgAwayGoals);
      const rawAwayAgainst = weightedAvg(teamAwayGA, teamAwayW, teamName, leagueAvgHomeGoals);

      return {
        homeAvgGoalsFor: shrinkToMean(rawHomeFor, leagueAvgHomeGoals, homeGames, shrinkK),
        homeAvgGoalsAgainst: shrinkToMean(rawHomeAgainst, leagueAvgAwayGoals, homeGames, shrinkK),
        awayAvgGoalsFor: shrinkToMean(rawAwayFor, leagueAvgAwayGoals, awayGames, shrinkK),
        awayAvgGoalsAgainst: shrinkToMean(rawAwayAgainst, leagueAvgHomeGoals, awayGames, shrinkK),
        homeGames,
        awayGames,
      };
    },
  };
}

// Current league table — used to show each team's position alongside
// their prediction (e.g. "Man City (1st)").
async function standings(competitionCode) {
  const data = await cachedFetch(`/competitions/${competitionCode}/standings`);
  const table = data.standings?.find((s) => s.type === "TOTAL")?.table || [];
  const positionByTeam = {};
  table.forEach((row) => { positionByTeam[row.team.name] = row.position; });
  return positionByTeam;
}

module.exports = { upcomingMatches, finishedMatches, computeStats, standings, formWeight, shrinkToMean, FORM_HALF_LIFE_DAYS };
