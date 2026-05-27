import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const notifier = path.join(repoRoot, "scripts", "codex-notify.mjs");

test("Codex notifier reports failed claims without failing the process", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-codex-notify-"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    scripts: {
      test: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`
    }
  }));

  const result = await runNotifier([
    "--cwd",
    fixture,
    "--message",
    "I have run the tests and they all pass."
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Verify notification: not done or unverified/);
  assert.match(result.stdout, /FAILED: Claimed tests passed, but `npm test` exited 1/s);
});

test("Codex notifier stays quiet when there are no supported claims", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-codex-notify-"));
  const result = await runNotifier([
    "--cwd",
    fixture,
    "--message",
    "I inspected the repository."
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /no supported completion claims detected/);
});

function runNotifier(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [notifier, ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
