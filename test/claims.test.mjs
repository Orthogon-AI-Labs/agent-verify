import test from "node:test";
import assert from "node:assert/strict";
import { detectClaims } from "../src/core/claims.mjs";

test("detects test pass claims once", () => {
  const claims = detectClaims("All tests passed. The test suite passes.");
  assert.equal(claims.filter((claim) => claim.type === "tests").length, 1);
});

test("detects backticked file change claims", () => {
  const claims = detectClaims("I updated `src/foo.ts`, created 'README.md', and `src/bar.ts` was changed.");
  assert.deepEqual(
    claims.filter((claim) => claim.type === "file").map((claim) => claim.path),
    ["src/foo.ts", "README.md", "src/bar.ts"]
  );
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
