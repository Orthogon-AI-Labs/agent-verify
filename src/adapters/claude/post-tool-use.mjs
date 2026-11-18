#!/usr/bin/env node
import { readStdinJson } from "../../core/io.mjs";
import { recordPostToolUse } from "../../core/evidence.mjs";

try {
  const input = await readStdinJson();
  if (input) {
    // Claude Code's hooks.json also sends failed Bash commands (PostToolUseFailure) and says so with this flag.
    recordPostToolUse(input, undefined, { failedCommandsRecorded: process.argv.includes("--failed-commands-recorded") });
  }
} catch (error) {
  console.error(`[agent-verify] failed to record hook evidence: ${error.message}`);
}
