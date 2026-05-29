# Verify is the verification layer for coding agents.

Verify checks what a coding agent claims it did — tests, files, commits, protected content — and makes it correct the record when the claim and the repository disagree.

Linters check your code. Test runners check your code. Nothing checks the agent's *report* of what it did, and that report is the thing you act on. You read "tests pass, branch pushed, nothing leaked," and you move on. If the report is wrong, everything downstream of it inherits the error. Verify checks the report against reality.

Built by Orthogon AI Labs.

V1 supports Claude Code first. Codex support runs as a notification workflow; a Cursor adapter is on the roadmap.

## What makes it trustworthy

Verify is the thing that grades your agent, so it holds itself to the same standard.

- **It never reports a failure it didn't observe.** When Verify can't check a claim — no test command, no `python3`, no upstream branch — it returns `inconclusive` and says so, instead of guessing. A tool that polices honesty has to be honest about its own limits.
- **It surfaces, it never fixes.** Verify reports the mismatch and makes the agent revise its answer. It never rewrites your code. A verifier that edits would just produce more work that needs verifying.
- **It blocks once, then gets out of the way.** One Stop-hook block, one correction. It stays quiet when no claims are made or when every claim checks out.

## Install for Claude Code

From this repo:

```bash
claude --plugin-dir .
```

Once loaded, Verify runs automatically through Claude Code hooks. It stays quiet unless it catches a mismatch.

## What Verify checks

- **Tests** — detects claims like "tests pass" and runs your configured or autodetected test command.
- **Files** — detects claims like "updated `src/foo.ts`" and checks the file was touched this session.
- **Git and PRs** — detects claims like "committed", "pushed", or "opened a PR" and checks local git or `gh` when available.
- **Protected sections** — detects claims like "protected sections are intact" and checks that blocks the user marked protected weren't silently overwritten. Pairs with the [canon](https://github.com/Orthogon-AI-Labs/canon) marker syntax; works standalone via a vendored checker.
- **Secrets** — detects claims like "no secrets committed" or "safe to push" and scans the staged diff (and commits ahead of upstream on a push claim) for credential patterns. Reports the file, line, and pattern name — never the secret value.

Tests and types fail loudly; you see red and fix it. Verify is built for the *silent* failures — a quietly overwritten voice-rules block, a "pushed" that never happened. Those are the ones that cost you a week.

If Verify catches a mismatch, it blocks the Stop hook once and tells the agent to revise:

```text
Verify found claim mismatches. Revise your final answer to include these verification results:
- Claimed tests passed, but `npm test` exited 1.
- Claimed protected sections were intact, but 1 block was modified: docs/voice.md (block: voice-rules).

Do not claim failed or unverified work succeeded.
```

## Codex notification workflow

Codex does not currently use the Claude Code Stop hook. The Codex plugin runs Verify as a notification workflow instead: it checks a final-answer draft and reports what was false, missing, or inconclusive.

```powershell
npm.cmd run codex:notify -- --message "I have run the tests and they all pass."
```

```text
Verify notification: not done or unverified:
- FAILED: Claimed tests passed, but `npm test` exited 1.
```

The Codex plugin skill lives in `skills/verify-claims/` and tells Codex to run this notification before any final answer that claims tests, file changes, commits, pushes, pull requests, or protected-section preservation.

## Configuration

Add `verify.config.json` to the project being worked on:

```json
{
  "test": {
    "command": "npm test",
    "timeoutMs": 120000
  },
  "enabledVerifiers": ["tests", "files", "git", "protected", "secrets"],
  "reportMode": "failures-only",
  "protected": {
    "allowed": [],
    "skipPaths": ["node_modules", "dist", "_archive"],
    "checkerPath": null
  },
  "secrets": {
    "skipPaths": ["node_modules", "dist", "_archive", "*.example", "*.test.*"],
    "allowPatterns": []
  },
  "receipt": {
    "history": false,
    "path": ".verify"
  }
}
```

Config precedence:

1. `verify.config.json`
2. `.verify/config.json`
3. autodetected test command

If no test command can be found, Verify marks the test check inconclusive instead of failing the run. The same rule holds for every verifier: a missing dependency is never reported as a lie.

## Verification receipt

After every run, Verify writes a machine-readable receipt to `.verify/last-receipt.json` (gitignored) recording each claim, what was checked, the per-check result, and what was inconclusive. `inconclusive` is kept as its own outcome — never folded into pass or fail — and no secret value or file body is ever stored.

```bash
agent-verify receipt --print   # dumps the last receipt; exits non-zero iff the last run blocked
```

Set `"receipt": { "history": true }` to also append one line per run to `.verify/history.jsonl`. The receipt is the foundation for CI mode and any "verified" badge — see the [roadmap](ROADMAP.md).

## Demo

```text
Claude: All tests pass and I pushed the branch.

Verify:
- `npm test` exited 1.
- Current branch has no upstream, so Verify could not confirm it was pushed.

Claude: Correction: I was wrong. The tests are failing and I did not verify that the branch was pushed.
```

## Roadmap

The short version: from a local hook to the verification layer the agent ecosystem needs. Full detail and build order in [ROADMAP.md](ROADMAP.md).

- **Shipped** — the protected-sections verifier ([spec 01](docs/specs/01-protected-sections.md)), alongside tests, files, and git.
- **v1.1 (next)** — the secrets verifier ([spec 02](docs/specs/02-secrets.md)): catches "no secrets committed" / "safe to push" claims by scanning the diff for credential patterns. The second of the two worst silent failures, after protected-content overwrites.
- **v1.2** — the **verification receipt** ([spec 03](docs/specs/03-receipt.md)): a machine-readable record of what was claimed, what was checked, and what was inconclusive. The artifact CI mode and any future "verified" badge depend on.
- **v2** — CI mode (verification at the merge boundary), a custom verifier registry for project-specific checks, a Cursor adapter, and native Codex enforcement if Codex exposes lifecycle hooks.

No telemetry, by default or otherwise. Any future "verified" status is backed by the local receipt artifact, not by phoning home.

## Development

```bash
npm test
npm run check
npm run demo
npm run smoke
npm run codex:notify -- --message "All tests pass."
```

Verify has no runtime npm dependencies. Node 18 or newer is required.

## Built by

Verify is built by Orthogon AI Labs, a small lab building tools for safer, more reliable agentic coding workflows. It pairs with [canon](https://github.com/Orthogon-AI-Labs/canon): canon writes and protects your project context; Verify checks that the agent respected it.
