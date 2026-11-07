import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBinary } from "../src/core/command.mjs";
import { emptyEvidence, loadSessionEvidence, recordPostToolUse, recordStop } from "../src/core/evidence.mjs";
import { commandDirs, otherBranchPr, pushRoots, workElsewhere } from "../src/core/elsewhere.mjs";
import { verifyFinalMessage } from "../src/core/verify.mjs";

test("reads the folders a shell command changes into", () => {
  assert.deepEqual(commandDirs(`cd "/a b/c" && pnpm test`, "/cwd"), ["/a b/c"]);
  assert.deepEqual(commandDirs("cd /x; cd sub && git -C ../y status", "/cwd"), ["/x", "/x/sub", "/x/y"]);
  assert.deepEqual(commandDirs("(cd ~/repo && make)", "/cwd"), [path.join(os.homedir(), "repo")]);
  assert.deepEqual(commandDirs("cd packages/tools && pnpm test", "/cwd"), ["/cwd/packages/tools"]);
  assert.deepEqual(commandDirs(`cd "$W" && ls; cd -`, "/cwd"), []);
  assert.deepEqual(commandDirs("echo cd /nope", "/cwd"), []);
});

test("finds a turn whose work was all in other checkouts", { skip: process.platform === "win32" }, async (t) => {
  if ((await runBinary("git", ["--version"])).exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const { cwd, other, worktree } = await checkouts();
  const scratch = tempDir();
  // The session starts before its edits; items are built before turn() runs, so set it in the past.
  const startedAt = new Date(Date.now() - 120000).toISOString();
  const turn = (items, extra = {}) => ({ ...emptyEvidence("test", cwd), startedAt, ...extra, ...items });
  const edit = (file, at = new Date().toISOString()) => ({ path: file, normalizedPath: file, at });
  const bash = (command, at = new Date().toISOString()) => ({ command, at });
  const roots = async (evidence) => (await workElsewhere(cwd, evidence))?.roots;

  assert.deepEqual(await roots(turn({ bashCommands: [bash(`cd "${other}" && pnpm test`)], touchedFiles: [edit(path.join(other, "a.js"))] })), [other]);
  // A worktree inside the project folder is still another checkout.
  assert.deepEqual(await roots(turn({ touchedFiles: [edit(path.join(worktree, "src", "new.js"))] })), [worktree]);
  // Any work at cwd, or none in a git checkout, keeps the checks at cwd.
  assert.equal(await roots(turn({ touchedFiles: [edit(path.join(other, "a.js")), edit(path.join(cwd, "b.js"))] })), undefined);
  assert.equal(await roots(turn({ bashCommands: [bash(`cd "${other}" && ls`), bash("cd packages && pnpm test")] })), undefined);
  assert.equal(await roots(turn({ touchedFiles: [edit(path.join(scratch, "notes.md"))] })), undefined);
  assert.equal(await roots(turn({})), undefined);

  // Only work since the last Stop counts.
  const before = new Date(Date.now() - 60000).toISOString();
  const lastStopAt = new Date(Date.now() - 30000).toISOString();
  assert.deepEqual(await roots(turn({ touchedFiles: [edit(path.join(cwd, "b.js"), before), edit(path.join(other, "a.js"))] }, { lastStopAt })), [other]);
  assert.equal(await roots(turn({ touchedFiles: [edit(path.join(other, "a.js"), before)] }, { lastStopAt })), undefined);
  // A file first edited before the last Stop and again after it counts for this turn.
  assert.deepEqual(await roots(turn({ touchedFiles: [{ ...edit(path.join(other, "a.js"), before), lastAt: new Date().toISOString() }] }, { lastStopAt })), [other]);
});

test("test and git claims are inconclusive when the turn's work was in another checkout", { skip: process.platform === "win32" }, async (t) => {
  if ((await runBinary("git", ["--version"])).exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const { cwd, other } = await checkouts();
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: { command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`, timeoutMs: 10000 }
  }));
  const message = "All tests pass, and I pushed the branch.";
  const verify = (file) => verifyFinalMessage(
    { cwd, session_id: "test", last_assistant_message: message },
    { evidence: { ...emptyEvidence("test", cwd), startedAt: new Date(Date.now() - 120000).toISOString(), touchedFiles: [{ path: file, normalizedPath: file, at: new Date().toISOString() }] } }
  );

  const elsewhere = await verify(path.join(other, "a.js"));
  assert.deepEqual(elsewhere.results.map((result) => [result.verifier, result.status]), [["tests", "inconclusive"], ["git", "inconclusive"]]);
  assert.match(elsewhere.results[0].summary, /^Claimed tests passed, but this turn's edits and commands were in /);
  assert.equal(elsewhere.shouldBlock, false);

  const here = await verify(path.join(cwd, "a.js"));
  assert.deepEqual(here.results.map((result) => [result.verifier, result.status]), [["tests", "fail"], ["git", "fail"]]);
});

test("Stop records where the next turn starts, and a repeat edit records its time", () => {
  const dataRoot = tempDir();
  const input = { session_id: "s", cwd: dataRoot, tool_name: "Write", tool_input: { file_path: path.join(dataRoot, "a.js") } };
  recordPostToolUse(input, dataRoot);
  recordStop("s", dataRoot, dataRoot);
  const { lastStopAt } = loadSessionEvidence(dataRoot, "s", dataRoot);
  const [entry] = recordPostToolUse(input, dataRoot).touchedFiles;
  assert.ok(lastStopAt && entry.lastAt >= lastStopAt && entry.at <= lastStopAt);
});

test("a push claim is checked where this turn ran `git push`", { skip: process.platform === "win32" }, async (t) => {
  if ((await runBinary("git", ["--version"])).exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const { cwd, other } = await checkouts();
  const git = (dir, args) => runBinary("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd: dir });
  // cwd has one commit that isn't on origin/main; other's origin/main has its HEAD.
  for (const dir of [cwd, other]) {
    await git(dir, ["remote", "add", "origin", path.join(dir, "nowhere")]);
    await git(dir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  }
  await git(cwd, ["commit", "-q", "--allow-empty", "-m", "fix"]);

  const startedAt = new Date(Date.now() - 120000).toISOString();
  const evidence = (...commands) => ({
    ...emptyEvidence("test", cwd),
    startedAt,
    bashCommands: commands.map((command) => ({ command, at: new Date().toISOString() })),
    touchedFiles: [{ path: path.join(cwd, "a.js"), normalizedPath: path.join(cwd, "a.js"), at: new Date().toISOString() }]
  });
  const roots = (...commands) => pushRoots(cwd, evidence(...commands));

  assert.deepEqual(await roots(`cd "${other}" && git push origin main`, "git commit -m fix"), [other]);
  assert.deepEqual(await roots(`git -C "${other}" push`), [other]);
  assert.equal(await roots("git push origin main"), null);
  assert.equal(await roots(`cd "${other}" && git push`, "git push"), null);
  assert.equal(await roots(`cd "$REPO" && git push`), null);
  assert.equal(await roots("git status"), null);

  // A real wrong block: the reply said the other repo was pushed and this one wasn't.
  const message = "**Billing service:** pushed to GitHub (`aaa1111..bbb2222` on main). **Web app:** fixed, but only on this machine so far.";
  const pushed = async (...commands) => {
    const verification = await verifyFinalMessage({ cwd, session_id: "test", last_assistant_message: message }, { evidence: evidence(...commands) });
    return verification.results.find((result) => result.verifier === "git");
  };
  const there = await pushed(`cd "${other}" && git push origin main`);
  assert.equal(there.status, "pass");
  assert.match(there.summary, /Checked in `.+`, where this turn ran `git push`\.$/);
  assert.equal((await pushed("git push origin main")).status, "fail");
  // Still a fail when the other checkout's push didn't land.
  await git(other, ["commit", "-q", "--allow-empty", "-m", "unpushed"]);
  assert.equal((await pushed(`cd "${other}" && git push origin main`)).status, "fail");
});

test("a claim about an open PR on another branch isn't checked in this folder", { skip: process.platform === "win32" }, async (t) => {
  if ((await runBinary("git", ["--version"])).exitCode !== 0) {
    t.skip("git is not available");
    return;
  }

  const { cwd } = await checkouts();
  await runBinary("git", ["switch", "-q", "-c", "feature-a"], { cwd });
  fs.writeFileSync(path.join(cwd, "verify.config.json"), JSON.stringify({
    test: { command: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`, timeoutMs: 10000 }
  }));
  // A stand-in gh that answers `gh pr view` from GH_STUB.
  const bin = tempDir();
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh
case "$GH_STUB" in
  error) echo 'error connecting to api.github.com' >&2; exit 1 ;;
  *) echo "$GH_STUB" ;;
esac
`, { mode: 0o755 });
  const pr = (state, headRefName) => JSON.stringify({ number: 42, state, headRefName });
  const evidence = { ...emptyEvidence("test", cwd), startedAt: new Date(Date.now() - 120000).toISOString() };
  // A real wrong block: the agent relayed another session's report on its PR.
  const relayed = "[#42](https://github.com/o/r/pull/42) is now based on main, with every test suite passing on this computer.";
  const status = async (stub, message = relayed) => {
    process.env.GH_STUB = stub;
    const verification = await verifyFinalMessage({ cwd, session_id: "test", last_assistant_message: message }, { evidence });
    return verification.results.find((result) => result.verifier === "tests");
  };

  const savedPath = process.env.PATH;
  try {
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
    const other = await status(pr("OPEN", "feature-b"));
    assert.equal(other.status, "inconclusive");
    assert.match(other.summary, /about PR #42 on `feature-b`, and this folder is on `feature-a`/);
    assert.equal((await status(pr("OPEN", "feature-b"), "PR 42 is rebased, and all tests pass.")).status, "inconclusive");
    // Checked here: the PR is this branch's, merged, unknown to gh, or not named.
    assert.equal((await status(pr("OPEN", "feature-a"))).status, "fail");
    assert.equal((await status(pr("MERGED", "feature-b"))).status, "fail");
    assert.equal((await status("error")).status, "fail");
    assert.equal((await status(pr("OPEN", "feature-b"), "All tests pass. I opened #42 for it.")).status, "fail");
    assert.equal(await otherBranchPr(cwd, "No PR here; all tests pass."), null);
  } finally {
    process.env.PATH = savedPath;
    delete process.env.GH_STUB;
  }
});

async function checkouts() {
  const git = (cwd, args) => runBinary("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { cwd });
  const cwd = fs.realpathSync(tempDir());
  const other = fs.realpathSync(tempDir());
  for (const dir of [cwd, other]) {
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["commit", "-q", "--allow-empty", "-m", "init"]);
  }
  const worktree = path.join(cwd, ".claude", "worktrees", "w");
  await git(cwd, ["worktree", "add", "-q", "-b", "w", worktree]);
  return { cwd, other, worktree };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-elsewhere-"));
}
