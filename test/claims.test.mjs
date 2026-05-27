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

test("does not detect negated test pass claims", () => {
  const claims = detectClaims("The tests did not pass.");
  assert.equal(claims.some((claim) => claim.type === "tests"), false);
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
