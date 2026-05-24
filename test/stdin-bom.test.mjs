import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stopHook = path.join(repoRoot, "src", "adapters", "claude", "stop.mjs");

test("stop hook strips leading UTF-8 BOM from stdin payload", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-bom-"));
  fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({
    scripts: { test: `${JSON.stringify(process.execPath)} -e "process.exit(1)"` }
  }));

  const payload = JSON.stringify({
    cwd: fixture,
    session_id: "bom-test",
    stop_hook_active: false,
    last_assistant_message: "All tests passed."
  });

  const stdout = await runHook(stopHook, "﻿" + payload, {
    CLAUDE_PLUGIN_DATA: path.join(fixture, ".plugin-data")
  });

  const decoded = JSON.parse(stdout);
  assert.equal(decoded.decision, "block");
  assert.match(decoded.reason, /npm test.*exited 1/s);
});

function runHook(entry, stdinPayload, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`hook exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(Buffer.from(stdinPayload, "utf8"));
  });
}
