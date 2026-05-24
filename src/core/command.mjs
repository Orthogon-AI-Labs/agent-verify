import { spawn } from "node:child_process";

const DEFAULT_MAX_OUTPUT_CHARS = 12000;

export function runShellCommand(command, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: options.cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1"
      },
      shell: true,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 120000);

    child.stdout?.on("data", (chunk) => {
      stdout = appendCapped(stdout, chunk, maxOutputChars);
    });

    child.stderr?.on("data", (chunk) => {
      stderr = appendCapped(stderr, chunk, maxOutputChars);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command,
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        command,
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

export function runBinary(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 30000);

    child.stdout?.on("data", (chunk) => {
      stdout = appendCapped(stdout, chunk, maxOutputChars);
    });

    child.stderr?.on("data", (chunk) => {
      stderr = appendCapped(stderr, chunk, maxOutputChars);
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        command: [command, ...args].join(" "),
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        command: [command, ...args].join(" "),
        exitCode,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - startedAt
      });
    });
  });
}

export function summarizeOutput(output, maxLines = 12, maxChars = 1200) {
  const lines = String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const selected = lines.slice(-maxLines).join("\n");
  if (selected.length <= maxChars) {
    return selected;
  }

  return `${selected.slice(0, maxChars)}...`;
}

function appendCapped(current, chunk, maxChars) {
  const next = current + String(chunk);
  if (next.length <= maxChars) {
    return next;
  }
  return next.slice(next.length - maxChars);
}
