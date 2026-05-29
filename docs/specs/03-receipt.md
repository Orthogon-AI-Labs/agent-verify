# Spec 03 — Verification receipt

**Status:** Ready for implementation
**Lands in:** Verify v1.2
**Author:** Noah / Orthogon AI Labs

---

## One-line

After every verification run, write a machine-readable receipt recording each claim, what was checked, the per-check result, and what was inconclusive — to `.verify/last-receipt.json` (gitignored), with optional append to `.verify/history.jsonl`.

---

## Why

Today a verification result is an *event*: it appears in the Stop-hook message and disappears. To become the verification layer, the result has to become *evidence* — something another process can read later. The receipt is the smallest artifact that makes that true, and two later moves depend on it:

- **CI mode** (roadmap Move 3) regenerates and reads it at the merge boundary.
- **A "verified" badge**, if the directory ships one, points at the receipt instead of at telemetry.

Build the receipt before CI mode and before any badge conversation. It's the foundation both stand on.

---

## Shape

```json
{
  "schema": "orthogon.verify.receipt/1",
  "createdAt": "2026-05-29T14:02:11Z",
  "verifyVersion": "1.2.0",
  "repo": { "root": "/abs/path", "head": "a1b2c3d", "branch": "feature/x" },
  "claims": [
    {
      "type": "tests",
      "text": "all tests pass",
      "verifier": "tests",
      "status": "fail",
      "summary": "`npm test` exited 1.",
      "evidence": { "command": "npm test", "exitCode": 1 }
    },
    {
      "type": "secrets",
      "text": "no secrets committed",
      "verifier": "secrets",
      "status": "pass",
      "summary": "No credential patterns in the diff."
    },
    {
      "type": "git",
      "text": "pushed the branch",
      "verifier": "git",
      "status": "inconclusive",
      "summary": "No upstream; could not confirm push."
    }
  ],
  "outcome": { "blocked": true, "fail": 1, "pass": 1, "inconclusive": 1 }
}
```

Design rules:
- **Never store secret values or full file contents.** Same rule as the secrets verifier (spec 02): the receipt must be safe to read and to upload. Store paths, line numbers, pattern names, exit codes — nothing sensitive.
- **`inconclusive` is a first-class outcome,** never folded into pass or fail. The honesty property depends on inconclusive staying visible downstream.
- **Stable schema string** (`orthogon.verify.receipt/1`) so CI and badge consumers can version against it.

---

## Scope

In:
- Write `.verify/last-receipt.json` after each run (overwrite).
- Optional `.verify/history.jsonl` append, gated by `config.receipt.history` (default `false`).
- On first run, add `.verify/` to the project `.gitignore` (idempotent — skip if already present). The receipt is never committed.
- A `verify receipt --print` command that dumps the last receipt; exit code non-zero iff the last run blocked (so CI can use it as a gate in Move 3).
- `receipt` block in `DEFAULT_CONFIG`.

Not in:
- Signing / cryptographic attestation — note as a v2+ possibility for a badge program; don't build now.
- Uploading anywhere. The receipt is local; CI reads it from its own regeneration. Nothing phones home.
- Per-run files in a directory — `last-receipt.json` (overwrite) + opt-in `history.jsonl` (append) covers both needs.

---

## Decided (was open)

- **Gitignore the receipt; CI regenerates.** A committed receipt attests to the *last local run*, not the current branch state — run Verify, get a green receipt, make three more commits without re-running, and the committed receipt now claims work is verified when it isn't. That stale attestation is exactly the failure class Verify exists to catch, and it's gameable (commit a green receipt, never run the checks). Use the model every test suite uses: don't commit results, regenerate them. Reviewability is preserved by CI posting the fresh receipt to the PR (Move 3), not by committing the file.
- **One receipt (overwrite) + opt-in history.** `last-receipt.json` is the current-state read; `history.jsonl` is the opt-in audit trail. *Later, not now:* if history ever becomes default-on it needs a size cap — deferred while opt-in.

---

## Acceptance criteria

1. A run with mixed outcomes writes `last-receipt.json` matching the schema, with `inconclusive` preserved as its own status (not folded into pass/fail).
2. No secret value or file body appears anywhere in the receipt, even when the secrets verifier failed.
3. `verify receipt --print` outputs the last receipt; exit code is non-zero iff the last run blocked.
4. With `config.receipt.history: true`, each run appends exactly one line to `history.jsonl`; with it `false` (default), no history file is created.
5. `.verify/` is present in the project `.gitignore` after the first run, and the entry is not duplicated on subsequent runs.
6. `npm test` passes including the new fixtures.

---

## Config additions (`src/core/config.mjs`)

```json
"receipt": {
  "history": false,
  "path": ".verify"
}
```

---

## Test fixtures / cases (`test/receipt.test.mjs`)

- mixed-outcome run → assert schema, all three statuses present, `outcome` counts correct
- secrets-fail run → assert no matched value string appears anywhere in the serialized receipt (criterion 2)
- `history: true` → two runs produce a two-line `history.jsonl`
- `history: false` → no `history.jsonl` created
- `.gitignore` absent then present → `.verify/` added once, not duplicated on a second run
- `verify receipt --print` exit code: blocked run → non-zero; clean run → zero

---

## Implementation plan

1. Add the `receipt` block to `DEFAULT_CONFIG`.
2. Build the receipt object from the verifier results already collected in `verify.mjs` (the dispatcher has every claim + status at close — assemble there).
3. Write `last-receipt.json` (overwrite) and, if `config.receipt.history`, append to `history.jsonl`. Reuse a serialization helper that strips any field carrying a value/body before write (defense for criterion 2).
4. Ensure `.verify/` is in `.gitignore` (idempotent insert).
5. Add the `verify receipt --print` command with the gate exit code.
6. Ship `test/receipt.test.mjs` with the cases above.
7. Smoke: `npm test`, `npm run check`, `npm run demo`, `npm run smoke`.

**Estimated effort:** 2–3 hours. Implement after v1.1 verifiers exist so the receipt records a full claim set.

---

## Cross-link

CI mode (roadmap Move 3) is this receipt consumed at the merge boundary — regenerated against PR HEAD on a trusted runner and posted to the PR. Do not spec CI mode until this schema is shipped and stable. The secret-safety rule (criterion 2) is shared with spec 02; any change lands in both.
