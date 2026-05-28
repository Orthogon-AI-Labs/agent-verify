# Verify catches false completion claims from coding agents.

Verify is a Claude Code plugin that checks the claims an agent makes before the final answer closes. If the agent says tests pass, a file changed, or a branch was pushed, Verify checks the project and makes Claude correct the answer when reality disagrees.

Built by Orthogon Labs.

V1 supports Claude Code first. Codex support is available as a notification workflow, and Cursor adapters are launching in the coming days.

## Install for Claude Code

From this repo:

```bash
claude --plugin-dir .
```

Once loaded, Verify runs automatically through Claude Code hooks. It stays quiet when no supported claims are made or when every detected claim checks out.

## What Verify Checks

- **Tests:** detects claims like "tests pass" and runs your configured or autodetected test command.
- **Files:** detects claims like "updated `src/foo.ts`" and checks that the file was touched this session.
- **Git and PRs:** detects claims like "committed", "pushed", or "opened a PR" and checks local git or `gh` when available.
- **Protected sections:** detects claims like "protected sections are intact" and checks canon-style protected Markdown blocks against `HEAD`.

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
  "enabledVerifiers": ["tests", "files", "git", "protected"],
  "reportMode": "failures-only",
  "protected": {
    "allowed": [],
    "skipPaths": ["node_modules", "dist", "_archive"],
    "checkerPath": null
  }
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

## Protected Sections

The protected-sections verifier catches a class of agent failure the other verifiers don't: silent overwrites of content the user marked as protected.

Mark a chunk of any Markdown file with canon's marker pair:

```markdown
<!-- canon:protected:start name="voice-rules" -->

Write like a tired senior engineer. No marketing language.
Never use the word "delve."

<!-- canon:protected:end -->
```

If the agent claims `"protected sections are intact"` but actually modified one of these blocks, Verify catches the mismatch and reports the file and block name. The checker is vendored, so Verify works standalone; the same marker convention also pairs with the sibling [canon](https://github.com/Orthogon-AI-Labs/canon) plugin.

Implementation details and acceptance criteria: see [docs/specs/01-protected-sections.md](docs/specs/01-protected-sections.md).

## V2 Roadmap

- Cursor adapter using the same core verifier engine.
- Native Codex enforcement if Codex exposes lifecycle hooks.
- Custom verifier registry for project-specific checks like lint, deploy, and health checks.
- Migration verifiers for Alembic, Prisma, Rails, and Django.
- Language-aware symbol/function verification.
- Local verification history.
- Optional team reporting for repeated verification failures, with no telemetry by default.

## Development

```bash
npm test
npm run check
npm run demo
npm run smoke
npm run codex:notify -- --message "All tests pass."
```

Verify has no runtime npm dependencies. Node 18 or newer is required.

## Built By

Verify is built by Orthogon AI Labs, a small lab building tools for safer, more reliable agentic coding workflows.
