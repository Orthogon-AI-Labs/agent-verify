import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8"));
const manifest = readJson("qwen-extension.json");
const config = readJson(manifest.hooks);

// Qwen Code replaces ${CLAUDE_PLUGIN_ROOT} in each hook command when it loads the extension.
const commandFor = (event) => config.hooks[event][0].hooks[0].command.replaceAll("${CLAUDE_PLUGIN_ROOT}", repoRoot);

test("every manifest carries the package version", () => {
  const { version } = readJson("package.json");
  for (const file of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "qwen-extension.json"]) {
    assert.equal(readJson(file).version, version, file);
  }
});

test("the Qwen Code manifest points at a hooks file with Stop and file-edit hooks", () => {
  assert.equal(manifest.name, "agent-verify");
  assert.equal(manifest.hooks, "./hooks/qwen-hooks.json");
  for (const tool of ["run_shell_command", "write_file", "edit"]) {
    assert.match(config.hooks.PostToolUse[0].matcher, new RegExp(`\\b${tool}\\b`));
  }
  assert.equal(config.hooks.Stop.length, 1);

  // Qwen Code has no args field: the script path must be part of the command string.
  for (const groups of Object.values(config.hooks)) {
    for (const hook of groups.flatMap((group) => group.hooks)) {
      assert.equal(hook.args, undefined);
      assert.match(hook.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/src\/adapters\/claude\/[a-z-]+\.mjs"$/);
      const script = hook.command.match(/"\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)"/)[1];
      assert.ok(fs.existsSync(path.join(repoRoot, script)), script);
    }
  }
});

test("the Qwen Code hooks record a write_file edit and block a false test claim", { skip: process.platform === "win32" }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-qwen-"));
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: { command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`, timeoutMs: 10000 }
  }));
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: path.join(cwd, ".plugin-data") };
  const common = { session_id: "qwen-session", transcript_path: null, cwd, timestamp: new Date().toISOString() };

  const notes = path.join(cwd, "notes.md");
  fs.writeFileSync(notes, "hello\n");
  const post = spawnSync("sh", ["-c", commandFor("PostToolUse")], {
    cwd,
    env,
    encoding: "utf8",
    input: JSON.stringify({ ...common, hook_event_name: "PostToolUse", tool_name: "write_file", tool_input: { file_path: notes, content: "hello\n" } })
  });
  assert.equal(post.status, 0, post.stderr);
  const evidence = JSON.parse(fs.readFileSync(path.join(env.CLAUDE_PLUGIN_DATA, "sessions", "qwen-session.json"), "utf8"));
  assert.deepEqual(evidence.touchedFiles.map((entry) => [entry.path, entry.tool]), [[notes, "write_file"]]);

  const stop = spawnSync("sh", ["-c", commandFor("Stop")], {
    cwd,
    env,
    encoding: "utf8",
    input: JSON.stringify({ ...common, hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Updated `notes.md`. All tests pass." })
  });
  assert.equal(stop.status, 0, stop.stderr);
  const output = JSON.parse(stop.stdout);
  assert.equal(output.decision, "block");
  assert.match(output.reason, /Claimed tests passed/);
});
