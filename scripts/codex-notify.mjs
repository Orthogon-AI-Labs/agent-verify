#!/usr/bin/env node
import { verifyFinalMessage } from "../src/core/verify.mjs";
import { formatNotificationItems } from "../src/core/format.mjs";

const args = process.argv.slice(2);
const message = readArg("--message");
const cwd = readArg("--cwd") ?? process.cwd();

if (!message || args.includes("--help")) {
  process.stdout.write("Usage: npm run codex:notify -- --message \"final answer draft\" [--cwd /path/to/project]\n");
  process.exit(0);
}

const verification = await verifyFinalMessage({
  cwd,
  session_id: "codex-notify",
  last_assistant_message: message
});

const actionable = verification.results.filter((result) => {
  return result.status === "fail" || result.status === "inconclusive";
});

if (verification.claims.length === 0) {
  process.stdout.write("Verify notification: no supported completion claims detected.\n");
  process.exit(0);
}

if (actionable.length === 0) {
  process.stdout.write("Verify notification: all detected claims checked out.\n");
  process.exit(0);
}

process.stdout.write("Verify notification: not done or unverified:\n");
process.stdout.write(`${formatNotificationItems(actionable)}\n`);
process.exit(0);

function readArg(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return null;
  }
  return args[index + 1] || null;
}
