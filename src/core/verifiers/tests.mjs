import { resolveTestCommand } from "../config.mjs";
import { runShellCommand, summarizeOutput } from "../command.mjs";

export async function verifyTestsClaim({ cwd, config }) {
  const testCommand = resolveTestCommand(cwd, config);

  if (!testCommand) {
    return {
      verifier: "tests",
      status: "inconclusive",
      summary: "Claimed tests passed, but Verify could not find a test command.",
      details: "Add verify.config.json with test.command to enable this check."
    };
  }

  const result = await runShellCommand(testCommand.command, {
    cwd,
    timeoutMs: testCommand.timeoutMs
  });

  if (result.exitCode === 0 && !result.timedOut) {
    return {
      verifier: "tests",
      status: "pass",
      summary: `Claimed tests passed, and \`${testCommand.command}\` exited 0.`,
      command: testCommand.command,
      exitCode: result.exitCode,
      durationMs: result.durationMs
    };
  }

  const combinedOutput = summarizeOutput(`${result.stdout}\n${result.stderr}`.trim());
  const reason = result.timedOut
    ? `timed out after ${testCommand.timeoutMs}ms`
    : `exited ${result.exitCode}`;

  return {
    verifier: "tests",
    status: "fail",
    summary: `Claimed tests passed, but \`${testCommand.command}\` ${reason}.`,
    details: combinedOutput,
    command: testCommand.command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: result.timedOut
  };
}
