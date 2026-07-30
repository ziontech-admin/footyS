// Minimal file-based persistence — remembers logged predictions across
// restarts (for accuracy tracking) and, now, user accounts too — needed so
// a password reset actually sticks instead of reverting to the
// environment-variable password on every restart.
//
// Needs a Railway persistent volume (or any writable disk path) mounted at
// DATA_FILE's directory — see README.

const fs = require("fs");
const path = require("path");

const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "..", "data", "store.json");

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ predictionLog: [], users: null, pendingPickNotifications: [], lastWeeklyDigestWeek: null }, null, 2));
  }
}

function readStore() {
  ensureFile();
  const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  if (data.predictionLog === undefined) data.predictionLog = [];
  if (data.users === undefined) data.users = null;
  if (data.pendingPickNotifications === undefined) data.pendingPickNotifications = [];
  if (data.lastWeeklyDigestWeek === undefined) data.lastWeeklyDigestWeek = null;
  return data;
}

function writeStore(data) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function getPredictionLog() {
  return readStore().predictionLog;
}

function setPredictionLog(log) {
  const data = readStore();
  data.predictionLog = log;
  writeStore(data);
}

// User accounts, once migrated from FOOTY_USERS into the store (see auth.js)
// — returns null if that migration hasn't happened yet, so auth.js knows
// to seed from the environment variable exactly once.
function getUsers() {
  return readStore().users;
}

function setUsers(users) {
  const data = readStore();
  data.users = users;
  writeStore(data);
}

// Pick-of-the-day matches waiting on a real result, so a check-in text can
// go out once they finish (see the weekly digest / result check-in logic
// in index.js). Each entry only ever gets one notification, ever.
function getPendingPickNotifications() {
  return readStore().pendingPickNotifications;
}

function setPendingPickNotifications(list) {
  const data = readStore();
  data.pendingPickNotifications = list;
  writeStore(data);
}

// Which week (as a "YYYY-MM-DD" Monday, see stats.js startOfWeekUtc) the
// Friday digest was last sent for — prevents sending it twice in the same
// week if the server restarts.
function getLastWeeklyDigestWeek() {
  return readStore().lastWeeklyDigestWeek;
}

function setLastWeeklyDigestWeek(week) {
  const data = readStore();
  data.lastWeeklyDigestWeek = week;
  writeStore(data);
}

module.exports = {
  getPredictionLog, setPredictionLog, getUsers, setUsers,
  getPendingPickNotifications, setPendingPickNotifications,
  getLastWeeklyDigestWeek, setLastWeeklyDigestWeek,
};
