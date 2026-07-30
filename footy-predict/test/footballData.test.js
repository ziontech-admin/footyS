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
