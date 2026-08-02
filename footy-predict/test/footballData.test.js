const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { computeStats, formWeight, shrinkToMean } = require("../src/footballData");

function fakeMatch(homeTeam, awayTeam, homeGoals, awayGoals, utcDate) {
  return {
    homeTeam: { name: homeTeam },
    awayTeam: { name: awayTeam },
    score: { fullTime: { home: homeGoals, away: awayGoals } },
    utcDate: utcDate || undefined,
  };
}

describe("computeStats", () => {
  test("computes correct league averages across all matches", () => {
    const matches = [
      fakeMatch("A", "B", 2, 1),
      fakeMatch("B", "A", 0, 3),
      fakeMatch("A", "C", 1, 1),
    ];
    const stats = computeStats(matches);
    assert.equal(stats.leagueAvgHomeGoals, 1);
    assert.ok(Math.abs(stats.leagueAvgAwayGoals - 5 / 3) < 0.001);
  });

  test("computes correct per-team home/away scoring splits (equal weights without dates)", () => {
    const matches = [
      fakeMatch("A", "B", 3, 0),
      fakeMatch("C", "A", 1, 2),
    ];
    // With shrinkK=0 for this assertion path — pass shrinkK 0 via options
    const stats = computeStats(matches, { shrinkK: 0 });
    const aStats = stats.teamStats("A");
    assert.equal(aStats.homeAvgGoalsFor, 3);
    assert.equal(aStats.homeAvgGoalsAgainst, 0);
    assert.equal(aStats.awayAvgGoalsFor, 2);
    assert.equal(aStats.awayAvgGoalsAgainst, 1);
  });

  test("a team with no home games yet falls back to the league average, not zero", () => {
    const matches = [fakeMatch("X", "Y", 1, 1)];
    const stats = computeStats(matches);
    const yStats = stats.teamStats("Y");
    assert.equal(yStats.homeAvgGoalsFor, stats.leagueAvgHomeGoals);
  });

  test("ignores matches with no final score yet", () => {
    const matches = [
      fakeMatch("A", "B", 2, 1),
      { homeTeam: { name: "A" }, awayTeam: { name: "B" }, score: { fullTime: { home: null, away: null } } },
    ];
    const stats = computeStats(matches, { shrinkK: 0 });
    assert.equal(stats.leagueAvgHomeGoals, 2);
  });

  test("recent matches weigh more than old ones when dates are present", () => {
    const now = Date.parse("2026-03-01T12:00:00Z");
    // Team A scored 5 at home recently, 0 at home long ago — weighted avg should be closer to 5 than 2.5
    const matches = [
      fakeMatch("A", "B", 0, 0, "2025-09-01T12:00:00Z"), // ~6 months ago
      fakeMatch("A", "C", 5, 0, "2026-02-20T12:00:00Z"), // ~9 days ago
    ];
    const stats = computeStats(matches, { nowMs: now, shrinkK: 0, halfLifeDays: 70 });
    const a = stats.teamStats("A");
    assert.ok(a.homeAvgGoalsFor > 3.5, `expected recent form pull, got ${a.homeAvgGoalsFor}`);
    assert.ok(a.homeAvgGoalsFor < 5, `should still blend a little old form, got ${a.homeAvgGoalsFor}`);
  });
});

describe("formWeight", () => {
  test("a match from today has weight ~1", () => {
    const now = Date.parse("2026-01-15T00:00:00Z");
    assert.ok(Math.abs(formWeight("2026-01-15T00:00:00Z", now, 70) - 1) < 0.01);
  });

  test("a match one half-life ago has weight ~0.5", () => {
    const now = Date.parse("2026-01-15T00:00:00Z");
    const past = "2025-11-06T00:00:00Z"; // ~70 days earlier
    const w = formWeight(past, now, 70);
    assert.ok(Math.abs(w - 0.5) < 0.05, `got ${w}`);
  });
});

describe("shrinkToMean", () => {
  test("zero games returns the league mean", () => {
    assert.equal(shrinkToMean(3, 1.5, 0, 4), 1.5);
  });

  test("many games stays close to the observed rate", () => {
    const v = shrinkToMean(3, 1.5, 20, 4);
    assert.ok(Math.abs(v - 3) < 0.3, `got ${v}`);
  });

  test("few games pulls toward the league mean", () => {
    const v = shrinkToMean(3, 1.5, 2, 4);
    // (3*2 + 1.5*4) / 6 = 12/6 = 2
    assert.equal(v, 2);
  });
});

describe("computeStatAverages", () => {
  const { computeStatAverages, extractCorners } = require("../src/footballData");

  function fakeMatchWithCorners(homeTeam, awayTeam, homeCorners, awayCorners, utcDate = "2026-01-01T15:00:00Z") {
    return {
      homeTeam: { name: homeTeam, statistics: { corner_kicks: homeCorners } },
      awayTeam: { name: awayTeam, statistics: { corner_kicks: awayCorners } },
      utcDate,
    };
  }

  test("returns null when no matches have the stat available at all", () => {
    const matches = [{ homeTeam: { name: "A" }, awayTeam: { name: "B" }, utcDate: "2026-01-01T15:00:00Z" }];
    const result = computeStatAverages(matches, extractCorners);
    assert.equal(result, null);
  });

  test("computes league and per-team averages from matches that do have the stat", () => {
    const matches = [
      fakeMatchWithCorners("A", "B", 6, 4),
      fakeMatchWithCorners("C", "A", 5, 7), // A away: for=7, against=5
    ];
    const result = computeStatAverages(matches, extractCorners, { now: new Date("2026-06-01") });
    assert.ok(result);
    const aStats = result.teamStats("A");
    assert.ok(aStats.homeAvgFor > 0);
    assert.ok(aStats.awayAvgFor > 0);
  });

  test("skips matches missing the stat, uses the ones that have it", () => {
    const matches = [
      fakeMatchWithCorners("A", "B", 6, 4),
      { homeTeam: { name: "A" }, awayTeam: { name: "C" }, utcDate: "2026-01-02T15:00:00Z" }, // no statistics field
    ];
    const result = computeStatAverages(matches, extractCorners, { now: new Date("2026-06-01") });
    assert.ok(result); // still works, just from the one match that has data
  });

  test("extractCorners returns null for a match without the Statistics Add-On data", () => {
    const match = { homeTeam: { name: "A" }, awayTeam: { name: "B" } };
    assert.equal(extractCorners(match), null);
  });

  test("extractCorners returns the real numbers when present", () => {
    const match = fakeMatchWithCorners("A", "B", 6, 4);
    assert.deepEqual(extractCorners(match), { home: 6, away: 4 });
  });
});

describe("extractThrowIns", () => {
  const { extractThrowIns, computeStatAverages } = require("../src/footballData");

  function fakeMatchWithThrowIns(homeTeam, awayTeam, homeThrowIns, awayThrowIns, utcDate = "2026-01-01T15:00:00Z") {
    return {
      homeTeam: { name: homeTeam, statistics: { throw_ins: homeThrowIns } },
      awayTeam: { name: awayTeam, statistics: { throw_ins: awayThrowIns } },
      utcDate,
    };
  }

  test("returns null for a match without throw-in data", () => {
    assert.equal(extractThrowIns({ homeTeam: { name: "A" }, awayTeam: { name: "B" } }), null);
  });

  test("returns real numbers when present", () => {
    const match = fakeMatchWithThrowIns("A", "B", 12, 14);
    assert.deepEqual(extractThrowIns(match), { home: 12, away: 14 });
  });

  test("works through computeStatAverages the same way corners do", () => {
    const matches = [fakeMatchWithThrowIns("A", "B", 12, 14), fakeMatchWithThrowIns("C", "A", 10, 15)];
    const result = computeStatAverages(matches, extractThrowIns, { now: new Date("2026-06-01") });
    assert.ok(result);
    assert.ok(result.teamStats("A").homeAvgFor > 0);
  });
});

describe("matchIdsNeedingEnrichment", () => {
  const { matchIdsNeedingEnrichment } = require("../src/footballData");

  function fakeMatch(id, homeTeam, awayTeam, utcDate) {
    return { id, homeTeam: { name: homeTeam }, awayTeam: { name: awayTeam }, utcDate };
  }

  test("selects only the given teams' matches, ignoring unrelated ones", () => {
    const finished = [
      fakeMatch(1, "A", "B", "2026-01-01"),
      fakeMatch(2, "C", "D", "2026-01-02"), // neither team is in our list
    ];
    const ids = matchIdsNeedingEnrichment(finished, ["A"], 5);
    assert.deepEqual(ids, [1]);
  });

  test("respects the per-team limit, taking most recent matches first", () => {
    const finished = [
      fakeMatch(1, "A", "X", "2026-01-01"),
      fakeMatch(2, "A", "Y", "2026-02-01"),
      fakeMatch(3, "A", "Z", "2026-03-01"),
    ];
    const ids = matchIdsNeedingEnrichment(finished, ["A"], 2);
    assert.equal(ids.length, 2);
    assert.ok(ids.includes(3)); // most recent
    assert.ok(ids.includes(2)); // second most recent
    assert.ok(!ids.includes(1)); // oldest, beyond the limit of 2
  });

  test("dedupes a match shared between two teams that are both in our list", () => {
    const finished = [fakeMatch(1, "A", "B", "2026-01-01")];
    const ids = matchIdsNeedingEnrichment(finished, ["A", "B"], 5);
    assert.deepEqual(ids, [1]); // not fetched twice just because both teams need it
  });

  test("returns an empty list when none of the given teams have any finished matches", () => {
    const finished = [fakeMatch(1, "X", "Y", "2026-01-01")];
    const ids = matchIdsNeedingEnrichment(finished, ["A", "B"], 5);
    assert.deepEqual(ids, []);
  });
});

describe("previousSeasonStartYear", () => {
  const { previousSeasonStartYear } = require("../src/footballData");

  test("returns the year before the current season's start date", () => {
    const fixtures = [{ season: { startDate: "2026-08-15" } }];
    assert.equal(previousSeasonStartYear(fixtures), 2025);
  });

  test("returns null when there are no fixtures at all", () => {
    assert.equal(previousSeasonStartYear([]), null);
  });

  test("returns null when a fixture exists but has no season data", () => {
    assert.equal(previousSeasonStartYear([{}]), null);
  });
});

describe("the remaining Statistics Add-On extractors", () => {
  const { extractFouls, extractShots, extractOffsides, extractGoalKicks, extractSaves, extractCards, extractPossession } = require("../src/footballData");

  function matchWithStats(homeStats, awayStats) {
    return { homeTeam: { name: "A", statistics: homeStats }, awayTeam: { name: "B", statistics: awayStats } };
  }

  test("extractFouls returns real numbers when present, null otherwise", () => {
    assert.deepEqual(extractFouls(matchWithStats({ fouls: 12 }, { fouls: 10 })), { home: 12, away: 10 });
    assert.equal(extractFouls(matchWithStats({}, {})), null);
  });

  test("extractShots returns real numbers when present, null otherwise", () => {
    assert.deepEqual(extractShots(matchWithStats({ shots: 14 }, { shots: 9 })), { home: 14, away: 9 });
    assert.equal(extractShots(matchWithStats({}, {})), null);
  });

  test("extractOffsides returns real numbers when present, null otherwise", () => {
    assert.deepEqual(extractOffsides(matchWithStats({ offsides: 3 }, { offsides: 1 })), { home: 3, away: 1 });
    assert.equal(extractOffsides(matchWithStats({}, {})), null);
  });

  test("extractGoalKicks returns real numbers when present, null otherwise", () => {
    assert.deepEqual(extractGoalKicks(matchWithStats({ goal_kicks: 8 }, { goal_kicks: 6 })), { home: 8, away: 6 });
    assert.equal(extractGoalKicks(matchWithStats({}, {})), null);
  });

  test("extractSaves returns real numbers when present, null otherwise", () => {
    assert.deepEqual(extractSaves(matchWithStats({ saves: 4 }, { saves: 2 })), { home: 4, away: 2 });
    assert.equal(extractSaves(matchWithStats({}, {})), null);
  });

  test("extractCards sums yellow and red cards together", () => {
    const result = extractCards(matchWithStats({ yellow_cards: 2, red_cards: 1 }, { yellow_cards: 3, red_cards: 0 }));
    assert.deepEqual(result, { home: 3, away: 3 });
  });

  test("extractCards treats a missing red_cards field as zero, not a failure", () => {
    const result = extractCards(matchWithStats({ yellow_cards: 2 }, { yellow_cards: 1 }));
    assert.deepEqual(result, { home: 2, away: 1 });
  });

  test("extractCards returns null when yellow_cards itself is missing", () => {
    assert.equal(extractCards(matchWithStats({}, {})), null);
  });

  test("extractPossession returns real percentages when present, null otherwise", () => {
    assert.deepEqual(extractPossession(matchWithStats({ ball_possession: 55 }, { ball_possession: 45 })), { home: 55, away: 45 });
    assert.equal(extractPossession(matchWithStats({}, {})), null);
  });
});
