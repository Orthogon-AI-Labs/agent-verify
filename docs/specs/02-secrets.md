# Spec 02 — Secrets verifier

**Status:** Ready for implementation
**Lands in:** Verify v1.1, alongside protected-sections
**Author:** Noah / Orthogon AI Labs

---

## One-line

Add a `secrets` verifier to `src/core/verifiers/` that catches when the agent claims a commit or push is clean ("no secrets committed", "safe to push") but the staged or committed diff contains credential patterns.

---

## Why

Secret leaks are the second silent-failure class (protected-overwrite is the first). The agent reformats a file, pastes a key into an example, commits, and says "pushed, all clean." Tests stay green; the leak ships. This is also the verifier that earns Verify the word "security" and a place on the directory's security shelf rather than the crowded workflow shelf.

The detection logic is not novel — it's the standard credential-pattern scan that exists in dozens of pre-commit hooks. Verify's contribution is not better regex; it is tying the scan to the *claim*. Verify fires only when the agent asserted cleanliness, which keeps it quiet and on-category (verifying a claim, not running a general scanner on every commit).

---

## Scope

In:
- `src/core/verifiers/secrets.mjs` — `verifySecretsClaim`, matching the existing verifier shape
- `SECRET_PATTERNS` (credential patterns) and `detectSecretsClaims(text)` (claim phrases) in `src/core/claims.mjs`
- `secrets` block in `DEFAULT_CONFIG` and `"secrets"` in `enabledVerifiers`
- Dispatch entry in `src/core/verify.mjs` for `claim.type === "secrets"`
- Fixtures under `test/fixtures/secrets/` and a runner at `test/secrets.test.mjs`
- README update (the "Secrets" bullet under "What Verify checks")

Not in:
- Auto-redaction or history rewriting — surface only, same contract as every other verifier
- Entropy-based / ML secret detection — pattern list only in v1.1; entropy is a v2 consideration
- Scanning the whole working tree — scope to the staged diff (`git diff --cached`); if a push is claimed and an upstream exists, also the commits ahead of upstream. Don't scan unrelated history.

---

## Claim phrases (`src/core/claims.mjs`)

Add a `detectSecretsClaims(text)` function mirroring the existing detector shape, matching (case-insensitive) on:

```javascript
const SECRET_CLAIM_PATTERNS = [
  /\b(?:no|zero)\s+secrets?\s+(?:were\s+)?(?:committed|leaked|exposed|included)\b/gi,
  /\b(?:safe|ok|fine)\s+to\s+push\b/gi,
  /\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:commit|include|leak|expose)\s+(?:any\s+)?(?:secrets?|keys?|credentials?|tokens?)\b/gi,
  /\bno\s+(?:api\s+)?keys?\s+(?:in|were\s+in)\s+(?:the\s+)?(?:diff|commit|changes?)\b/gi,
  /\b(?:scrubbed|removed|stripped)\s+(?:the\s+)?(?:secrets?|keys?|credentials?)\b/gi
];
```

The existing `hasNearbyNegation` / `hasInternalNegation` helpers still apply.

Negative-match (don't fire the verifier):
- `"committed the .env.example with placeholder values"` — intentional, declared
- `"added a dummy key for the test fixture"` — declared test value

Hedge phrases for `skipPhrases` (don't fire as claims):
- `"should be safe to push"`
- `"I think there are no secrets"`

Add `detectSecretsClaims` to the `detectClaims` dedupe list in `claims.mjs`, alongside the existing test/file/git/protected detectors.

---

## Credential patterns to scan (`SECRET_PATTERNS`)

Keep these in one exported constant so they're auditable and extendable. Match against added (`+`) lines of the diff:

```
sk-ant-[A-Za-z0-9_-]{20,}                                       # Anthropic
sk-[A-Za-z0-9]{20,}                                             # OpenAI-style
sk_live_[A-Za-z0-9]{20,}                                        # Stripe live
ghp_[A-Za-z0-9]{36}                                             # GitHub PAT
AKIA[0-9A-Z]{16}                                                # AWS access key id
-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----                 # private key block
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}   # JWT
```

Source list is the vault's `.env` lockdown notes — reuse, don't reinvent.

---

## Verifier behavior (`src/core/verifiers/secrets.mjs`)

```javascript
export async function verifySecretsClaim({ cwd, claim, evidence, config }) {
  // returns { verifier: "secrets", status, summary, hits? }
}
```

1. Resolve repo root via `git rev-parse --show-toplevel`. Not a git repo → `inconclusive`.
2. Collect candidate lines: `git diff --cached` always; if the claim is a push claim and an upstream exists, also `git diff @{u}..HEAD`. No diff readable → `inconclusive` (absence of a diff is **not** proof of cleanliness once a claim was made).
3. Scan added lines against `SECRET_PATTERNS`, honoring `config.secrets.skipPaths` (glob) and `config.secrets.allowPatterns` (project-declared false positives).
4. Translate:
   - no hits → `{ status: "pass", summary: "No credential patterns in the diff." }`
   - hits → `{ status: "fail", summary: "Possible secret in diff.", hits: [{ file, line, pattern }] }`
   - cannot read diff / no git → `{ status: "inconclusive", summary: "Could not read the diff to check for secrets." }`

**Never print the matched value.** Report `path/to/file:42 matched AWS-access-key-id`. The secret value must not reach the Stop-hook message, logs, or the receipt. A verification tool must not become the leak vector.

---

## Output format (`src/core/format.mjs`)

```
Verify found claim mismatches. Revise your final answer to include these verification results:
- Claimed no secrets were committed, but the staged diff contains 1 credential pattern:
    src/config/dev.ts:18  (AWS-access-key-id)

Do not claim failed or unverified work succeeded.
```

Inconclusive:

```
Verify could not check: "no secrets committed"
  (no readable diff; nothing staged or no git repo).
```

---

## Config additions (`src/core/config.mjs`)

```json
"secrets": {
  "skipPaths": ["node_modules", "dist", "_archive", "*.example", "*.test.*"],
  "allowPatterns": []
}
```

Add `"secrets"` to the `enabledVerifiers` default. Confirm `mergeConfig` / `normalizeConfig` deep-merge the new object key without changes.

---

## Acceptance criteria

1. Claim "no secrets committed" + clean staged diff → `pass`.
2. Claim "safe to push" + staged diff adding a line matching `AKIA[0-9A-Z]{16}` → `fail`; report names file, line, and pattern name, and does **not** print the value.
3. Same hit but the path matches a `skipPaths` glob (`config.example`) → `pass`.
4. A non-secrets claim (e.g. tests pass) does not trigger the secrets verifier — `detectClaims` returns no secrets-type claim.
5. No git / no readable diff with a cleanliness claim present → `inconclusive`, does not block.
6. `npm test` passes including the new fixtures.

---

## Test fixtures (`test/fixtures/secrets/`)

- `clean-diff/` — staged change with no credentials → pass
- `aws-key-in-diff/` — staged line matching `AKIA…` → fail; assert value is absent from output
- `skipped-path/` — key in a `*.example` file → pass
- `private-key-block/` — `-----BEGIN PRIVATE KEY-----` in diff → fail
- `jwt-in-diff/` — JWT-shaped string in diff → fail
- `no-upstream/` — push claim, no upstream → inconclusive

Use a temp git repo with staged changes so the diff is real. The runner must assert (criterion 2) that no fixture's secret value appears anywhere in the verifier output.

---

## Implementation plan

1. Add `SECRET_PATTERNS`, `SECRET_CLAIM_PATTERNS`, and `detectSecretsClaims` to `claims.mjs`; wire into `detectClaims`.
2. Write `src/core/verifiers/secrets.mjs` following the shape of `git.mjs`. Reuse the existing `command.mjs` helper for `git diff`.
3. Update `config.mjs` (`DEFAULT_CONFIG` + `enabledVerifiers`).
4. Update `verify.mjs` dispatcher for `claim.type === "secrets"`.
5. Update `format.mjs` so `hits` renders as the indented list above — with pattern name, never value.
6. Ship fixtures + `test/secrets.test.mjs`, including the no-leak-in-output assertion.
7. Update README ("Secrets" bullet).
8. Smoke: `npm test`, `npm run check`, `npm run demo`, `npm run smoke`. All pass before commit.

**Estimated effort:** 2–3 hours. Bulk is fixtures + guaranteeing values never reach output.

---

## Open questions

- **Pattern list governance.** Keep `SECRET_PATTERNS` inline for v1.1. If it grows, move to a versioned data file (like the vendored canon checker in spec 01) so it's auditable.
- **Staged vs working tree.** This spec scans the staged diff (and commits-ahead on a push claim). If users report leaks in unstaged edits they claimed clean, revisit — but default to staged to keep scope tight and the signal tied to what's actually being committed.

---

## Cross-link

Sibling silent-failure verifier to spec 01 (protected-sections). Both catch failures the loud checks (tests, types) miss. The secret-safety rule (never emit a value) is shared with spec 03 (receipt) — any change to it lands in both.
