import { detectClaims } from "./claims.mjs";
import { loadConfig, isVerifierEnabled } from "./config.mjs";
import { getPluginDataRoot, loadSessionEvidence } from "./evidence.mjs";
import { verifyTestsClaim } from "./verifiers/tests.mjs";
import { verifyFileClaim } from "./verifiers/files.mjs";
import { verifyGitClaim } from "./verifiers/git.mjs";
import { verifyProtectedClaim } from "./verifiers/protected.mjs";
import { verifySecretsClaim } from "./verifiers/secrets.mjs";
import { verifyTestFilesClaim } from "./verifiers/unchanged-tests.mjs";
import { workElsewhere } from "./elsewhere.mjs";

const CLAIM_WORDS = {
  tests: "Claimed tests passed",
  committed: "Claimed a commit was made",
  pushed: "Claimed the branch was pushed",
  "opened-pr": "Claimed a PR was opened"
};

export async function verifyFinalMessage(input, options = {}) {
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || input.sessionId || "manual";
  const finalMessage = getFinalMessage(input);
  const config = options.config ?? loadConfig(cwd);
  const dataRoot = options.dataRoot ?? getPluginDataRoot();
  const evidence = options.evidence ?? loadSessionEvidence(dataRoot, sessionId, cwd);
  const claims = detectClaims(finalMessage);
  const results = [];
  const elsewhere = claims.some((claim) => claim.type === "tests" || claim.type === "git")
    ? await workElsewhere(cwd, evidence)
    : null;

  if (claims.some((claim) => claim.type === "tests") && isVerifierEnabled(config, "tests")) {
    results.push(elsewhere ? elsewhereResult("tests", CLAIM_WORDS.tests, elsewhere) : await verifyTestsClaim({ cwd, config, evidence }));
  }

  if (isVerifierEnabled(config, "files")) {
    for (const claim of claims.filter((item) => item.type === "file")) {
      results.push(verifyFileClaim({ cwd, claim, evidence }));
    }
  }

  if (isVerifierEnabled(config, "git")) {
    for (const claim of claims.filter((item) => item.type === "git")) {
      results.push(elsewhere && CLAIM_WORDS[claim.action]
        ? elsewhereResult("git", CLAIM_WORDS[claim.action], elsewhere)
        : await verifyGitClaim({ cwd, claim, evidence }));
    }
  }

  if (isVerifierEnabled(config, "protected")) {
    for (const claim of claims.filter((item) => item.type === "protected")) {
      results.push(await verifyProtectedClaim({ cwd, claim, evidence, config }));
    }
  }

  if (isVerifierEnabled(config, "secrets")) {
    for (const claim of claims.filter((item) => item.type === "secrets")) {
      results.push(await verifySecretsClaim({ cwd, claim, evidence, config }));
    }
  }

  const testFilesClaim = claims.find((claim) => claim.type === "testfiles");
  if (testFilesClaim && isVerifierEnabled(config, "testfiles")) {
    results.push(await verifyTestFilesClaim({ cwd, claim: testFilesClaim, evidence }));
  }

  return {
    cwd,
    sessionId,
    config,
    evidence,
    claims,
    results,
    shouldBlock: results.some((result) => result.status === "fail")
  };
}

function elsewhereResult(verifier, claimed, { cwdRoot, roots }) {
  return {
    verifier,
    status: "inconclusive",
    summary: `${claimed}, but this turn's edits and commands were in ${roots.map((root) => `\`${root}\``).join(", ")}, not \`${cwdRoot}\`, so Verify did not check it here.`
  };
}

function getFinalMessage(input) {
  return input.last_assistant_message
    ?? input.lastAssistantMessage
    ?? input.message
    ?? input.response
    ?? "";
}
