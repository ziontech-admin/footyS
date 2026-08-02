// Thin wrapper around football-data.org's v4 API, with a simple in-memory
// cache. The free tier allows exactly 10 requests/minute — this app can
// need up to 15 on a cold cache (3 calls × 5 leagues), so every actual
// network call is throttled through a queue with a minimum gap between
// requests, rather than firing them all at once and hitting a 429.

const BASE_URL = "https://api.football-data.org/v4";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Half-life for exponential form weighting (days). A match halfLife days ago
// contributes half as much as a match today. ~70 days keeps recent form
// important without discarding the rest of the season.
const FORM_HALF_LIFE_DAYS = 70;

const cache = new Map();

// 7 seconds between requests = ~8.5/minute, comfortably under the 10/minute
// free-tier cap with margin for other traffic (e.g. a second person loading
// the app at the same time).
const MIN_REQUEST_INTERVAL_MS = 7000;
let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function throttled(fn) {
  const result = requestQueue.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Keep the queue alive even if this particular call fails, so one error
  // doesn't jam up every request behind it.
  requestQueue = result.catch(() => {});
  return result;
}

async function rawFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_API_KEY },
  });
  if (res.status === 429) {
    // Belt-and-braces: the throttle above should prevent this, but if it
    // still happens (e.g. another process sharing the same account), wait
    // the time the API tells us to and retry once rather than failing outright.
    const body = await res.json().catch(() => ({}));
    const waitSeconds = Number(String(body.message || "").match(/(\d+)\s*second/)?.[1]) || 15;
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    return rawFetch(path);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`football-data.org request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function cachedFetch(path) {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

  const data = await throttled(() => rawFetch(path));
  cache.set(path, { data, at: Date.now() });
  return data;
}

async function upcomingMatches(competitionCode, limit = 10) {
  const data = await cachedFetch(`/competitions/${competitionCode}/matches?status=SCHEDULED`);
  return (data.matches || []).slice(0, limit);
}

// `seasonStartYear`, if given, pulls a specific season (e.g. 2025 for the
// 2025/26 season) instead of whatever football-data.org considers
// "current" — used to bridge back to last season's real results at the
// very start of a new one, before it has any finished matches of its own.
async function finishedMatches(competitionCode, seasonStartYear) {
  const seasonParam = seasonStartYear ? `&season=${seasonStartYear}` : "";
  const data = await cachedFetch(`/competitions/${competitionCode}/matches?status=FINISHED${seasonParam}`);
  return data.matches || [];
}

// football-data.org marks a new season "current" up to 30 days before it
// actually starts — so right at the start of a season, `finishedMatches()`
// can legitimately return nothing yet, not because of a bug, just because
// no one's played a match. This reads the real season start date straight
// off an upcoming fixture (rather than guessing from today's date) to work
// out what "last season" actually was, so it can be used as a bridge.
function previousSeasonStartYear(fixtures) {
  const startDate = fixtures?.[0]?.season?.startDate;
  if (!startDate) return null;
  const year = new Date(startDate).getUTCFullYear();
  return Number.isFinite(year) ? year - 1 : null;
}

// The competition-wide list endpoint (finishedMatches above) does NOT
// include per-match statistics (corners, throw-ins, etc.) — only the
// single-match detail endpoint does. This fetches one match's full detail,
// going through the same cache + throttle as everything else.
async function matchDetail(matchId) {
  return cachedFetch(`/matches/${matchId}`);
}

// Pure selection logic: which match IDs need detail-fetching, given a list
// of teams and how many of each team's most-recent matches to cover.
// Separated from the actual fetching below so this can be tested without
// any network access.
function matchIdsNeedingEnrichment(finished, teamNames, perTeamLimit = 5) {
  const teamSet = new Set(teamNames);
  const neededIds = new Set();

  teamSet.forEach((team) => {
    const teamMatches = finished
      .filter((m) => m.homeTeam.name === team || m.awayTeam.name === team)
      .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate))
      .slice(0, perTeamLimit);
    teamMatches.forEach((m) => neededIds.add(m.id));
  });

  return Array.from(neededIds);
}

// Enriches a subset of `finished` matches with statistics, bounded and
// deduped so this doesn't turn into "fetch detail for every match all
// season." For each team in `teamNames`, only their most recent
// `perTeamLimit` matches get detail-fetched — and since two teams facing
// each other share a match, the actual number of unique fetches needed is
// usually well below teamNames.length × perTeamLimit. Returns the same
// array with statistics merged onto whichever matches were selected;
// matches that weren't selected are returned unchanged (so
// computeStatAverages simply skips them, same as any match missing stats).
async function enrichWithStatistics(finished, teamNames, perTeamLimit = 5) {
  const byId = new Map(finished.map((m) => [m.id, m]));
  const neededIds = matchIdsNeedingEnrichment(finished, teamNames, perTeamLimit);

  let succeeded = 0, hadStatistics = 0, failed = 0;

  await Promise.all(neededIds.map(async (id) => {
    try {
      const detail = await matchDetail(id);
      const original = byId.get(id);
      if (original && detail) {
        original.homeTeam = { ...original.homeTeam, statistics: detail.homeTeam?.statistics };
        original.awayTeam = { ...original.awayTeam, statistics: detail.awayTeam?.statistics };
        succeeded += 1;
        if (detail.homeTeam?.statistics || detail.awayTeam?.statistics) hadStatistics += 1;
      }
    } catch (err) {
      failed += 1;
      console.error(`enrichWithStatistics: failed to fetch match ${id}:`, err.message);
    }
  }));

  console.log(`enrichWithStatistics: ${neededIds.length} matches needed, ${succeeded} fetched OK, ${hadStatistics} actually had statistics data, ${failed} failed`);
  return finished;
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

// A generic version of computeStats' math for any per-match stat, not just
// goals — used for corners (and easy to extend to throw-ins, fouls, shots,
// etc. later). `extractStat(match)` should return { home, away } numbers
// for that stat, or null if the match doesn't have it (e.g. the Statistics
// Add-On wasn't active yet when it was played, or the match hasn't finished).
// Gets the exact same recency-weighting and small-sample shrinkage as goals
// — this is the same statistical rigor, not a simplified shortcut for a
// "lesser" stat.
function computeStatAverages(matches, extractStat, options = {}) {
  const nowMs = options.now ?? Date.now();
  const halfLifeDays = options.halfLifeDays ?? FORM_HALF_LIFE_DAYS;
  const shrinkK = options.shrinkK ?? 4;

  const teamHomeFor = {}, teamHomeAgainst = {}, teamHomeW = {}, teamHomeGames = {};
  const teamAwayFor = {}, teamAwayAgainst = {}, teamAwayW = {}, teamAwayGames = {};
  let wHomeTotal = 0, wAwayTotal = 0, wGames = 0;

  matches.forEach((m) => {
    const stat = extractStat(m);
    if (!stat || stat.home == null || stat.away == null) return;
    const home = m.homeTeam.name, away = m.awayTeam.name;
    const w = formWeight(m.utcDate, nowMs, halfLifeDays);

    teamHomeFor[home] = (teamHomeFor[home] || 0) + stat.home * w;
    teamHomeAgainst[home] = (teamHomeAgainst[home] || 0) + stat.away * w;
    teamHomeW[home] = (teamHomeW[home] || 0) + w;
    teamHomeGames[home] = (teamHomeGames[home] || 0) + 1;

    teamAwayFor[away] = (teamAwayFor[away] || 0) + stat.away * w;
    teamAwayAgainst[away] = (teamAwayAgainst[away] || 0) + stat.home * w;
    teamAwayW[away] = (teamAwayW[away] || 0) + w;
    teamAwayGames[away] = (teamAwayGames[away] || 0) + 1;

    wHomeTotal += stat.home * w;
    wAwayTotal += stat.away * w;
    wGames += w;
  });

  // If nothing had this stat available (e.g. no matches with the add-on
  // active yet), return null rather than a misleading all-zero result.
  if (wGames === 0) return null;

  const leagueAvgHome = wHomeTotal / wGames;
  const leagueAvgAway = wAwayTotal / wGames;
  const weightedAvg = (sumObj, weightObj, team, fallback) => (weightObj[team] > 0 ? sumObj[team] / weightObj[team] : fallback);

  return {
    leagueAvgHome, leagueAvgAway,
    teamStats: (teamName) => {
      const homeGames = teamHomeGames[teamName] || 0;
      const awayGames = teamAwayGames[teamName] || 0;
      return {
        homeAvgFor: shrinkToMean(weightedAvg(teamHomeFor, teamHomeW, teamName, leagueAvgHome), leagueAvgHome, homeGames, shrinkK),
        homeAvgAgainst: shrinkToMean(weightedAvg(teamHomeAgainst, teamHomeW, teamName, leagueAvgAway), leagueAvgAway, homeGames, shrinkK),
        awayAvgFor: shrinkToMean(weightedAvg(teamAwayFor, teamAwayW, teamName, leagueAvgAway), leagueAvgAway, awayGames, shrinkK),
        awayAvgAgainst: shrinkToMean(weightedAvg(teamAwayAgainst, teamAwayW, teamName, leagueAvgHome), leagueAvgHome, awayGames, shrinkK),
        homeGames, awayGames,
      };
    },
  };
}

// Extracts corner counts from a match, using football-data.org's own
// Statistics Add-On field (statistics.corner_kicks) — returns null if this
// match doesn't have it (add-on wasn't active, or match hasn't finished).
function extractCorners(match) {
  const home = match.homeTeam?.statistics?.corner_kicks;
  const away = match.awayTeam?.statistics?.corner_kicks;
  if (home == null || away == null) return null;
  return { home, away };
}

// Same idea as extractCorners, for throw-ins (statistics.throw_ins).
function extractThrowIns(match) {
  const home = match.homeTeam?.statistics?.throw_ins;
  const away = match.awayTeam?.statistics?.throw_ins;
  if (home == null || away == null) return null;
  return { home, away };
}

// The rest of the Statistics Add-On fields — same pattern, following
// football-data.org's snake_case naming convention (confirmed correct for
// corner_kicks and throw_ins already). If any of these field names turn
// out to be different once tested against a real account, that one stat
// simply won't populate — same graceful degradation as everything else.
function extractFouls(match) {
  const home = match.homeTeam?.statistics?.fouls;
  const away = match.awayTeam?.statistics?.fouls;
  if (home == null || away == null) return null;
  return { home, away };
}

function extractShots(match) {
  const home = match.homeTeam?.statistics?.shots;
  const away = match.awayTeam?.statistics?.shots;
  if (home == null || away == null) return null;
  return { home, away };
}

function extractOffsides(match) {
  const home = match.homeTeam?.statistics?.offsides;
  const away = match.awayTeam?.statistics?.offsides;
  if (home == null || away == null) return null;
  return { home, away };
}

function extractGoalKicks(match) {
  const home = match.homeTeam?.statistics?.goal_kicks;
  const away = match.awayTeam?.statistics?.goal_kicks;
  if (home == null || away == null) return null;
  return { home, away };
}

function extractSaves(match) {
  const home = match.homeTeam?.statistics?.saves;
  const away = match.awayTeam?.statistics?.saves;
  if (home == null || away == null) return null;
  return { home, away };
}

// Cards: football-data.org's sample data didn't show a combined "cards"
// field explicitly — this assumes yellow_cards + red_cards as separate
// fields, summed into one total. If the real field name differs, this
// just won't populate, same as any other stat.
function extractCards(match) {
  const homeYellow = match.homeTeam?.statistics?.yellow_cards;
  const homeRed = match.homeTeam?.statistics?.red_cards;
  const awayYellow = match.awayTeam?.statistics?.yellow_cards;
  const awayRed = match.awayTeam?.statistics?.red_cards;
  if (homeYellow == null || awayYellow == null) return null;
  return { home: homeYellow + (homeRed || 0), away: awayYellow + (awayRed || 0) };
}

// Possession isn't an over/under market (it's a percentage split that
// always sums to 100), so this returns straight weighted-average
// percentages rather than going through predictStatOverUnder.
function extractPossession(match) {
  const home = match.homeTeam?.statistics?.ball_possession;
  const away = match.awayTeam?.statistics?.ball_possession;
  if (home == null || away == null) return null;
  return { home, away };
}

module.exports = {
  upcomingMatches, finishedMatches, computeStats, standings, formWeight, shrinkToMean, FORM_HALF_LIFE_DAYS,
  computeStatAverages, extractCorners, extractThrowIns, extractFouls, extractShots, extractOffsides,
  extractGoalKicks, extractSaves, extractCards, extractPossession,
  matchDetail, enrichWithStatistics, matchIdsNeedingEnrichment, previousSeasonStartYear,
};
