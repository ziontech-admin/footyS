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

// Corner prediction — same Poisson math as goals (corners are count data
// too), but the number people usually care about is the combined total vs.
// a line (e.g. "over/under 9.5"), not a home/away/draw split.
function predictCorners(homeAvgCornersFor, awayAvgCornersFor, overUnderLine = 9.5) {
  const totalExpected = homeAvgCornersFor + awayAvgCornersFor;
  let underOrEqualProb = 0;
  for (let total = 0; total <= Math.floor(overUnderLine); total++) {
    underOrEqualProb += poissonProb(total, totalExpected);
  }
  const overProb = 1 - underOrEqualProb;
  return {
    homeExpectedCorners: Math.round(homeAvgCornersFor * 10) / 10,
    awayExpectedCorners: Math.round(awayAvgCornersFor * 10) / 10,
    totalExpectedCorners: Math.round(totalExpected * 10) / 10,
    overUnderLine,
    overPct: Math.round(overProb * 1000) / 10,
    underPct: Math.round(underOrEqualProb * 1000) / 10,
  };
}

// Total goals over/under — same combined-Poisson trick as corners, using
// the home/away expected goals already computed for the win/draw/loss
// prediction. No extra API calls needed; free with the existing data.
function predictGoalsOverUnder(homeExpectedGoals, awayExpectedGoals, overUnderLine = 2.5) {
  const totalExpected = homeExpectedGoals + awayExpectedGoals;
  let underOrEqualProb = 0;
  for (let total = 0; total <= Math.floor(overUnderLine); total++) {
    underOrEqualProb += poissonProb(total, totalExpected);
  }
  const overProb = 1 - underOrEqualProb;
  return {
    totalExpectedGoals: Math.round(totalExpected * 100) / 100,
    overUnderLine,
    overPct: Math.round(overProb * 1000) / 10,
    underPct: Math.round(underOrEqualProb * 1000) / 10,
  };
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
  return candidates.reduce((best, c) => (c.pct > best.pct ? c : best));
}

module.exports = {
  poissonProb, teamStrength, expectedGoals, predictMatch, predict,
  predictCorners, predictGoalsOverUnder, bestOutcome, factorial, dixonColesTau,
};
