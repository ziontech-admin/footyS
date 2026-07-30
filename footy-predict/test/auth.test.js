const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

// auth.js reads its config and seeds its user store the moment it's
// require()'d, so the environment has to be set up first — including
// pointing DATA_FILE at a throwaway test file, never the real one.
const TEST_DATA_FILE = path.join(__dirname, ".auth-test-store.json");
process.env.DATA_FILE = TEST_DATA_FILE;
process.env.JWT_SECRET = "test-secret-not-for-real-use";
process.env.FOOTY_USERS = JSON.stringify([
  { username: "alex", password: "correcthorse1", phone: "0722123456" },
  { username: "nophone", password: "somepassword1" }, // deliberately no phone
]);

describe("auth (password reset flow)", () => {
  before(() => { if (fs.existsSync(TEST_DATA_FILE)) fs.unlinkSync(TEST_DATA_FILE); });
  after(() => { if (fs.existsSync(TEST_DATA_FILE)) fs.unlinkSync(TEST_DATA_FILE); });

  const auth = require("../src/auth");

  test("generateResetCode always returns a 6-digit zero-padded string", () => {
    for (let i = 0; i < 20; i++) {
      const code = auth.generateResetCode();
      assert.equal(code.length, 6);
      assert.match(code, /^\d{6}$/);
    }
  });

  test("verifyLogin works against the seeded FOOTY_USERS accounts", () => {
    assert.deepEqual(auth.verifyLogin("alex", "correcthorse1"), { username: "alex" });
    assert.equal(auth.verifyLogin("alex", "wrongpassword"), null);
    assert.equal(auth.verifyLogin("nobody", "whatever"), null);
  });

  test("startPasswordReset returns null for a user with no phone on file", () => {
    const result = auth.startPasswordReset("nophone");
    assert.equal(result, null);
  });

  test("startPasswordReset returns null for an unknown username", () => {
    const result = auth.startPasswordReset("ghost");
    assert.equal(result, null);
  });

  test("a full reset cycle: start, then complete with the right code changes the password", () => {
    const started = auth.startPasswordReset("alex");
    assert.equal(started.phone, "0722123456");
    assert.match(started.code, /^\d{6}$/);

    const completed = auth.completePasswordReset("alex", started.code, "brandNewPassword1");
    assert.equal(completed, true);

    // Old password no longer works, new one does.
    assert.equal(auth.verifyLogin("alex", "correcthorse1"), null);
    assert.deepEqual(auth.verifyLogin("alex", "brandNewPassword1"), { username: "alex" });
  });

  test("completePasswordReset fails with the wrong code", () => {
    auth.startPasswordReset("alex");
    const result = auth.completePasswordReset("alex", "000000", "someOtherPassword1");
    assert.equal(result, false);
  });

  test("a reset code can't be reused after it's already been used once", () => {
    const started = auth.startPasswordReset("alex");
    const firstUse = auth.completePasswordReset("alex", started.code, "firstNewPassword1");
    assert.equal(firstUse, true);

    const secondUse = auth.completePasswordReset("alex", started.code, "secondNewPassword1");
    assert.equal(secondUse, false);
  });
});

describe("auth (account management)", () => {
  const auth = require("../src/auth");

  test("the first user listed in FOOTY_USERS is the owner, others are not", () => {
    assert.equal(auth.isOwner("alex"), true);
    assert.equal(auth.isOwner("nophone"), false);
  });

  test("listAccounts never exposes password hashes or reset codes", () => {
    const accounts = auth.listAccounts();
    accounts.forEach((a) => {
      assert.equal(a.passwordHash, undefined);
      assert.equal(a.resetCode, undefined);
    });
  });

  test("addAccount creates a working, non-owner account", () => {
    auth.addAccount("newfriend", "somePassword1", "0700000000");
    assert.deepEqual(auth.verifyLogin("newfriend", "somePassword1"), { username: "newfriend" });
    assert.equal(auth.isOwner("newfriend"), false);
  });

  test("addAccount rejects a duplicate username", () => {
    assert.throws(() => auth.addAccount("alex", "whatever123", "0711111111"));
  });

  test("removeAccount deletes a non-owner account", () => {
    auth.addAccount("temporary", "tempPassword1", null);
    auth.removeAccount("temporary");
    assert.equal(auth.verifyLogin("temporary", "tempPassword1"), null);
  });

  test("removeAccount refuses to delete the owner", () => {
    assert.throws(() => auth.removeAccount("alex"));
  });

  test("removeAccount throws for an account that doesn't exist", () => {
    assert.throws(() => auth.removeAccount("ghost"));
  });

  test("ownerResetPassword sets a new password directly, no code required", () => {
    auth.ownerResetPassword("nophone", "aBrandNewPassword1");
    assert.deepEqual(auth.verifyLogin("nophone", "aBrandNewPassword1"), { username: "nophone" });
  });
});
