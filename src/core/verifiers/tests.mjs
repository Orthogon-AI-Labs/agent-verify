import { resolveTestCommand } from "../config.mjs";
import { commandProgram, findExecutable, runShellCommand, summarizeOutput } from "../command.mjs";

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

  // "Command not found" from the shell says nothing about the tests: the program that runs them isn't installed.
  const program = commandProgram(testCommand.command);
  if ((result.exitCode === 127 || result.exitCode === 9009) && !findExecutable(program, cwd)) {
    return {
      verifier: "tests",
      status: "inconclusive",
      summary: `Claimed tests passed, but \`${program}\` is not installed, so Verify could not run \`${testCommand.command}\`.`,
      details: combinedOutput,
      command: testCommand.command,
      exitCode: result.exitCode
    };
  }
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
