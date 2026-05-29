import { detectClaims } from "./claims.mjs";
import { loadConfig, isVerifierEnabled } from "./config.mjs";
import { getPluginDataRoot, loadSessionEvidence } from "./evidence.mjs";
import { verifyTestsClaim } from "./verifiers/tests.mjs";
import { verifyFileClaim } from "./verifiers/files.mjs";
import { verifyGitClaim } from "./verifiers/git.mjs";
import { verifyProtectedClaim } from "./verifiers/protected.mjs";
import { verifySecretsClaim } from "./verifiers/secrets.mjs";

export async function verifyFinalMessage(input, options = {}) {
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || input.sessionId || "manual";
  const finalMessage = getFinalMessage(input);
  const config = options.config ?? loadConfig(cwd);
  const dataRoot = options.dataRoot ?? getPluginDataRoot();
  const evidence = options.evidence ?? loadSessionEvidence(dataRoot, sessionId, cwd);
  const claims = detectClaims(finalMessage);
  const results = [];

  if (claims.some((claim) => claim.type === "tests") && isVerifierEnabled(config, "tests")) {
    results.push(await verifyTestsClaim({ cwd, config, evidence }));
  }

  if (isVerifierEnabled(config, "files")) {
    for (const claim of claims.filter((item) => item.type === "file")) {
      results.push(verifyFileClaim({ cwd, claim, evidence }));
    }
  }

  if (isVerifierEnabled(config, "git")) {
    for (const claim of claims.filter((item) => item.type === "git")) {
      results.push(await verifyGitClaim({ cwd, claim, evidence }));
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

function getFinalMessage(input) {
  return input.last_assistant_message
    ?? input.lastAssistantMessage
    ?? input.message
    ?? input.response
    ?? "";
}
