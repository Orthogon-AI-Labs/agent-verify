#!/usr/bin/env node
import { formatTextReport } from "./core/format.mjs";
import { verifyFinalMessage } from "./core/verify.mjs";

const args = process.argv.slice(2);
const messageIndex = args.indexOf("--message");
const cwdIndex = args.indexOf("--cwd");

if (args.includes("--help") || messageIndex === -1 || !args[messageIndex + 1]) {
  process.stdout.write(`Usage: agent-verify --message "tests pass" [--cwd /path/to/project]\n`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const verification = await verifyFinalMessage({
  cwd: cwdIndex >= 0 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd(),
  session_id: "manual",
  last_assistant_message: args[messageIndex + 1]
});

process.stdout.write(`${formatTextReport(verification.results)}\n`);
process.exit(verification.shouldBlock ? 1 : 0);
