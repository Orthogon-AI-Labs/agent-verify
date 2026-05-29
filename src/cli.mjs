#!/usr/bin/env node
import { formatTextReport } from "./core/format.mjs";
import { verifyFinalMessage } from "./core/verify.mjs";
import { loadConfig } from "./core/config.mjs";
import { writeReceipt, readLastReceipt } from "./core/receipt.mjs";

const args = process.argv.slice(2);

function readArg(name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    return fallback;
  }
  return args[index + 1];
}

if (args[0] === "receipt") {
  const cwd = readArg("--cwd", process.cwd());
  if (!args.includes("--print")) {
    process.stdout.write("Usage: agent-verify receipt --print [--cwd /path/to/project]\n");
    process.exit(0);
  }

  const receipt = readLastReceipt(cwd, loadConfig(cwd));
  if (!receipt) {
    process.stdout.write("No receipt found. Run Verify first.\n");
    process.exit(0);
  }

  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exit(receipt.outcome?.blocked ? 1 : 0);
}

const messageIndex = args.indexOf("--message");

if (args.includes("--help") || messageIndex === -1 || !args[messageIndex + 1]) {
  process.stdout.write(
    "Usage: agent-verify --message \"tests pass\" [--cwd /path/to/project]\n" +
    "   or: agent-verify receipt --print [--cwd /path/to/project]\n"
  );
  process.exit(args.includes("--help") ? 0 : 1);
}

const verification = await verifyFinalMessage({
  cwd: readArg("--cwd", process.cwd()),
  session_id: "manual",
  last_assistant_message: args[messageIndex + 1]
});

try {
  await writeReceipt(verification, { cwd: verification.cwd, config: verification.config });
} catch (error) {
  process.stderr.write(`[agent-verify] could not write receipt: ${error.message}\n`);
}

process.stdout.write(`${formatTextReport(verification.results)}\n`);
process.exit(verification.shouldBlock ? 1 : 0);
