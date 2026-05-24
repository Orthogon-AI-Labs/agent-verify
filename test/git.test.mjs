import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBinary } from "../src/core/command.mjs";
import { emptyEvidence } from "../src/core/evidence.mjs";
import { verifyGitClaim } from "../src/core/verifiers/git.mjs";

test("no git repository is inconclusive", async () => {
  const cwd = tempDir();
  const result = await verifyGitClaim({
    cwd,
    evidence: emptyEvidence("test", cwd),
    claim: {
      action: "pushed",
      text: "pushed"
    }
  });

  assert.equal(result.status, "unknown");
});

test("commit claim fails when repository has no commits", async (t) => {
  const git = await runBinary("git", ["--version"]);
  if (git.exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const cwd = tempDir();
  await runBinary("git", ["init"], { cwd });
  const result = await verifyGitClaim({
    cwd,
    evidence: emptyEvidence("test", cwd),
    claim: {
      action: "committed",
      text: "committed"
    }
  });

  assert.equal(result.status, "fail");
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-git-"));
}
