# Spec 01 — Protected Sections Verifier

**Status:** Ready for implementation
**Lands in:** Verify v1.1
**Author:** Noah / Orthogon AI Labs

---

## One-line

Add a `protected` verifier to `src/core/verifiers/` that catches when the agent claims it preserved (or didn't touch) `<!-- canon:protected:start name="..." -->` blocks in Markdown files but actually modified them.

---

## Why

`canon` (the sibling plugin under `orthogon-ai-labs`) ships protected-section markers so users can wrap content they don't want silently overwritten — voice rules, stack lock, hard-won design decisions. canon enforces this at its own Stop hook via `hooks/scripts/check-protected-sections.py`. Verify should enforce it from the verification side too.

The strategic move: this is what turns "protected sections" from a canon convention into shared infrastructure between the two plugins. If a user has both installed, every agent close on a Markdown-touching session is checked by both layers. If a user has only Verify, they still get the protection — they don't need canon to benefit.

Silent overwrite is the worst class of agent failure. Tests failing is loud; you see red and fix it. *"I quietly rewrote the voice rules while reformatting"* is silent — you don't notice for a week, by which point the change is buried in history. The `tests` and `files` verifiers don't catch this category. The `protected` verifier does.

---

## Scope

In:
- `src/core/verifiers/protected.mjs` — the verifier function, matching the existing `verifyFileClaim` / `verifyTestClaim` shape
- Claim-phrase patterns added to `src/core/claims.mjs` (`PROTECTED_PATTERNS`, `detectProtectedClaims`)
- `verify.config.json` schema additions for `protected` settings (allowed-block names, skip paths, override checker path)
- A vendored copy of canon's `check-protected-sections.py` at `vendor/check-protected-sections.py` so Verify works standalone
- Discovery chain so Verify uses canon's installed checker if present, falls back to the vendored copy, gracefully degrades if neither exists
- Test fixtures under `test/fixtures/protected/`
- README updated to mention the new verifier

Not in:
- Auto-fixing protected blocks — Verify only surfaces the mismatch, never rewrites code
- New marker syntax — we use canon's `<!-- canon:protected:start name="..." -->` / `<!-- canon:protected:end -->` exactly
- Modifying canon's `check-protected-sections.py` itself — vendor it as-is, with a version constant for drift detection

---

## Claim phrases to detect (`src/core/claims.mjs`)

Add a `PROTECTED_PATTERNS` array and a `detectProtectedClaims(text)` function that mirrors the existing detector shape. Match (case-insensitive) on any of:

```javascript
const PROTECTED_PATTERNS = [
  /\b(?:protected\s+sections?|protected\s+blocks?)\s+(?:are|stayed|remain|were)\s+(?:intact|untouched|preserved|unmodified)\b/gi,
  /\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:touch|modify|edit|change)\s+(?:any\s+)?protected\b/gi,
  /\b(?:left|kept)\s+(?:the\s+)?protected\s+(?:sections?|blocks?)\s+alone\b/gi,
  /\bpreserved\s+(?:the\s+)?protected\s+(?:sections?|blocks?|markers?)\b/gi,
  /\brespected\s+(?:the\s+)?(?:canon:)?protected\s+markers?\b/gi,
  /\bI\s+(?:did\s+not|didn't)\s+modify\s+(?:any\s+)?protected\b/gi
];
```

The existing `hasNearbyNegation` and `hasInternalNegation` helpers should still apply.

Negative-match (don't trigger the verifier):
- `"edited protected section <name>"` — agent is declaring an intentional edit, not claiming preservation
- `"after override: edited protected"` — explicit override path

Hedge phrases to add to the default `skipPhrases` (don't fire as claims):
- `"should leave protected sections alone"` — expressing intent, not making a claim
- `"tried not to touch protected"` — hedged

Add to `detectClaims` in `claims.mjs`:

```javascript
export function detectClaims(message) {
  const text = String(message ?? "");
  return dedupeClaims([
    ...detectTestClaims(text),
    ...detectFileClaims(text),
    ...detectGitClaims(text),
    ...detectProtectedClaims(text)     // new
  ]);
}
```

---

## Verifier behavior (`src/core/verifiers/protected.mjs`)

Function signature matching existing verifiers:

```javascript
export async function verifyProtectedClaim({ cwd, claim, evidence, config }) {
  // returns { verifier: "protected", status, summary, blocks? }
}
```

Behavior:

1. **Resolve the repo root.** Use `git rev-parse --show-toplevel`. If not in a git repo, return `status: "inconclusive"` with a one-line summary.
2. **Find the checker.** Discovery chain in order:
   - `config.protected.checkerPath` (explicit override)
   - `${repoRoot}/.canon/codex/bin/check-protected-sections.py` (canon's Codex install)
   - `${repoRoot}/.canon/bin/check-protected-sections.py` (canon's Claude Code install, if it ever moves out of the plugin dir)
   - `${VERIFY_ROOT}/vendor/check-protected-sections.py` (the vendored fallback — preferred)
3. **Execute.** Run `python3 <checker> --working-tree` with `--allow <name>` for each name in `config.protected.allowed`. Capture exit code and stdout via the existing `command.mjs` helper.
4. **Translate exit codes:**
   - `0` → `{ status: "pass", summary: "Protected sections intact." }`
   - `1` → `{ status: "fail", summary: "Protected sections modified.", blocks: [...] }` — parse stdout for the file/block list
   - `2` → `{ status: "inconclusive", summary: "Marker syntax error in <file>: <reason>." }` — surface as warning, not a false claim
   - `3` or missing `python3` → `{ status: "inconclusive", summary: "Protected-section checker not available. Install canon or check vendor path." }`

**Important:** never return `fail` when the checker is missing. A missing dependency is not a lie. `inconclusive` is the right status — it shows up in the report but doesn't block the Stop hook.

---

## Output format

When the verifier fails, the final report (via `format.mjs`) should look like:

```
Verify found claim mismatches. Revise your final answer to include these verification results:
- Claimed protected sections were intact, but 2 blocks were modified:
    docs/specs/01-look-back.md (block: scope)
    README.md (block: install)

Do not claim failed or unverified work succeeded.
```

When inconclusive (checker missing):

```
Verify could not check: "protected sections are intact"
  (canon's check-protected-sections.py not found; install canon or set
   `protected.checkerPath` in verify.config.json to enable this verifier).
```

---

## Config schema additions (`verify.config.json`)

```json
{
  "test": { "command": "npm test", "timeoutMs": 120000 },
  "enabledVerifiers": ["tests", "files", "git", "protected"],
  "reportMode": "failures-only",
  "protected": {
    "allowed": [],
    "skipPaths": ["node_modules", "dist", "_archive"],
    "checkerPath": null
  }
}
```

Update `DEFAULT_CONFIG` in `src/core/config.mjs` to include `protected: { allowed: [], skipPaths: ["node_modules", "dist", "_archive"], checkerPath: null }` and add `"protected"` to `enabledVerifiers`.

`mergeConfig` and `normalizeConfig` should handle the new key without changes if they currently deep-merge objects; verify that's the case.

---

## Acceptance criteria

The verifier ships when:

1. A response claiming `"protected sections are intact"` against a clean repo returns `status: "pass"`.
2. A response claiming `"protected sections are intact"` against a repo with a modified `<!-- canon:protected:start name="example" -->` block returns `status: "fail"` and the report names the file and block.
3. Same case but `verify.config.json` has `"protected": { "allowed": ["example"] }` returns `status: "pass"`.
4. A claim unrelated to protected sections (tests pass, file created) does NOT trigger the protected verifier — `detectClaims` returns no protected-type claim.
5. With no `python3` on PATH and no vendored checker, the verifier returns `status: "inconclusive"` with a clear summary and does NOT block the Stop hook.
6. Marker syntax errors (exit 2 from the checker) surface as `status: "inconclusive"` with the file path, not as `status: "fail"`.
7. `npm test` passes including the new fixtures.

---

## Test fixtures (`test/fixtures/protected/`)

Ship these and a test runner that asserts each case:

- `clean.md` — file with one intact protected block. Verifier returns pass.
- `modified.md` — file with a protected block whose body has been changed since HEAD. Verifier returns fail.
- `allowed.md` — same as modified.md, but config has the block name in `allowed`. Verifier returns pass.
- `nested.md` — invalid: protected block inside another protected block. Verifier returns inconclusive.
- `unmatched.md` — opening marker with no close. Verifier returns inconclusive.
- `multi/a.md` + `multi/b.md` — two files, one modified, one clean. Verifier returns fail listing only the modified file.

The test runner should use `test/fixtures/protected/repo/` as a temp git repo (init + commit + modify) so the checker has a real HEAD to diff against.

---

## Implementation plan

In order:

1. **Vendor the checker.** Copy canon's `hooks/scripts/check-protected-sections.py` to `vendor/check-protected-sections.py`. Add a `__version__ = "canon-0.4.0"` constant at the top so we can detect drift later. Make sure it's executable.
2. **Write `src/core/verifiers/protected.mjs`.** Follow the shape of `files.mjs` and `git.mjs`. Export `verifyProtectedClaim`.
3. **Update `src/core/claims.mjs`** with `PROTECTED_PATTERNS`, `detectProtectedClaims`, and the dedupe entry in `detectClaims`.
4. **Update `src/core/config.mjs`** with the `protected` default block and `"protected"` in `enabledVerifiers`.
5. **Update `src/core/verify.mjs`** (the main dispatcher) to route `claim.type === "protected"` to `verifyProtectedClaim`.
6. **Update `src/core/format.mjs`** if needed so the `blocks` array renders as the indented list shown above.
7. **Ship fixtures** at `test/fixtures/protected/*` and the runner at `test/protected.test.mjs`.
8. **Update README.md** — add the new verifier to "What V1 Checks" (rename section to "What Verify Checks") and add a paragraph under it explaining the canon dependency / fallback.
9. **Add an entry to the V2 roadmap removal list** since protected-sections lands in v1.1, not v2.
10. **Smoke test** — run `npm test`, `npm run check`, `npm run demo`, `npm run smoke`. All pass before commit.

**Estimated effort:** 2–3 hours for someone familiar with the codebase. The bulk is the fixture set and the test runner.

---

## Open questions

- **Vendor vs hard dependency on canon.** Vendoring with a version constant (the choice in this spec) keeps Verify standalone. The alternative — declare canon as a peer dependency and let installation handle it — is cleaner long-term but adds an install-time coupling. Defer to whoever ships v1.1.
- **Allowed scope: per-project vs per-claim.** This spec persists `allowed` in `verify.config.json` (per-project). canon uses a per-invocation override phrase. The semantics are intentionally different — Verify is enforcement at close, so a persistent allow makes more sense than a one-shot. Flag if user feedback says otherwise.
- **Byte-equal vs whitespace-equal.** Canon's checker uses byte-equal comparison. Verify inherits that by vendoring. Flag if fixtures turn up unexpected whitespace-only failures.

---

## Cross-link

This spec is the Verify side of canon's `docs/specs/02-protected-sections.md`. The two specs together describe the shared convention. Any future change to marker syntax or checker behavior must land in both specs at once.
