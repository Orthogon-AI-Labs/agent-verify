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

  assert.equal(result.status, "inconclusive");
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

test("a PR claim looks the branch up with `gh pr view <branch>`", { skip: process.platform === "win32" }, async (t) => {
  const git = await runBinary("git", ["--version"]);
  if (git.exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const cwd = tempDir();
  await runBinary("git", ["init", "-q", "-b", "feature/x"], { cwd });
  await runBinary("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init"], { cwd });
  // A stand-in gh: records its arguments and answers the way the real one does for each case.
  const bin = tempDir();
  const argsFile = path.join(bin, "args");
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
echo "$@" > "${argsFile}"
if [ "$3" = "--head" ]; then echo 'unknown flag: --head' >&2; exit 1; fi
case "$GH_STUB" in
  open) echo '{"state":"OPEN","title":"x","url":"https://github.com/o/r/pull/1"}' ;;
  none) echo 'no pull requests found for branch "feature/x"' >&2; exit 1 ;;
  *) echo 'error connecting to api.github.com' >&2; exit 1 ;;
esac
`, { mode: 0o755 });
  const savedPath = process.env.PATH;
  const claim = { action: "opened-pr", text: "opened a PR" };
  try {
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    const statuses = {};
    for (const stub of ["open", "none", "offline"]) {
      process.env.GH_STUB = stub;
      statuses[stub] = (await verifyGitClaim({ cwd, evidence: emptyEvidence("test", cwd), claim })).status;
    }
    assert.deepEqual(statuses, { open: "pass", none: "fail", offline: "inconclusive" });
    assert.equal(fs.readFileSync(argsFile, "utf8").trim(), "pr view feature/x --json url,state,title");
  } finally {
    process.env.PATH = savedPath;
    delete process.env.GH_STUB;
  }
});

test("a push claim passes when the same-name remote branch has HEAD, even without a matching upstream", async (t) => {
  const git = await runBinary("git", ["--version"]);
  if (git.exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const remote = tempDir();
  const cwd = tempDir();
  const run = (args) => runBinary("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });
  const pushed = async () =>
    (await verifyGitClaim({ cwd, evidence: emptyEvidence("test", cwd), claim: { action: "pushed", text: "pushed" } })).status;
  await runBinary("git", ["init", "-q", "--bare", remote]);
  await run(["init", "-q", "-b", "main"]);
  await run(["remote", "add", "origin", remote]);
  await run(["commit", "-q", "--allow-empty", "-m", "init"]);
  await run(["push", "-q", "-u", "origin", "main"]);

  // Pushed with `git push origin <branch>`, no -u: no upstream.
  await run(["switch", "-q", "-c", "no-upstream"]);
  await run(["commit", "-q", "--allow-empty", "-m", "a"]);
  assert.equal(await pushed(), "fail");
  await run(["push", "-q", "origin", "no-upstream"]);
  assert.equal(await pushed(), "pass");

  // Branched from origin/main, so it tracks main and is 2 ahead of it, but origin/<branch> has both commits.
  await run(["switch", "-q", "-c", "tracks-main", "--track", "origin/main"]);
  await run(["commit", "-q", "--allow-empty", "-m", "b"]);
  await run(["commit", "-q", "--allow-empty", "-m", "c"]);
  assert.equal(await pushed(), "fail");
  await run(["push", "-q", "origin", "tracks-main"]);
  assert.equal(await pushed(), "pass");

  // A commit made after the push is still unpushed.
  await run(["commit", "-q", "--allow-empty", "-m", "d"]);
  assert.equal(await pushed(), "fail");
});

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-git-"));
}
