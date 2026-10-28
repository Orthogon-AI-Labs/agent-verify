import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hook = path.join(repoRoot, "src", "adapters", "claude", "post-tool-use.mjs");

test("post-tool-use hook records a touched file as evidence", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-ptu-"));
  const dataRoot = path.join(fixture, ".plugin-data");

  await runHook({
    session_id: "ptu-write",
    cwd: fixture,
    tool_name: "Write",
    tool_input: { file_path: "src/foo.ts" }
  }, { CLAUDE_PLUGIN_DATA: dataRoot });

  const evidence = readEvidence(dataRoot, "ptu-write");
  assert.equal(evidence.touchedFiles.length, 1);
  assert.equal(evidence.touchedFiles[0].path, path.resolve(fixture, "src/foo.ts"));
  assert.equal(evidence.touchedFiles[0].tool, "Write");
});

test("post-tool-use hook records files from a Codex apply_patch", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-ptu-"));
  const dataRoot = path.join(fixture, ".plugin-data");

  await runHook({
    session_id: "ptu-codex",
    turn_id: "turn-1",
    cwd: fixture,
    tool_name: "apply_patch",
    tool_input: {
      command: [
        "*** Begin Patch",
        "*** Add File: notes/hello.md",
        "+hello",
        "*** Update File: src/app.ts",
        "*** Move to: src/main.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch"
      ].join("\n")
    }
  }, { CLAUDE_PLUGIN_DATA: dataRoot });

  const evidence = readEvidence(dataRoot, "ptu-codex");
  assert.deepEqual(
    evidence.touchedFiles.map((entry) => [path.relative(fixture, entry.path), entry.tool]),
    [["notes/hello.md", "apply_patch"], ["src/app.ts", "apply_patch"], ["src/main.ts", "apply_patch"]]
  );
});

test("post-tool-use hook records bash commands and dedupes repeated files", async () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-ptu-"));
  const dataRoot = path.join(fixture, ".plugin-data");

  await runHook({
    session_id: "ptu-multi",
    cwd: fixture,
    tool_name: "Edit",
    tool_input: { file_path: "a.ts" }
  }, { CLAUDE_PLUGIN_DATA: dataRoot });
  await runHook({
    session_id: "ptu-multi",
    cwd: fixture,
    tool_name: "Edit",
    tool_input: { file_path: "a.ts" }
  }, { CLAUDE_PLUGIN_DATA: dataRoot });
  await runHook({
    session_id: "ptu-multi",
    cwd: fixture,
    tool_name: "Bash",
    tool_input: { command: "ls -la" }
  }, { CLAUDE_PLUGIN_DATA: dataRoot });

  const evidence = readEvidence(dataRoot, "ptu-multi");
  assert.equal(evidence.touchedFiles.length, 1, "repeated edits of the same file dedupe");
  assert.equal(evidence.bashCommands.length, 1);
  assert.equal(evidence.bashCommands[0].command, "ls -la");
});

function readEvidence(dataRoot, sessionId) {
  const file = path.join(dataRoot, "sessions", `${sessionId}.json`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function runHook(payload, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], {
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`hook exited ${code}: ${stderr}`));
        return;
      }
      resolve();
    });

    child.stdin.end(JSON.stringify(payload));
  });
}
