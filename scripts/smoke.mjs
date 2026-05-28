import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stopHook = path.join(repoRoot, "src", "adapters", "claude", "stop.mjs");

const smokeTests = [
  {
    name: "natural test claim with BOM package.json",
    message: "I have run the tests and they all pass.",
    setup(fixture) {
      writeBomJson(path.join(fixture, "package.json"), {
        scripts: {
          test: `${JSON.stringify(process.execPath)} -e "process.exit(1)"`
        }
      });
    },
    reasonPattern: /npm test.*exited 1/s
  },
  {
    name: "bare file path claim",
    message: "I updated src/never-created.ts.",
    setup() {},
    reasonPattern: /src\/never-created\.ts.*file does not exist/s
  },
  {
    name: "modified protected section claim",
    message: "Protected sections are intact.",
    async setup(fixture) {
      const file = path.join(fixture, "docs", "protected.md");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, protectedBlock("Original protected text."));
      await runCommand("git", ["init"], fixture);
      await runCommand("git", ["config", "user.email", "verify@example.com"], fixture);
      await runCommand("git", ["config", "user.name", "Verify Smoke"], fixture);
      await runCommand("git", ["add", "."], fixture);
      await runCommand("git", ["commit", "-m", "initial protected content"], fixture);
      fs.writeFileSync(file, protectedBlock("Changed protected text."));
    },
    reasonPattern: /protected sections were intact.*docs\/protected\.md \(block: example\)/s
  }
];

for (const smokeTest of smokeTests) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "agent-verify-smoke-"));
  await smokeTest.setup(fixture);

  const payload = {
    cwd: fixture,
    session_id: smokeTest.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
    stop_hook_active: false,
    last_assistant_message: smokeTest.message
  };

  const stdout = await runStopHook(payload, {
    CLAUDE_PLUGIN_DATA: path.join(fixture, ".plugin-data")
  });
  const decoded = parseHookOutput(stdout);

  if (decoded.decision !== "block") {
    throw new Error(`${smokeTest.name}: expected block decision, got ${JSON.stringify(decoded)}`);
  }

  if (!smokeTest.reasonPattern.test(decoded.reason)) {
    throw new Error(`${smokeTest.name}: block reason did not match ${smokeTest.reasonPattern}\n${decoded.reason}`);
  }

  process.stdout.write(`PASS ${smokeTest.name}\n`);
}

process.stdout.write("Smoke tests passed.\n");

function runStopHook(payload, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [stopHook], {
      cwd: repoRoot,
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`stop hook exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout);
    });

    child.stdin.end(JSON.stringify(payload));
  });
}

function parseHookOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("stop hook produced no output");
  }
  return JSON.parse(trimmed);
}

function writeBomJson(file, value) {
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(value), "utf8")
  ]));
}

function protectedBlock(body) {
  return [
    "# Protected",
    "",
    "<!-- canon:protected:start name=\"example\" -->",
    body,
    "<!-- canon:protected:end -->",
    ""
  ].join("\n");
}

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr || stdout}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
