// Live-score sites (SofaScore-style) render their stats comparison as
// repeating triples when you select and copy the text: a home value, the
// stat's label, then the away value. This parser walks the pasted text
// looking for KNOWN labels (not just "every 3 lines", which would be
// fragile against stray blank lines or extra content) and pulls the value
// immediately before and after each recognized label.
//
// Only xG actually feeds the half-time projection math — everything else
// recognized here is just useful context to show alongside it, the same
// way a human would read shots/possession/corners together.

const KNOWN_STATS = [
  { key: "xG", pattern: /^expected goals/i },
  { key: "possession", pattern: /^ball possession/i },
  { key: "totalShots", pattern: /^total shots/i },
  { key: "shotsOnTarget", pattern: /^shots on target/i },
  { key: "corners", pattern: /^corner kicks/i },
  { key: "throwIns", pattern: /^throw.?ins?/i },
  { key: "bigChances", pattern: /^big chances/i },
  { key: "fouls", pattern: /^fouls/i },
];

// Strips a trailing "%" or "(123/456)" so "62%" → 62 and "86%(310/359)" → 86.
// The projection only needs the headline number, not the raw fraction.
function parseNumericValue(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/%/g, "").replace(/\(.*?\)/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

// Returns { xG: {home, away}, possession: {home, away}, ... } — only keys
// actually found in the pasted text are included, so a caller can check
// `if (result.xG)` before relying on it existing.
function parseHalfTimeStats(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const result = {};

  lines.forEach((line, i) => {
    const stat = KNOWN_STATS.find((s) => s.pattern.test(line));
    if (!stat || result[stat.key]) return; // first match wins if a label somehow repeats
    const homeRaw = lines[i - 1];
    const awayRaw = lines[i + 1];
    const home = parseNumericValue(homeRaw);
    const away = parseNumericValue(awayRaw);
    if (home !== null && away !== null) result[stat.key] = { home, away };
  });

  return result;
}

module.exports = { parseHalfTimeStats, parseNumericValue, KNOWN_STATS };
