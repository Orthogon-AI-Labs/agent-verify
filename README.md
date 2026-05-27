# Verify catches false completion claims from coding agents.

Verify is a Claude Code plugin that checks the claims an agent makes before the final answer closes. If the agent says tests pass, a file changed, or a branch was pushed, Verify checks the project and makes Claude correct the answer when reality disagrees.

V1 supports Claude Code first. Codex support is available as a notification workflow, and Cursor adapters are launching in the coming days.

## Install for Claude Code

From this repo:

```bash
claude --plugin-dir .
```

Once loaded, Verify runs automatically through Claude Code hooks. It stays quiet when no supported claims are made or when every detected claim checks out.

## What V1 Checks

- **Tests:** detects claims like "tests pass" and runs your configured or autodetected test command.
- **Files:** detects claims like "updated `src/foo.ts`" and checks that the file was touched this session.
- **Git and PRs:** detects claims like "committed", "pushed", or "opened a PR" and checks local git or `gh` when available.

If Verify catches a mismatch, it blocks the Stop hook once and tells Claude to revise the final response.

```text
Verify found claim mismatches. Revise your final answer to include these verification results:
- Claimed tests passed, but `npm test` exited 1.

Do not claim failed or unverified work succeeded.
```

## Codex Notification Workflow

Codex does not currently use the Claude Code Stop hook. The Codex plugin therefore runs Verify as a notification workflow: it checks a final-answer draft and reports what was false, missing, or inconclusive.

```powershell
npm.cmd run codex:notify -- --message "I have run the tests and they all pass."
```

Example output:

```text
Verify notification: not done or unverified:
- FAILED: Claimed tests passed, but `npm test` exited 1.
```

The Codex plugin skill lives in `skills/verify-claims/` and tells Codex to run this notification before final answers that claim tests, file changes, commits, pushes, or pull requests.

## Configuration

Add `verify.config.json` to the project being worked on:

```json
{
  "test": {
    "command": "npm test",
    "timeoutMs": 120000
  },
  "enabledVerifiers": ["tests", "files", "git"],
  "reportMode": "failures-only"
}
```

Config precedence:

1. `verify.config.json`
2. `.verify/config.json`
3. autodetected test command

If no test command can be found, Verify marks the test check inconclusive instead of failing the run.

## Demo

```text
Claude: All tests pass and I pushed the branch.

Verify:
- `npm test` exited 1.
- Current branch has no upstream, so Verify could not confirm it was pushed.

Claude: Correction: I was wrong. The tests are failing and I did not verify that the branch was pushed.
```

## V2 Roadmap

- Cursor adapter using the same core verifier engine.
- Native Codex enforcement if Codex exposes lifecycle hooks.
- Custom verifier registry for project-specific checks like lint, deploy, and health checks.
- Migration verifiers for Alembic, Prisma, Rails, and Django.
- Language-aware symbol/function verification.
- Local verification history.
- Optional local-only ShelfAI Pro nudge after repeated failures, with no telemetry by default.

## Development

```bash
npm test
npm run check
npm run demo
```

Verify has no runtime npm dependencies. Node 18 or newer is required.

## ShelfAI Pro

Verify is the free, local-first wedge. ShelfAI Pro is the team layer for audit trails, policy enforcement, and organization-level agent governance.
