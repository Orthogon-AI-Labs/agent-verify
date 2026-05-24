#!/usr/bin/env node
import { readStdinJson } from "../../core/io.mjs";
import { recordPostToolUse } from "../../core/evidence.mjs";

try {
  const input = await readStdinJson();
  if (input) {
    recordPostToolUse(input);
  }
} catch (error) {
  console.error(`[agent-verify] failed to record hook evidence: ${error.message}`);
}
