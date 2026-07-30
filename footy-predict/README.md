# Footy Predict

Stats-based football outcome predictions (Premier League, La Liga, Serie A,
Bundesliga, Ligue 1) for you and a small group of friends. Informational
only — not betting advice, no real money involved anywhere in this app.

## Also included (from an earlier customized build)

A few things beyond the core feature set, worth knowing about:
- **Dixon-Coles adjustment** — a refinement on top of the plain Poisson
  model that corrects a known bias in low-scoring outcomes (0-0, 1-0, 0-1,
  1-1). Slightly more accurate than plain Poisson for those specific scores.
- **Recency-weighted form** — matches from the last few weeks count more
  than matches from months ago (exponential decay, ~70-day half-life), so a
  team's current form actually shows up instead of being buried in a
  season-long average.
- **Shrinkage toward the league mean** — early in a season, or for a team
  that's only played a couple of home games, their stats get pulled toward
  the league average rather than trusted at face value. A team that scored
  5 in one fluky game doesn't get treated as a "5 goals a game" team.
- **Confidence badge** ("Data: high/medium/low") on every match, based on
  how many home/away games that team has played this season — a small
  sample size means less trustworthy stats, so this flags that honestly.
- **Login rate limiting** — 8 attempts per IP per 15 minutes, to slow down
  password guessing.
- **`/api/health`** — a simple health-check endpoint, useful if you ever
  want to monitor whether the app is up.
- Favorite-outcome highlighting, a match count per league, a manual refresh
  button, and a "last updated" timestamp — small UI polish on the Leagues page.

## "Why this prediction?"

Every match card has an expandable panel showing the actual numbers behind
the prediction — each team's real scoring/conceding rate (already
recency-weighted and shrunk toward the league mean), and how many games
that's based on. The model isn't a black box — if a prediction looks
surprising, you can check exactly why it landed where it did.

## Also included: BTTS, clean sheets, and search

Every match card also shows **both teams to score (BTTS)** and **clean
sheet** probabilities — free, computed from the same Poisson grid as
everything else. There's also a **search box** on the Leagues page to jump
straight to a specific team across any league.

## Account management (closes a real gap)

Whoever's listed **first** in `FOOTY_USERS` becomes the "owner" and gets an
**Accounts** tab — add people, remove them, or reset someone's password
directly, all from inside the app. This is what actually fixes the
one-time-only `FOOTY_USERS` limitation: you don't need a redeploy to add a
friend anymore, only the very first time the app ever boots.

## Weekly digest and result check-ins (uses your existing SMS setup)

Every **Friday at 9pm EAT**, everyone with a phone on file gets a text with
that week's highest-confidence pick. Once that match actually finishes,
everyone gets a follow-up text saying whether it hit — win or lose, you'll
know. (Only tracks result and goals O/U picks for this — corners picks
aren't checked, since confirming the actual corner count would cost another
paid API call just for a text message.)

## Accuracy, one level deeper

The accuracy banner is now expandable — click it to see accuracy broken out
**by league** (the model might genuinely be better at some leagues than
others) and **by week** (so you can see if it's trending up or down over
time), not just one lifetime running total.

## Forgot password

If you forget your password, there's now a real "Forgot password?" link on
the login screen: enter your username, get a 6-digit code texted to you
(valid for 10 minutes), then set a new password. Reset requests are rate
limited (4 per 15 minutes per IP) separately from login attempts.

**Important architecture note**: accounts used to live only in the
`FOOTY_USERS` environment variable, which the app can't write back to.
Now, the first time the app ever starts, it reads `FOOTY_USERS` once and
saves those accounts into the same persistent storage used for accuracy
tracking — from then on, **`FOOTY_USERS` is ignored**, and password resets
actually stick (they wouldn't if accounts still lived only in an env var).
This means:
- `FOOTY_USERS` now needs a `phone` field per person too (see below)
- Editing `FOOTY_USERS` and redeploying does nothing after that first
  boot — but that's fine now, because the **owner can add or remove
  people directly through the app's Accounts tab** instead
- This makes the persistent volume (see below) **required now**, not just
  recommended — without it, every restart wipes all accounts back to
  whatever `FOOTY_USERS` said the very first time

## How the predictions work

A standard Poisson expected-goals model: each team's own scoring history
this season (goals scored/conceded, home and away separately) is compared
against the league average to work out an attack/defense strength, then
combined into a probability for Home Win / Draw / Away Win plus a "most
likely scoreline." It's math based on real stats — not a guarantee.

**Corners** (optional, requires a paid API-Football key — see below) use
the same Poisson math applied to each team's average corners won/conceded,
predicting the combined total against a 9.5 line (over/under).

**Goals over/under** (free — reuses the same expected-goals numbers above)
predicts the combined total against a 2.5 line.

**Highest confidence pick** scans every outcome across every match and
league and surfaces whichever single number is the strongest statistical
read that day.

**Accuracy tracking** quietly logs each match's prediction the first time
it's shown, then checks it against the real final score once that match
finishes — building an honest "the model's actually been right X% of the
time" record over weeks and months, shown as a banner once there's enough
data to be meaningful. This needs a small amount of persistent storage —
see below.

**Manual tools** (a "Manual" tab in the app) let you get predictions for
leagues or matches the free API doesn't cover:
- **Quick prediction** — type in two teams' own scoring averages directly,
  get an instant prediction. Nothing saved, nothing uploaded.
- **CSV upload** — upload a file of past results (`home_team, away_team,
  home_goals, away_goals` columns) for any league/competition, and the app
  computes the same stats the API leagues use, then lets you pick any two
  uploaded teams to predict a matchup between them. This data isn't saved
  on the server — it's held in your browser for that session only, so
  refreshing the page or uploading again starts fresh on purpose.

## What you need before deploying

1. **A free API key from football-data.org** (for match outcomes)
   - Go to https://www.football-data.org/client/register
   - Sign up (free), confirm your email, and copy your API token from your account page
   - The free tier covers the 5 leagues this app uses

2. **A persistent storage volume** (now required — for accounts and accuracy tracking)
   - In Railway: your project → Settings → Volumes → add a volume, mount it
     at e.g. `/data`
   - Set the `DATA_FILE` environment variable to `/data/store.json`
   - Without this, every restart wipes accounts back to `FOOTY_USERS`'s
     original passwords and resets the accuracy record to zero

3. **A paid API-Football key** (optional — only if you want corner predictions)
   - Sign up at https://www.api-football.com or via RapidAPI
   - The **Pro tier (~$19/month)** is the cheapest plan that includes match
     statistics (corners)
   - **Read this before enabling it**: getting corners requires a different,
     more expensive kind of API call than goals do — for each match, this
     app has to look up each team's last 10 games *and then* fetch each of
     those games' statistics separately, just to compute one average. That's
     roughly 20+ API calls per team, cached for 24 hours to keep this
     affordable. Watch your API-Football usage dashboard for the first few
     days after enabling this to make sure you're comfortably within your
     plan's request quota — if you're not, corners may need to be limited to
     fewer leagues or checked less often.
   - If you don't set this key, the app works exactly as before — every
     match just won't show a corners line, no errors, nothing breaks.

4. **A JWT secret** — any long random string, used to sign login sessions.
   You can generate one at https://randomkeygen.com (use a "CodeIgniter
   Encryption Key" or similar long one) or just mash the keyboard for 40+
   characters.

5. **A list of who's allowed to log in** — you and your friends, as a JSON
   string. **Each person now needs a phone number** too, for password resets.
   **Whoever's listed first becomes the owner** — the only one who can add
   or remove people later through the Accounts tab, so put yourself first.
   Example with two people:
   ```json
   [{"username":"alex","password":"letmein123","phone":"0722123456"},{"username":"sam","password":"anotherpass456","phone":"0733987654"}]
   ```
   Pick real passwords here — don't use the examples above. Remember: this
   is only ever read once, on the very first boot — see the "Forgot
   password" section above for what that means for adding people later.

6. **A BlessedTexts account** (for sending password reset codes via SMS)
   - If you're already using BlessedTexts for the Zion Networks app, you
     can reuse the same account and API key here — no new signup needed
   - Otherwise, sign up at BlessedTexts and grab your `api_key` and `sender_id`
   - Same setup as the Zion project: `BLESSEDTEXTS_API_KEY` and
     `BLESSEDTEXTS_SENDER_ID` — see `src/sms.js` for the exact request shape

## Environment variables to set in Railway

| Variable | Value | Required? |
|---|---|---|
| `FOOTBALL_DATA_API_KEY` | Your token from football-data.org | Yes |
| `DATA_FILE` | Path to your mounted volume, e.g. `/data/store.json` | Yes — see step 2 |
| `JWT_SECRET` | Your random string from step 4 | Yes |
| `FOOTY_USERS` | Your JSON list from step 5, with phone numbers (paste it exactly as one line) | Yes, on first boot only |
| `BLESSEDTEXTS_API_KEY` | Your BlessedTexts API key from step 6 | Yes — for password resets |
| `BLESSEDTEXTS_SENDER_ID` | Your BlessedTexts sender ID | Yes — for password resets |
| `API_FOOTBALL_KEY` | Your API-Football key | No — only for corners |

## Deploying (same GitHub + Railway workflow as your other app)

1. Create a new GitHub repository (separate from your Zion Networks repo —
   this is a completely different project)
2. Upload all these files into it, keeping the folder structure:
   - `package.json`
   - `src/index.js`, `src/auth.js`, `src/footballData.js`, `src/apiFootball.js`, `src/predict.js`, `src/stats.js`, `src/store.js`, `src/csvParse.js`, `src/sms.js`
   - `public/index.html`, `public/style.css`, `public/app.js`
   - `test/predict.test.js`, `test/footballData.test.js`, `test/stats.test.js`, `test/csvParse.test.js`, `test/auth.test.js`
3. In Railway: New Project → Deploy from GitHub repo → pick this new repo
4. Add the 3 environment variables above in Railway's Variables tab
5. Railway auto-detects it's a Node app (`npm install` then `npm start`) —
   no other configuration needed

## Testing it before you deploy

If you ever want to verify the prediction math itself hasn't broken, run:
```
npm test
```
This checks the actual scoring formulas — not the live football data — so
it works without needing your API key.

## A few honest limitations, on purpose (kept simple since it's just for friends)

- No self-service sign-up — the owner adds people through the Accounts
  tab; there's no "request an invite" flow for someone to add themselves
- If football-data.org's free tier is temporarily slow or down, that one
  league shows an error message rather than the whole page breaking
