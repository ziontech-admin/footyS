// Standard Poisson expected-goals model for football outcome prediction,
// with a Dixon-Coles adjustment for low-scoring outcomes.
// This is a statistical estimate based on scoring history — informational
// only, not a guarantee of any result.

// Factorial helper for the Poisson formula (small n only — goals per match
// realistically never exceed single digits, so no need for anything fancier).
function factorial(n) {
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

// Probability of scoring exactly k goals given an expected-goals rate (lambda).
function poissonProb(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}

// Dixon-Coles tau: corrects the independence assumption for low scores.
// Plain Poisson underestimates 0-0 / 1-1 and overestimates 1-0 / 0-1 slightly.
// rho ≈ -0.13 is a widely used football default; 0 disables the adjustment.
function dixonColesTau(homeGoals, awayGoals, homeLambda, awayLambda, rho) {
  if (rho === 0) return 1;
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeLambda * awayLambda * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeLambda * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayLambda * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

// Given a team's scoring history, computes their attack/defense strength
// relative to the league average. Returns { attack, defense } as multipliers
// of the league average (1.0 = exactly average).
function teamStrength(teamAvgGoalsFor, teamAvgGoalsAgainst, leagueAvgGoalsFor, leagueAvgGoalsAgainst) {
  return {
    attack: leagueAvgGoalsFor > 0 ? teamAvgGoalsFor / leagueAvgGoalsFor : 1,
    defense: leagueAvgGoalsAgainst > 0 ? teamAvgGoalsAgainst / leagueAvgGoalsAgainst : 1,
  };
}

// Computes each team's expected goals (lambda) for an upcoming match.
function expectedGoals(homeStrength, awayStrength, leagueAvgHomeGoals, leagueAvgAwayGoals) {
  const homeExpected = homeStrength.attack * awayStrength.defense * leagueAvgHomeGoals;
  const awayExpected = awayStrength.attack * homeStrength.defense * leagueAvgAwayGoals;
  return { homeExpected, awayExpected };
}

// Builds a full scoreline probability grid, applies Dixon-Coles tau on low
// scores, then sums into win/draw/loss probabilities and most likely scoreline.
// Also computes BTTS (both teams to score) and clean sheet probabilities
// from the exact same grid — no extra computation cost, and consistent
// with the Dixon-Coles adjustment already applied to every cell.
function predictMatch(homeExpectedGoals, awayExpectedGoals, maxGoals = 8, rho = -0.13) {
  let homeWin = 0, draw = 0, awayWin = 0;
  let bttsYes = 0, homeCleanSheet = 0, awayCleanSheet = 0;
  let bestScore = { home: 0, away: 0, prob: 0 };

  for (let h = 0; h <= maxGoals; h++) {
    const pHome = poissonProb(h, homeExpectedGoals);
    for (let a = 0; a <= maxGoals; a++) {
      const pAway = poissonProb(a, awayExpectedGoals);
      const tau = dixonColesTau(h, a, homeExpectedGoals, awayExpectedGoals, rho);
      const p = pHome * pAway * tau;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h >= 1 && a >= 1) bttsYes += p;
      if (a === 0) homeCleanSheet += p; // away scored 0 → home kept a clean sheet
      if (h === 0) awayCleanSheet += p; // home scored 0 → away kept a clean sheet
      if (p > bestScore.prob) bestScore = { home: h, away: a, prob: p };
    }
  }

  const total = homeWin + draw + awayWin;
  return {
    homeWinPct: Math.round((homeWin / total) * 1000) / 10,
    drawPct: Math.round((draw / total) * 1000) / 10,
    awayWinPct: Math.round((awayWin / total) * 1000) / 10,
    likelyScore: `${bestScore.home}-${bestScore.away}`,
    homeExpectedGoals: Math.round(homeExpectedGoals * 100) / 100,
    awayExpectedGoals: Math.round(awayExpectedGoals * 100) / 100,
    bttsYesPct: Math.round((bttsYes / total) * 1000) / 10,
    bttsNoPct: Math.round((1 - bttsYes / total) * 1000) / 10,
    homeCleanSheetPct: Math.round((homeCleanSheet / total) * 1000) / 10,
    awayCleanSheetPct: Math.round((awayCleanSheet / total) * 1000) / 10,
  };
}

function predict({ homeAvgGoalsFor, homeAvgGoalsAgainst, awayAvgGoalsFor, awayAvgGoalsAgainst, leagueAvgHomeGoals, leagueAvgAwayGoals }) {
  const homeStrength = teamStrength(homeAvgGoalsFor, homeAvgGoalsAgainst, leagueAvgHomeGoals, leagueAvgAwayGoals);
  const awayStrength = teamStrength(awayAvgGoalsFor, awayAvgGoalsAgainst, leagueAvgAwayGoals, leagueAvgHomeGoals);
  const { homeExpected, awayExpected } = expectedGoals(homeStrength, awayStrength, leagueAvgHomeGoals, leagueAvgAwayGoals);
  return predictMatch(homeExpected, awayExpected);
}

// The shared math behind every over/under market (goals, corners,
// throw-ins, fouls, shots, cards, etc.) — the sum of two independent
// Poisson variables is itself Poisson with the combined rate, so this
// works for any count-based stat, not just goals.
function predictStatOverUnder(homeAvg, awayAvg, overUnderLine) {
  const totalExpected = homeAvg + awayAvg;
  let underOrEqualProb = 0;
  for (let total = 0; total <= Math.floor(overUnderLine); total++) {
    underOrEqualProb += poissonProb(total, totalExpected);
  }
  const overProb = 1 - underOrEqualProb;
  return {
    homeExpected: Math.round(homeAvg * 100) / 100,
    awayExpected: Math.round(awayAvg * 100) / 100,
    totalExpected: Math.round(totalExpected * 100) / 100,
    overUnderLine,
    overPct: Math.round(overProb * 1000) / 10,
    underPct: Math.round(underOrEqualProb * 1000) / 10,
  };
}

// Corner prediction — thin wrapper around predictStatOverUnder, keeping
// its historical field names (totalExpectedCorners etc.) so nothing
// depending on this shape breaks.
function predictCorners(homeAvgCornersFor, awayAvgCornersFor, overUnderLine = 9.5) {
  const r = predictStatOverUnder(homeAvgCornersFor, awayAvgCornersFor, overUnderLine);
  return {
    homeExpectedCorners: r.homeExpected, awayExpectedCorners: r.awayExpected, totalExpectedCorners: r.totalExpected,
    overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct,
  };
}

// Total goals over/under — same wrapper pattern.
function predictGoalsOverUnder(homeExpectedGoals, awayExpectedGoals, overUnderLine = 2.5) {
  const r = predictStatOverUnder(homeExpectedGoals, awayExpectedGoals, overUnderLine);
  return { totalExpectedGoals: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

// Scans a single match's full prediction (result + goals O/U + corners O/U,
// if available) and returns whichever individual outcome has the highest
// probability, with a plain-English label. Used to surface a "highest
// confidence pick" across a whole day's matches — still just a statistical
// read of the numbers already computed, not a new kind of prediction.
function bestOutcome(match) {
  const candidates = [
    { pct: match.prediction.homeWinPct, label: `${match.homeTeam} to win`, market: "result", side: "home" },
    { pct: match.prediction.drawPct, label: `${match.homeTeam} vs ${match.awayTeam} to draw`, market: "result", side: "draw" },
    { pct: match.prediction.awayWinPct, label: `${match.awayTeam} to win`, market: "result", side: "away" },
  ];
  if (match.goalsOverUnder) {
    candidates.push({ pct: match.goalsOverUnder.overPct, label: `Over ${match.goalsOverUnder.overUnderLine} goals`, market: "goalsOverUnder", side: "over" });
    candidates.push({ pct: match.goalsOverUnder.underPct, label: `Under ${match.goalsOverUnder.overUnderLine} goals`, market: "goalsOverUnder", side: "under" });
  }
  if (match.corners) {
    candidates.push({ pct: match.corners.overPct, label: `Over ${match.corners.overUnderLine} corners`, market: "corners", side: "over" });
    candidates.push({ pct: match.corners.underPct, label: `Under ${match.corners.overUnderLine} corners`, market: "corners", side: "under" });
  }
  if (match.throwIns) {
    candidates.push({ pct: match.throwIns.overPct, label: `Over ${match.throwIns.overUnderLine} throw-ins`, market: "throwIns", side: "over" });
    candidates.push({ pct: match.throwIns.underPct, label: `Under ${match.throwIns.overUnderLine} throw-ins`, market: "throwIns", side: "under" });
  }
  if (match.cards) {
    candidates.push({ pct: match.cards.overPct, label: `Over ${match.cards.overUnderLine} cards`, market: "cards", side: "over" });
    candidates.push({ pct: match.cards.underPct, label: `Under ${match.cards.overUnderLine} cards`, market: "cards", side: "under" });
  }
  return candidates.reduce((best, c) => (c.pct > best.pct ? c : best));
}

// Same combined-Poisson approach as corners and goals, for throw-ins.
// Throw-ins run much higher per match than corners (based on real sample
// data, roughly 12-14 per team), so the default line is set accordingly —
// adjust if your own data suggests a different typical total.
function predictThrowIns(homeAvgThrowInsFor, awayAvgThrowInsFor, overUnderLine = 25.5) {
  const r = predictStatOverUnder(homeAvgThrowInsFor, awayAvgThrowInsFor, overUnderLine);
  return {
    homeExpectedThrowIns: r.homeExpected, awayExpectedThrowIns: r.awayExpected, totalExpectedThrowIns: r.totalExpected,
    overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct,
  };
}

// The rest of the Statistics Add-On markets — same pattern, same math,
// just different labels. Default lines are rough starting points (real
// per-league calibration happens via calibratedLine, same as everything else).
function predictFouls(homeAvgFor, awayAvgFor, overUnderLine = 22.5) {
  const r = predictStatOverUnder(homeAvgFor, awayAvgFor, overUnderLine);
  return { homeExpectedFouls: r.homeExpected, awayExpectedFouls: r.awayExpected, totalExpectedFouls: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

function predictShots(homeAvgFor, awayAvgFor, overUnderLine = 24.5) {
  const r = predictStatOverUnder(homeAvgFor, awayAvgFor, overUnderLine);
  return { homeExpectedShots: r.homeExpected, awayExpectedShots: r.awayExpected, totalExpectedShots: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

function predictOffsides(homeAvgFor, awayAvgFor, overUnderLine = 3.5) {
  const r = predictStatOverUnder(homeAvgFor, awayAvgFor, overUnderLine);
  return { homeExpectedOffsides: r.homeExpected, awayExpectedOffsides: r.awayExpected, totalExpectedOffsides: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

function predictGoalKicks(homeAvgFor, awayAvgFor, overUnderLine = 15.5) {
  const r = predictStatOverUnder(homeAvgFor, awayAvgFor, overUnderLine);
  return { homeExpectedGoalKicks: r.homeExpected, awayExpectedGoalKicks: r.awayExpected, totalExpectedGoalKicks: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

function predictSaves(homeAvgFor, awayAvgFor, overUnderLine = 6.5) {
  const r = predictStatOverUnder(homeAvgFor, awayAvgFor, overUnderLine);
  return { homeExpectedSaves: r.homeExpected, awayExpectedSaves: r.awayExpected, totalExpectedSaves: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

function predictCards(homeAvgFor, awayAvgFor, overUnderLine = 3.5) {
  const r = predictStatOverUnder(homeAvgFor, awayAvgFor, overUnderLine);
  return { homeExpectedCards: r.homeExpected, awayExpectedCards: r.awayExpected, totalExpectedCards: r.totalExpected, overUnderLine: r.overUnderLine, overPct: r.overPct, underPct: r.underPct };
}

// Finds the natural over/under line (always an X.5 value, since a whole
// number would allow ties/pushes) closest to a league's real average total.
// This is what replaces one-size-fits-all defaults like "always 2.5 goals"
// or "always 9.5 corners" — a league that actually averages 3.1 combined
// goals per match should have its line at 3.5, not 2.5, or every
// over/under prediction in that league skews lopsided for no good reason.
function calibratedLine(leagueAverage) {
  if (!Number.isFinite(leagueAverage) || leagueAverage <= 0) return 2.5; // sane fallback if data's missing
  return Math.round(leagueAverage - 0.5) + 0.5;
}

module.exports = {
  poissonProb, teamStrength, expectedGoals, predictMatch, predict, predictStatOverUnder,
  predictCorners, predictThrowIns, predictFouls, predictShots, predictOffsides, predictGoalKicks, predictSaves, predictCards,
  predictGoalsOverUnder, bestOutcome, factorial, dixonColesTau, calibratedLine,
};
