import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { formatTextReport } from "../src/core/format.mjs";
import { emptyEvidence } from "../src/core/evidence.mjs";
import { verifyFinalMessage } from "../src/core/verify.mjs";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-demo-"));
fs.writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
  scripts: {
    test: "node -e \"process.exit(1)\""
  }
}, null, 2));

const evidence = emptyEvidence("demo", cwd);
const verification = await verifyFinalMessage({
  cwd,
  session_id: "demo",
  last_assistant_message: "All tests pass and I pushed the branch."
}, {
  evidence
});

process.stdout.write(`${formatTextReport(verification.results)}\n`);
process.stdout.write("\nDemo complete: Verify detected the false claim above.\n");
