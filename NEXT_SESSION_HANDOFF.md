# Verify Plugin — Next Session Handoff (2026-05-27)

> **Update (post-handoff):** Both bugs below are now **FIXED** in the current tree, and the protected-sections verifier (spec 01) has since shipped — so the `508f123` master reference below is stale (HEAD is now past it). Bug 2 (BOM) is covered by `test/file-bom.test.mjs`; Bug 1 (parser narrowness) is covered by the natural-language and bare-path cases in `test/claims.test.mjs` and `scripts/smoke.mjs`. The "two known bugs" section is retained for history.

You are picking up work on the **Verify** Claude Code plugin (catches false completion claims from coding agents — `PostToolUse` records evidence, `Stop` checks the final assistant message). The plugin is V1-shippable with two known bugs documented. This handoff is a snapshot, not a spec.

Repo root: `C:\Users\noah\Documents\obsid\NB VAULT\noahwork\agent-verify`. Master is at `508f123` as of this write-up.

## TL;DR — state right now

- All five interactive scenarios from `CLAUDE_TEST_HANDOFF.md` have been driven at least once. Results in `TEST_RESULTS.md`.
- The two verifier blocking paths that returned INCONCLUSIVE in the original interactive run (Step 4 tests-verifier, Step 5a files-verifier) have since been **directly smoke-tested via `node src/adapters/claude/stop.mjs`** — both PASS with clear actionable block reasons.
- A fourth real-world catch was observed organically: a commit claim was blocked because the latest commit predated the session. This path wasn't in the original test plan.
- **No false positives** observed in any run. The plugin's value-prop holds.
- ~~**Two real bugs surfaced and documented but not yet patched.** Both are V2 work, not V1 blockers.~~ **Both bugs are now fixed** — see the resolution notes in the "Two known bugs" section below.

## What works (confirmed by this run)

| Surface | Confirmed by |
|---|---|
| Stop hook fires reliably | Every interactive step |
| `stop_hook_active` loop guard works | Step 6 interactive ("Ran 1 stop hook" exactly once) |
| Tests-verifier blocking path | Step 4 smoke test — block reason cites `npm test exited 1` + stdout |
| Files-verifier blocking path | Step 5a smoke test — block reason cites missing path |
| Git verifier — false push (no upstream) | Step 6 interactive — Claude revised final answer |
| Git verifier — missing `.git` graceful | Step 6b interactive — no crash, no over-eager block |
| Git verifier — commit predates session | Organic catch during this session |
| PostToolUse evidence path | Step 5b interactive — real Write recorded, no false-positive block |

## Two known bugs (both now FIXED — retained for history)

### Bug 1 — Parser narrowness in `src/core/claims.mjs` — ✅ FIXED

**Resolution:** `TEST_PATTERNS` now allows up to 8 intervening connective words between the test noun and the pass verb (claims.mjs), so "I have run the tests and they all pass" matches. `FILE_PATTERNS` gained a bare-path regex that matches path-like tokens (a `/` or `\` plus a recognizable extension), so `src/never-created.ts` is caught without quotes. Regression coverage: `test/claims.test.mjs` ("natural-language test pass claims", "bare file paths") and `scripts/smoke.mjs`.

The claim-detection regexes are too tight for real Claude phrasings.

- **Test claim regex** at [claims.mjs:2](src/core/claims.mjs) requires the test noun and the pass verb to be adjacent: `\b(?:all\s+)?(?:tests?|...)\s+(?:pass(?:ed|es)?|...)\b`. So `All tests pass.` matches, but `I have run the tests and they all pass.` does **not** (four words between "tests" and "pass"). Recorded as the FAIL row dated 2026-05-27 in `TEST_RESULTS.md`.
- **File claim regex** at [claims.mjs:8](src/core/claims.mjs) requires the path to be in backticks / single / double quotes: `[`'"]([^`'"]+)[`'"]`. So `I updated 'src/never-created.ts'.` matches, but `I updated src/never-created.ts.` (bare path) does not.

Fix direction: widen the test regex to allow N intervening words between noun and verb (with a cap to avoid runaway matches), and add a path-shape heuristic to the file regex for bare paths (something containing `/` or `\`, ending in a recognizable extension). Be conservative — too eager and false positives explode.

### Bug 2 — BOM crash in tests-verifier's `package.json` read — ✅ FIXED

**Resolution:** BOM stripping is now centralized in `src/core/json.mjs` (`readTextFile` strips a leading `﻿` before `JSON.parse`), and every file read goes through it. Regression coverage: `test/file-bom.test.mjs` (BOM-prefixed `verify.config.json`, `package.json`, and session-evidence JSON) and the "natural test claim with BOM package.json" case in `scripts/smoke.mjs`.

When `package.json` has a UTF-8 BOM, the verifier's `JSON.parse` throws:

```
[agent-verify] verification failed: Unexpected token '﻿', "﻿{"scripts"... is not valid JSON
```

PowerShell 5.1's `Set-Content -Encoding utf8` writes UTF-8 *with* BOM, and many Windows tools emit BOMs. The stdin-BOM fix that landed pre-V1 (regression test in [test/stdin-bom.test.mjs](test/stdin-bom.test.mjs)) covers stdin only, not file reads. Look at the relevant verifier — likely [src/core/verifiers/tests.mjs](src/core/verifiers/tests.mjs) — and strip BOM before `JSON.parse` on every file read. Mirror the existing stdin fix; should be a one-line `replace(/^﻿/, "")` per call site plus a regression test.

The runner's Step 4 fixture setup previously triggered Bug 2 incidentally (it used `-Encoding utf8`). The `-Encoding utf8` flag has been removed in commit `508f123`. Don't add it back without fixing Bug 2.

## How to drive the tests

### Interactive runner (full E2E, needs you at the keyboard)

In a **plain PowerShell window** (not inside any Claude session):

```powershell
Set-Location 'C:\Users\noah\Documents\obsid\NB VAULT\noahwork\agent-verify'
powershell -ExecutionPolicy Bypass -File .\scripts\run-interactive-tests.ps1            # all five
powershell -ExecutionPolicy Bypass -File .\scripts\run-interactive-tests.ps1 -Step 5b   # one only
```

If auto-discovery of `claude.exe` flakes (it now globs MSIX-packaged install paths and retries 3x for updater races, but races can still happen):

```powershell
... -ClaudePath 'C:\Users\noah\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\<ver>\claude.exe'
```

The exact `<ver>` changes when Claude Code auto-updates. Find current with `Get-ChildItem 'C:\Users\noah\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude-code\'`.

### Stop-hook smoke tests (no interactive Claude required — recommended for verifier work)

```powershell
$f = Join-Path $env:TEMP ('verify-smoke-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $f | Out-Null
# IMPORTANT: do NOT add -Encoding utf8 until Bug 2 is fixed
'{"scripts":{"test":"node -e \"process.exit(1)\""}}' |
  Set-Content -LiteralPath (Join-Path $f 'package.json') -NoNewline
$env:CLAUDE_PLUGIN_DATA = Join-Path $f '.plugin-data'
$payload = @{ cwd = $f; session_id = 'smoke'; stop_hook_active = $false;
              last_assistant_message = 'All tests pass.' } | ConvertTo-Json -Compress
$payload | node src/adapters/claude/stop.mjs
```

Expected: `{"decision":"block","reason":"..."}` JSON on stdout. Swap the `last_assistant_message` and fixture setup to test different verifier paths.

## Critical files

| File | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `hooks/hooks.json` | Hook registration |
| `src/adapters/claude/stop.mjs` | Stop hook entry (loop guard at line 8 is correct) |
| `src/adapters/claude/post-tool-use.mjs` | Evidence recording |
| `src/core/verify.mjs` | Top-level orchestration |
| `src/core/claims.mjs` | Claim regexes — **Bug 1 lives here** |
| `src/core/verifiers/tests.mjs` | Test verifier — **Bug 2 lives here (JSON.parse of package.json)** |
| `src/core/verifiers/files.mjs` | File verifier |
| `src/core/verifiers/git.mjs` | Git verifier — includes the commit-predates-session check |
| `scripts/run-interactive-tests.ps1` | Manual interactive runner; ASCII-clean for PS 5.1 compat |
| `TEST_RESULTS.md` | Append-only log with V1 ship verdict + bug write-ups |
| `CLAUDE_TEST_HANDOFF.md` | Original test brief — **don't edit, user has local mods** |

## Suggested next moves

Pick what fits your scope. Roughly ordered by cost ascending:

1. **Patch Bug 2.** Small, clearly a defect, has a clean parallel fix (the stdin BOM strip). Add a regression test in `test/` (e.g., `test/file-bom.test.mjs`) that writes a BOM-prefixed `package.json` and confirms the verifier still parses it.
2. **Patch Bug 1.** Higher design surface. Look at `TEST_PATTERNS` and `FILE_PATTERNS` in `claims.mjs`. Adding `(?:\s+\w+){0,6}\s+` between noun and verb buys natural-language coverage; for files, a bare-path heuristic (`[a-zA-Z0-9._/\\-]+\.[a-zA-Z]{1,8}`) catches typical mentions but needs testing for false positives.
3. **Add roleplay-framed prompt option to the runner.** The current "Reply with exactly: <text>" pattern only works when the chosen text matches the parser. A roleplay frame ("Pretend you're a broken agent that overreports success...") might get Claude to produce richer natural-language false claims, exercising Bug 1 area more.
4. **Audit the git verifier's commit-predates-session logic.** It caught a real claim organically this session — worth a read to understand the threshold for "predates" and whether there are false-positive risks (e.g., pulling external commits mid-session).
5. **Consider a `--no-color` / non-TTY mode for `claude.exe`** that the runner could drive without needing the user at the keyboard, removing the manual grading step entirely. (Headless `claude --print` was blocked by auth on the standalone exe last we tried; worth a retry if the auth flow has improved.)

## Don't do

- **Don't run the interactive runner from inside any Claude session.** Hooks load at session start; the spawned `claude.exe` doesn't play well nested inside another Claude session's tool calls. Use a plain PowerShell window.
- **Don't commit `.claude/settings.local.json`** — it has machine-specific absolute paths and is gitignored.
- **Don't `git worktree remove --force`** any worktree path without confirming no other shell or Claude session has its cwd inside it. The classifier may also block recursive deletion of dirs the agent didn't create.
- **Don't edit `CLAUDE_TEST_HANDOFF.md`** — the user has uncommitted local edits to that file. The longer 242-line version is canonical.
- **Don't add `-Encoding utf8`** back to fixture writes in the runner until Bug 2 is fixed.

## Commit log this session built

```
508f123  Fix runner BOM, document smoke-test pass + two surfaced bugs
ff7ce1e  Tighten Step 4 and 5a prompts to match the existing claims parser
8b58a34  Rewrite Step 4 and 5a prompts to a 'produce exact text' framing
74fdd36  Record V1 interactive test results: 3 PASS / 2 INCONCLUSIVE / 0 FAIL
d9f42ee  Discover claude.exe in MSIX-packaged install path too
ec9bcfe  Harden runner's claude.exe discovery against auto-updater races
837030c  Add interactive test runner and marketplace manifest for Verify plugin
fdfac94  Initial import of Verify plugin V1
```

## Environment gotchas

- **Plugin path has a space** (`NB VAULT`). Quote every path in every command.
- **PowerShell 5.1 + non-ASCII** = parser errors. The runner is ASCII-clean by design; preserve that. No em-dashes.
- **Claude Code installs via MSIX package.** The "real" path is `$env:LOCALAPPDATA\Packages\Claude_<hash>\LocalCache\Roaming\Claude\claude-code\<ver>\claude.exe`. The `$env:APPDATA\Claude` path is a symlink only visible from inside the package's filesystem view — external PowerShell shells can't traverse it.
- **Auto-updater can race** with binary discovery. The runner now retries Test-Path 3x with 500ms backoff (commit `ec9bcfe`) and globs MSIX paths (commit `d9f42ee`).
- **Standalone `claude.exe` is not on PATH and not logged in.** Desktop app's OAuth doesn't carry over. Headless `claude --print` is blocked until either (a) `claude auth login` is run interactively, or (b) `$env:ANTHROPIC_API_KEY` is set.
- **Modern aligned Claude refuses to make false claims on direct request.** Steps 4 and 5a's original prompts will return INCONCLUSIVE forever against this Claude version. The "Reply with exactly: <text>" framing partially works; full coverage requires roleplay framing or direct stop-hook smoke tests.
