const express = require("express");
const path = require("path");
const {
  verifyLogin, signToken, requireAuth, startPasswordReset, completePasswordReset,
  isOwner, listAccounts, addAccount, removeAccount, ownerResetPassword,
} = require("./auth");
const { sendSms } = require("./sms");
const { upcomingMatches, finishedMatches, computeStats, standings, computeStatAverages, extractCorners, extractThrowIns, enrichWithStatistics } = require("./footballData");
const { predict, predictCorners, predictThrowIns, predictGoalsOverUnder, bestOutcome } = require("./predict");
const {
  recentForm, checkPredictionOutcome, aggregateAccuracy, accuracyByLeague, accuracyByWeek, startOfWeekUtc, checkPickOutcome,
} = require("./stats");
const { parseMatchesCsv, teamNamesIn } = require("./csvParse");
const {
  getPredictionLog, setPredictionLog, getPendingPickNotifications, setPendingPickNotifications,
  getLastWeeklyDigestWeek, setLastWeeklyDigestWeek,
} = require("./store");

const LEAGUES = [
  { code: "PL", name: "Premier League" },
  { code: "PD", name: "La Liga" },
  { code: "SA", name: "Serie A" },
  { code: "BL1", name: "Bundesliga" },
  { code: "FL1", name: "Ligue 1" },
];

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Simple in-memory login rate limit: 8 attempts per IP per 15 minutes.
const loginAttempts = new Map();
function checkLoginRate(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 8;
  let entry = loginAttempts.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    loginAttempts.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= maxAttempts;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
  });
});

app.post("/api/login", (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!checkLoginRate(ip)) {
    return res.status(429).json({ error: "Too many login attempts — try again in a few minutes." });
  }
  const { username, password } = req.body || {};
  const user = verifyLogin(username, password);
  if (!user) return res.status(401).json({ error: "Incorrect username or password." });
  res.json({ token: signToken(user.username), username: user.username });
});

// Who am I, and am I the owner — the frontend uses this once after login to
// decide whether to show the Accounts tab at all.
app.get("/api/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username, isOwner: isOwner(req.user.username) });
});

function requireOwner(req, res, next) {
  if (!isOwner(req.user.username)) return res.status(403).json({ error: "Only the account owner can do that." });
  next();
}

// Account management — closes the gap where FOOTY_USERS could only ever be
// read once. The owner (whoever was listed first) can add/remove people
// and reset passwords directly through the app from now on.
app.get("/api/accounts", requireAuth, requireOwner, (req, res) => {
  res.json(listAccounts());
});

app.post("/api/accounts", requireAuth, requireOwner, (req, res) => {
  const { username, password, phone } = req.body || {};
  if (!username || !String(username).trim()) return res.status(400).json({ error: "Username is required." });
  if (!password || String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  try {
    addAccount(String(username).trim(), password, phone || null);
    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/accounts/:username", requireAuth, requireOwner, (req, res) => {
  try {
    removeAccount(req.params.username);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/accounts/:username/reset-password", requireAuth, requireOwner, (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });
  try {
    ownerResetPassword(req.params.username, newPassword);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Separate rate limit from login — 4 reset requests per IP per 15 minutes.
// Kept separate from login attempts so a determined password-guesser can't
// also burn through the SMS quota in the same bucket.
const resetAttempts = new Map();
function checkResetRate(ip) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const maxAttempts = 4;
  let entry = resetAttempts.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { windowStart: now, count: 0 };
    resetAttempts.set(ip, entry);
  }
  entry.count += 1;
  return entry.count <= maxAttempts;
}

// Always returns the same generic message regardless of whether the
// username exists or has a phone on file — so this can't be used to probe
// which usernames are real.
app.post("/api/forgot-password", async (req, res) => {
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
  if (!checkResetRate(ip)) {
    return res.status(429).json({ error: "Too many reset requests — try again in a few minutes." });
  }
  const { username } = req.body || {};
  const generic = { ok: true, message: "If that account exists and has a phone number on file, a reset code has been texted to it." };
  if (!username) return res.json(generic);

  try {
    const started = startPasswordReset(username);
    if (started) {
      const result = await sendSms(started.phone, `Footy Predict: Your password reset code is ${started.code}. It expires in 10 minutes.`);
      if (!result.ok) console.error("Failed to send reset SMS:", result.error);
    }
  } catch (err) {
    console.error("Failed to send reset SMS:", err.message);
  }
  res.json(generic);
});

app.post("/api/reset-password", (req, res) => {
  const { username, code, newPassword } = req.body || {};
  if (!username || !code || !newPassword) return res.status(400).json({ error: "Username, code, and new password are all required." });
  if (String(newPassword).length < 8) return res.status(400).json({ error: "New password must be at least 8 characters." });

  const success = completePasswordReset(username, code, newPassword);
  if (!success) return res.status(400).json({ error: "Invalid or expired code." });
  res.json({ ok: true });
});

// Confidence label from how many relevant home/away games we have for both teams.
function sampleConfidence(homeGames, awayGames) {
  const n = Math.min(homeGames, awayGames);
  if (n >= 8) return "high";
  if (n >= 4) return "medium";
  return "low";
}

// The whole "gather predictions for every league" pipeline, factored out so
// it can be reused both by the /api/predictions route and by the weekly
// digest / result check-in background job — a background job has no HTTP
// request to hang off, so it needs to call this directly.
async function computeAllPredictions() {
  const results = await Promise.all(LEAGUES.map(async (league) => {
    try {
      const [fixtures, finished, table] = await Promise.all([
        upcomingMatches(league.code, 10),
        finishedMatches(league.code),
        standings(league.code).catch(() => ({})),
      ]);
      const stats = computeStats(finished);

      // Corners/throw-ins: football-data.org's competition-wide match list
      // doesn't include per-match statistics — only the single-match detail
      // endpoint does. So each upcoming fixture's two teams get their most
      // recent finished matches enriched with a detail fetch (bounded and
      // deduped — see enrichWithStatistics), then corners/throw-ins are
      // computed from that enriched data the same way goals are computed
      // from the plain list. If the Statistics Add-On isn't active on this
      // account, the enrichment finds no statistics and these simply come
      // back null — no error, corners/throw-ins just don't show.
      const teamsInFixtures = Array.from(new Set(fixtures.flatMap((m) => [m.homeTeam.name, m.awayTeam.name])));
      await enrichWithStatistics(finished, teamsInFixtures, 5);
      const cornerStats = computeStatAverages(finished, extractCorners);
      const throwInStats = computeStatAverages(finished, extractThrowIns);

      const log = getPredictionLog();
      const loggedIds = new Set(log.map((e) => e.matchId));
      const newLogEntries = [];

      const matches = await Promise.all(fixtures.map(async (m) => {
        const homeStats = stats.teamStats(m.homeTeam.name);
        const awayStats = stats.teamStats(m.awayTeam.name);
        const prediction = predict({
          homeAvgGoalsFor: homeStats.homeAvgGoalsFor, homeAvgGoalsAgainst: homeStats.homeAvgGoalsAgainst,
          awayAvgGoalsFor: awayStats.awayAvgGoalsFor, awayAvgGoalsAgainst: awayStats.awayAvgGoalsAgainst,
          leagueAvgHomeGoals: stats.leagueAvgHomeGoals, leagueAvgAwayGoals: stats.leagueAvgAwayGoals,
        });
        const goalsOverUnder = predictGoalsOverUnder(prediction.homeExpectedGoals, prediction.awayExpectedGoals);

        let corners = null;
        if (cornerStats) {
          const homeCornerStats = cornerStats.teamStats(m.homeTeam.name);
          const awayCornerStats = cornerStats.teamStats(m.awayTeam.name);
          corners = predictCorners(homeCornerStats.homeAvgFor, awayCornerStats.awayAvgFor);
        }

        let throwIns = null;
        if (throwInStats) {
          const homeThrowInStats = throwInStats.teamStats(m.homeTeam.name);
          const awayThrowInStats = throwInStats.teamStats(m.awayTeam.name);
          throwIns = predictThrowIns(homeThrowInStats.homeAvgFor, awayThrowInStats.awayAvgFor);
        }

        if (!loggedIds.has(m.id)) {
          const resultPick = prediction.homeWinPct >= prediction.drawPct && prediction.homeWinPct >= prediction.awayWinPct ? "home"
            : prediction.drawPct >= prediction.awayWinPct ? "draw" : "away";
          const goalsOverUnderPick = goalsOverUnder.overPct >= goalsOverUnder.underPct ? "over" : "under";
          newLogEntries.push({
            matchId: m.id, league: league.name, homeTeam: m.homeTeam.name, awayTeam: m.awayTeam.name, utcDate: m.utcDate,
            resultPick, goalsOverUnderPick, goalsOverUnderLine: goalsOverUnder.overUnderLine, resolved: false,
          });
        }

        return {
          id: m.id, utcDate: m.utcDate,
          homeTeam: m.homeTeam.name, awayTeam: m.awayTeam.name,
          homeCrest: m.homeTeam.crest, awayCrest: m.awayTeam.crest,
          homeForm: recentForm(finished, m.homeTeam.name), awayForm: recentForm(finished, m.awayTeam.name),
          homePosition: table[m.homeTeam.name] || null, awayPosition: table[m.awayTeam.name] || null,
          prediction, goalsOverUnder, corners, throwIns,
          explain: {
            homeAvgGoalsFor: Math.round(homeStats.homeAvgGoalsFor * 100) / 100,
            homeAvgGoalsAgainst: Math.round(homeStats.homeAvgGoalsAgainst * 100) / 100,
            awayAvgGoalsFor: Math.round(awayStats.awayAvgGoalsFor * 100) / 100,
            awayAvgGoalsAgainst: Math.round(awayStats.awayAvgGoalsAgainst * 100) / 100,
            leagueAvgHomeGoals: Math.round(stats.leagueAvgHomeGoals * 100) / 100,
            leagueAvgAwayGoals: Math.round(stats.leagueAvgAwayGoals * 100) / 100,
            homeGames: homeStats.homeGames, awayGames: awayStats.awayGames,
          },
          confidence: sampleConfidence(homeStats.homeGames, awayStats.awayGames),
          sampleSize: { home: homeStats.homeGames, away: awayStats.awayGames },
        };
      }));

      // Reconcile: any previously-logged prediction whose match has now
      // finished gets checked against the real score, once, ever.
      if (newLogEntries.length || log.some((e) => !e.resolved)) {
        const finishedById = Object.fromEntries(finished.map((f) => [f.id, f]));
        const updatedLog = [...log, ...newLogEntries].map((entry) => {
          if (entry.resolved) return entry;
          const finishedMatch = finishedById[entry.matchId];
          if (!finishedMatch) return entry;
          const outcome = checkPredictionOutcome(entry, finishedMatch.score.fullTime.home, finishedMatch.score.fullTime.away);
          return { ...entry, ...outcome, resolved: true };
        });
        setPredictionLog(updatedLog);
      }

      return { league: league.name, code: league.code, matches, error: null, finished };
    } catch (err) {
      return { league: league.name, code: league.code, matches: [], error: err.message, finished: [] };
    }
  }));

  let pickOfTheDay = null;
  results.forEach((league) => {
    league.matches.forEach((m) => {
      const outcome = bestOutcome(m);
      if (!pickOfTheDay || outcome.pct > pickOfTheDay.pct) {
        pickOfTheDay = { ...outcome, matchId: m.id, league: league.league, homeTeam: m.homeTeam, awayTeam: m.awayTeam, utcDate: m.utcDate };
      }
    });
  });

  // A combined lookup of every finished match across every league, by ID —
  // used to check pending pick-of-the-day notifications against reality.
  const allFinishedById = {};
  results.forEach((league) => { league.finished.forEach((f) => { allFinishedById[f.id] = f; }); });

  // Strip the internal `finished` field before returning — it's only used
  // above, the API response and callers don't need it.
  const leagues = results.map(({ finished, ...rest }) => rest);

  return { leagues, pickOfTheDay, allFinishedById };
}

// Tracks today's pick-of-the-day (if it's a new match) and checks any
// previously-tracked picks against real results once they finish — sending
// a check-in text either way it lands. Called after every predictions fetch
// and by the weekly digest job, so this stays current without needing its
// own separate polling loop.
async function processPickTracking(pickOfTheDay, allFinishedById) {
  const pending = getPendingPickNotifications();
  let changed = false;

  // Only "result" and "goalsOverUnder" picks are tracked — see checkPickOutcome.
  if (pickOfTheDay && (pickOfTheDay.market === "result" || pickOfTheDay.market === "goalsOverUnder")
      && !pending.some((p) => p.matchId === pickOfTheDay.matchId)) {
    pending.push({
      matchId: pickOfTheDay.matchId, label: pickOfTheDay.label, market: pickOfTheDay.market, side: pickOfTheDay.side,
      line: pickOfTheDay.market === "goalsOverUnder" ? Number(pickOfTheDay.label.match(/[\d.]+/)?.[0]) : undefined,
      league: pickOfTheDay.league, homeTeam: pickOfTheDay.homeTeam, awayTeam: pickOfTheDay.awayTeam,
      notified: false,
    });
    changed = true;
  }

  for (const pick of pending) {
    if (pick.notified) continue;
    const finishedMatch = allFinishedById[pick.matchId];
    if (!finishedMatch) continue;

    const correct = checkPickOutcome(pick, finishedMatch.score.fullTime.home, finishedMatch.score.fullTime.away);
    pick.notified = true;
    changed = true;
    if (correct === null) continue; // unsupported market, silently stop tracking

    const text = correct
      ? `Footy Predict: ✅ Hit! "${pick.label}" (${pick.homeTeam} vs ${pick.awayTeam}) came through.`
      : `Footy Predict: ❌ Missed. "${pick.label}" (${pick.homeTeam} vs ${pick.awayTeam}) didn't land.`;
    await smsAllUsers(text);
  }

  if (changed) setPendingPickNotifications(pending);
}

async function smsAllUsers(text) {
  const accounts = listAccounts().filter((a) => a.phone);
  await Promise.all(accounts.map(async (a) => {
    const result = await sendSms(a.phone, text);
    if (!result.ok) console.error(`Failed to text ${a.username}:`, result.error);
  }));
}

app.get("/api/predictions", requireAuth, async (req, res) => {
  const { leagues, pickOfTheDay, allFinishedById } = await computeAllPredictions();
  processPickTracking(pickOfTheDay, allFinishedById).catch((err) => console.error("Pick tracking failed:", err.message));
  res.json({ generatedAt: new Date().toISOString(), leagues, pickOfTheDay });
});

// Overall prediction accuracy so far, plus a per-league and per-week
// breakdown — only counts matches that have actually finished and been
// checked against reality.
app.get("/api/accuracy", requireAuth, (req, res) => {
  const log = getPredictionLog();
  const resolved = log.filter((e) => e.resolved);
  res.json({
    ...aggregateAccuracy(resolved),
    totalTracked: log.length,
    totalResolved: resolved.length,
    byLeague: accuracyByLeague(resolved),
    byWeek: accuracyByWeek(resolved),
  });
});

// Upload a CSV of past results for any league/competition not covered by
// football-data.org's free tier — computes the exact same stats the API
// leagues use, just from your own data instead. Nothing here is saved
// server-side; the computed stats are returned to the browser for that
// session only, so a re-upload or page refresh starts fresh on purpose
// (this is meant as a quick one-off tool, not a stored league).
app.post("/api/upload-csv", requireAuth, (req, res) => {
  const { csvText } = req.body || {};
  if (!csvText || !String(csvText).trim()) return res.status(400).json({ error: "No CSV data received." });

  try {
    const matches = parseMatchesCsv(csvText);
    const stats = computeStats(matches);
    const teams = teamNamesIn(matches);
    const teamStats = Object.fromEntries(teams.map((name) => [name, stats.teamStats(name)]));
    res.json({
      teams, teamStats,
      leagueAvgHomeGoals: Math.round(stats.leagueAvgHomeGoals * 100) / 100,
      leagueAvgAwayGoals: Math.round(stats.leagueAvgAwayGoals * 100) / 100,
      matchCount: matches.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// A prediction from raw stats directly — no team names, no API lookups.
// Used both by the "quick manual entry" form and by the CSV-upload flow
// once the user's picked two uploaded teams (the browser sends that team's
// already-computed stats straight through).
app.post("/api/predict-manual", requireAuth, (req, res) => {
  const { homeAvgGoalsFor, homeAvgGoalsAgainst, awayAvgGoalsFor, awayAvgGoalsAgainst, leagueAvgHomeGoals, leagueAvgAwayGoals } = req.body || {};
  const nums = { homeAvgGoalsFor, homeAvgGoalsAgainst, awayAvgGoalsFor, awayAvgGoalsAgainst, leagueAvgHomeGoals, leagueAvgAwayGoals };
  for (const [key, val] of Object.entries(nums)) {
    if (!Number.isFinite(Number(val)) || Number(val) < 0) return res.status(400).json({ error: `"${key}" must be a valid, non-negative number.` });
  }

  const prediction = predict({
    homeAvgGoalsFor: Number(homeAvgGoalsFor), homeAvgGoalsAgainst: Number(homeAvgGoalsAgainst),
    awayAvgGoalsFor: Number(awayAvgGoalsFor), awayAvgGoalsAgainst: Number(awayAvgGoalsAgainst),
    leagueAvgHomeGoals: Number(leagueAvgHomeGoals), leagueAvgAwayGoals: Number(leagueAvgAwayGoals),
  });
  const goalsOverUnder = predictGoalsOverUnder(prediction.homeExpectedGoals, prediction.awayExpectedGoals);
  res.json({ prediction, goalsOverUnder });
});

// Weekly picks digest — every Friday evening (18:00 UTC = 9pm EAT), texts
// everyone with a phone number that week's highest-confidence pick. Checked
// hourly; a week marker (see store.js) stops it from ever sending twice for
// the same week, even across restarts.
async function checkWeeklyDigest() {
  try {
    const now = new Date();
    const isFridayEvening = now.getUTCDay() === 5 && now.getUTCHours() >= 18;
    if (!isFridayEvening) return;

    const currentWeek = startOfWeekUtc(now);
    if (getLastWeeklyDigestWeek() === currentWeek) return; // already sent this week

    const { pickOfTheDay, allFinishedById } = await computeAllPredictions();
    await processPickTracking(pickOfTheDay, allFinishedById);
    if (pickOfTheDay) {
      await smsAllUsers(`Footy Predict: This weekend's highest-confidence pick — ${pickOfTheDay.label} (${pickOfTheDay.homeTeam} vs ${pickOfTheDay.awayTeam}, ${pickOfTheDay.pct}%).`);
    }
    setLastWeeklyDigestWeek(currentWeek);
  } catch (err) {
    console.error("Weekly digest failed:", err.message);
  }
}
setInterval(checkWeeklyDigest, 60 * 60 * 1000);
checkWeeklyDigest(); // also check once on boot, in case the window was missed while the server was down

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Footy Predict server listening on port ${PORT}`));
