// Pure helpers for two things: computing a team's recent form (W/D/L
// sequence) from finished matches, and checking whether a previously-logged
// prediction turned out correct once a match finishes. No I/O here — that
// lives in store.js — so all of this is directly testable.

// Returns the team's last `count` results (any venue), most recent first,
// as an array of "W" | "D" | "L". Matches without a final score are ignored.
function recentForm(matches, teamName, count = 5) {
  const teamMatches = matches
    .filter((m) => (m.homeTeam.name === teamName || m.awayTeam.name === teamName) && m.score?.fullTime?.home != null)
    .slice()
    .sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));

  return teamMatches.slice(0, count).map((m) => {
    const isHome = m.homeTeam.name === teamName;
    const homeGoals = m.score.fullTime.home, awayGoals = m.score.fullTime.away;
    if (homeGoals === awayGoals) return "D";
    const teamWon = isHome ? homeGoals > awayGoals : awayGoals > homeGoals;
    return teamWon ? "W" : "L";
  });
}

// Given a logged prediction (the "predicted" side for each market this app
// covers) and the actual final score, works out whether each market's
// prediction was correct. Any market not present in the logged prediction
// (e.g. corners, if that wasn't enabled at prediction time) is simply
// omitted from the result rather than guessed at.
// `actualStats` is optional — pass { corners: {home, away}, throwIns: {...},
// cards: {...} } when the finished match's real statistics are available,
// and those markets get checked too. Without it, only the goal-derived
// markets (result, goals O/U, BTTS, clean sheets) are checked — which is
// exactly the right behavior, since a market we can't verify shouldn't be
// silently counted as either right or wrong.
function checkPredictionOutcome(logged, actualHomeGoals, actualAwayGoals, actualStats) {
  const result = {};

  if (logged.resultPick) {
    const actual = actualHomeGoals > actualAwayGoals ? "home" : actualHomeGoals < actualAwayGoals ? "away" : "draw";
    result.resultCorrect = logged.resultPick === actual;
  }

  if (logged.goalsOverUnderPick) {
    const actualTotal = actualHomeGoals + actualAwayGoals;
    const actualSide = actualTotal > logged.goalsOverUnderLine ? "over" : "under";
    result.goalsOverUnderCorrect = logged.goalsOverUnderPick === actualSide;
  }

  // Both teams to score — derivable from the score alone, no stats needed.
  if (logged.bttsPick) {
    const actualSide = actualHomeGoals >= 1 && actualAwayGoals >= 1 ? "yes" : "no";
    result.bttsCorrect = logged.bttsPick === actualSide;
  }

  // Clean sheets — also purely goal-derived.
  if (logged.homeCleanSheetPick) {
    const actualSide = actualAwayGoals === 0 ? "yes" : "no";
    result.homeCleanSheetCorrect = logged.homeCleanSheetPick === actualSide;
  }
  if (logged.awayCleanSheetPick) {
    const actualSide = actualHomeGoals === 0 ? "yes" : "no";
    result.awayCleanSheetCorrect = logged.awayCleanSheetPick === actualSide;
  }

  // Stat-based markets — only checkable when the real match statistics
  // came through (Statistics Add-On active, match detail fetched).
  const statMarkets = [
    { pickKey: "cornersPick", lineKey: "cornersLine", statKey: "corners", resultKey: "cornersCorrect" },
    { pickKey: "throwInsPick", lineKey: "throwInsLine", statKey: "throwIns", resultKey: "throwInsCorrect" },
    { pickKey: "cardsPick", lineKey: "cardsLine", statKey: "cards", resultKey: "cardsCorrect" },
  ];
  statMarkets.forEach(({ pickKey, lineKey, statKey, resultKey }) => {
    const stat = actualStats?.[statKey];
    if (!logged[pickKey] || !stat || stat.home == null || stat.away == null) return;
    const actualTotal = stat.home + stat.away;
    const actualSide = actualTotal > logged[lineKey] ? "over" : "under";
    result[resultKey] = logged[pickKey] === actualSide;
  });

  return result;
}

// Aggregates a list of resolved log entries (each already run through
// checkPredictionOutcome and merged in) into simple overall accuracy
// percentages per market. Entries where a market wasn't tracked are
// excluded from that market's denominator, not counted as wrong.
function aggregateAccuracy(entries) {
  const pct = (arr, key) => (arr.length ? Math.round((arr.filter((e) => e[key]).length / arr.length) * 1000) / 10 : null);

  // Every market tracked, with the log field it's stored under and the
  // label used in the API response. Adding a new market here is all it
  // takes for it to show up everywhere accuracy is displayed.
  const markets = [
    { key: "resultCorrect", name: "result" },
    { key: "goalsOverUnderCorrect", name: "goalsOverUnder" },
    { key: "bttsCorrect", name: "btts" },
    { key: "homeCleanSheetCorrect", name: "homeCleanSheet" },
    { key: "awayCleanSheetCorrect", name: "awayCleanSheet" },
    { key: "cornersCorrect", name: "corners" },
    { key: "throwInsCorrect", name: "throwIns" },
    { key: "cardsCorrect", name: "cards" },
  ];

  const out = {};
  markets.forEach(({ key, name }) => {
    const tracked = entries.filter((e) => e[key] !== undefined);
    out[`${name}AccuracyPct`] = pct(tracked, key);
    out[`${name}SampleSize`] = tracked.length;
  });
  return out;
}

// Same accuracy math as aggregateAccuracy, but broken out per league — a
// model can genuinely be more reliable for some leagues than others, and
// lumping everything into one number hides that.
function accuracyByLeague(entries) {
  const byLeague = {};
  entries.forEach((e) => {
    if (!e.league) return;
    if (!byLeague[e.league]) byLeague[e.league] = [];
    byLeague[e.league].push(e);
  });
  return Object.entries(byLeague)
    .map(([league, leagueEntries]) => ({ league, ...aggregateAccuracy(leagueEntries) }))
    .sort((a, b) => b.resultSampleSize - a.resultSampleSize);
}

// Monday (UTC midnight) of the week containing the given date — used to
// bucket resolved predictions into weekly accuracy figures.
function startOfWeekUtc(dateInput) {
  const d = new Date(dateInput);
  const day = d.getUTCDay(); // 0=Sunday..6=Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMonday));
  return monday.toISOString().slice(0, 10);
}

// Result-market accuracy per week (by the match's own date, not when it was
// checked) — shows whether the model's trending up or down over time,
// rather than just one running total. Sorted oldest week first.
function accuracyByWeek(entries) {
  const byWeek = {};
  entries.forEach((e) => {
    if (e.resultCorrect === undefined || !e.utcDate) return;
    const week = startOfWeekUtc(e.utcDate);
    if (!byWeek[week]) byWeek[week] = [];
    byWeek[week].push(e);
  });
  return Object.entries(byWeek)
    .map(([weekStart, weekEntries]) => {
      const correct = weekEntries.filter((e) => e.resultCorrect).length;
      return {
        weekStart,
        resultAccuracyPct: Math.round((correct / weekEntries.length) * 1000) / 10,
        sampleSize: weekEntries.length,
      };
    })
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

// Checks whether a single tracked pick (as stored for the weekly-digest
// check-in feature) turned out correct, given the real final score. Only
// "result" and "goalsOverUnder" markets are supported — corners picks
// aren't tracked for check-ins since verifying the actual corner count
// would need another paid API call just to confirm a text message.
function checkPickOutcome(pick, actualHomeGoals, actualAwayGoals) {
  if (pick.market === "result") {
    const actual = actualHomeGoals > actualAwayGoals ? "home" : actualHomeGoals < actualAwayGoals ? "away" : "draw";
    return pick.side === actual;
  }
  if (pick.market === "goalsOverUnder") {
    const actualTotal = actualHomeGoals + actualAwayGoals;
    const actualSide = actualTotal > pick.line ? "over" : "under";
    return pick.side === actualSide;
  }
  return null; // unsupported market — caller should skip sending a check-in for this
}

module.exports = {
  recentForm, checkPredictionOutcome, aggregateAccuracy, accuracyByLeague, accuracyByWeek, startOfWeekUtc, checkPickOutcome,
};
