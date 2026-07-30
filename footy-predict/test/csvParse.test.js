const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { parseMatchesCsv, teamNamesIn } = require("../src/csvParse");

describe("parseMatchesCsv", () => {
  test("parses a valid CSV into match objects matching the API shape", () => {
    const csv = "home_team,away_team,home_goals,away_goals\nArsenal,Chelsea,2,1\nChelsea,Liverpool,0,3";
    const matches = parseMatchesCsv(csv);
    assert.equal(matches.length, 2);
    assert.equal(matches[0].homeTeam.name, "Arsenal");
    assert.equal(matches[0].score.fullTime.home, 2);
    assert.equal(matches[1].awayTeam.name, "Liverpool");
  });

  test("header columns can be in any order", () => {
    const csv = "away_goals,home_team,home_goals,away_team\n1,Arsenal,2,Chelsea";
    const matches = parseMatchesCsv(csv);
    assert.equal(matches[0].homeTeam.name, "Arsenal");
    assert.equal(matches[0].score.fullTime.home, 2);
    assert.equal(matches[0].score.fullTime.away, 1);
  });

  test("header matching is case-insensitive", () => {
    const csv = "Home_Team,Away_Team,Home_Goals,Away_Goals\nArsenal,Chelsea,2,1";
    const matches = parseMatchesCsv(csv);
    assert.equal(matches.length, 1);
  });

  test("skips blank lines", () => {
    const csv = "home_team,away_team,home_goals,away_goals\nArsenal,Chelsea,2,1\n\n\nChelsea,Liverpool,0,3\n";
    const matches = parseMatchesCsv(csv);
    assert.equal(matches.length, 2);
  });

  test("throws a clear error for a missing required column", () => {
    const csv = "home_team,away_team,home_goals\nArsenal,Chelsea,2";
    assert.throws(() => parseMatchesCsv(csv), /away_goals/);
  });

  test("throws a clear error naming the row number for non-numeric goals", () => {
    const csv = "home_team,away_team,home_goals,away_goals\nArsenal,Chelsea,two,1";
    assert.throws(() => parseMatchesCsv(csv), /Row 2/);
  });

  test("throws for negative goals", () => {
    const csv = "home_team,away_team,home_goals,away_goals\nArsenal,Chelsea,-1,1";
    assert.throws(() => parseMatchesCsv(csv), /negative/);
  });

  test("throws if there's no data at all, just a header", () => {
    const csv = "home_team,away_team,home_goals,away_goals";
    assert.throws(() => parseMatchesCsv(csv), /at least one match row/);
  });
});

describe("teamNamesIn", () => {
  test("returns every distinct team name, alphabetically, no duplicates", () => {
    const matches = [
      { homeTeam: { name: "Chelsea" }, awayTeam: { name: "Arsenal" } },
      { homeTeam: { name: "Arsenal" }, awayTeam: { name: "Liverpool" } },
    ];
    assert.deepEqual(teamNamesIn(matches), ["Arsenal", "Chelsea", "Liverpool"]);
  });
});
