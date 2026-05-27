import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/core/config.mjs";
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

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-tests-"));
}
