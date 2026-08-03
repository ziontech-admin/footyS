const app = document.getElementById("app");

function getToken() { return localStorage.getItem("footy_token"); }
function setToken(t) { if (t) localStorage.setItem("footy_token", t); else localStorage.removeItem("footy_token"); }

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function renderLogin(errorMsg = "") {
  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">
        <h1>⚽ Footy Predict</h1>
        <div class="subtitle">Stats-based predictions — informational only, not betting advice.</div>
        <input id="username" placeholder="Username" autocomplete="username" />
        <input id="password" type="password" placeholder="Password" autocomplete="current-password" />
        ${errorMsg ? `<div class="error">${errorMsg}</div>` : ""}
        <button id="loginBtn">Log in</button>
        <button class="link-btn" id="forgotBtn">Forgot password?</button>
      </div>
    </div>
  `;
  const submit = async () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value;
    const btn = document.getElementById("loginBtn");
    btn.disabled = true; btn.textContent = "Logging in…";
    try {
      const { token } = await api("/api/login", { method: "POST", body: JSON.stringify({ username, password }) });
      setToken(token);
      renderPredictions();
    } catch (e) {
      renderLogin(e.message);
    }
  };
  document.getElementById("loginBtn").addEventListener("click", submit);
  document.getElementById("password").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  document.getElementById("username").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  document.getElementById("forgotBtn").addEventListener("click", () => renderForgotPassword());
}

let forgotPasswordUsername = ""; // carries the username from the request step to the code step

function renderForgotPassword(step = "request") {
  const requestStepHtml = `
    <div class="subtitle">Enter your username and we'll text you a reset code.</div>
    <input id="fpUsername" placeholder="Username" value="${forgotPasswordUsername}" />
    <div id="fpError" class="error"></div>
    <div id="fpMessage" class="fp-message"></div>
    <button id="fpRequestBtn">Send reset code</button>
    <button class="link-btn" id="fpBackBtn">Back to login</button>
  `;
  const codeStepHtml = `
    <div class="subtitle">Check your phone for a 6-digit code — it expires in 10 minutes.</div>
    <input id="fpCode" placeholder="6-digit code" maxlength="6" />
    <input id="fpNewPassword" type="password" placeholder="New password (min 8 characters)" autocomplete="new-password" />
    <div id="fpError" class="error"></div>
    <button id="fpResetBtn">Reset password</button>
    <button class="link-btn" id="fpBackBtn">Back to login</button>
  `;

  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">
        <h1>⚽ Footy Predict</h1>
        ${step === "request" ? requestStepHtml : codeStepHtml}
      </div>
    </div>
  `;
  document.getElementById("fpBackBtn").addEventListener("click", () => { forgotPasswordUsername = ""; renderLogin(); });

  if (step === "request") {
    document.getElementById("fpRequestBtn").addEventListener("click", async () => {
      const username = document.getElementById("fpUsername").value.trim();
      const errorEl = document.getElementById("fpError");
      const messageEl = document.getElementById("fpMessage");
      errorEl.textContent = ""; messageEl.textContent = "";
      if (!username) { errorEl.textContent = "Enter your username first."; return; }

      try {
        const { message } = await api("/api/forgot-password", { method: "POST", body: JSON.stringify({ username }) });
        forgotPasswordUsername = username;
        messageEl.textContent = message;
        setTimeout(() => renderForgotPassword("code"), 1200);
      } catch (e) {
        errorEl.textContent = e.message;
      }
    });
  } else {
    document.getElementById("fpResetBtn").addEventListener("click", async () => {
      const errorEl = document.getElementById("fpError");
      errorEl.textContent = "";
      const code = document.getElementById("fpCode").value.trim();
      const newPassword = document.getElementById("fpNewPassword").value;
      try {
        await api("/api/reset-password", { method: "POST", body: JSON.stringify({ username: forgotPasswordUsername, code, newPassword }) });
        forgotPasswordUsername = "";
        renderLogin();
      } catch (e) {
        errorEl.textContent = e.message;
      }
    });
  }
}

function skeletonHtml(count = 4) {
  const card = `
    <div class="skeleton-card">
      <div class="skeleton-line w-60"></div>
      <div class="skeleton-line w-40"></div>
      <div class="skeleton-line w-100" style="margin-top:20px"></div>
    </div>
  `;
  return card.repeat(count);
}

function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " +
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatGeneratedAt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function favOutcome(p) {
  const entries = [
    { key: "home", pct: p.homeWinPct },
    { key: "draw", pct: p.drawPct },
    { key: "away", pct: p.awayWinPct },
  ];
  entries.sort((a, b) => b.pct - a.pct);
  return entries[0].key;
}

function formHtml(form) {
  if (!form || form.length === 0) return "";
  return `<span class="form-badges">${form.map((r) => `<span class="form-${r.toLowerCase()}">${r}</span>`).join("")}</span>`;
}

function matchCardHtml(m) {
  const p = m.prediction;
  const c = m.corners;
  const t = m.throwIns;
  const cd = m.cards;
  const fav = favOutcome(p);
  const conf = m.confidence || "medium";
  return `
    <div class="match-card">
      <div class="match-teams">
        <div class="team home">
          ${m.homeCrest ? `<img src="${m.homeCrest}" alt="" />` : ""}
          <span>${m.homeTeam}${m.homePosition ? ` <span class="position">(${m.homePosition})</span>` : ""}</span>
        </div>
        <div class="vs">vs</div>
        <div class="team away">
          <span>${m.awayPosition ? `<span class="position">(${m.awayPosition})</span> ` : ""}${m.awayTeam}</span>
          ${m.awayCrest ? `<img src="${m.awayCrest}" alt="" />` : ""}
        </div>
      </div>
      <div class="form-row">
        ${formHtml(m.homeForm)}
        <span class="match-meta">
          <span class="match-date">${formatDate(m.utcDate)}</span>
          <span class="confidence conf-${conf}" title="Based on sample size of home/away games this season">Data: ${conf}</span>
        </span>
        ${formHtml(m.awayForm)}
      </div>
      <div class="prediction-bar">
        <div class="home${fav === "home" ? " fav" : ""}" style="width:${p.homeWinPct}%"></div>
        <div class="draw${fav === "draw" ? " fav" : ""}" style="width:${p.drawPct}%"></div>
        <div class="away${fav === "away" ? " fav" : ""}" style="width:${p.awayWinPct}%"></div>
      </div>
      <div class="prediction-labels">
        <span class="${fav === "home" ? "fav-label" : ""}"><strong>${p.homeWinPct}%</strong> Home</span>
        <span class="${fav === "draw" ? "fav-label" : ""}"><strong>${p.drawPct}%</strong> Draw</span>
        <span class="${fav === "away" ? "fav-label" : ""}"><strong>${p.awayWinPct}%</strong> Away</span>
      </div>
      <div class="likely-score">Most likely: ${p.likelyScore} · xG ${p.homeExpectedGoals} – ${p.awayExpectedGoals}</div>
      ${m.goalsOverUnder ? `
        <div class="corners-row">
          <span>⚽ Goals: ~${m.goalsOverUnder.totalExpectedGoals} expected</span>
          <span>O/U ${m.goalsOverUnder.overUnderLine}: <strong>${m.goalsOverUnder.overPct}%</strong> over · <strong>${m.goalsOverUnder.underPct}%</strong> under</span>
        </div>
      ` : ""}
      <div class="corners-row">
        <span>🥅 BTTS: <strong>${p.bttsYesPct}%</strong> yes · <strong>${p.bttsNoPct}%</strong> no</span>
        <span>Clean sheet: <strong>${p.homeCleanSheetPct}%</strong> home · <strong>${p.awayCleanSheetPct}%</strong> away</span>
      </div>
      ${c ? `
        <div class="corners-row">
          <span>⛳ Corners: ~${c.totalExpectedCorners} expected</span>
          <span>O/U ${c.overUnderLine}: <strong>${c.overPct}%</strong> over · <strong>${c.underPct}%</strong> under</span>
        </div>
      ` : ""}
      ${t ? `
        <div class="corners-row">
          <span>🤾 Throw-ins: ~${t.totalExpectedThrowIns} expected</span>
          <span>O/U ${t.overUnderLine}: <strong>${t.overPct}%</strong> over · <strong>${t.underPct}%</strong> under</span>
        </div>
      ` : ""}
      ${cd ? `
        <div class="corners-row">
          <span>🟨 Cards: ~${cd.totalExpectedCards} expected</span>
          <span>O/U ${cd.overUnderLine}: <strong>${cd.overPct}%</strong> over · <strong>${cd.underPct}%</strong> under</span>
        </div>
      ` : ""}
      ${moreStatsHtml(m)}
      ${explainHtml(m.explain)}
    </div>
  `;
}

// Fouls, shots, offsides, goal-kicks, saves, and possession — real markets,
// but less commonly cared about than corners/cards, so they're tucked into
// their own expandable panel instead of always taking up space on the card.
function moreStatsHtml(m) {
  const rows = [];
  if (m.fouls) rows.push(`<div class="explain-row"><span>Fouls</span><strong>~${m.fouls.totalExpectedFouls} · O/U ${m.fouls.overUnderLine}: ${m.fouls.overPct}% / ${m.fouls.underPct}%</strong></div>`);
  if (m.shots) rows.push(`<div class="explain-row"><span>Shots</span><strong>~${m.shots.totalExpectedShots} · O/U ${m.shots.overUnderLine}: ${m.shots.overPct}% / ${m.shots.underPct}%</strong></div>`);
  if (m.offsides) rows.push(`<div class="explain-row"><span>Offsides</span><strong>~${m.offsides.totalExpectedOffsides} · O/U ${m.offsides.overUnderLine}: ${m.offsides.overPct}% / ${m.offsides.underPct}%</strong></div>`);
  if (m.goalKicks) rows.push(`<div class="explain-row"><span>Goal kicks</span><strong>~${m.goalKicks.totalExpectedGoalKicks} · O/U ${m.goalKicks.overUnderLine}: ${m.goalKicks.overPct}% / ${m.goalKicks.underPct}%</strong></div>`);
  if (m.saves) rows.push(`<div class="explain-row"><span>Saves</span><strong>~${m.saves.totalExpectedSaves} · O/U ${m.saves.overUnderLine}: ${m.saves.overPct}% / ${m.saves.underPct}%</strong></div>`);
  if (m.possession) rows.push(`<div class="explain-row"><span>Possession</span><strong>${m.homeTeam} ${m.possession.home}% – ${m.possession.away}% ${m.awayTeam}</strong></div>`);
  if (rows.length === 0) return "";
  return `
    <details class="explain">
      <summary>More stats (${rows.length})</summary>
      <div style="margin-top:10px">${rows.join("")}</div>
    </details>
  `;
}

// The actual numbers behind a prediction, in an expandable native <details>
// element — no JS needed to toggle it. Turns the model from a black box
// into something a stats-curious friend can actually check and trust.
function explainHtml(e) {
  if (!e) return "";
  return `
    <details class="explain">
      <summary>Why this prediction?</summary>
      <div class="explain-grid">
        <div class="explain-col">
          <div class="explain-label">Home, at home</div>
          <div class="explain-row"><span>Scores</span><strong>${e.homeAvgGoalsFor}</strong></div>
          <div class="explain-row"><span>Concedes</span><strong>${e.homeAvgGoalsAgainst}</strong></div>
          <div class="explain-row"><span>Sample</span><strong>${e.homeGames} game${e.homeGames === 1 ? "" : "s"}</strong></div>
        </div>
        <div class="explain-col">
          <div class="explain-label">Away, on the road</div>
          <div class="explain-row"><span>Scores</span><strong>${e.awayAvgGoalsFor}</strong></div>
          <div class="explain-row"><span>Concedes</span><strong>${e.awayAvgGoalsAgainst}</strong></div>
          <div class="explain-row"><span>Sample</span><strong>${e.awayGames} game${e.awayGames === 1 ? "" : "s"}</strong></div>
        </div>
      </div>
      <div class="explain-footnote">League average: ${e.leagueAvgHomeGoals} home goals, ${e.leagueAvgAwayGoals} away goals per game. Recent matches count more, and small samples are pulled toward the league average rather than trusted outright.</div>
    </details>
  `;
}

function leagueSectionHtml(league) {
  if (league.loading) {
    return `<div class="league-section"><div class="league-title">${league.league}</div>${skeletonHtml(3)}</div>`;
  }
  if (league.error) {
    return `<div class="league-section"><div class="league-title">${league.league}</div><div class="league-error">Couldn't load this league right now: ${league.error}</div></div>`;
  }
  if (league.matches.length === 0) {
    return `<div class="league-section"><div class="league-title">${league.league}</div><div class="empty">No upcoming matches scheduled.</div></div>`;
  }
  return `
    <div class="league-section">
      <div class="league-title">${league.league} <span class="match-count">${league.matches.length}</span></div>
      ${league.matches.map(matchCardHtml).join("")}
    </div>
  `;
}

let currentLeaguesData = []; // cached for client-side search filtering, no extra API calls needed

function renderLeagueSections(searchTerm = "") {
  const term = searchTerm.trim().toLowerCase();
  const filtered = !term ? currentLeaguesData : currentLeaguesData
    .map((league) => ({ ...league, matches: league.matches.filter((m) => m.homeTeam.toLowerCase().includes(term) || m.awayTeam.toLowerCase().includes(term)) }))
    .filter((league) => league.error || league.matches.length > 0);

  if (term && filtered.length === 0) return `<div class="empty">No matches found for "${searchTerm}".</div>`;
  return filtered.map(leagueSectionHtml).join("");
}

async function renderPredictions() {
  app.innerHTML = `
    <div class="top-bar">
      <h1>⚽ Footy Predict</h1>
      <div class="tabs">
        <button class="tab-btn active" id="tabLeagues">Leagues</button>
        <button class="tab-btn" id="tabLive">Live</button>
        <button class="tab-btn" id="tabManual">Manual</button>
        <button class="tab-btn" id="tabAccounts" style="display:none">Accounts</button>
        <button class="secondary" id="refreshBtn" title="Reload predictions">Refresh</button>
        <button class="secondary" id="logoutBtn">Log out</button>
      </div>
    </div>
    <div class="content">
      <input id="teamSearch" placeholder="🔍 Search by team…" style="margin-bottom:18px" />
      <div id="predictionsArea">${skeletonHtml()}</div>
    </div>
    <div class="disclaimer">Predictions are statistical estimates (Poisson + Dixon–Coles + recent-form weighting) based on this season's scoring data — for fun, not financial or betting advice.</div>
  `;
  document.getElementById("logoutBtn").addEventListener("click", () => { setToken(null); renderLogin(); });
  document.getElementById("refreshBtn").addEventListener("click", () => renderPredictions());
  document.getElementById("tabManual").addEventListener("click", renderManualTools);
  document.getElementById("tabLeagues").addEventListener("click", renderPredictions);
  document.getElementById("tabLive").addEventListener("click", renderLive);
  document.getElementById("teamSearch").addEventListener("input", (e) => {
    document.getElementById("predictionsArea").innerHTML = renderLeagueSections(e.target.value);
  });

  // Only shows the Accounts tab if this user turns out to be the owner —
  // fetched in parallel, doesn't block the predictions from loading.
  api("/api/me").then(({ isOwner }) => {
    if (!isOwner) return;
    const btn = document.getElementById("tabAccounts");
    btn.style.display = "";
    btn.addEventListener("click", renderAccounts);
  }).catch(() => {});

  try {
    const [data, accuracy] = await Promise.all([
      api("/api/predictions"),
      api("/api/accuracy").catch(() => null),
    ]);

    const leagues = Array.isArray(data) ? data : (data.leagues || []);
    const generatedAt = Array.isArray(data) ? null : data.generatedAt;
    const topPicks = Array.isArray(data) ? [] : (data.topPicks || (data.pickOfTheDay ? [data.pickOfTheDay] : []));
    currentLeaguesData = leagues;

    const anyLoading = leagues.some((l) => l.loading);
    const stamp = generatedAt
      ? `<div class="generated-at">Updated ${formatGeneratedAt(generatedAt)}</div>`
      : anyLoading ? `<div class="generated-at">Some leagues are still loading for the first time — this can take a while, checking again automatically…</div>` : "";
    const pickHtml = topPicksHtml(topPicks);
    const accuracyHtml = accuracy && accuracy.totalResolved > 0 ? accuracyBannerHtml(accuracy) : "";

    document.getElementById("predictionsArea").innerHTML = stamp + accuracyHtml + pickHtml + renderLeagueSections();

    // Only keep polling while something's genuinely still loading — once
    // every league has either real data or an error, this stops on its own.
    if (anyLoading) setTimeout(() => renderPredictions(), 15000);
  } catch (e) {
    if (e.message.includes("logged in") || e.message.includes("expired")) { setToken(null); renderLogin(); return; }
    document.getElementById("predictionsArea").innerHTML = `<div class="league-error">${e.message}</div>`;
  }
}

// Ranks #1 as the headline (same treatment as the old single pick-of-day
// card), #2–5 as a compact numbered list underneath — one card, one glance,
// instead of scrolling every league to find the best matches yourself.
function topPicksHtml(topPicks) {
  if (!topPicks || topPicks.length === 0) return "";
  const [top, ...rest] = topPicks;
  const restHtml = rest.map((p, i) => `
    <div class="top-pick-row">
      <span class="top-pick-rank">#${i + 2}</span>
      <span class="top-pick-label">${p.label}</span>
      <span class="top-pick-meta">${p.homeTeam} vs ${p.awayTeam} · ${p.league}</span>
      <strong class="top-pick-pct">${p.pct}%</strong>
    </div>
  `).join("");

  return `
    <div class="pick-of-day">
      <div class="pick-label">🔥 Top ${topPicks.length} highest confidence picks</div>
      <div class="pick-main">${top.label}</div>
      <div class="pick-sub">${top.homeTeam} vs ${top.awayTeam} · ${top.league} · <strong>${top.pct}%</strong></div>
      ${restHtml ? `<div class="top-picks-rest">${restHtml}</div>` : ""}
    </div>
  `;
}

// The accuracy summary banner, expandable into per-league and per-week
// breakdowns — a running total alone hides whether the model's actually
// better at some leagues than others, or trending up or down over time.
function accuracyBannerHtml(accuracy) {
  const byLeagueHtml = (accuracy.byLeague || []).map((l) =>
    `<div class="explain-row"><span>${l.league}</span><strong>${l.resultAccuracyPct}% <span style="color:var(--text-faint);font-weight:400">(${l.resultSampleSize})</span></strong></div>`
  ).join("");
  const byWeekHtml = (accuracy.byWeek || []).slice(-8).map((w) =>
    `<div class="explain-row"><span>Week of ${w.weekStart}</span><strong>${w.resultAccuracyPct}% <span style="color:var(--text-faint);font-weight:400">(${w.sampleSize})</span></strong></div>`
  ).join("");

  // Every market's own hit rate — this is the honest answer to "is the
  // corners model actually any good?", which a single overall number hides.
  const markets = [
    { name: "Result", key: "result" },
    { name: "Goals O/U", key: "goalsOverUnder" },
    { name: "BTTS", key: "btts" },
    { name: "Clean sheet (home)", key: "homeCleanSheet" },
    { name: "Clean sheet (away)", key: "awayCleanSheet" },
    { name: "Corners", key: "corners" },
    { name: "Throw-ins", key: "throwIns" },
    { name: "Cards", key: "cards" },
  ];
  const byMarketHtml = markets
    .filter((m) => accuracy[`${m.key}AccuracyPct`] != null)
    .map((m) => `<div class="explain-row"><span>${m.name}</span><strong>${accuracy[`${m.key}AccuracyPct`]}% <span style="color:var(--text-faint);font-weight:400">(${accuracy[`${m.key}SampleSize`]})</span></strong></div>`)
    .join("");

  return `
    <div class="accuracy-banner">
      <details class="explain">
        <summary>
          📊 Track record so far:
          ${accuracy.resultAccuracyPct != null ? `<strong>${accuracy.resultAccuracyPct}%</strong> correct on results (${accuracy.resultSampleSize} checked)` : ""}
          ${accuracy.goalsOverUnderAccuracyPct != null ? ` · <strong>${accuracy.goalsOverUnderAccuracyPct}%</strong> on goals O/U (${accuracy.goalsOverUnderSampleSize} checked)` : ""}
        </summary>
        <div style="margin-top:14px">
          <div class="explain-label">By market</div>
          ${byMarketHtml || '<div class="explain-row"><span>Not enough data yet</span></div>'}
        </div>
        <div class="explain-grid" style="grid-template-columns:1fr 1fr; margin-top:14px;">
          <div>
            <div class="explain-label">By league</div>
            ${byLeagueHtml || '<div class="explain-row"><span>Not enough data yet</span></div>'}
          </div>
          <div>
            <div class="explain-label">By week (last 8)</div>
            ${byWeekHtml || '<div class="explain-row"><span>Not enough data yet</span></div>'}
          </div>
        </div>
      </details>
    </div>
  `;
}

// Renders a prediction result (from /api/predict-manual) into the given
// container element — shared by both the quick-entry form and the CSV
// team-picker, since they end up calling the same endpoint.
function renderManualResult(container, data) {
  const p = data.prediction, g = data.goalsOverUnder;
  container.innerHTML = `
    <div class="match-card">
      <div class="prediction-bar">
        <div class="home" style="width:${p.homeWinPct}%"></div>
        <div class="draw" style="width:${p.drawPct}%"></div>
        <div class="away" style="width:${p.awayWinPct}%"></div>
      </div>
      <div class="prediction-labels">
        <span><strong>${p.homeWinPct}%</strong> Home</span>
        <span><strong>${p.drawPct}%</strong> Draw</span>
        <span><strong>${p.awayWinPct}%</strong> Away</span>
      </div>
      <div class="likely-score">Most likely score: ${p.likelyScore} · xG ${p.homeExpectedGoals} – ${p.awayExpectedGoals}</div>
      <div class="corners-row">
        <span>⚽ Goals: ~${g.totalExpectedGoals} expected</span>
        <span>O/U ${g.overUnderLine}: <strong>${g.overPct}%</strong> over · <strong>${g.underPct}%</strong> under</span>
      </div>
    </div>
  `;
}

let uploadedLeagueData = null; // cached in memory for this session only — see /api/upload-csv

// Live matches — sorted by kickoff time (earliest first, since those are
// typically furthest into the match). Auto-refreshes every 30 seconds
// while this tab is open; the server's own cache only actually changes
// once a minute, so this just picks up whatever's freshest without
// hammering anything.
async function renderLive() {
  app.innerHTML = `
    <div class="top-bar">
      <h1>⚽ Footy Predict</h1>
      <div class="tabs">
        <button class="tab-btn" id="tabLeagues">Leagues</button>
        <button class="tab-btn active" id="tabLive">Live</button>
        <button class="tab-btn" id="tabManual">Manual</button>
        <button class="tab-btn" id="tabAccounts" style="display:none">Accounts</button>
        <button class="secondary" id="logoutBtn">Log out</button>
      </div>
    </div>
    <div class="content" id="liveArea">${skeletonHtml(2)}</div>
  `;
  document.getElementById("logoutBtn").addEventListener("click", () => { setToken(null); renderLogin(); });
  document.getElementById("tabLeagues").addEventListener("click", renderPredictions);
  document.getElementById("tabLive").addEventListener("click", renderLive);
  document.getElementById("tabManual").addEventListener("click", renderManualTools);
  api("/api/me").then(({ isOwner }) => {
    if (!isOwner) return;
    const btn = document.getElementById("tabAccounts");
    btn.style.display = "";
    btn.addEventListener("click", renderAccounts);
  }).catch(() => {});

  try {
    const { matches, error } = await api("/api/live");
    const area = document.getElementById("liveArea");
    if (error) {
      area.innerHTML = `<div class="league-error">Couldn't load live matches right now: ${error}</div>`;
    } else if (matches.length === 0) {
      area.innerHTML = `<div class="empty">No matches live right now across your 5 leagues.</div>`;
    } else {
      area.innerHTML = matches.map(liveMatchHtml).join("");
    }
  } catch (e) {
    if (e.message.includes("logged in") || e.message.includes("expired")) { setToken(null); renderLogin(); return; }
    document.getElementById("liveArea").innerHTML = `<div class="league-error">${e.message}</div>`;
  }

  // Only keep auto-refreshing while the Live tab is still the one showing
  // — if the person's navigated elsewhere, this quietly stops on its own.
  setTimeout(() => { if (document.getElementById("tabLive")?.classList.contains("active")) renderLive(); }, 30000);
}

function liveMatchHtml(m) {
  const statusLabel = m.status === "PAUSED" ? "HT" : `${m.minute ?? "?"}'`;
  return `
    <div class="match-card">
      <div class="match-teams">
        <div class="team home">
          ${m.homeCrest ? `<img src="${m.homeCrest}" alt="" />` : ""}
          <span>${m.homeTeam}</span>
        </div>
        <div class="live-score">
          <span class="live-badge">${statusLabel}</span>
          <span class="live-score-value">${m.homeScore} – ${m.awayScore}</span>
        </div>
        <div class="team away">
          <span>${m.awayTeam}</span>
          ${m.awayCrest ? `<img src="${m.awayCrest}" alt="" />` : ""}
        </div>
      </div>
      <div class="match-date">${m.league}</div>
    </div>
  `;
}

async function renderAccounts() {
  app.innerHTML = `
    <div class="top-bar">
      <h1>⚽ Footy Predict</h1>
      <div class="tabs">
        <button class="tab-btn" id="tabLeagues">Leagues</button>
        <button class="tab-btn" id="tabLive">Live</button>
        <button class="tab-btn" id="tabManual">Manual</button>
        <button class="tab-btn active" id="tabAccounts">Accounts</button>
        <button class="secondary" id="logoutBtn">Log out</button>
      </div>
    </div>
    <div class="content">
      <div class="section-card">
        <h3>Add someone</h3>
        <div class="sub">They'll be able to log in right away with these details.</div>
        <label>Username</label>
        <input id="newUsername" placeholder="e.g. sam" />
        <label>Password</label>
        <input id="newPassword" type="password" placeholder="At least 6 characters" />
        <label>Phone (optional — needed for password resets)</label>
        <input id="newPhone" placeholder="0722XXXXXX" />
        <button id="addAccountBtn" style="margin-top:14px">Add account</button>
        <div id="addError" class="error"></div>
      </div>
      <div class="section-card" id="accountsListCard">
        <h3>Everyone with access</h3>
        <div id="accountsList">${skeletonHtml(2)}</div>
      </div>
    </div>
  `;
  document.getElementById("logoutBtn").addEventListener("click", () => { setToken(null); renderLogin(); });
  document.getElementById("tabManual").addEventListener("click", renderManualTools);
  document.getElementById("tabLeagues").addEventListener("click", renderPredictions);
  document.getElementById("tabLive").addEventListener("click", renderLive);
  document.getElementById("tabAccounts").addEventListener("click", renderAccounts);

  document.getElementById("addAccountBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("addError");
    errorEl.textContent = "";
    try {
      await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          username: document.getElementById("newUsername").value.trim(),
          password: document.getElementById("newPassword").value,
          phone: document.getElementById("newPhone").value.trim() || null,
        }),
      });
      renderAccounts();
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  try {
    const accounts = await api("/api/accounts");
    document.getElementById("accountsList").innerHTML = accounts.map(accountRowHtml).join("");
    accounts.forEach((a) => {
      if (a.isOwner) return;
      document.getElementById(`remove-${a.username}`)?.addEventListener("click", async () => {
        if (!confirm(`Remove ${a.username}? They won't be able to log in anymore.`)) return;
        try { await api(`/api/accounts/${a.username}`, { method: "DELETE" }); renderAccounts(); }
        catch (e) { alert(e.message); }
      });
      document.getElementById(`reset-${a.username}`)?.addEventListener("click", async () => {
        const newPassword = prompt(`New password for ${a.username} (at least 6 characters):`);
        if (!newPassword) return;
        try { await api(`/api/accounts/${a.username}/reset-password`, { method: "POST", body: JSON.stringify({ newPassword }) }); alert("Password updated."); }
        catch (e) { alert(e.message); }
      });
    });
  } catch (e) {
    document.getElementById("accountsList").innerHTML = `<div class="league-error">${e.message}</div>`;
  }
}

function accountRowHtml(a) {
  return `
    <div class="account-row">
      <div>
        <div class="account-username">${a.username}${a.isOwner ? ' <span class="position">(owner)</span>' : ""}</div>
        <div class="account-phone">${a.phone || "No phone on file"}</div>
      </div>
      ${!a.isOwner ? `
        <div class="account-actions">
          <button class="secondary" id="reset-${a.username}">Reset password</button>
          <button class="secondary" id="remove-${a.username}">Remove</button>
        </div>
      ` : ""}
    </div>
  `;
}

async function renderManualTools() {
  app.innerHTML = `
    <div class="top-bar">
      <h1>⚽ Footy Predict</h1>
      <div class="tabs">
        <button class="tab-btn" id="tabLeagues">Leagues</button>
        <button class="tab-btn" id="tabLive">Live</button>
        <button class="tab-btn active" id="tabManual">Manual</button>
        <button class="tab-btn" id="tabAccounts" style="display:none">Accounts</button>
        <button class="secondary" id="logoutBtn">Log out</button>
      </div>
    </div>
    <div class="content">
      <div class="section-card">
        <h3>Quick prediction</h3>
        <div class="sub">Type in two teams' own scoring stats directly — no upload needed.</div>
        <div class="manual-grid">
          <div>
            <label>Home team name</label>
            <input id="mHomeName" placeholder="e.g. Home Team" />
            <label>Avg goals scored at home</label>
            <input id="mHomeFor" type="number" step="0.1" placeholder="e.g. 1.8" />
            <label>Avg goals conceded at home</label>
            <input id="mHomeAgainst" type="number" step="0.1" placeholder="e.g. 1.0" />
          </div>
          <div>
            <label>Away team name</label>
            <input id="mAwayName" placeholder="e.g. Away Team" />
            <label>Avg goals scored away</label>
            <input id="mAwayFor" type="number" step="0.1" placeholder="e.g. 1.2" />
            <label>Avg goals conceded away</label>
            <input id="mAwayAgainst" type="number" step="0.1" placeholder="e.g. 1.6" />
          </div>
        </div>
        <label>League average goals — home / away</label>
        <div class="manual-grid-2">
          <input id="mLeagueHome" type="number" step="0.1" placeholder="e.g. 1.5" value="1.5" />
          <input id="mLeagueAway" type="number" step="0.1" placeholder="e.g. 1.1" value="1.1" />
        </div>
        <button id="predictManualBtn" style="margin-top:12px">Predict</button>
        <div id="manualError" class="error"></div>
        <div id="manualResult"></div>
      </div>

      <div class="section-card">
        <h3>Upload past results (CSV)</h3>
        <div class="sub">Columns required: <code>home_team, away_team, home_goals, away_goals</code> — a header row, any column order.</div>
        <input type="file" id="csvFile" accept=".csv,text/csv" />
        <button id="uploadCsvBtn" style="margin-top:10px">Upload</button>
        <div id="csvError" class="error"></div>
        <div id="csvPickers" style="display:none; margin-top:16px;">
          <div class="manual-grid">
            <div>
              <label>Home team</label>
              <select id="csvHomeTeam"></select>
            </div>
            <div>
              <label>Away team</label>
              <select id="csvAwayTeam"></select>
            </div>
          </div>
          <button id="predictCsvBtn" style="margin-top:12px">Predict this matchup</button>
        </div>
        <div id="csvResult"></div>
      </div>
    </div>
    <div class="disclaimer">Predictions are statistical estimates based on the data you provide — for fun, not financial or betting advice.</div>
  `;
  document.getElementById("logoutBtn").addEventListener("click", () => { setToken(null); renderLogin(); });
  document.getElementById("tabManual").addEventListener("click", renderManualTools);
  document.getElementById("tabLeagues").addEventListener("click", renderPredictions);
  document.getElementById("tabLive").addEventListener("click", renderLive);
  api("/api/me").then(({ isOwner }) => {
    if (!isOwner) return;
    const btn = document.getElementById("tabAccounts");
    btn.style.display = "";
    btn.addEventListener("click", renderAccounts);
  }).catch(() => {});

  document.getElementById("predictManualBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("manualError");
    const resultEl = document.getElementById("manualResult");
    errorEl.textContent = ""; resultEl.innerHTML = "";
    try {
      const data = await api("/api/predict-manual", {
        method: "POST",
        body: JSON.stringify({
          homeAvgGoalsFor: document.getElementById("mHomeFor").value,
          homeAvgGoalsAgainst: document.getElementById("mHomeAgainst").value,
          awayAvgGoalsFor: document.getElementById("mAwayFor").value,
          awayAvgGoalsAgainst: document.getElementById("mAwayAgainst").value,
          leagueAvgHomeGoals: document.getElementById("mLeagueHome").value,
          leagueAvgAwayGoals: document.getElementById("mLeagueAway").value,
        }),
      });
      renderManualResult(resultEl, data);
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  document.getElementById("uploadCsvBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("csvError");
    const fileInput = document.getElementById("csvFile");
    errorEl.textContent = "";
    document.getElementById("csvPickers").style.display = "none";
    document.getElementById("csvResult").innerHTML = "";
    if (!fileInput.files[0]) { errorEl.textContent = "Choose a CSV file first."; return; }

    try {
      const csvText = await fileInput.files[0].text();
      const data = await api("/api/upload-csv", { method: "POST", body: JSON.stringify({ csvText }) });
      uploadedLeagueData = data;
      const homeSelect = document.getElementById("csvHomeTeam");
      const awaySelect = document.getElementById("csvAwayTeam");
      const options = data.teams.map((t) => `<option value="${t}">${t}</option>`).join("");
      homeSelect.innerHTML = options;
      awaySelect.innerHTML = options;
      if (data.teams.length > 1) awaySelect.value = data.teams[1];
      document.getElementById("csvPickers").style.display = "block";
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });

  document.getElementById("predictCsvBtn").addEventListener("click", async () => {
    const errorEl = document.getElementById("csvError");
    const resultEl = document.getElementById("csvResult");
    errorEl.textContent = ""; resultEl.innerHTML = "";
    const homeTeam = document.getElementById("csvHomeTeam").value;
    const awayTeam = document.getElementById("csvAwayTeam").value;
    if (homeTeam === awayTeam) { errorEl.textContent = "Pick two different teams."; return; }

    try {
      const homeStats = uploadedLeagueData.teamStats[homeTeam];
      const awayStats = uploadedLeagueData.teamStats[awayTeam];
      const data = await api("/api/predict-manual", {
        method: "POST",
        body: JSON.stringify({
          homeAvgGoalsFor: homeStats.homeAvgGoalsFor, homeAvgGoalsAgainst: homeStats.homeAvgGoalsAgainst,
          awayAvgGoalsFor: awayStats.awayAvgGoalsFor, awayAvgGoalsAgainst: awayStats.awayAvgGoalsAgainst,
          leagueAvgHomeGoals: uploadedLeagueData.leagueAvgHomeGoals, leagueAvgAwayGoals: uploadedLeagueData.leagueAvgAwayGoals,
        }),
      });
      renderManualResult(resultEl, data);
    } catch (e) {
      errorEl.textContent = e.message;
    }
  });
}

if (getToken()) renderPredictions();
else renderLogin();

// Registers the service worker so the browser offers "Add to Home Screen" /
// install — failing silently on browsers that don't support it (older
// Safari, etc.) rather than breaking anything.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}
