import { runBinary } from "../command.mjs";
import { SECRET_PATTERNS } from "../claims.mjs";

const GIT_TIMEOUT_MS = 10000;

export async function verifySecretsClaim({ cwd, claim, config }) {
  const repoRootResult = await runBinary("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS
  });

  if (repoRootResult.exitCode !== 0) {
    return inconclusive("Claimed the changes were free of secrets, but this project is not a git repository.");
  }

  const repoRoot = repoRootResult.stdout.trim();

  const staged = await git(repoRoot, ["diff", "--cached"]);
  if (staged.exitCode !== 0) {
    return inconclusive("Claimed no secrets were committed, but Verify could not read the staged diff.");
  }

  const sources = [staged.stdout];
  let pushUnverifiable = false;

  if (claim.push) {
    const upstream = await git(repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    if (upstream.exitCode !== 0) {
      pushUnverifiable = true;
    } else {
      const ahead = await git(repoRoot, ["diff", `${upstream.stdout.trim()}..HEAD`]);
      if (ahead.exitCode !== 0) {
        pushUnverifiable = true;
      } else {
        sources.push(ahead.stdout);
      }
    }
  }

  const addedLines = collectAddedLines(sources.join("\n"));
  const hits = scanForSecrets(addedLines, config.secrets);

  if (hits.length > 0) {
    return {
      verifier: "secrets",
      status: "fail",
      summary: `Claimed no secrets were committed, but the diff contains ${hits.length} credential pattern${hits.length === 1 ? "" : "s"}:`,
      hits,
      details: hits.map((hit) => `${hit.file}:${hit.line}  (${hit.pattern})`).join("\n")
    };
  }

  if (pushUnverifiable) {
    return inconclusive("Claimed it was safe to push, but the branch has no upstream (or it could not be read), so Verify could not check the pushed commits for secrets.");
  }

  if (addedLines.length === 0) {
    return inconclusive("Claimed no secrets were committed, but Verify found no staged changes to check.");
  }

  return {
    verifier: "secrets",
    status: "pass",
    summary: "Claimed no secrets were committed, and no credential patterns were found in the diff."
  };
}

function inconclusive(summary) {
  return {
    verifier: "secrets",
    status: "inconclusive",
    summary
  };
}

function collectAddedLines(diffText) {
  const added = [];
  let file = "(unknown)";
  let newLine = 0;

  for (const raw of diffText.split(/\r?\n/)) {
    if (raw.startsWith("+++ ")) {
      const target = raw.slice(4).trim();
      file = target === "/dev/null" ? "(unknown)" : target.replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("--- ") || raw.startsWith("diff --git")) {
      continue;
    }

    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }

    if (raw.startsWith("+")) {
      added.push({ file, line: newLine, content: raw.slice(1) });
      newLine += 1;
      continue;
    }
    if (raw.startsWith("-")) {
      continue;
    }
    if (raw.startsWith(" ")) {
      newLine += 1;
    }
  }

  return added;
}

function scanForSecrets(addedLines, secretsConfig = {}) {
  const skipPaths = secretsConfig.skipPaths ?? [];
  const allowPatterns = compileAllowPatterns(secretsConfig.allowPatterns ?? []);
  const hits = [];
  const seen = new Set();

  for (const { file, line, content } of addedLines) {
    if (isSkippedPath(file, skipPaths)) {
      continue;
    }
    if (allowPatterns.some((regex) => regex.test(content))) {
      continue;
    }

    for (const { name, regex } of SECRET_PATTERNS) {
      if (regex.test(content)) {
        const key = `${file}:${line}:${name}`;
        if (!seen.has(key)) {
          seen.add(key);
          hits.push({ file, line, pattern: name });
        }
        break;
      }
    }
  }

  return hits;
}

function compileAllowPatterns(patterns) {
  const compiled = [];
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern));
    } catch {
      // Ignore malformed user-supplied allow patterns rather than crashing the hook.
    }
  }
  return compiled;
}

function isSkippedPath(file, skipPaths) {
  const normalized = String(file).replace(/\\/g, "/");
  const base = normalized.split("/").pop();

  return skipPaths.some((pattern) => {
    if (pattern.includes("*")) {
      const regex = globToRegExp(pattern);
      return regex.test(normalized) || regex.test(base);
    }
    const clean = pattern.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalized === clean
      || normalized.startsWith(`${clean}/`)
      || normalized.split("/").includes(clean);
  });
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function git(cwd, args) {
  return runBinary("git", args, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS
  });
}
