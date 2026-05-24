import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emptyEvidence } from "../src/core/evidence.mjs";
import { formatBlockReason } from "../src/core/format.mjs";
import { verifyFinalMessage } from "../src/core/verify.mjs";

test("stop verification blocks false test pass claim once", async () => {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: {
      command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`,
      timeoutMs: 10000
    }
  }));

  const verification = await verifyFinalMessage({
    cwd,
    session_id: "abc123",
    last_assistant_message: "All tests passed."
  }, {
    evidence: emptyEvidence("abc123", cwd)
  });

  assert.equal(verification.shouldBlock, true);
  assert.match(formatBlockReason(verification.results), /Verify found claim mismatches/);
});

test("no supported claims stays quiet", async () => {
  const cwd = tempDir();
  const verification = await verifyFinalMessage({
    cwd,
    session_id: "abc123",
    last_assistant_message: "I looked through the code."
  }, {
    evidence: emptyEvidence("abc123", cwd)
  });

  assert.equal(verification.shouldBlock, false);
  assert.deepEqual(verification.results, []);
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-hook-"));
}
