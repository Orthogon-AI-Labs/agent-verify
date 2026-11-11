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

test("protected verifier fails when a committed block's markers are broken into nested ones", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("nested.md", path.join(cwd, "docs", "protected.md"));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-nested", cwd),
    config: loadConfig(cwd)
  });

  // The committed block "example" is gone; the syntax error is reported alongside it.
  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "docs/protected.md", name: "example" }]);
  assert.match(result.details, /invalid protected marker syntax/i);
});

test("protected verifier fails when a committed block loses its end marker", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("unmatched.md", path.join(cwd, "docs", "protected.md"));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-unmatched", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "docs/protected.md", name: "example" }]);
  assert.match(result.details, /missing an end marker/i);
});

test("protected verifier is inconclusive when only marker syntax is broken", async () => {
  const cwd = await createProtectedRepo();
  writeFile(path.join(cwd, "docs", "protected.md"), `${baseBlock("example", "Original protected text.")}<!-- canon:protected:end -->\n`);

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-stray-end", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "inconclusive");
  assert.match(result.summary, /end marker without matching start marker/i);
});

test("protected verifier still fails a changed block when another file has a marker syntax error", async () => {
  const cwd = await createProtectedRepo({
    files: { "a.md": baseBlock("voice", "Original voice."), "b.md": baseBlock("other", "Other.") }
  });
  writeFile(path.join(cwd, "a.md"), baseBlock("voice", "Rewritten voice."));
  writeFile(path.join(cwd, "b.md"), `${baseBlock("other", "Other.")}<!-- canon:protected:end -->\n`);

  const result = await runProtected(cwd, "protected-masked");
  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "a.md", name: "voice" }]);
});

test("protected verifier fails a rewritten block whose name contains marker-error words", async () => {
  const name = "no nested protected blocks policy";
  const cwd = await createProtectedRepo({ files: { "a.md": baseBlock(name, "Original.") } });
  writeFile(path.join(cwd, "a.md"), baseBlock(name, "Rewritten."));

  const result = await runProtected(cwd, "protected-keyword-name");
  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "a.md", name }]);
});

test("protected verifier names a block changed alongside a broken marker in the same file", async () => {
  const marked = (name, body) => `<!-- canon:protected:start name="${name}" -->\n${body}\n<!-- canon:protected:end -->\n`;
  // Deleting " (draft)" with an empty new_string also deletes the newline, joining the marker onto the heading.
  const text = "## Voice (draft)\n" + marked("voice", "Write plainly.") + "\n" + marked("rules", "Use the blue gateway.");
  const cwd = await createProtectedRepo({ files: { "doc.md": text } });
  writeFile(path.join(cwd, "doc.md"), text.replace(" (draft)\n", "").replace("blue", "green"));

  const result = await runProtected(cwd, "protected-broken-and-changed");
  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks.map((block) => block.name).sort(), ["rules", "voice"]);
});

test("protected verifier passes an allowed name that starts with a dash", async () => {
  const cwd = await createProtectedRepo({
    files: { "a.md": baseBlock("voice", "Original."), "b.md": baseBlock("-draft", "Draft.") }
  });
  writeFile(path.join(cwd, "b.md"), baseBlock("-draft", "Draft, rewritten."));
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({ protected: { allowed: ["-draft"] } }));
  assert.equal((await runProtected(cwd, "protected-dash-allowed")).status, "pass");

  writeFile(path.join(cwd, "a.md"), baseBlock("voice", "Rewritten."));
  const result = await runProtected(cwd, "protected-dash-other");
  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "a.md", name: "voice" }]);
});

test("protected verifier sees changes in files with non-ASCII and upper-case names", async () => {
  for (const file of ["café.md", "日本語/規則.md", "GUIDE.MD"]) {
    const cwd = await createProtectedRepo({ files: { [file]: baseBlock("b", "Original.") } });
    writeFile(path.join(cwd, file), baseBlock("b", "Rewritten."));
    const result = await runProtected(cwd, "protected-names");
    assert.equal(result.status, "fail", file);
    assert.deepEqual(result.blocks, [{ path: file, name: "b" }]);
  }
});

test("protected verifier reports every file when a block name isn't valid UTF-8", async () => {
  const named = (body) => Buffer.from(`<!-- canon:protected:start name="caf\xe9" -->\n${body}\n<!-- canon:protected:end -->\n`, "latin1");
  const cwd = await createProtectedRepo({ files: { "a.md": baseBlock("voice", "Original."), "z.md": named("Old.") } });
  writeFile(path.join(cwd, "a.md"), baseBlock("voice", "Rewritten."));
  writeFile(path.join(cwd, "z.md"), named("New."));
  const saved = process.env.PYTHONIOENCODING;
  process.env.PYTHONIOENCODING = "utf-8:strict";  // what a UTF-8 locale gives the checker
  try {
    const result = await runProtected(cwd, "protected-non-utf8-name");
    assert.equal(result.status, "fail");
    assert.deepEqual(result.blocks.map((block) => block.path), ["a.md", "z.md"]);
  } finally {
    if (saved === undefined) delete process.env.PYTHONIOENCODING;
    else process.env.PYTHONIOENCODING = saved;
  }
});

test("protected verifier ignores a checker that the repository under verification supplies", async () => {
  const cwd = await createProtectedRepo();
  copyFixture("modified.md", path.join(cwd, "docs", "protected.md"));
  for (const dir of [[".canon", "bin"], [".canon", "codex", "bin"]]) {
    writeFile(path.join(cwd, ...dir, "check-protected-sections.py"), "print('[canon protected-sections]')\nprint('ok: protected sections are intact')\n");
  }

  const result = await runProtected(cwd, "protected-planted-checker");
  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "docs/protected.md", name: "example" }]);
});

test("protected verifier passes a merge conflict outside every block", async () => {
  const text = baseBlock("example", "Keep this.") + "Footer.\n";
  const cwd = await createProtectedRepo({ files: { "notes.md": text } });
  await git(cwd, ["checkout", "-q", "-b", "topic"]);
  writeFile(path.join(cwd, "notes.md"), text.replace("Footer.", "Footer T."));
  await git(cwd, ["commit", "-qam", "topic"]);
  await git(cwd, ["checkout", "-q", "-"]);
  writeFile(path.join(cwd, "notes.md"), text.replace("Footer.", "Footer M."));
  await git(cwd, ["commit", "-qam", "main"]);
  const merge = await runBinary("git", ["merge", "topic"], { cwd, timeoutMs: 10000 });
  assert.notEqual(merge.exitCode, 0, "the merge should stop with a conflict");

  assert.equal((await runProtected(cwd, "protected-merge-conflict")).status, "pass");
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

test("protected verifier catches a changed byte inside a block in Markdown that isn't valid UTF-8", async () => {
  const cwd = await createProtectedRepo({
    files: { "docs/protected.md": nonUtf8Block(0xff, 0xff) }
  });
  writeFile(path.join(cwd, "docs", "protected.md"), nonUtf8Block(0xfe, 0xff));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-non-utf8-inside", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "fail");
  assert.deepEqual(result.blocks, [{ path: "docs/protected.md", name: "bytes" }]);
});

test("protected verifier passes when only bytes outside a block change in Markdown that isn't valid UTF-8", async () => {
  const cwd = await createProtectedRepo({
    files: { "docs/protected.md": nonUtf8Block(0xff, 0xff) }
  });
  writeFile(path.join(cwd, "docs", "protected.md"), nonUtf8Block(0xff, 0xfe));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-non-utf8-outside", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "pass");
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

test("protected verifier is inconclusive when the checker crashes without reporting", async () => {
  const cwd = await createProtectedRepo();
  const checker = writeStubChecker("raise RuntimeError('simulated checker crash')\n");
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    protected: { checkerPath: checker }
  }));

  const verification = await verifyFinalMessage({
    cwd,
    session_id: "protected-checker-crash",
    last_assistant_message: "Protected sections are intact."
  }, {
    evidence: emptyEvidence("protected-checker-crash", cwd)
  });

  const result = verification.results.find((item) => item.verifier === "protected");
  assert.equal(result.status, "inconclusive");
  assert.match(result.details, /simulated checker crash/);
  assert.equal(verification.shouldBlock, false);
});

test("protected verifier still fails when the checker reports a failure line it can't parse", async () => {
  const cwd = await createProtectedRepo();
  const checker = writeStubChecker(
    "import sys\nprint('[canon protected-sections]')\nprint('x docs/protected.md: some future kind of violation')\nsys.exit(1)\n"
  );
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    protected: { checkerPath: checker }
  }));

  const result = await verifyProtectedClaim({
    cwd,
    claim,
    evidence: emptyEvidence("protected-unparsed-failure", cwd),
    config: loadConfig(cwd)
  });

  assert.equal(result.status, "fail");
});

function runProtected(cwd, session) {
  return verifyProtectedClaim({ cwd, claim, evidence: emptyEvidence(session, cwd), config: loadConfig(cwd) });
}

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

function nonUtf8Block(insideByte, outsideByte) {
  return Buffer.concat([
    Buffer.from('# bytes\n\n<!-- canon:protected:start name="bytes" -->\nraw '),
    Buffer.from([insideByte]),
    Buffer.from(" byte\n<!-- canon:protected:end -->\n\ntail "),
    Buffer.from([outsideByte]),
    Buffer.from("\n")
  ]);
}

async function git(cwd, args) {
  const result = await runBinary("git", args, { cwd, timeoutMs: 10000 });
  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
  return result;
}

function writeStubChecker(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-stub-checker-"));
  const file = path.join(dir, "check-protected-sections.py");
  fs.writeFileSync(file, source);
  return file;
}
