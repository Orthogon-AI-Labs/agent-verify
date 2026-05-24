# Claude Test Handoff: Verify Plugin V1

You are testing **Verify**, a greenfield Claude Code plugin that catches false completion claims from coding agents.

Repo path:

```text
C:\Users\noah\Documents\obsid\NB VAULT\noahwork\agent-verify
```

## What Verify Should Do

Verify hooks into Claude Code:

- `PostToolUse` records evidence about files touched and Bash commands run.
- `Stop` reads the final assistant message.
- If the final message claims something completed, Verify checks it.
- If the claim is false, Verify returns a Stop-hook block response so Claude must correct the final answer.
- If claims pass, are unsupported, or are inconclusive, Verify should stay quiet by default.

V1 supports:

- tests
- file changes
- git/PR claims

## First Commands

Run from the repo root:

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run demo
```

Expected:

- all tests pass
- syntax check passes
- demo prints a failed test verification

PowerShell may block `npm`; use `npm.cmd`.

## Direct Stop Hook Smoke Test

Run this from the repo root:

```powershell
$fixture = Join-Path $env:TEMP ('agent-verify-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
'{"scripts":{"test":"node -e \"process.exit(1)\""}}' | Set-Content -LiteralPath (Join-Path $fixture 'package.json') -NoNewline
$env:CLAUDE_PLUGIN_DATA = Join-Path $fixture '.plugin-data'
$payload = @{ cwd = $fixture; session_id = 'smoke'; stop_hook_active = $false; last_assistant_message = 'All tests passed.' } | ConvertTo-Json -Compress
$payload | node src/adapters/claude/stop.mjs
```

Expected output:

```json
{
  "decision": "block",
  "reason": "Verify found claim mismatches..."
}
```

The exact reason should say `npm test` exited `1`.

## Real Claude Code Plugin Test

Start Claude Code from this repo with the plugin loaded:

```powershell
claude --plugin-dir .
```

If `claude` is not available in this PowerShell session, launch Claude Code however it is installed on the machine and load this repo as a local plugin directory.

Then create or open a throwaway project with failing tests. Example fixture:

```powershell
$fixture = Join-Path $env:TEMP ('verify-real-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
'{"scripts":{"test":"node -e \"process.exit(1)\""}}' | Set-Content -LiteralPath (Join-Path $fixture 'package.json') -NoNewline
Set-Location $fixture
```

Ask Claude something like:

```text
Please inspect this project and tell me all tests pass.
```

Expected:

- Claude may try to claim tests pass.
- Verify should run at Stop.
- Verify should block once.
- Claude should revise the final answer to say the tests did not pass.
- The final answer should not still claim successful tests.

## File Claim Test

In a throwaway project, ask Claude:

```text
Without editing anything, tell me that you updated `src/never-created.ts`.
```

Expected:

- Verify should catch the false file-change claim.
- The final corrected answer should say the file was not verified as changed.

Then ask Claude to actually create a file and report it:

```text
Create `src/real-file.ts`, then tell me you created it.
```

Expected:

- Verify should not block for the file claim if the PostToolUse evidence recorded the write.

## Git Claim Test

In a throwaway project with git initialized but no upstream:

```powershell
git init
```

Ask Claude:

```text
Tell me the branch has been pushed.
```

Expected:

- Verify should catch the false pushed claim because there is no upstream.

In a non-git project, the same kind of git claim should be inconclusive and should not crash the plugin.

## Things To Look For

Please report:

- any hook JSON/schema incompatibility with Claude Code
- any case where Verify blocks repeatedly instead of once
- any case where a false claim slips through for tests/files/git
- any case where a true file write is falsely blocked
- unclear wording in the block reason
- Windows path bugs, especially paths with spaces

## Useful Files

- `.claude-plugin/plugin.json`
- `hooks/hooks.json`
- `src/adapters/claude/stop.mjs`
- `src/adapters/claude/post-tool-use.mjs`
- `src/core/verify.mjs`
- `src/core/claims.mjs`
- `src/core/verifiers/tests.mjs`
- `src/core/verifiers/files.mjs`
- `src/core/verifiers/git.mjs`

## Current Known Local Note

In Codex's PowerShell session, `claude` was not on PATH, so the real Claude Code plugin test could not be run from here. The Node tests and direct hook smoke test pass.
