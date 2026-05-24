#!/usr/bin/env node
import { readStdinJson, writeJson } from "../../core/io.mjs";
import { formatBlockReason } from "../../core/format.mjs";
import { verifyFinalMessage } from "../../core/verify.mjs";

try {
  const input = await readStdinJson();
  if (!input || input.stop_hook_active === true) {
    process.exit(0);
  }

  const verification = await verifyFinalMessage(input);
  if (!verification.shouldBlock) {
    process.exit(0);
  }

  writeJson({
    decision: "block",
    reason: formatBlockReason(verification.results)
  });
} catch (error) {
  console.error(`[agent-verify] verification failed: ${error.message}`);
  process.exit(0);
}
