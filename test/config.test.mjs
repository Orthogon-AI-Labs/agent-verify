import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, resolveTestCommand } from "../src/core/config.mjs";

test("loads verify.config.json", () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: {
      command: "npm run test:unit",
      timeoutMs: 1234
    },
    enabledVerifiers: ["tests"],
    reportMode: "always"
  }));

  const config = loadConfig(cwd);
  assert.equal(config.test.command, "npm run test:unit");
  assert.equal(config.test.timeoutMs, 1234);
  assert.deepEqual(config.enabledVerifiers, ["tests"]);
  assert.equal(config.reportMode, "always");
});

test("autodetects package json test command", () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    scripts: {
      test: "node test.js"
    }
  }));

  const command = resolveTestCommand(cwd);
  assert.equal(command.command, "npm test");
  assert.equal(command.source, "autodetect:package-json");
});

test("returns null when no test command can be found", () => {
  const cwd = tempDir();
  assert.equal(resolveTestCommand(cwd), null);
});

test("default config enables protected verifier with safe defaults", () => {
  const cwd = tempDir();
  const config = loadConfig(cwd);

  assert.equal(config.enabledVerifiers.includes("protected"), true);
  assert.deepEqual(config.protected.allowed, []);
  assert.deepEqual(config.protected.skipPaths, ["node_modules", "dist", "_archive"]);
  assert.equal(config.protected.checkerPath, null);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-config-"));
}
