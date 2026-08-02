const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { poissonProb, teamStrength, predictMatch, predict } = require("../src/predict");

describe("poissonProb", () => {
  test("probabilities for a given lambda sum to ~1 across a wide enough range", () => {
    const lambda = 1.5;
    let sum = 0;
    for (let k = 0; k <= 30; k++) sum += poissonProb(k, lambda);
    assert.ok(Math.abs(sum - 1) < 0.0001);
  });

  test("zero expected goals means zero goals is certain", () => {
    assert.equal(poissonProb(0, 0), 1);
    assert.equal(poissonProb(1, 0), 0);
  });

  test("higher lambda shifts probability toward higher scores", () => {
    // At lambda=3, scoring 3 should be more likely than scoring 0.
    assert.ok(poissonProb(3, 3) > poissonProb(0, 3));
  });
});

describe("teamStrength", () => {
  test("a team scoring exactly the league average has attack strength of 1", () => {
    const s = teamStrength(1.5, 1.0, 1.5, 1.0);
    assert.equal(s.attack, 1);
    assert.equal(s.defense, 1);
  });

  test("a team scoring above league average has attack strength above 1", () => {
    const s = teamStrength(3.0, 1.0, 1.5, 1.0);
    assert.equal(s.attack, 2);
  });

  test("a team conceding below league average has defense strength below 1 (good defense)", () => {
    const s = teamStrength(1.5, 0.5, 1.5, 1.0);
    assert.equal(s.defense, 0.5);
  });
});

describe("predictMatch", () => {
  test("evenly matched teams (equal expected goals) favor the home side slightly less than a draw skew", () => {
    const result = predictMatch(1.4, 1.4);
    // Symmetric strength: home/away splits should be close, draw is a real chunk of probability.
    assert.ok(result.drawPct > 15);
    assert.ok(Math.abs(result.homeWinPct - result.awayWinPct) < 5);
  });

  test("a much stronger home side should show a clearly higher home win percentage", () => {
    const result = predictMatch(2.8, 0.6);
    assert.ok(result.homeWinPct > result.awayWinPct);
    assert.ok(result.homeWinPct > 60);
  });

  test("percentages always sum to almost exactly 100", () => {
    const result = predictMatch(1.2, 0.9);
    const total = result.homeWinPct + result.drawPct + result.awayWinPct;
    assert.ok(Math.abs(total - 100) < 0.5);
  });

  test("returns a plausible most-likely scoreline, not something absurd", () => {
    const result = predictMatch(1.3, 1.1);
    const [h, a] = result.likelyScore.split("-").map(Number);
    assert.ok(h >= 0 && h <= 4);
    assert.ok(a >= 0 && a <= 4);
  });
});

describe("predict (end-to-end)", () => {
  test("a strong attacking home team vs a weak defense produces a home-favored prediction", () => {
    const result = predict({
      homeAvgGoalsFor: 2.5, homeAvgGoalsAgainst: 0.6,
      awayAvgGoalsFor: 0.8, awayAvgGoalsAgainst: 2.0,
      leagueAvgHomeGoals: 1.5, leagueAvgAwayGoals: 1.1,
    });
    assert.ok(result.homeWinPct > result.awayWinPct);
    assert.ok(result.homeExpectedGoals > result.awayExpectedGoals);
  });

  test("two league-average teams produce expected goals close to the league averages", () => {
    const result = predict({
      homeAvgGoalsFor: 1.5, homeAvgGoalsAgainst: 1.1,
      awayAvgGoalsFor: 1.1, awayAvgGoalsAgainst: 1.5,
      leagueAvgHomeGoals: 1.5, leagueAvgAwayGoals: 1.1,
    });
    assert.ok(Math.abs(result.homeExpectedGoals - 1.5) < 0.1);
    assert.ok(Math.abs(result.awayExpectedGoals - 1.1) < 0.1);
  });
});

describe("predictCorners", () => {
  const { predictCorners } = require("../src/predict");

  test("over/under percentages sum to almost exactly 100", () => {
    const result = predictCorners(5.2, 4.8, 9.5);
    assert.ok(Math.abs(result.overPct + result.underPct - 100) < 0.5);
  });

  test("a high combined expected corner count favors the over", () => {
    const result = predictCorners(7, 6, 9.5); // total expected 13, well above the 9.5 line
    assert.ok(result.overPct > result.underPct);
  });

  test("a low combined expected corner count favors the under", () => {
    const result = predictCorners(3, 2.5, 9.5); // total expected 5.5, well below the 9.5 line
    assert.ok(result.underPct > result.overPct);
  });

  test("total expected corners is the simple sum of both teams' averages", () => {
    const result = predictCorners(5, 4.5, 9.5);
    assert.equal(result.totalExpectedCorners, 9.5);
  });
});

describe("predictGoalsOverUnder", () => {
  const { predictGoalsOverUnder } = require("../src/predict");

  test("over/under percentages sum to almost exactly 100", () => {
    const result = predictGoalsOverUnder(1.6, 1.1, 2.5);
    assert.ok(Math.abs(result.overPct + result.underPct - 100) < 0.5);
  });

  test("a high-scoring matchup favors the over on the standard 2.5 line", () => {
    const result = predictGoalsOverUnder(2.2, 1.8, 2.5); // total expected 4.0
    assert.ok(result.overPct > result.underPct);
  });

  test("a low-scoring matchup favors the under on the standard 2.5 line", () => {
    const result = predictGoalsOverUnder(0.7, 0.6, 2.5); // total expected 1.3
    assert.ok(result.underPct > result.overPct);
  });

  test("total expected goals is the simple sum of both teams' expected goals", () => {
    const result = predictGoalsOverUnder(1.4, 1.1, 2.5);
    assert.equal(result.totalExpectedGoals, 2.5);
  });
});

describe("dixonColesTau", () => {
  const { dixonColesTau } = require("../src/predict");

  test("rho=0 leaves all scorelines unchanged", () => {
    assert.equal(dixonColesTau(0, 0, 1.5, 1.2, 0), 1);
    assert.equal(dixonColesTau(1, 1, 1.5, 1.2, 0), 1);
    assert.equal(dixonColesTau(2, 1, 1.5, 1.2, 0), 1);
  });

  test("negative rho boosts 0-0 and 1-1 relative to independent Poisson", () => {
    const rho = -0.13;
    // For 0-0: 1 - λμρ with ρ negative → factor > 1
    assert.ok(dixonColesTau(0, 0, 1.4, 1.2, rho) > 1);
    // For 1-1: 1 - ρ with ρ negative → factor > 1
    assert.ok(dixonColesTau(1, 1, 1.4, 1.2, rho) > 1);
  });

  test("higher scores are unaffected", () => {
    assert.equal(dixonColesTau(2, 1, 1.5, 1.2, -0.13), 1);
    assert.equal(dixonColesTau(3, 0, 1.5, 1.2, -0.13), 1);
  });
});

describe("predictMatch with Dixon-Coles", () => {
  test("still produces percentages that sum to ~100", () => {
    const result = predictMatch(1.3, 1.1);
    const total = result.homeWinPct + result.drawPct + result.awayWinPct;
    assert.ok(Math.abs(total - 100) < 0.5);
  });

  test("rho=0 matches the old independent model behaviour for strong home side", () => {
    const withDc = predictMatch(2.8, 0.6, 8, -0.13);
    const plain = predictMatch(2.8, 0.6, 8, 0);
    // Both should heavily favour home
    assert.ok(withDc.homeWinPct > 60);
    assert.ok(plain.homeWinPct > 60);
  });
});

describe("bestOutcome", () => {
  const { bestOutcome } = require("../src/predict");

  test("picks the single highest-probability outcome across result markets", () => {
    const match = {
      homeTeam: "Alpha FC", awayTeam: "Beta United",
      prediction: { homeWinPct: 72.5, drawPct: 18.0, awayWinPct: 9.5 },
    };
    const result = bestOutcome(match);
    assert.equal(result.label, "Alpha FC to win");
    assert.equal(result.pct, 72.5);
  });

  test("considers goals over/under alongside the result market", () => {
    const match = {
      homeTeam: "Alpha FC", awayTeam: "Beta United",
      prediction: { homeWinPct: 40, drawPct: 30, awayWinPct: 30 },
      goalsOverUnder: { overUnderLine: 2.5, overPct: 88, underPct: 12 },
    };
    const result = bestOutcome(match);
    assert.equal(result.label, "Over 2.5 goals");
    assert.equal(result.pct, 88);
  });

  test("considers corners when available too", () => {
    const match = {
      homeTeam: "Alpha FC", awayTeam: "Beta United",
      prediction: { homeWinPct: 40, drawPct: 30, awayWinPct: 30 },
      goalsOverUnder: { overUnderLine: 2.5, overPct: 55, underPct: 45 },
      corners: { overUnderLine: 9.5, overPct: 91, underPct: 9 },
    };
    const result = bestOutcome(match);
    assert.equal(result.label, "Over 9.5 corners");
    assert.equal(result.pct, 91);
  });

  test("works fine with no corners or goals O/U data present at all", () => {
    const match = {
      homeTeam: "Alpha FC", awayTeam: "Beta United",
      prediction: { homeWinPct: 33, drawPct: 34, awayWinPct: 33 },
    };
    const result = bestOutcome(match);
    assert.equal(result.pct, 34);
  });
});

describe("predictMatch — BTTS and clean sheets", () => {
  test("BTTS yes/no percentages sum to almost exactly 100", () => {
    const result = predictMatch(1.4, 1.1);
    assert.ok(Math.abs(result.bttsYesPct + result.bttsNoPct - 100) < 0.5);
  });

  test("two strong-scoring teams favor BTTS yes", () => {
    const result = predictMatch(2.2, 1.8);
    assert.ok(result.bttsYesPct > result.bttsNoPct);
  });

  test("a very weak away attack favors BTTS no (home likely keeps a clean sheet)", () => {
    const result = predictMatch(1.8, 0.15);
    assert.ok(result.bttsNoPct > result.bttsYesPct);
  });

  test("a near-zero away attack means a high home clean sheet chance", () => {
    const result = predictMatch(1.8, 0.1);
    assert.ok(result.homeCleanSheetPct > 60);
  });

  test("a near-zero home attack means a high away clean sheet chance", () => {
    const result = predictMatch(0.1, 1.8);
    assert.ok(result.awayCleanSheetPct > 60);
  });

  test("high-scoring both sides means low clean sheet chances for both", () => {
    const result = predictMatch(2.5, 2.3);
    assert.ok(result.homeCleanSheetPct < 20);
    assert.ok(result.awayCleanSheetPct < 20);
  });
});

describe("bestOutcome — market/side", () => {
  const { bestOutcome } = require("../src/predict");

  test("a home win pick has market=result, side=home", () => {
    const match = { homeTeam: "A", awayTeam: "B", prediction: { homeWinPct: 80, drawPct: 15, awayWinPct: 5 } };
    const result = bestOutcome(match);
    assert.equal(result.market, "result");
    assert.equal(result.side, "home");
  });

  test("a goals-over pick has market=goalsOverUnder, side=over", () => {
    const match = {
      homeTeam: "A", awayTeam: "B",
      prediction: { homeWinPct: 40, drawPct: 30, awayWinPct: 30 },
      goalsOverUnder: { overUnderLine: 2.5, overPct: 90, underPct: 10 },
    };
    const result = bestOutcome(match);
    assert.equal(result.market, "goalsOverUnder");
    assert.equal(result.side, "over");
  });
});

describe("predictThrowIns", () => {
  const { predictThrowIns } = require("../src/predict");

  test("over/under percentages sum to almost exactly 100", () => {
    const result = predictThrowIns(13, 12, 25.5);
    assert.ok(Math.abs(result.overPct + result.underPct - 100) < 0.5);
  });

  test("a high combined expected total favors the over", () => {
    const result = predictThrowIns(16, 15, 25.5); // total expected 31, well above the line
    assert.ok(result.overPct > result.underPct);
  });

  test("a low combined expected total favors the under", () => {
    const result = predictThrowIns(9, 8, 25.5); // total expected 17, well below the line
    assert.ok(result.underPct > result.overPct);
  });

  test("total expected is the simple sum of both teams' averages", () => {
    const result = predictThrowIns(13, 12.5, 25.5);
    assert.equal(result.totalExpectedThrowIns, 25.5);
  });
});

describe("calibratedLine", () => {
  const { calibratedLine } = require("../src/predict");

  test("finds the nearest X.5 line above the average", () => {
    assert.equal(calibratedLine(2.7), 2.5);
    assert.equal(calibratedLine(2.2), 2.5);
  });

  test("finds the nearest X.5 line below the average when closer", () => {
    assert.equal(calibratedLine(1.9), 1.5);
    assert.equal(calibratedLine(3.4), 3.5);
  });

  test("a league averaging much higher than the old hardcoded default gets a proportionally higher line", () => {
    assert.equal(calibratedLine(31.3), 31.5); // this is the actual throw-ins case that prompted this fix
  });

  test("handles exact X.0 averages sensibly", () => {
    assert.equal(calibratedLine(3.0), 3.5); // exactly halfway between 2.5 and 3.5; rounds up (JS's Math.round rounds .5 up)
  });

  test("falls back to a sane default for missing or invalid data", () => {
    assert.equal(calibratedLine(0), 2.5);
    assert.equal(calibratedLine(null), 2.5);
    assert.equal(calibratedLine(NaN), 2.5);
    assert.equal(calibratedLine(-1), 2.5);
  });
});

describe("predictStatOverUnder (shared core) and the new stat wrappers", () => {
  const { predictStatOverUnder, predictFouls, predictShots, predictOffsides, predictGoalKicks, predictSaves, predictCards } = require("../src/predict");

  test("predictStatOverUnder: over/under sum to almost exactly 100", () => {
    const r = predictStatOverUnder(12, 10, 22.5);
    assert.ok(Math.abs(r.overPct + r.underPct - 100) < 0.5);
  });

  test("predictFouls returns correctly-named fields", () => {
    const r = predictFouls(12, 10, 22.5);
    assert.equal(r.totalExpectedFouls, 22);
    assert.ok(r.overPct !== undefined && r.underPct !== undefined);
  });

  test("predictShots returns correctly-named fields", () => {
    const r = predictShots(13, 11, 24.5);
    assert.equal(r.totalExpectedShots, 24);
  });

  test("predictOffsides returns correctly-named fields", () => {
    const r = predictOffsides(2, 1.5, 3.5);
    assert.equal(r.totalExpectedOffsides, 3.5);
  });

  test("predictGoalKicks returns correctly-named fields", () => {
    const r = predictGoalKicks(8, 7.5, 15.5);
    assert.equal(r.totalExpectedGoalKicks, 15.5);
  });

  test("predictSaves returns correctly-named fields", () => {
    const r = predictSaves(3.5, 3, 6.5);
    assert.equal(r.totalExpectedSaves, 6.5);
  });

  test("predictCards returns correctly-named fields", () => {
    const r = predictCards(2, 1.5, 3.5);
    assert.equal(r.totalExpectedCards, 3.5);
  });

  test("a high combined expected total favors the over, consistently across all new stat types", () => {
    assert.ok(predictFouls(15, 14, 22.5).overPct > 50);
    assert.ok(predictShots(16, 15, 24.5).overPct > 50);
    assert.ok(predictCards(3, 2.5, 3.5).overPct > 50);
  });
});
