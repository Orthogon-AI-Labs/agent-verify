import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeReceipt, readLastReceipt } from "../src/core/receipt.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "src", "cli.mjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-receipt-"));
}

function mixedVerification(cwd, config, { blocked = true } = {}) {
  return {
    cwd,
    config,
    shouldBlock: blocked,
    claims: [
      { type: "tests", text: "all tests pass" },
      { type: "secrets", text: "no secrets committed" },
      { type: "git", text: "pushed the branch" }
    ],
    results: [
      { verifier: "tests", status: "fail", summary: "`npm test` exited 1.", command: "npm test", exitCode: 1 },
      { verifier: "secrets", status: "pass", summary: "No credential patterns in the diff." },
      { verifier: "git", status: "inconclusive", summary: "No upstream; could not confirm push." }
    ]
  };
}

const configWith = (receipt) => ({ receipt: { history: false, path: ".verify", ...receipt } });

test("writes a schema-shaped receipt with inconclusive preserved and correct counts", async () => {
  const cwd = tempDir();
  const receipt = await writeReceipt(mixedVerification(cwd, configWith()), { cwd, config: configWith() });

  assert.equal(receipt.schema, "orthogon.verify.receipt/1");
  assert.equal(receipt.claims.length, 3);
  const statuses = receipt.claims.map((claim) => claim.status).sort();
  assert.deepEqual(statuses, ["fail", "inconclusive", "pass"]);
  assert.deepEqual(receipt.outcome, { blocked: true, fail: 1, pass: 1, inconclusive: 1 });

  const onDisk = readLastReceipt(cwd, configWith());
  assert.deepEqual(onDisk.outcome, receipt.outcome);
});

test("never writes a secret value into the receipt, even on a secrets failure", async () => {
  const cwd = tempDir();
  const fakeValue = "AKIA" + "SECRETVALUE12345";
  const verification = {
    cwd,
    config: configWith(),
    shouldBlock: true,
    claims: [{ type: "secrets", text: "no secrets committed" }],
    results: [{
      verifier: "secrets",
      status: "fail",
      summary: "Possible secret in diff.",
      hits: [{ file: "src/a.ts", line: 1, pattern: "aws-access-key-id" }],
      details: `src/a.ts:1 ${fakeValue}`
    }]
  };

  await writeReceipt(verification, { cwd, config: configWith() });

  const serialized = fs.readFileSync(path.join(cwd, ".verify", "last-receipt.json"), "utf8");
  assert.equal(serialized.includes(fakeValue), false);
  // the safe locator should still be present
  assert.equal(serialized.includes("aws-access-key-id"), true);
});

test("history:true appends one line per run; history:false writes no history file", async () => {
  const onDir = tempDir();
  await writeReceipt(mixedVerification(onDir, configWith({ history: true })), { cwd: onDir, config: configWith({ history: true }) });
  await writeReceipt(mixedVerification(onDir, configWith({ history: true })), { cwd: onDir, config: configWith({ history: true }) });
  const history = fs.readFileSync(path.join(onDir, ".verify", "history.jsonl"), "utf8")
    .split(/\r?\n/)
    .filter(Boolean);
  assert.equal(history.length, 2);

  const offDir = tempDir();
  await writeReceipt(mixedVerification(offDir, configWith()), { cwd: offDir, config: configWith() });
  assert.equal(fs.existsSync(path.join(offDir, ".verify", "history.jsonl")), false);
});

test("adds .verify/ to .gitignore once and does not duplicate it", async () => {
  const cwd = tempDir();
  await writeReceipt(mixedVerification(cwd, configWith()), { cwd, config: configWith() });
  await writeReceipt(mixedVerification(cwd, configWith()), { cwd, config: configWith() });

  const gitignore = fs.readFileSync(path.join(cwd, ".gitignore"), "utf8");
  const occurrences = gitignore.split(/\r?\n/).filter((line) => line.trim() === ".verify/").length;
  assert.equal(occurrences, 1);
});

test("verify receipt --print exits non-zero iff the last run blocked", async () => {
  const blockedDir = tempDir();
  await writeReceipt(mixedVerification(blockedDir, configWith(), { blocked: true }), { cwd: blockedDir, config: configWith() });
  const blocked = await runCli(["receipt", "--print", "--cwd", blockedDir]);
  assert.equal(blocked.exitCode, 1);
  assert.match(blocked.stdout, /orthogon\.verify\.receipt\/1/);

  const cleanDir = tempDir();
  const cleanVerification = {
    cwd: cleanDir,
    config: configWith(),
    shouldBlock: false,
    claims: [{ type: "tests", text: "all tests pass" }],
    results: [{ verifier: "tests", status: "pass", summary: "`npm test` exited 0.", command: "npm test", exitCode: 0 }]
  };
  await writeReceipt(cleanVerification, { cwd: cleanDir, config: configWith() });
  const clean = await runCli(["receipt", "--print", "--cwd", cleanDir]);
  assert.equal(clean.exitCode, 0);
});

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}
