import test from "node:test";
import assert from "node:assert/strict";
import { detectClaims } from "../src/core/claims.mjs";

test("detects test pass claims once", () => {
  const claims = detectClaims("All tests passed. The test suite passes.");
  assert.equal(claims.filter((claim) => claim.type === "tests").length, 1);
});

test("detects natural-language test pass claims with bounded intervening words", () => {
  const claims = detectClaims("I have run the tests and they all pass.");
  assert.equal(claims.filter((claim) => claim.type === "tests").length, 1);
});

test("detects 'passing' and 'which now passes' test claims", () => {
  const testClaims = (message) => detectClaims(message).filter((claim) => claim.type === "tests").length;
  assert.equal(testClaims("All tests are now passing."), 1);
  assert.equal(testClaims("The repository is clean, with all tests passing."), 1);
  assert.equal(testClaims("Verified the fix by running the test which now passes."), 1);
  assert.equal(testClaims("The tests are not passing yet."), 0);
  assert.equal(testClaims("| Package | Tests passing |\n|---|---|\n| schemas | 613 |"), 0);
  assert.equal(testClaims("That deploy waits on main's tests passing."), 0);
  assert.equal(testClaims("I'll merge once the tests pass."), 0);
  assert.equal(testClaims("Ran it on CI and all tests pass."), 1);
});

test("does not detect negated test pass claims", () => {
  const claims = detectClaims("The tests did not pass.");
  assert.equal(claims.some((claim) => claim.type === "tests"), false);
});

test("does not read a pass claim in a reply that says the tests fail", () => {
  const testClaims = (message) => detectClaims(message).filter((claim) => claim.type === "tests").length;
  assert.equal(testClaims("`npm test` still fails: 1 test passes and 1 fails."), 0);
  assert.equal(testClaims("The slugify test in packages/a passes now, but the full `npm test` run still fails because of packages/b."), 0);
  assert.equal(testClaims("Fixed the bug. The unit tests pass; the integration test is still failing because rasterkit isn't installed."), 0);
  assert.equal(testClaims("The `sum adds` test now passes. The integration test failure is due to a missing `rasterkit` command."), 0);
  assert.equal(testClaims("The flaky test failure is fixed, and all tests pass."), 1);
  assert.equal(testClaims("Each fix has a test that fails when the fix is removed. All tests pass."), 1);
  assert.equal(testClaims("The flaky test no longer fails, and all tests pass."), 1);
  assert.equal(testClaims("All tests pass, 0 failures."), 1);
  assert.equal(testClaims("The slugify test failed before. I fixed it and all tests pass now."), 1);
});

test("detects backticked file change claims", () => {
  const claims = detectClaims("I updated `src/foo.ts`, created 'README.md', and `src/bar.ts` was changed.");
  assert.deepEqual(
    claims.filter((claim) => claim.type === "file").map((claim) => claim.path),
    ["src/foo.ts", "README.md", "src/bar.ts"]
  );
});

test("detects bare file paths only when they look path-like", () => {
  const claims = detectClaims("I updated src/never-created.ts and changed docs/readme.md.");
  assert.deepEqual(
    claims.filter((claim) => claim.type === "file").map((claim) => claim.path),
    ["src/never-created.ts", "docs/readme.md"]
  );
});

test("does not detect ordinary bare nouns as file paths", () => {
  const claims = detectClaims("I updated the docs and changed the implementation.");
  assert.equal(claims.some((claim) => claim.type === "file"), false);
});

test("detects git claims", () => {
  const claims = detectClaims("I committed the fix, pushed the branch, and opened a PR.");
  assert.deepEqual(
    claims.filter((claim) => claim.type === "git").map((claim) => claim.action),
    ["committed", "pushed", "opened-pr"]
  );
});

test("ignores nearby negated git claims", () => {
  const claims = detectClaims("I did not push the branch.");
  assert.equal(claims.some((claim) => claim.type === "git"), false);
});

test("does not treat the dedication sense of 'committed' as a git claim", () => {
  const committed = (text) =>
    detectClaims(text).some((claim) => claim.type === "git" && claim.action === "committed");

  assert.equal(committed("I am committed to clean code."), false);
  assert.equal(committed("We stay committed to quality and excellence."), false);
  assert.equal(committed("I committed the changes."), true);
  assert.equal(committed("I committed to main."), true);
});

test("ignores push mentions that say nothing was pushed", () => {
  const pushed = (text) =>
    detectClaims(text).some((claim) => claim.type === "git" && claim.action === "pushed");

  assert.equal(pushed("Committed locally; nothing is pushed."), false);
  assert.equal(pushed("Nothing is committed, pushed or deployed."), false);
  assert.equal(pushed("Nothing has been committed or pushed."), false);
  assert.equal(pushed("Nothing is committed, staged or pushed."), false);
  assert.equal(pushed("None of it is pushed yet."), false);
  assert.equal(pushed("It isn’t pushed yet."), false);
  assert.equal(pushed("I pushed nothing and touched no database."), false);
  assert.equal(pushed("The branch has to be pushed first."), false);
  assert.equal(pushed("Done. I pushed the branch."), true);
  assert.equal(pushed("Both are fixed and pushed; nothing is merged."), true);
});

test("a negation in an earlier sentence or clause doesn't cancel a claim", () => {
  const has = (text, type) => detectClaims(text).some((claim) => claim.type === type);

  assert.equal(has("Nothing else changed. I pushed the branch.", "git"), true);
  assert.equal(has("The old build did not run. All 12 tests pass.", "tests"), true);
  assert.equal(has("I checked that nothing uses them, and its tests pass.", "tests"), true);
});

test("counts quoted text as a file only when it looks like a file path", () => {
  const files = (text) =>
    detectClaims(text).filter((claim) => claim.type === "file").map((claim) => claim.path);

  assert.deepEqual(files('It wrote "Relevant tests pass" on Sep 9.'), []);
  assert.deepEqual(files("I added `deal_id` and changed `sendSupplement`."), []);
  assert.deepEqual(files("Added `MAX_RETRIES=5` and `listApplicants()`."), []);
  assert.deepEqual(files("I added `*.tsbuildinfo` to the ignore list."), []);
  assert.deepEqual(files("I updated `backend/src/app/`."), []);
  assert.deepEqual(files("I updated `user.role`."), []);
  assert.deepEqual(files("I updated `config.yaml`, created `Makefile` and changed `.gitignore`."), [
    "config.yaml",
    "Makefile",
    ".gitignore"
  ]);
  assert.deepEqual(files("I created `apps/desk/src/app/c/[token]/page.tsx`."), ["apps/desk/src/app/c/[token]/page.tsx"]);
});
