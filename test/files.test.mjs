import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyEvidence } from "../src/core/evidence.mjs";
import { verifyFileClaim } from "../src/core/verifiers/files.mjs";

test("passes when evidence saw the claimed file touched", () => {
  const cwd = tempDir();
  const file = path.join(cwd, "src", "foo.ts");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "export const x = 1;\n");

  const evidence = emptyEvidence("test", cwd);
  evidence.startedAt = new Date(Date.now() + 60_000).toISOString();
  evidence.touchedFiles.push({
    path: file,
    normalizedPath: process.platform === "win32" ? file.toLowerCase() : file,
    at: new Date().toISOString(),
    tool: "Edit"
  });

  const result = verifyFileClaim({
    cwd,
    evidence,
    claim: {
      path: "src/foo.ts"
    }
  });

  assert.equal(result.status, "pass");
});

test("fails when claimed file does not exist", () => {
  const cwd = tempDir();
  const result = verifyFileClaim({
    cwd,
    evidence: emptyEvidence("test", cwd),
    claim: {
      path: "src/missing.ts"
    }
  });

  assert.equal(result.status, "fail");
});

test("fails when claimed file is outside the project", () => {
  const cwd = tempDir();
  const result = verifyFileClaim({
    cwd,
    evidence: emptyEvidence("test", cwd),
    claim: {
      path: "../outside.txt"
    }
  });

  assert.equal(result.status, "fail");
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-files-"));
}
