import fs from "node:fs";
import path from "node:path";
import { runBinary } from "../command.mjs";

const GIT_TIMEOUT_MS = 10000;
const SESSION_SKEW_MS = 2000;
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
// Test files by common convention: test/, tests/, __tests__/, spec/, e2e/ and testdata/ folders, *.test.* and *.spec.*,
// node --test names, Go/Python/Ruby/JVM/.NET test names, pytest's conftest.py and Jest snapshots.
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|e2e|testdata)\/|\.(?:test|spec)\.[a-z0-9]+$|[-_]test\.[cm]?[jt]sx?$|(?:^|\/)test-[^/]+\.[cm]?[jt]sx?$|_test\.(?:go|py|rb|exs?)$|(?:^|\/)test_[^/]+\.py$|_spec\.rb$|Tests?\.(?:java|kt|cs|swift)$|(?:^|\/)conftest\.py$|\.snap$/;

export function isTestPath(relativePath) {
  return TEST_PATH.test(String(relativePath).replace(/\\/g, "/"));
}

// Checks "I didn't change the tests" against git: test files that are modified, deleted or renamed now, compared with
// the last commit before this session, and that were edited this session. New test files don't count. A claim that
// names a folder ("nothing in \`tests/\` changed") is checked against every file in that folder instead.
export async function verifyTestFilesClaim({ cwd, claim = {}, evidence }) {
  const top = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (top.exitCode !== 0) {
    return {
      verifier: "testfiles",
      status: "inconclusive",
      summary: `${claimed(claim)}, but this project is not a git repository.`
    };
  }

  const root = top.stdout.trim();
  const startedAtMs = Date.parse(evidence.startedAt);
  const base = await sessionBase(root, startedAtMs);
  const diff = await git(root, ["-c", "core.quotepath=false", "diff", "--name-status", "-M", "-z", base, "--"]);
  if (diff.exitCode !== 0) {
    return {
      verifier: "testfiles",
      status: "inconclusive",
      summary: `${claimed(claim)}, but Verify could not read the git diff.`,
      details: diff.stderr.trim()
    };
  }

  const touched = new Set(evidence.touchedFiles.map((entry) => realPath(entry.path)));
  const dirPrefix = claim.dir ? repoPrefix(root, cwd, claim.dir) : null;
  const inScope = (file) => (dirPrefix ? file.startsWith(dirPrefix) : isTestPath(file));
  const changed = parseNameStatus(diff.stdout)
    .filter((entry) => inScope(entry.path) && entry.status !== "A" && entry.status !== "C")
    .filter((entry) => changedThisSession(root, entry, touched, startedAtMs));

  if (changed.length === 0) {
    return {
      verifier: "testfiles",
      status: "pass",
      summary: `${claimed(claim)}, and git shows no ${claim.dir ? "file in it" : "test file"} changed this session.`
    };
  }

  return {
    verifier: "testfiles",
    status: "fail",
    summary: `${claimed(claim)}, but ${changed.length} ${claim.dir ? "file(s) in it" : "test file(s)"} changed this session:`,
    details: changed.map(describe).join("\n")
  };
}

function claimed(claim) {
  return claim.dir ? `Claimed \`${claim.dir}/\` was not changed` : "Claimed the tests were not changed";
}

// The claimed folder as a path prefix relative to the repo root, the form git diff prints.
function repoPrefix(root, cwd, dir) {
  const relative = path.relative(root, path.resolve(realPath(cwd), dir)).split(path.sep).join("/");
  return `${relative.replace(/\/+$/, "")}/`;
}

async function sessionBase(root, startedAtMs) {
  if (!Number.isFinite(startedAtMs)) {
    const head = await git(root, ["rev-parse", "--verify", "-q", "HEAD"]);
    return head.exitCode === 0 ? "HEAD" : EMPTY_TREE;
  }
  const before = new Date(startedAtMs - SESSION_SKEW_MS).toISOString();
  const result = await git(root, ["rev-list", "-1", `--before=${before}`, "HEAD"]);
  return result.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : EMPTY_TREE;
}

function parseNameStatus(output) {
  const fields = output.split("\0").filter((field) => field !== "");
  const entries = [];
  for (let i = 0; i < fields.length; i += 1) {
    const status = fields[i][0];
    if (status === "R" || status === "C") {
      entries.push({ status, path: fields[i + 1], to: fields[i + 2] });
      i += 2;
    } else {
      entries.push({ status, path: fields[i + 1] });
      i += 1;
    }
  }
  return entries;
}

// A modified file counts only if this session edited it, so a test file that was already dirty is not blamed on the agent.
function changedThisSession(root, entry, touched, startedAtMs) {
  if (entry.status === "D" || entry.status === "R") {
    return true;
  }
  const absolutePath = path.join(root, entry.path);
  if (touched.has(realPath(absolutePath))) {
    return true;
  }
  try {
    return Number.isFinite(startedAtMs) && fs.statSync(absolutePath).mtimeMs >= startedAtMs - SESSION_SKEW_MS;
  } catch {
    return false;
  }
}

// git prints the repo root with symlinks resolved (/private/var on macOS); agents report paths as they see them.
function realPath(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function describe(entry) {
  if (entry.status === "D") {
    return `${entry.path} (deleted)`;
  }
  if (entry.status === "R") {
    return `${entry.path} (renamed to ${entry.to})`;
  }
  return `${entry.path} (modified)`;
}

function git(cwd, args) {
  return runBinary("git", args, { cwd, timeoutMs: GIT_TIMEOUT_MS });
}
