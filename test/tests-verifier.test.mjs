import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig, resolveTestCommand } from "../src/core/config.mjs";
import { verifyTestsClaim } from "../src/core/verifiers/tests.mjs";

test("test verifier fails on non-zero test command", async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: {
      command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`,
      timeoutMs: 10000
    }
  }));

  const result = await verifyTestsClaim({
    cwd,
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "fail");
  assert.match(result.summary, /exited 1/);
});

test("test verifier passes on zero test command", async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: {
      command: `${JSON.stringify(process.execPath)} -e "process.exit(0)"`,
      timeoutMs: 10000
    }
  }));

  const result = await verifyTestsClaim({
    cwd,
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "pass");
});

test("test verifier passes with autodetected npm test script", async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    scripts: {
      test: "node -e \"process.exit(0)\""
    }
  }));

  const result = await verifyTestsClaim({
    cwd,
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "pass");
});

test("a test command whose program is not installed is inconclusive, not a failure", async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({ test: { command: "agent-verify-no-such-program --run", timeoutMs: 10000 } }));
  const result = await verifyTestsClaim({ cwd, config: loadConfig(cwd) });
  assert.equal(result.status, "inconclusive");
  assert.match(result.summary, /`agent-verify-no-such-program` is not installed/);
});

test("exit 127 from inside an installed test command is still a failure", { skip: process.platform === "win32" }, async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({ test: { command: "sh -c 'exit 127'", timeoutMs: 10000 } }));
  const result = await verifyTestsClaim({ cwd, config: loadConfig(cwd) });
  assert.equal(result.status, "fail");
});

test("pytest projects run with the virtualenv's Python, else python3", { skip: process.platform === "win32" }, () => {
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, "tests"));
  const bin = tempDir();
  const savedPath = process.env.PATH;
  try {
    process.env.PATH = bin;
    assert.equal(resolveTestCommand(cwd).command, "python -m pytest -q");
    fs.writeFileSync(path.join(bin, "python3"), "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(resolveTestCommand(cwd).command, "python3 -m pytest -q");
    fs.mkdirSync(path.join(cwd, ".venv", "bin"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".venv", "bin", "python"), "#!/bin/sh\n", { mode: 0o755 });
    assert.equal(resolveTestCommand(cwd).command, ".venv/bin/python -m pytest -q");
  } finally {
    process.env.PATH = savedPath;
  }
});

const hasPytest = process.platform !== "win32" && spawnSync("python3", ["-m", "pytest", "--version"]).status === 0;
test("a passing pytest suite passes with no config", { skip: !hasPytest && "python3 -m pytest is not available" }, async () => {
  const cwd = tempDir();
  fs.mkdirSync(path.join(cwd, "tests"));
  fs.writeFileSync(path.join(cwd, "tests", "test_ok.py"), "def test_ok():\n    assert 1 + 1 == 2\n");
  const result = await verifyTestsClaim({ cwd, config: loadConfig(cwd) });
  assert.equal(result.status, "pass", result.details);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-tests-"));
}
