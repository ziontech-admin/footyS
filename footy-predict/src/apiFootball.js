// Corner statistics come from API-Football (api-sports.io), a separate paid
// provider from football-data.org — corners aren't available on any free
// tier we could find, so this is a distinct integration with its own API key.
//
// Important cost note: unlike goals (which come bundled in each match's own
// data), corners require fetching each team's recent fixtures AND then each
// fixture's statistics separately — that's many more API calls per team than
// the goals side of this app uses. Caching here is aggressive (24 hours) to
// keep this affordable; don't reduce the cache time without checking your
// plan's request quota first.

const BASE_URL = "https://v3.football.api-sports.io";
const CORNER_STATS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const teamIdCache = new Map(); // team name -> API-Football team id (doesn't change, cached forever)
const cornerStatsCache = new Map();

// Strips common club-name suffixes so "Manchester United FC" (one provider's
// naming) matches "Manchester United" (another provider's naming).
function normalizeName(name) {
  return String(name).toLowerCase().replace(/\b(fc|cf|afc|cfc|ac|sc|sad|cd)\b/g, "").replace(/[^a-z0-9]/g, "").trim();
}

async function apiFootballFetch(path) {
  const res = await fetch(`${BASE_URL}${path}`, { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
  if (!res.ok) throw new Error(`API-Football request failed (${res.status})`);
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length) throw new Error(`API-Football error: ${JSON.stringify(data.errors)}`);
  return data;
}

async function findTeamId(teamName) {
  const key = normalizeName(teamName);
  if (teamIdCache.has(key)) return teamIdCache.get(key);

  const data = await apiFootballFetch(`/teams?search=${encodeURIComponent(teamName)}`);
  const results = data.response || [];
  const match = results.find((r) => normalizeName(r.team.name) === key) || results[0];
  if (!match) return null;

  teamIdCache.set(key, match.team.id);
  return match.team.id;
}

function cornersFromStatBlock(statBlock) {
  const entry = statBlock?.statistics?.find((s) => s.type === "Corner Kicks");
  return typeof entry?.value === "number" ? entry.value : 0;
}

// A team's average corners for/against, restricted to their home (or away)
// matches only, from their last 10 finished fixtures. Returns null if the
// team can't be matched or has no recent finished fixtures on record — the
// caller should treat that as "corner data unavailable for this match"
// rather than an error.
async function teamCornerStats(teamName, isHome) {
  const cacheKey = `${normalizeName(teamName)}:${isHome ? "home" : "away"}`;
  const cached = cornerStatsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CORNER_STATS_CACHE_TTL_MS) return cached.data;

  let result = null;
  try {
    const teamId = await findTeamId(teamName);
    if (teamId) {
      const fixturesData = await apiFootballFetch(`/fixtures?team=${teamId}&last=10&status=FT`);
      const fixtures = (fixturesData.response || []).filter((f) =>
        isHome ? f.teams.home.id === teamId : f.teams.away.id === teamId
      );

      let cornersFor = 0, cornersAgainst = 0, count = 0;
      for (const f of fixtures) {
        try {
          const statsData = await apiFootballFetch(`/fixtures/statistics?fixture=${f.fixture.id}`);
          const teamBlock = (statsData.response || []).find((s) => s.team.id === teamId);
          const oppBlock = (statsData.response || []).find((s) => s.team.id !== teamId);
          cornersFor += cornersFromStatBlock(teamBlock);
          cornersAgainst += cornersFromStatBlock(oppBlock);
          count += 1;
        } catch {
          // One fixture's stats being unavailable shouldn't sink the whole average.
        }
      }

      if (count > 0) result = { avgCornersFor: cornersFor / count, avgCornersAgainst: cornersAgainst / count, sampleSize: count };
    }
  } catch {
    result = null; // team search or fixtures lookup failed — corners just won't show for this match
  }

  cornerStatsCache.set(cacheKey, { data: result, at: Date.now() });
  return result;
}

module.exports = { findTeamId, teamCornerStats, normalizeName };
