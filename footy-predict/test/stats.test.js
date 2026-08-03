const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { recentForm, checkPredictionOutcome, aggregateAccuracy } = require("../src/stats");

function fakeMatch(homeTeam, awayTeam, homeGoals, awayGoals, utcDate) {
  return { homeTeam: { name: homeTeam }, awayTeam: { name: awayTeam }, score: { fullTime: { home: homeGoals, away: awayGoals } }, utcDate };
}

describe("recentForm", () => {
  test("returns results most recent first, as W/D/L", () => {
    const matches = [
      fakeMatch("A", "B", 2, 0, "2026-01-01"), // A won
      fakeMatch("C", "A", 1, 1, "2026-01-08"), // A drew (away)
      fakeMatch("A", "D", 0, 3, "2026-01-15"), // A lost
    ];
    const form = recentForm(matches, "A");
    assert.deepEqual(form, ["L", "D", "W"]); // most recent (Jan 15) first
  });

  test("only includes matches involving the given team", () => {
    const matches = [
      fakeMatch("A", "B", 1, 0, "2026-01-01"),
      fakeMatch("C", "D", 2, 2, "2026-01-02"), // doesn't involve A
    ];
    const form = recentForm(matches, "A");
    assert.equal(form.length, 1);
  });

  test("respects the count limit", () => {
    const matches = Array.from({ length: 10 }, (_, i) => fakeMatch("A", "B", 1, 0, `2026-01-${i + 1}`));
    const form = recentForm(matches, "A", 5);
    assert.equal(form.length, 5);
  });

  test("ignores matches with no final score", () => {
    const matches = [
      fakeMatch("A", "B", 1, 0, "2026-01-01"),
      { homeTeam: { name: "A" }, awayTeam: { name: "C" }, score: { fullTime: { home: null, away: null } }, utcDate: "2026-01-02" },
    ];
    const form = recentForm(matches, "A");
    assert.equal(form.length, 1);
  });
});

describe("checkPredictionOutcome", () => {
  test("marks a home-win prediction correct when home actually won", () => {
    const result = checkPredictionOutcome({ resultPick: "home" }, 2, 0);
    assert.equal(result.resultCorrect, true);
  });

  test("marks a home-win prediction incorrect when away actually won", () => {
    const result = checkPredictionOutcome({ resultPick: "home" }, 0, 2);
    assert.equal(result.resultCorrect, false);
  });

  test("marks a draw prediction correct when the match was actually drawn", () => {
    const result = checkPredictionOutcome({ resultPick: "draw" }, 1, 1);
    assert.equal(result.resultCorrect, true);
  });

  test("checks goals over/under independently of the result market", () => {
    const result = checkPredictionOutcome({ goalsOverUnderPick: "over", goalsOverUnderLine: 2.5 }, 2, 1);
    assert.equal(result.goalsOverUnderCorrect, true); // 3 total > 2.5
  });

  test("marks goals under correct when actual total is below the line", () => {
    const result = checkPredictionOutcome({ goalsOverUnderPick: "under", goalsOverUnderLine: 2.5 }, 1, 0);
    assert.equal(result.goalsOverUnderCorrect, true); // 1 total < 2.5
  });

  test("omits a market entirely if it wasn't in the logged prediction", () => {
    const result = checkPredictionOutcome({ resultPick: "home" }, 2, 0);
    assert.equal(result.goalsOverUnderCorrect, undefined);
  });
});

describe("aggregateAccuracy", () => {
  test("computes correct overall percentage for the result market", () => {
    const entries = [{ resultCorrect: true }, { resultCorrect: true }, { resultCorrect: false }, { resultCorrect: true }];
    const acc = aggregateAccuracy(entries);
    assert.equal(acc.resultAccuracyPct, 75);
    assert.equal(acc.resultSampleSize, 4);
  });

  test("tracks goals over/under accuracy independently from result accuracy", () => {
    const entries = [
      { resultCorrect: true, goalsOverUnderCorrect: false },
      { resultCorrect: false, goalsOverUnderCorrect: true },
    ];
    const acc = aggregateAccuracy(entries);
    assert.equal(acc.resultAccuracyPct, 50);
    assert.equal(acc.goalsOverUnderAccuracyPct, 50);
  });

  test("returns null (not zero) for a market with no resolved entries yet", () => {
    const acc = aggregateAccuracy([]);
    assert.equal(acc.resultAccuracyPct, null);
    assert.equal(acc.resultSampleSize, 0);
  });

  test("entries missing a market don't count against that market's denominator", () => {
    const entries = [{ resultCorrect: true }, { resultCorrect: true, goalsOverUnderCorrect: true }];
    const acc = aggregateAccuracy(entries);
    assert.equal(acc.resultSampleSize, 2);
    assert.equal(acc.goalsOverUnderSampleSize, 1);
  });
});

describe("accuracyByLeague", () => {
  const { accuracyByLeague } = require("../src/stats");

  test("groups accuracy correctly per league", () => {
    const entries = [
      { league: "Premier League", resultCorrect: true },
      { league: "Premier League", resultCorrect: false },
      { league: "La Liga", resultCorrect: true },
    ];
    const result = accuracyByLeague(entries);
    const pl = result.find((r) => r.league === "Premier League");
    const laliga = result.find((r) => r.league === "La Liga");
    assert.equal(pl.resultAccuracyPct, 50);
    assert.equal(laliga.resultAccuracyPct, 100);
  });

  test("sorts leagues by sample size, largest first", () => {
    const entries = [
      { league: "Small League", resultCorrect: true },
      { league: "Big League", resultCorrect: true },
      { league: "Big League", resultCorrect: false },
      { league: "Big League", resultCorrect: true },
    ];
    const result = accuracyByLeague(entries);
    assert.equal(result[0].league, "Big League");
  });

  test("entries with no league field are ignored, not crashing", () => {
    const entries = [{ resultCorrect: true }, { league: "X", resultCorrect: true }];
    const result = accuracyByLeague(entries);
    assert.equal(result.length, 1);
  });
});

describe("startOfWeekUtc", () => {
  const { startOfWeekUtc } = require("../src/stats");

  test("a Wednesday maps to the Monday of that week", () => {
    assert.equal(startOfWeekUtc("2026-03-04T15:00:00Z"), "2026-03-02"); // Wed → Mon
  });

  test("a Sunday maps to the Monday of the same week (not the next one)", () => {
    assert.equal(startOfWeekUtc("2026-03-08T09:00:00Z"), "2026-03-02"); // Sun → Mon of that week
  });

  test("a Monday maps to itself", () => {
    assert.equal(startOfWeekUtc("2026-03-02T00:00:00Z"), "2026-03-02");
  });
});

describe("accuracyByWeek", () => {
  const { accuracyByWeek } = require("../src/stats");

  test("buckets entries into the correct week and computes accuracy", () => {
    const entries = [
      { utcDate: "2026-03-04T15:00:00Z", resultCorrect: true },  // week of Mar 2
      { utcDate: "2026-03-05T15:00:00Z", resultCorrect: false }, // week of Mar 2
      { utcDate: "2026-03-11T15:00:00Z", resultCorrect: true },  // week of Mar 9
    ];
    const result = accuracyByWeek(entries);
    assert.equal(result.length, 2);
    const week1 = result.find((w) => w.weekStart === "2026-03-02");
    assert.equal(week1.resultAccuracyPct, 50);
    assert.equal(week1.sampleSize, 2);
  });

  test("sorted oldest week first", () => {
    const entries = [
      { utcDate: "2026-03-11T15:00:00Z", resultCorrect: true },
      { utcDate: "2026-02-25T15:00:00Z", resultCorrect: true },
    ];
    const result = accuracyByWeek(entries);
    assert.ok(result[0].weekStart < result[1].weekStart);
  });

  test("ignores unresolved entries (no resultCorrect field)", () => {
    const entries = [{ utcDate: "2026-03-04T15:00:00Z" }];
    const result = accuracyByWeek(entries);
    assert.equal(result.length, 0);
  });
});

describe("checkPickOutcome", () => {
  const { checkPickOutcome } = require("../src/stats");

  test("a result/home pick is correct when home actually won", () => {
    assert.equal(checkPickOutcome({ market: "result", side: "home" }, 2, 0), true);
  });

  test("a result/home pick is incorrect when away actually won", () => {
    assert.equal(checkPickOutcome({ market: "result", side: "home" }, 0, 2), false);
  });

  test("a result/draw pick is correct when the match was drawn", () => {
    assert.equal(checkPickOutcome({ market: "result", side: "draw" }, 1, 1), true);
  });

  test("a goalsOverUnder/over pick is correct when the actual total exceeds the line", () => {
    assert.equal(checkPickOutcome({ market: "goalsOverUnder", side: "over", line: 2.5 }, 2, 1), true);
  });

  test("a goalsOverUnder/under pick is correct when the actual total is below the line", () => {
    assert.equal(checkPickOutcome({ market: "goalsOverUnder", side: "under", line: 2.5 }, 1, 0), true);
  });

  test("returns null for an unsupported market like corners", () => {
    assert.equal(checkPickOutcome({ market: "corners", side: "over", line: 9.5 }, 2, 1), null);
  });
});

describe("checkPredictionOutcome — the newer markets", () => {
  test("BTTS 'yes' is correct when both teams actually scored", () => {
    const r = checkPredictionOutcome({ bttsPick: "yes" }, 2, 1);
    assert.equal(r.bttsCorrect, true);
  });

  test("BTTS 'yes' is incorrect when one team was shut out", () => {
    const r = checkPredictionOutcome({ bttsPick: "yes" }, 3, 0);
    assert.equal(r.bttsCorrect, false);
  });

  test("BTTS 'no' is correct on a clean sheet either way", () => {
    assert.equal(checkPredictionOutcome({ bttsPick: "no" }, 3, 0).bttsCorrect, true);
    assert.equal(checkPredictionOutcome({ bttsPick: "no" }, 0, 2).bttsCorrect, true);
  });

  test("home clean sheet is correct when the away side scored zero", () => {
    assert.equal(checkPredictionOutcome({ homeCleanSheetPick: "yes" }, 2, 0).homeCleanSheetCorrect, true);
    assert.equal(checkPredictionOutcome({ homeCleanSheetPick: "yes" }, 2, 1).homeCleanSheetCorrect, false);
  });

  test("away clean sheet is correct when the home side scored zero", () => {
    assert.equal(checkPredictionOutcome({ awayCleanSheetPick: "yes" }, 0, 1).awayCleanSheetCorrect, true);
    assert.equal(checkPredictionOutcome({ awayCleanSheetPick: "yes" }, 1, 1).awayCleanSheetCorrect, false);
  });

  test("corners over is correct when the real combined total beat the line", () => {
    const r = checkPredictionOutcome(
      { cornersPick: "over", cornersLine: 9.5 }, 1, 1,
      { corners: { home: 6, away: 5 } } // 11 total, above 9.5
    );
    assert.equal(r.cornersCorrect, true);
  });

  test("corners under is correct when the real total came in below the line", () => {
    const r = checkPredictionOutcome(
      { cornersPick: "under", cornersLine: 9.5 }, 1, 1,
      { corners: { home: 3, away: 4 } } // 7 total, below 9.5
    );
    assert.equal(r.cornersCorrect, true);
  });

  test("throw-ins and cards are checked the same way as corners", () => {
    const r = checkPredictionOutcome(
      { throwInsPick: "over", throwInsLine: 25.5, cardsPick: "under", cardsLine: 3.5 }, 1, 1,
      { throwIns: { home: 15, away: 14 }, cards: { home: 1, away: 1 } }
    );
    assert.equal(r.throwInsCorrect, true); // 29 > 25.5
    assert.equal(r.cardsCorrect, true);    // 2 < 3.5
  });

  test("a stat market is left unchecked (not guessed) when the real stats aren't available", () => {
    const r = checkPredictionOutcome({ cornersPick: "over", cornersLine: 9.5 }, 1, 1, undefined);
    assert.equal(r.cornersCorrect, undefined);
  });

  test("goal-derived markets still work fine even with no stats passed at all", () => {
    const r = checkPredictionOutcome({ resultPick: "home", bttsPick: "yes" }, 2, 1);
    assert.equal(r.resultCorrect, true);
    assert.equal(r.bttsCorrect, true);
  });
});

describe("aggregateAccuracy — the newer markets", () => {
  test("reports accuracy and sample size for every new market independently", () => {
    const entries = [
      { bttsCorrect: true, cornersCorrect: true, cardsCorrect: false },
      { bttsCorrect: false, cornersCorrect: true },
    ];
    const acc = aggregateAccuracy(entries);
    assert.equal(acc.bttsAccuracyPct, 50);
    assert.equal(acc.bttsSampleSize, 2);
    assert.equal(acc.cornersAccuracyPct, 100);
    assert.equal(acc.cornersSampleSize, 2);
    assert.equal(acc.cardsAccuracyPct, 0);
    assert.equal(acc.cardsSampleSize, 1); // only one entry tracked cards
  });

  test("markets with no data at all report null, not a misleading zero", () => {
    const acc = aggregateAccuracy([{ resultCorrect: true }]);
    assert.equal(acc.throwInsAccuracyPct, null);
    assert.equal(acc.throwInsSampleSize, 0);
  });
});
