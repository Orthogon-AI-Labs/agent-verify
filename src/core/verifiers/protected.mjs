import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBinary } from "../command.mjs";

const VERIFY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CHECKER_TIMEOUT_MS = 30000;

export async function verifyProtectedClaim({ cwd, claim, config }) {
  const repoRootResult = await runBinary("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeoutMs: 10000
  });

  if (repoRootResult.exitCode !== 0) {
    return {
      verifier: "protected",
      status: "inconclusive",
      summary: "Claimed protected sections were intact, but this project is not a git repository."
    };
  }

  const repoRoot = repoRootResult.stdout.trim();
  const checker = findChecker(repoRoot, config.protected);
  if (!checker) {
    return {
      verifier: "protected",
      status: "inconclusive",
      summary: "Claimed protected sections were intact, but the protected-section checker is not available.",
      details: "Install canon or set protected.checkerPath in verify.config.json."
    };
  }

  const args = [checker];
  for (const name of config.protected.allowed) {
    // --allow=NAME: with "--allow NAME", a name starting with "-" is read as an option.
    args.push(`--allow=${name}`);
  }

  const result = await runBinary("python3", args, {
    cwd: repoRoot,
    timeoutMs: CHECKER_TIMEOUT_MS,
    maxOutputChars: 12000
  });

  if (result.exitCode === null) {
    return {
      verifier: "protected",
      status: "inconclusive",
      summary: "Claimed protected sections were intact, but Python 3 is not available.",
      details: "Install Python 3 or set protected.checkerPath to a runnable checker."
    };
  }

  const output = `${result.stdout}\n${result.stderr}`.trim();

  if (result.exitCode === 0) {
    return {
      verifier: "protected",
      status: "pass",
      summary: "Claimed protected sections were intact, and the checker found no protected-block changes."
    };
  }

  if (result.exitCode === 1) {
    // Changed blocks first: a marker syntax error in one file must not hide a changed block in another.
    const parsedBlocks = parseModifiedBlocks(result.stdout);
    const syntaxErrors = markerSyntaxErrors(result.stdout);
    const blocks = filterSkippedBlocks(parsedBlocks, config.protected.skipPaths);
    if (blocks.length > 0) {
      return {
        verifier: "protected",
        status: "fail",
        summary: `Claimed protected sections were intact, but ${blocks.length} block(s) were modified:`,
        blocks,
        details: [
          ...blocks.map((block) => `${block.path} (block: ${block.name})`),
          ...syntaxErrors
        ].join("\n")
      };
    }

    if (syntaxErrors.length > 0) {
      return {
        verifier: "protected",
        status: "inconclusive",
        summary: `Claimed protected sections were intact, but ${syntaxErrors[0]}`,
        details: output
      };
    }

    if (parsedBlocks.length > 0) {
      return {
        verifier: "protected",
        status: "pass",
        summary: "Claimed protected sections were intact, and only skipped paths differed."
      };
    }

    // A crash (an uncaught Python exception) also exits 1, with a traceback and no
    // failure lines. That is not an observed modification, so it must not block.
    if (!hasFailureLines(result.stdout)) {
      return {
        verifier: "protected",
        status: "inconclusive",
        summary: "Claimed protected sections were intact, but the protected-section checker failed without reporting any blocks, so Verify could not check them.",
        details: output
      };
    }

    return {
      verifier: "protected",
      status: "fail",
      summary: "Claimed protected sections were intact, but the checker reported protected-section failures.",
      details: output
    };
  }

  return {
    verifier: "protected",
    status: "inconclusive",
    summary: "Claimed protected sections were intact, but Verify could not run the protected-section checker.",
    details: output
  };
}

function findChecker(repoRoot, protectedConfig) {
  if (protectedConfig.checkerPath) {
    const explicitPath = path.isAbsolute(protectedConfig.checkerPath)
      ? protectedConfig.checkerPath
      : path.resolve(repoRoot, protectedConfig.checkerPath);
    return fs.existsSync(explicitPath) ? explicitPath : null;
  }

  // Only the vendored copy otherwise: a checker found inside the repository under verification
  // could be stale, or written to pass.
  const vendored = path.join(VERIFY_ROOT, "vendor", "check-protected-sections.py");
  return fs.existsSync(vendored) ? vendored : null;
}

function parseModifiedBlocks(output) {
  const blocks = [];
  const linePattern = /^x\s+(.+?)\s+\((?:working tree|index)\):.*protected block "([^"]+)"/;

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(linePattern);
    if (!match) {
      continue;
    }
    blocks.push({
      path: normalizeOutputPath(match[1]),
      name: match[2]
    });
  }

  return blocks;
}

function hasFailureLines(stdout) {
  return /^x\s+/m.test(stdout ?? "");
}

function filterSkippedBlocks(blocks, skipPaths) {
  return blocks.filter((block) => {
    const normalized = block.path.replace(/\\/g, "/");
    return !skipPaths.some((skipPath) => {
      const skip = skipPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      return normalized === skip || normalized.startsWith(`${skip}/`);
    });
  });
}

function markerSyntaxErrors(stdout) {
  // Only the checker's own syntax-error lines; a block name can contain the same words.
  const linePattern = /^x\s+(.+?: invalid protected marker syntax in (?:HEAD|working tree|index): .*)$/;
  return (stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(linePattern)?.[1])
    .filter(Boolean);
}

function normalizeOutputPath(filePath) {
  return filePath.replace(/\\/g, "/");
}
