// Accounts are seeded once from the FOOTY_USERS environment variable, then
// live in persistent storage from then on — this is what makes password
// resets actually stick, instead of reverting to the environment variable's
// password on every restart. Editing FOOTY_USERS after that first boot has
// no effect; see README for how to add/remove people later.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { getUsers, setUsers } = require("./store");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required.");

const RESET_CODE_TTL_MS = 10 * 60 * 1000;

function seedUsersIfNeeded() {
  if (getUsers() !== null) return; // already migrated — FOOTY_USERS is ignored from now on

  const raw = process.env.FOOTY_USERS;
  if (!raw) throw new Error("FOOTY_USERS environment variable is required on first boot — see README for the format.");
  const parsed = JSON.parse(raw);
  const users = parsed.map((u, i) => ({
    username: u.username,
    phone: u.phone || null,
    passwordHash: bcrypt.hashSync(u.password, 10),
    resetCode: null,
    resetCodeExpiresAt: null,
    isOwner: i === 0, // whoever's listed first can add/remove people later
  }));
  setUsers(users);
}
seedUsersIfNeeded();

function findUser(username) {
  return getUsers().find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
}

function verifyLogin(username, password) {
  const user = findUser(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password || "", user.passwordHash)) return null;
  return { username: user.username };
}

function signToken(username) {
  return jwt.sign({ username }, JWT_SECRET, { expiresIn: "30d" });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Not logged in." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Session expired — please log in again." });
  }
}

// A 6-digit numeric code, as a zero-padded string (e.g. "004821").
function generateResetCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// Starts a reset: finds the user, generates a code, stores it against their
// account with a 10-minute expiry. Returns the user's phone + the code so
// the caller can actually send it (sms.js) — this function deliberately
// doesn't send anything itself, so auth.js has no knowledge of how SMS works.
// Returns null if the username doesn't exist or has no phone on file —
// callers should show the same generic message either way, so this can't be
// used to check which usernames exist.
function startPasswordReset(username) {
  const users = getUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
  if (!user || !user.phone) return null;

  const code = generateResetCode();
  user.resetCode = code;
  user.resetCodeExpiresAt = Date.now() + RESET_CODE_TTL_MS;
  setUsers(users);
  return { phone: user.phone, code };
}

function isResetCodeValid(user, code) {
  if (!user.resetCode || !user.resetCodeExpiresAt) return false;
  if (Date.now() > user.resetCodeExpiresAt) return false;
  return user.resetCode === String(code || "").trim();
}

// Completes a reset: verifies the code (right code, not expired) and, if
// valid, sets the new password and invalidates the code so it can't be
// reused. Returns true/false rather than throwing, so the route can show a
// plain "invalid or expired code" either way without distinguishing cases.
function completePasswordReset(username, code, newPassword) {
  const users = getUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
  if (!user || !isResetCodeValid(user, code)) return false;

  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.resetCode = null;
  user.resetCodeExpiresAt = null;
  setUsers(users);
  return true;
}

function isOwner(username) {
  const user = findUser(username);
  return Boolean(user?.isOwner);
}

// Everyone except password hashes and reset codes — safe to send to the client.
function listAccounts() {
  return getUsers().map((u) => ({ username: u.username, phone: u.phone || "", isOwner: Boolean(u.isOwner) }));
}

// Owner only, enforced by the route, not here — this closes the real gap
// where FOOTY_USERS could only ever be read once: from now on, the owner
// can add people through the app itself instead of needing a redeploy.
function addAccount(username, password, phone) {
  const users = getUsers();
  if (users.some((u) => u.username.toLowerCase() === String(username || "").toLowerCase())) {
    throw new Error("That username is already taken.");
  }
  users.push({
    username, phone: phone || null,
    passwordHash: bcrypt.hashSync(password, 10),
    resetCode: null, resetCodeExpiresAt: null, isOwner: false,
  });
  setUsers(users);
}

function removeAccount(username) {
  const users = getUsers();
  const target = users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
  if (!target) throw new Error("Account not found.");
  if (target.isOwner) throw new Error("Can't remove the owner account.");
  setUsers(users.filter((u) => u !== target));
}

// Owner-initiated reset — sets a new password directly, no code/SMS needed,
// for when someone's genuinely locked out and it's easier to just help them.
function ownerResetPassword(username, newPassword) {
  const users = getUsers();
  const user = users.find((u) => u.username.toLowerCase() === String(username || "").toLowerCase());
  if (!user) throw new Error("Account not found.");
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  user.resetCode = null;
  user.resetCodeExpiresAt = null;
  setUsers(users);
}

module.exports = {
  verifyLogin, signToken, requireAuth, generateResetCode, startPasswordReset, completePasswordReset, isResetCodeValid,
  isOwner, listAccounts, addAccount, removeAccount, ownerResetPassword,
};
