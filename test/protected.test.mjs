import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.mjs";
import { detectClaims } from "../src/core/claims.mjs";
import { verifyFinalMessage } from "../src/core/verify.mjs";
import { verifyProtectedClaim } from "../src/core/verifiers/protected.mjs";
import { runBinary } from "../src/core/command.mjs";
import { emptyEvidence } from "../src/core/evidence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(repoRoot, "test", "fixtures", "protected");
const claim = { type: "protected", text: "protected sections are intact" };

test("detects protected-section preservation claims", () => {
  const claims = detectClaims("The protected sections are intact, and tests pass.");
  assert.equal(claims.filter((item) => item.type === "protected").length, 1);
});

test("does not detect protected-section intent or explicit edit phrases", () => {
  assert.equal(detectClaims("I should leave protected sections alone.").some((item) => item.type === "protected"), false);
  assert.equal(detectClaims("I edited protected section example.").some((item) => item.type === "protected"), false);
  assert.equal(detectClaims("After override: edited protected section example.").some((item) => item.type === "protected"), false);
});

test("protected verifier passes against a clean repo", async () => {
  const cwd = await createProtectedRepo();
  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-clean", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "pass");
});

test("protected verifier fails and names the modified file and block", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("modified.md", path.join(cwd, "docs", "protected.md"));

  const verification = await verifyFinalMessage({
    cwd,
    session_id: "protected-modified",
    last_assistant_message: "Protected sections are intact."
  }, {
    evidence: emptyEvidence("protected-modified", cwd)
  });

  const result = verification.results.find((item) => item.verifier === "protected");
  assert.equal(result.status, "fail");
  assert.equal(verification.shouldBlock, true);
  assert.deepEqual(result.blocks, [{ path: "docs/protected.md", name: "example" }]);
});

test("protected verifier allows configured block names", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("allowed.md", path.join(cwd, "docs", "protected.md"));
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    protected: {
      allowed: ["example"]
    }
  }));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-allowed", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "pass");
});

test("protected verifier reports marker syntax errors as inconclusive", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("nested.md", path.join(cwd, "docs", "protected.md"));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-nested", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "inconclusive");
  assert.match(result.summary, /invalid protected marker syntax/i);
});

test("protected verifier reports unmatched markers as inconclusive", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("unmatched.md", path.join(cwd, "docs", "protected.md"));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-unmatched", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "inconclusive");
  assert.match(result.summary, /missing an end marker/i);
});

test("protected verifier lists only modified files in multi-file repos", async () => {
  const cwd = await createProtectedRepo({
    files: {
      "multi/a.md": baseBlock("scope", "Original scope."),
      "multi/b.md": baseBlock("voice", "Original voice.")
    }
  });
  copyFixture(path.join("multi", "a.md"), path.join(cwd, "multi", "a.md"));
  copyFixture(path.join("multi", "b.md"), path.join(cwd, "multi", "b.md"));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-multi", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "multi/a.md", name: "scope" }]);
});

test("protected verifier is inconclusive when the checker is unavailable", async () => {
  const cwd = await createProtectedRepo();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    protected: {
      checkerPath: "missing/check-protected-sections.py"
    }
  }));

  const verification = await verifyFinalMessage({
    cwd,
    session_id: "protected-missing-checker",
    last_assistant_message: "Protected sections are intact."
  }, {
    evidence: emptyEvidence("protected-missing-checker", cwd)
  });

  const result = verification.results.find((item) => item.verifier === "protected");
  assert.equal(result.status, "inconclusive");
  assert.equal(verification.shouldBlock, false);
});

async function createProtectedRepo(options = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-protected-"));
  const files = options.files ?? {
    "docs/protected.md": baseBlock("example", "Original protected text.")
  };

  for (const [file, contents] of Object.entries(files)) {
    writeFile(path.join(cwd, file), contents);
  }

  await git(cwd, ["init"]);
  await git(cwd, ["config", "user.email", "verify@example.com"]);
  await git(cwd, ["config", "user.name", "Verify Tests"]);
  await git(cwd, ["add", "."]);
  await git(cwd, ["commit", "-m", "initial protected content"]);
  return cwd;
}

function copyFixture(from, to) {
  writeFile(to, fs.readFileSync(path.join(fixtures, from), "utf8"));
}

function writeFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function baseBlock(name, body) {
  return [
    `# ${name}`,
    "",
    `<!-- canon:protected:start name="${name}" -->`,
    body,
    "<!-- canon:protected:end -->",
    ""
  ].join("\n");
}

async function git(cwd, args) {
  const result = await runBinary("git", args, { cwd, timeoutMs: 10000 });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result;
}
