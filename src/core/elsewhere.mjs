import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBinary } from "./command.mjs";

const GIT_TIMEOUT_MS = 10000;
const MAX_DIRS = 100;
// `cd <dir>`, `pushd <dir>` at the start of a command or after `&&`, `||`, `;`, `(`; and `git -C <dir>`.
const DIR_ARGUMENT = String.raw`("[^"]*"|'[^']*'|[^\s;&|()]+)`;
const COMMAND_DIRS = new RegExp(String.raw`(?:^|&&|\|\||[;\n(])\s*(?:cd|pushd)\s+${DIR_ARGUMENT}|\bgit\s+-C\s+${DIR_ARGUMENT}`, "g");
// The same `cd` / `pushd`, and `git push` or `git -C <dir> push`.
const PUSH_STEPS = new RegExp(String.raw`(?:^|&&|\|\||[;\n(])\s*(?:cd|pushd)\s+(?<cd>${DIR_ARGUMENT})|\bgit\s+(?:-C\s+(?<gitDir>${DIR_ARGUMENT})\s+)?push\b`, "g");
const MAX_PR_REFS = 3;

// When this turn's edits and `cd` / `git -C` targets are all in git checkouts other than the one at cwd, the agent
// worked somewhere else (often a worktree outside the project, where the shell resets to the project folder), so
// running tests or git checks at cwd says nothing about its claims. Returns { cwdRoot, roots } then, null otherwise.
export async function workElsewhere(cwd, evidence) {
  const cwdRoot = await gitRoot(cwd);
  if (!cwdRoot) {
    return null;
  }

  const inTurn = turnFilter(evidence);
  const dirs = new Set();
  for (const entry of evidence.touchedFiles ?? []) {
    if (inTurn(entry.lastAt ?? entry.at)) {
      dirs.add(path.dirname(entry.path));
    }
  }
  for (const entry of evidence.bashCommands ?? []) {
    if (inTurn(entry.at)) {
      for (const dir of commandDirs(entry.command, cwd)) {
        dirs.add(dir);
      }
    }
  }
  if (dirs.size === 0 || dirs.size > MAX_DIRS) {
    return null;
  }

  const roots = new Set();
  for (const dir of dirs) {
    const root = await gitRoot(existingAncestor(dir));
    if (root === cwdRoot) {
      return null;
    }
    if (root) {
      roots.add(root);
    }
  }
  return roots.size > 0 ? { cwdRoot, roots: [...roots] } : null;
}

// The git checkouts other than cwd's where this turn ran `git push`, so a push claim is checked where the push ran
// ("PaperMatrix: pushed" while the session folder is another repo). Null when there was no push, one ran in cwd's
// checkout, or a push's folder can't be read from the command text.
export async function pushRoots(cwd, evidence) {
  const inTurn = turnFilter(evidence);
  const dirs = new Set();
  for (const entry of evidence.bashCommands ?? []) {
    if (!inTurn(entry.at)) {
      continue;
    }
    let base = cwd;
    for (const match of String(entry.command).matchAll(PUSH_STEPS)) {
      const { cd, gitDir } = match.groups;
      if (cd !== undefined) {
        base = base && resolveDir(base, cd);
        continue;
      }
      const dir = gitDir === undefined ? base : base && resolveDir(base, gitDir);
      if (!dir) {
        return null;
      }
      dirs.add(dir);
    }
  }
  if (dirs.size === 0 || dirs.size > MAX_DIRS) {
    return null;
  }

  const cwdRoot = await gitRoot(cwd);
  const roots = new Set();
  for (const dir of dirs) {
    const root = await gitRoot(existingAncestor(dir));
    if (!root || root === cwdRoot) {
      return null;
    }
    roots.add(root);
  }
  return [...roots];
}

// When a claim's sentence names an open PR on a branch other than the one checked out at cwd ("#281 is rebased, with
// every test suite passing", relayed from the session working on #281), checks at cwd say nothing about it. Returns
// { pr, branch, cwdBranch } then; null when no PR is named, one is on cwd's branch, or gh can't look one up.
export async function otherBranchPr(cwd, sentence) {
  const refs = prRefs(String(sentence ?? ""));
  if (refs.length === 0) {
    return null;
  }
  const head = await runBinary("git", ["-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"], { timeoutMs: GIT_TIMEOUT_MS });
  if (head.exitCode !== 0) {
    return null;
  }

  const cwdBranch = head.stdout.trim();
  let other = null;
  for (const ref of refs) {
    const result = await runBinary("gh", ["pr", "view", ref, "--json", "number,state,headRefName"], { cwd, timeoutMs: GIT_TIMEOUT_MS });
    let pr;
    try {
      pr = result.exitCode === 0 ? JSON.parse(result.stdout) : null;
    } catch {
      pr = null;
    }
    if (!pr || pr.headRefName === cwdBranch) {
      return null;
    }
    // A merged or closed PR is history ("since #45 merged, all tests pass"), not the claim's subject.
    if (pr.state === "OPEN") {
      other ??= { pr: pr.number, branch: pr.headRefName, cwdBranch };
    }
  }
  return other;
}

// GitHub PR links, then `#123` and `PR 123` not already in a link; at most MAX_PR_REFS.
function prRefs(sentence) {
  const urls = sentence.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g) ?? [];
  const linked = new Set(urls.map((url) => url.split("/").pop()));
  const numbers = [...sentence.matchAll(/(?<![\w&/])#(\d{1,7})\b|\bPR\s+#?(\d{1,7})\b/gi)]
    .map((match) => match[1] ?? match[2])
    .filter((number) => !linked.has(number));
  return [...new Set([...urls, ...numbers])].slice(0, MAX_PR_REFS);
}

// Folders a shell command changes into, in order; a relative one resolves against the one before it, else cwd.
export function commandDirs(command, cwd) {
  const dirs = [];
  let base = cwd;
  for (const match of String(command).matchAll(COMMAND_DIRS)) {
    const dir = resolveDir(base, match[1] ?? match[2]);
    if (dir) {
      base = dir;
      dirs.push(base);
    }
  }
  return dirs;
}

// A `cd` argument resolved against base; null for a variable, substitution or `cd -`, which the text can't resolve.
function resolveDir(base, argument) {
  const raw = argument.replace(/^(["'])(.*)\1$/, "$2");
  const expanded = raw.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, os.homedir());
  return expanded === "-" || /[$`]/.test(expanded) ? null : path.resolve(base, expanded);
}

// Whether a time is in this turn: since the last Stop, else since the session started.
function turnFilter(evidence) {
  const since = Date.parse(evidence.lastStopAt ?? evidence.startedAt);
  return (at) => !Number.isFinite(since) || Date.parse(at) >= since;
}

function existingAncestor(dir) {
  let current = path.resolve(dir);
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    current = path.dirname(current);
  }
  return current;
}

async function gitRoot(dir) {
  const result = await runBinary("git", ["-C", dir, "rev-parse", "--show-toplevel"], { timeoutMs: GIT_TIMEOUT_MS });
  if (result.exitCode !== 0) {
    return null;
  }
  try {
    return fs.realpathSync(result.stdout.trim());
  } catch {
    return null;
  }
}
