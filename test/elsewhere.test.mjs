import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBinary } from "../src/core/command.mjs";
import { emptyEvidence, loadSessionEvidence, recordPostToolUse, recordStop } from "../src/core/evidence.mjs";
import { commandDirs, workElsewhere } from "../src/core/elsewhere.mjs";
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
  const turn = (items, extra = {}) => ({ ...emptyEvidence("test", cwd), ...extra, ...items });
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
    { evidence: { ...emptyEvidence("test", cwd), touchedFiles: [{ path: file, normalizedPath: file, at: new Date().toISOString() }] } }
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
