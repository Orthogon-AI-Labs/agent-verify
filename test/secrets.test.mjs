import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
import { detectClaims } from "../src/core/claims.mjs";
import { verifyFinalMessage } from "../src/core/verify.mjs";
import { verifySecretsClaim } from "../src/core/verifiers/secrets.mjs";
import { runBinary } from "../src/core/command.mjs";
import { emptyEvidence } from "../src/core/evidence.mjs";

// Fake credential values assembled at runtime so no real-looking secret is
// committed to this repo, while still matching SECRET_PATTERNS.
const FAKE_AWS_KEY = "AKIA" + "ABCDEFGH12345678";
const FAKE_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----";
const FAKE_JWT = "eyJ" + "hbGciOiJIUzI1Ni" + "." + "eyJzdWIiOiIxMjM0NTY" + "." + "SflKxwRJSMeKKF2QTm";

const claim = { type: "secrets", text: "no secrets were committed", push: false };

test("detects secret-cleanliness claims and skips hedges/declared values", () => {
  const hasSecrets = (text) => detectClaims(text).some((item) => item.type === "secrets");
  assert.equal(hasSecrets("No secrets were committed."), true);
  assert.equal(hasSecrets("It is safe to push."), true);
  assert.equal(hasSecrets("I think there are no secrets."), false);
  assert.equal(hasSecrets("That should be safe to push."), false);
});

test("a tests-pass claim does not trigger the secrets verifier", () => {
  assert.equal(detectClaims("All tests pass.").some((item) => item.type === "secrets"), false);
});

test("secrets verifier passes on a clean staged diff", async () => {
  const cwd = await createRepo();
  await stage(cwd, "src/app.ts", "export const value = 42;\n");
  const result = await verifySecretsClaim({ cwd, claim, config: loadConfig(cwd) });
  assert.equal(result.status, "pass");
});

test("secrets verifier fails on a staged AWS key and never prints the value", async () => {
  const cwd = await createRepo();
  await stage(cwd, "src/config/dev.ts", `export const key = "${FAKE_AWS_KEY}";\n`);

  const verification = await verifyFinalMessage({
    cwd,
    session_id: "secrets-aws",
    last_assistant_message: "It is safe to push."
  }, { evidence: emptyEvidence("secrets-aws", cwd) });

  const result = verification.results.find((item) => item.verifier === "secrets");
  assert.equal(result.status, "fail");
  assert.equal(verification.shouldBlock, true);
  assert.deepEqual(result.hits, [{ file: "src/config/dev.ts", line: 1, pattern: "aws-access-key-id" }]);
  // criterion 2: the matched value must never appear in any output surface.
  assert.equal(JSON.stringify(result).includes(FAKE_AWS_KEY), false);
});

test("secrets verifier passes when the only hit is in a skipPaths glob", async () => {
  const cwd = await createRepo();
  await stage(cwd, "config.example", `KEY=${FAKE_AWS_KEY}\n`);
  const result = await verifySecretsClaim({ cwd, claim, config: loadConfig(cwd) });
  assert.equal(result.status, "pass");
});

test("secrets verifier fails on a private key block", async () => {
  const cwd = await createRepo();
  await stage(cwd, "deploy/key.pem", `${FAKE_PRIVATE_KEY}\nMIIB_fake_body\n`);
  const result = await verifySecretsClaim({ cwd, claim, config: loadConfig(cwd) });
  assert.equal(result.status, "fail");
  assert.equal(result.hits[0].pattern, "private-key-block");
});

test("secrets verifier fails on a JWT", async () => {
  const cwd = await createRepo();
  await stage(cwd, "src/token.ts", `const t = "${FAKE_JWT}";\n`);
  const result = await verifySecretsClaim({ cwd, claim, config: loadConfig(cwd) });
  assert.equal(result.status, "fail");
  assert.equal(result.hits[0].pattern, "jwt");
});

test("secrets verifier is inconclusive for a push claim with no upstream", async () => {
  const cwd = await createRepo();
  await stage(cwd, "README.md", "a clean documentation change\n");
  const result = await verifySecretsClaim({
    cwd,
    claim: { type: "secrets", text: "safe to push", push: true },
    config: loadConfig(cwd)
  });
  assert.equal(result.status, "inconclusive");
});

test("secrets verifier is inconclusive outside a git repository", async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-secrets-nogit-"));
  const result = await verifySecretsClaim({ cwd, claim, config: loadConfig(cwd) });
  assert.equal(result.status, "inconclusive");
});

async function createRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-secrets-"));
  await runBinary("git", ["init"], { cwd });
  await runBinary("git", ["config", "user.email", "verify@example.com"], { cwd });
  await runBinary("git", ["config", "user.name", "Verify Test"], { cwd });
  fs.writeFileSync(path.join(cwd, ".gitkeep"), "");
  await runBinary("git", ["add", "."], { cwd });
  await runBinary("git", ["commit", "-m", "init"], { cwd });
  return cwd;
}

async function stage(cwd, relPath, content) {
  const full = path.join(cwd, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  await runBinary("git", ["add", relPath], { cwd });
}
