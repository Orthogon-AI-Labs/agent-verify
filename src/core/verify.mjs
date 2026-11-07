import { detectClaims } from "./claims.mjs";
import { loadConfig, isVerifierEnabled } from "./config.mjs";
import { getPluginDataRoot, loadSessionEvidence } from "./evidence.mjs";
import { verifyTestsClaim } from "./verifiers/tests.mjs";
import { verifyFileClaim } from "./verifiers/files.mjs";
import { verifyGitClaim } from "./verifiers/git.mjs";
import { verifyProtectedClaim } from "./verifiers/protected.mjs";
import { verifySecretsClaim } from "./verifiers/secrets.mjs";
import { verifyTestFilesClaim } from "./verifiers/unchanged-tests.mjs";
import { otherBranchPr, pushRoots, workElsewhere } from "./elsewhere.mjs";

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
  // Claims in the same sentence look its PRs up once.
  const lookups = new Map();
  const otherPr = (claim) => {
    if (!lookups.has(claim.sentence)) {
      lookups.set(claim.sentence, otherBranchPr(cwd, claim.sentence));
    }
    return lookups.get(claim.sentence);
  };

  const testClaim = claims.find((claim) => claim.type === "tests");
  if (testClaim && isVerifierEnabled(config, "tests")) {
    results.push(await checkHere("tests", CLAIM_WORDS.tests, testClaim, elsewhere, otherPr, () => verifyTestsClaim({ cwd, config, evidence })));
  }

  if (isVerifierEnabled(config, "files")) {
    for (const claim of claims.filter((item) => item.type === "file")) {
      results.push(verifyFileClaim({ cwd, claim, evidence }));
    }
  }

  if (isVerifierEnabled(config, "git")) {
    let roots;
    for (const claim of claims.filter((item) => item.type === "git")) {
      const check = () => verifyGitClaim({ cwd, claim, evidence });
      if (claim.action === "pushed" && (roots ??= await pushRoots(cwd, evidence))) {
        results.push(await pushedAt(roots, claim, evidence));
        continue;
      }
      results.push(CLAIM_WORDS[claim.action] ? await checkHere("git", CLAIM_WORDS[claim.action], claim, elsewhere, otherPr, check) : await check());
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

// A claim is checked at cwd unless the turn's work was all in other checkouts, or its sentence names an open PR on
// another branch.
async function checkHere(verifier, claimed, claim, elsewhere, otherPr, check) {
  if (elsewhere) {
    return elsewhereResult(verifier, claimed, elsewhere);
  }
  const other = await otherPr(claim);
  return other
    ? {
        verifier,
        status: "inconclusive",
        summary: `${claimed}, but the claim is about PR #${other.pr} on \`${other.branch}\`, and this folder is on \`${other.cwdBranch}\`, so Verify did not check it here.`
      }
    : await check();
}

// A push claim when this turn pushed only from other checkouts: checked in each, and the worst result kept.
async function pushedAt(roots, claim, evidence) {
  const results = [];
  for (const root of roots) {
    results.push({ root, ...(await verifyGitClaim({ cwd: root, claim, evidence })) });
  }
  const { root, ...worst } = results.find((result) => result.status === "fail")
    ?? results.find((result) => result.status === "inconclusive")
    ?? results[0];
  return { ...worst, summary: `${worst.summary} Checked in \`${root}\`, where this turn ran \`git push\`.` };
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
