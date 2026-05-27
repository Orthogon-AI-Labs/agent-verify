import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyEvidence, loadSessionEvidence, saveSessionEvidence } from "../src/core/evidence.mjs";
import { loadConfig, resolveTestCommand } from "../src/core/config.mjs";
import { verifyTestsClaim } from "../src/core/verifiers/tests.mjs";

test("config loader strips UTF-8 BOM from verify.config.json", () => {
  const cwd = tempDir();
  writeBomJson(path.join(cwd, "verify.config.json"), {
    test: {
      command: "npm test",
      timeoutMs: 4321
    }
  });

  const config = loadConfig(cwd);
  assert.equal(config.test.command, "npm test");
  assert.equal(config.test.timeoutMs, 4321);
});

test("test command autodetection strips UTF-8 BOM from package.json", () => {
  const cwd = tempDir();
  writeBomJson(path.join(cwd, "package.json"), {
    scripts: {
      test: "node test.js"
    }
  });

  const command = resolveTestCommand(cwd);
  assert.equal(command.command, "npm test");
});

test("test verifier handles BOM-prefixed package.json", async () => {
  const cwd = tempDir();
  writeBomJson(path.join(cwd, "package.json"), {
    scripts: {
      test: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`
    }
  });

  const result = await verifyTestsClaim({
    cwd,
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "fail");
  assert.match(result.summary, /npm test.*exited 1/);
});

test("evidence loader strips UTF-8 BOM from session JSON", () => {
  const cwd = tempDir();
  const dataRoot = path.join(cwd, ".plugin-data");
  const evidence = emptyEvidence("bom-evidence", cwd);
  evidence.touchedFiles.push({
    path: path.join(cwd, "src", "foo.ts"),
    normalizedPath: path.join(cwd, "src", "foo.ts"),
    at: new Date().toISOString(),
    tool: "Write"
  });
  saveSessionEvidence(dataRoot, evidence);

  const evidenceFile = path.join(dataRoot, "sessions", "bom-evidence.json");
  const raw = fs.readFileSync(evidenceFile);
  fs.writeFileSync(evidenceFile, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]));

  const loaded = loadSessionEvidence(dataRoot, "bom-evidence", cwd);
  assert.equal(loaded.touchedFiles.length, 1);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-file-bom-"));
}

function writeBomJson(file, value) {
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(value), "utf8")
  ]));
}
