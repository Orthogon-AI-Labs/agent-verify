import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runBinary } from "./command.mjs";

const GIT_TIMEOUT_MS = 10000;
const MAX_DIRS = 100;
// `cd <dir>`, `pushd <dir>` at the start of a command or after `&&`, `||`, `;`, `(`; and `git -C <dir>`.
const DIR_ARGUMENT = String.raw`("[^"]*"|'[^']*'|[^\s;&|()]+)`;
const COMMAND_DIRS = new RegExp(String.raw`(?:^|&&|\|\||[;\n(])\s*(?:cd|pushd)\s+${DIR_ARGUMENT}|\bgit\s+-C\s+${DIR_ARGUMENT}`, "g");

// When this turn's edits and `cd` / `git -C` targets are all in git checkouts other than the one at cwd, the agent
// worked somewhere else (often a worktree outside the project, where the shell resets to the project folder), so
// running tests or git checks at cwd says nothing about its claims. Returns { cwdRoot, roots } then, null otherwise.
export async function workElsewhere(cwd, evidence) {
  const cwdRoot = await gitRoot(cwd);
  if (!cwdRoot) {
    return null;
  }

  const since = Date.parse(evidence.lastStopAt ?? evidence.startedAt);
  const inTurn = (at) => !Number.isFinite(since) || Date.parse(at) >= since;
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

// Folders a shell command changes into, in order; a relative one resolves against the one before it, else cwd.
export function commandDirs(command, cwd) {
  const dirs = [];
  let base = cwd;
  for (const match of String(command).matchAll(COMMAND_DIRS)) {
    const raw = (match[1] ?? match[2]).replace(/^(["'])(.*)\1$/, "$2");
    const expanded = raw.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, os.homedir());
    // A variable, substitution or `cd -` can't be resolved from the command text.
    if (expanded === "-" || /[$`]/.test(expanded)) {
      continue;
    }
    base = path.resolve(base, expanded);
    dirs.push(base);
  }
  return dirs;
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
