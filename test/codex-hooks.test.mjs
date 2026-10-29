import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, ".codex-plugin", "plugin.json"), "utf8"));
const hooksFile = path.join(repoRoot, manifest.hooks);
const config = JSON.parse(fs.readFileSync(hooksFile, "utf8"));

test("the Codex manifest points at a hooks file with Stop and apply_patch hooks", () => {
  assert.equal(manifest.hooks, "./hooks/codex-hooks.json");
  assert.match(config.hooks.PostToolUse[0].matcher, /\bapply_patch\b/);
  assert.match(config.hooks.PostToolUse[0].matcher, /\bBash\b/);
  assert.equal(config.hooks.Stop.length, 1);

  // Codex has no args field: the script path must be part of the command string.
  for (const groups of Object.values(config.hooks)) {
    for (const hook of groups.flatMap((group) => group.hooks)) {
      assert.equal(hook.args, undefined);
      assert.match(hook.command, /^node "\$PLUGIN_ROOT\/src\/adapters\/claude\/[a-z-]+\.mjs"$/);
      const script = hook.command.match(/"\$PLUGIN_ROOT\/(.+)"/)[1];
      assert.ok(fs.existsSync(path.join(repoRoot, script)), script);
    }
  }
});

test("the Codex Stop command blocks a false test claim from a Codex payload", { skip: process.platform === "win32" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-codex-"));
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: { command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`, timeoutMs: 10000 }
  }));

  const payload = {
    session_id: "codex-session",
    transcript_path: null,
    cwd,
    hook_event_name: "Stop",
    model: "gpt-5.6-sol",
    permission_mode: "default",
    turn_id: "turn-1",
    stop_hook_active: false,
    last_assistant_message: "Created notes/hello.md. All tests pass."
  };

  const result = spawnSync("sh", ["-c", config.hooks.Stop[0].hooks[0].command], {
    cwd,
    input: JSON.stringify(payload),
    env: { ...process.env, PLUGIN_ROOT: repoRoot, CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data") },
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /Claimed tests passed/);
});
