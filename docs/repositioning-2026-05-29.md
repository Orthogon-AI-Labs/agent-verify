# agent-verify — repositioning to the verification layer

**Date:** 2026-05-29
**Author:** Noah / Orthogon AI Labs (drafted via Claude)
**Status:** Proposal. Decide, then edit the README and roadmap to match.

---

## The change in one line

Stop describing Verify as "a plugin that catches false test claims." Start describing it as **the verification boundary an agent's final answer has to pass before you trust it** — the one plugin whose job is to check the agent, not extend it.

The code barely changes. The frame, the README headline, and the roadmap order change.

---

## Why now

When Verify was scoped, the case for it was local and specific: agents lie about test results, so catch the lie at the Stop hook. That case is still true and still the wedge. But the market it ships into is different than it was six months ago.

As of early 2026 there is an official Anthropic plugin directory with 9,000+ plugins across the ecosystem, partner plugins from GitHub, Supabase, Figma, Vercel, Linear, Sentry, Stripe, and roughly 200,000 developers a month browsing for things to install. The directory maintainers have said in plain terms what the next problem is: curation, discovery, **quality scoring, verified-publisher badges, and automated security scanning**.

Read that list again. Every item on it is a trust problem, not a capability problem. The ecosystem has more than enough plugins that *do* things. What it does not have is a layer that tells you whether the agent did what it said it did. That is the seam Verify already sits in. Almost nobody else is in it.

So the repositioning is not a pivot. It is naming the category Verify was already in and aiming the roadmap at the part of it the market is about to need.

---

## What Verify is, stated as a category

Linters check the code. Test runners check the code. Type checkers check the code. None of them check the **agent's report of what it did**. That report is the thing a human acts on — you read "tests pass, branch pushed, protected sections intact," and you move on. If the report is wrong, every tool downstream of it inherits the error.

Verify checks the report against reality. That is a distinct primitive from everything else in the ecosystem, and it is worth saying out loud:

> Verify is the honesty layer for agentic coding. It checks the claims an agent makes at the moment of close — tests, files, git, protected content — and forces a correction when the claim and the repository disagree.

The category is *verification*, not *testing* and not *linting*. Hold that line. The moment Verify starts shipping its own linters (knip, madge, dead-code) it becomes one more capability plugin competing with hundreds of others. Its defensible position is that it verifies claims, and claims are a layer nobody else owns.

---

## What to keep, and sharpen

The current core is right. Three things in it are not just features — they are the trust credential, and the new positioning should foreground them.

**1. Inconclusive is not failure.** Verify returns `inconclusive` when it can't check something (no test command, no `python3`, no upstream branch) instead of guessing. A tool that verifies honesty has to be honest about its own limits, or it is exactly the thing it claims to police. This is the single most important property Verify has and the README buries it in a config note. It should be a stated principle on the front page: *Verify never reports a failure it didn't actually observe.*

**2. It surfaces, it never auto-fixes.** Verify reports the mismatch and makes Claude revise; it does not rewrite code. Auto-fixing would make Verify an actor whose own work then needs verifying — infinite regress. Surfacing-only keeps it a clean boundary. Keep it.

**3. It blocks once, then gets out of the way.** One Stop-hook block, one correction, done. A verification layer that nags is a verification layer people uninstall. The discipline of "quiet when claims check out, one block when they don't" is what makes it tolerable to leave on. Keep it.

These three are the answer to "why should I trust the thing that's grading my agent." Lead with them.

---

## Roadmap, reordered for the trust layer

The existing roadmap (Cursor adapter, native Codex, custom verifier registry, migration verifiers, symbol verification, history, team reporting) is a reasonable feature list but it's ordered as "more verifiers." Reorder it as "from local hook to trust layer." Three moves, in order.

### Move 1 — broaden the claim class toward security (v1.1)

v1.1 already has the protected-sections verifier specced. Ship it. But pair it with the verifier that most directly maps to the ecosystem's named "automated security scanning" gap:

**A secret-leak verifier.** When the agent commits or claims "no secrets committed / safe to push," scan the staged diff for the obvious patterns — `sk-ant-`, `sk_live_`, `ghp_`, `AKIA`, private-key headers, JWT shapes. The vault already has the source material for this in the `.env` lockdown notes (the three leak paths, the pre-commit pattern list). This is the verifier with the highest trust-per-line-of-code in the whole roadmap, and it's the one that lets Verify credibly use the word "security." Spec is in the companion section below.

Protected-sections catches silent overwrites. Secret-leak catches silent leaks. Both are *silent* failures the loud tools (tests, types) miss — which is the through-line of the whole product. Frame v1.1 as "Verify now catches the two worst silent failures: overwriting protected content and leaking secrets."

### Move 2 — make the result a portable artifact (v1.2)

Today the verification result lives in the Stop-hook message and then it's gone. The trust-layer version emits a **verification receipt**: a small JSON artifact recording what was claimed, what was checked, the result of each check, and what was inconclusive. Written to `.verify/last-receipt.json` (and optionally appended to a local history).

This is the bridge from "a hook on my machine" to "the trust layer." A receipt is machine-readable, so:

- CI can read it and gate a merge on it (Move 3).
- A future "verified" badge has something real underneath it instead of a vibe.
- A human reviewing a PR can see "these claims were checked, these were inconclusive" instead of taking the agent's word.

The receipt is the single highest-leverage net-new thing on this roadmap, because it's what turns verification from an event into evidence. Spec in the companion section.

### Move 3 — move verification to the merge boundary (v1.3 / v2)

The terminal Stop hook protects the developer who's running the agent. The merge boundary protects everyone downstream. A **Verify CI mode** — a GitHub Action that reads the verification receipt (or re-runs the checks against the PR) and fails the check if the PR description or commit messages claim work that the diff doesn't support — is where "verified publisher / quality scoring" actually lives.

This is the move that makes Verify infrastructure instead of a convenience. It's also the one that earns a place in the official directory's "security scanning" category rather than the crowded "dev workflow" category. Sequence it after the receipt exists, because CI mode is just the receipt consumed at a different boundary.

CI mode does not read a committed receipt (there isn't one — receipts are gitignored). "CI" here is the automated checks that run on every pull request — e.g. a GitHub Action. When Verify runs there it regenerates the receipt against the PR HEAD on a trusted runner, gates the merge on the outcome, and **posts that fresh receipt back onto the pull request itself** — either as a *comment* (a message in the PR conversation) or a *check annotation* (the pass/fail detail at the bottom of the PR). So a reviewer opening the PR sees "tests: pass, secrets: pass, push: inconclusive" right there, without trusting the agent's prose and without anyone committing a receipt file. That posting is how you get the "receipt visible in review" benefit without ever committing a file that can go stale.

The custom verifier registry (already on the roadmap) slots in alongside Move 3: once projects can define their own claim→check pairs (deploy succeeded, health check green, migration applied), Verify stops being a fixed checklist and becomes the place a team encodes "what counts as done here." That's the platform version. Keep it after the receipt and CI mode, not before — the registry is only worth building once there's a stable artifact and boundary for custom verifiers to plug into.

Cursor and native Codex adapters stay on the roadmap but drop in priority. They widen the surface; they don't deepen the moat. Ship them when the core trust-layer story (security verifier + receipt + CI) is real, because that's the story that makes the adapters worth installing.

---

## Positioning and distribution, concretely

**Get into the official directory under the right category.** Not "dev workflow" — that's where it drowns next to 100+ tools. Aim for the security / quality-scoring shelf the directory maintainers said they're building. Verify's pitch there is one sentence: *the only plugin whose job is to verify the agent's own claims.*

**Pair-market with canon, don't merge it.** Protected-sections is already shared infrastructure between the two. Keep them separate products with one explicit relationship: canon writes and protects context; Verify checks that the agent respected it. "Install both" is a real recommendation, not a bundle.

**Lead every surface with the honesty-of-the-tool-itself property.** In a directory about to be flooded with quality scores and badges, the credential that matters is "this tool is honest about what it doesn't know." `inconclusive ≠ fail` is not a footnote — it's the reason to trust the grader.

---

## What not to do

- **Don't become a linter.** knip, madge, dead-code, type consolidation — these exist, they're crowded, and they pull Verify out of the claim-verification category into the capability-plugin scrum. If a check isn't verifying a *claim the agent made*, it probably doesn't belong in Verify.
- **Don't add telemetry to earn the "verified" badge.** The badge, if it comes, should be backed by the local receipt artifact, not by phoning home. The roadmap already says "no telemetry by default" — hold that even when a badge program makes telemetry tempting.
- **Don't auto-fix.** Stated above; restating because it's the most likely scope-creep request once people trust the detection.
- **Don't widen agent support before the trust story is real.** Cursor/Codex breadth is worth less than the security-verifier + receipt + CI depth. Depth is the moat; breadth is reach. Build the moat first.

---

## The headline rewrite

Current README H1:

> Verify catches false completion claims from coding agents.

Proposed:

> Verify is the verification layer for coding agents. It checks what the agent claims it did — tests, files, commits, protected content, secrets — and makes it correct the record when the claim and the repo disagree.

Sub-line, foregrounding the trust credential:

> Verify never reports a failure it didn't observe. When it can't check a claim, it says so instead of guessing.

---

## Decision needed

1. Adopt the verification-layer frame and rewrite the README headline + intro? (Low effort, high leverage.)
2. Pull the secret-leak verifier into v1.1 alongside protected-sections, or hold v1.1 to protected-sections only and make secret-leak the lead of v1.2?
3. Commit to the receipt artifact as the v1.2 anchor (the thing CI and any future badge depend on)?

My recommendation: yes to 1, secret-leak into v1.1 (it's small and it's the word "security"), and yes to the receipt as the v1.2 anchor.

---
---

# Companion spec A — Secret-leak verifier (v1.1)

**Status:** Ready to scope into v1.1
**Lands in:** Verify v1.1, alongside protected-sections

## One-line

Add a `secrets` verifier to `src/core/verifiers/` that catches when the agent claims a commit or push is clean ("no secrets committed", "safe to push") but the staged or committed diff contains credential patterns.

## Why

Secret leaks are the second silent-failure class (protected-overwrite is the first). The agent reformats a file, pastes a key into an example, commits, and says "pushed, all clean." Tests stay green; the leak ships. This is also the verifier that earns Verify the word "security" and a place on the directory's security shelf rather than the crowded workflow shelf.

The detection logic is not novel — it's the standard credential-pattern scan that exists in dozens of pre-commit hooks. Verify's contribution is not better regex; it's tying the scan to the *claim*. Verify fires only when the agent asserted cleanliness, which keeps it quiet and on-category (verifying a claim, not running a general scanner on every commit).

## Scope

In:
- `src/core/verifiers/secrets.mjs` — `verifySecretsClaim`, matching the existing verifier shape
- `SECRET_PATTERNS` and `detectSecretsClaims(text)` in `src/core/claims.mjs`
- `secrets` block in `DEFAULT_CONFIG` and `"secrets"` in `enabledVerifiers`
- Fixtures under `test/fixtures/secrets/`

Not in:
- Auto-redaction or history rewriting — surface only, same contract as every other verifier
- Entropy-based / ML secret detection — pattern list only in v1.1; entropy is a v2 consideration
- Scanning the whole working tree — scope to the staged diff (`git diff --cached`) plus, if a push is claimed, the commits ahead of upstream. Don't scan unrelated history.

## Claim phrases (`src/core/claims.mjs`)

```javascript
const SECRET_PATTERNS = [
  /\b(?:no|zero)\s+secrets?\s+(?:were\s+)?(?:committed|leaked|exposed|included)\b/gi,
  /\b(?:safe|ok|fine)\s+to\s+push\b/gi,
  /\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:commit|include|leak|expose)\s+(?:any\s+)?(?:secrets?|keys?|credentials?|tokens?)\b/gi,
  /\bno\s+(?:api\s+)?keys?\s+(?:in|were\s+in)\s+(?:the\s+)?(?:diff|commit|changes?)\b/gi,
  /\b(?:scrubbed|removed|stripped)\s+(?:the\s+)?(?:secrets?|keys?|credentials?)\b/gi
];
```

Negative-match (don't fire): `"committed the .env.example with placeholder values"`, `"added a dummy key for the test fixture"`. Hedge / skip: `"should be safe to push"`, `"I think there are no secrets"`.

## Credential patterns to scan (the diff)

Match added lines (`+` lines in the diff) against, at minimum:

```
sk-ant-[A-Za-z0-9_-]{20,}          # Anthropic
sk-[A-Za-z0-9]{20,}                # OpenAI-style
sk_live_[A-Za-z0-9]{20,}           # Stripe live
ghp_[A-Za-z0-9]{36}                # GitHub PAT
AKIA[0-9A-Z]{16}                   # AWS access key id
-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----
eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}  # JWT
```

Keep the list in one exported constant so it's auditable and extendable. Source is the vault's `.env` lockdown notes — reuse, don't reinvent.

## Verifier behavior (`src/core/verifiers/secrets.mjs`)

```javascript
export async function verifySecretsClaim({ cwd, claim, evidence, config }) {
  // returns { verifier: "secrets", status, summary, hits? }
}
```

1. Resolve repo root via `git rev-parse --show-toplevel`. Not a git repo → `inconclusive`.
2. Collect candidate lines: `git diff --cached` always; if the claim is a push claim and an upstream exists, also `git diff @{u}..HEAD`. No git diff available → `inconclusive` (not `pass` — absence of a diff is not proof of cleanliness when a claim was made).
3. Scan added lines against `SECRET_PATTERNS` (the credential list above), honoring `config.secrets.skipPaths` (default `["node_modules","dist","_archive","*.example","*.test.*"]`) and `config.secrets.allowPatterns` (project-declared false positives).
4. Translate:
   - no hits → `{ status: "pass", summary: "No credential patterns in the diff." }`
   - hits → `{ status: "fail", summary: "Possible secret in diff.", hits: [{file, line, pattern}] }` — report file and line number and the *pattern name*, never the matched secret value.
   - cannot read diff / no git → `{ status: "inconclusive", summary: "Could not read the diff to check for secrets." }`

**Never print the matched secret.** Report `path/to/file:42 matched AWS-access-key-id`. Printing the value into the Stop-hook message would leak it into logs — a verification tool must not be the leak vector.

## Output format

```
Verify found claim mismatches. Revise your final answer to include these verification results:
- Claimed no secrets were committed, but the staged diff contains 1 credential pattern:
    src/config/dev.ts:18  (AWS-access-key-id)

Do not claim failed or unverified work succeeded.
```

## Config additions

```json
"secrets": {
  "skipPaths": ["node_modules", "dist", "_archive", "*.example", "*.test.*"],
  "allowPatterns": []
}
```
Add `"secrets"` to `enabledVerifiers` default.

## Acceptance criteria

1. Claim "no secrets committed" + clean staged diff → `pass`.
2. Claim "safe to push" + staged diff adding a line matching `AKIA[0-9A-Z]{16}` → `fail`, report names file, line, and pattern name, and does **not** print the value.
3. Same hit but the path matches a `skipPaths` glob (`config.example`) → `pass`.
4. A non-secrets claim (tests pass) does not trigger the secrets verifier.
5. No git / no diff with a cleanliness claim present → `inconclusive`, does not block.
6. `npm test` passes with new fixtures.

## Fixtures (`test/fixtures/secrets/`)

`clean-diff/`, `aws-key-in-diff/`, `skipped-path/` (key in `*.example`), `private-key-block/`, `jwt-in-diff/`, `no-upstream/` (push claim, no upstream → inconclusive). Use a temp git repo with staged changes so the diff is real.

**Estimated effort:** 2–3 hours. Bulk is fixtures + making sure values never reach output.

---

# Companion spec B — Verification receipt (v1.2 anchor)

**Status:** Design proposal — this is the artifact CI mode and any future badge depend on
**Lands in:** Verify v1.2

## One-line

After every verification run, write a machine-readable receipt recording each claim, what was checked, the per-check result, and what was inconclusive — to `.verify/last-receipt.json`, with optional append to `.verify/history.jsonl`.

## Why

Right now a verification result is an event: it shows up in the Stop-hook message and disappears. To become the trust layer, the result has to become *evidence* — something another process can read later. The receipt is the smallest artifact that makes that true, and three later moves depend on it:

- **CI mode** reads the receipt to gate a merge.
- **A "verified" badge**, if the directory ships one, points at the receipt instead of at telemetry.
- **A human reviewer** sees what was checked and what was skipped, instead of trusting the agent's prose.

Build the receipt before CI mode and before any badge conversation. It's the foundation both stand on.

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
- **Never store secret values or full file contents in the receipt.** Same rule as the secrets verifier — the receipt must be safe to commit and to upload. Store paths, line numbers, pattern names, exit codes. Nothing sensitive.
- **`inconclusive` is a first-class outcome in the receipt,** not folded into pass or fail. The whole honesty property depends on inconclusive staying visible downstream.
- **Stable schema string** (`orthogon.verify.receipt/1`) so CI and badge consumers can version against it.

## Scope

In:
- Write `.verify/last-receipt.json` after each run (overwrite).
- Optional `.verify/history.jsonl` append, gated by `config.receipt.history` (default `false` to avoid surprise files).
- `.verify/` is gitignored. Verify adds it to a generated `.gitignore` entry on first run (idempotent; skip if already present). The receipt is never a committed file. See "Decided" below for the reasoning.
- A `verify receipt --print` command to dump the last receipt for humans/CI.

Not in:
- Signing / cryptographic attestation — note it as a v2+ possibility for the badge program; don't build it now.
- Uploading anywhere. The receipt is local. CI reads it from the checkout; nothing phones home.

## Acceptance criteria

1. A run with mixed outcomes writes a `last-receipt.json` matching the schema, with `inconclusive` preserved as its own status.
2. No secret value or file body appears anywhere in the receipt, even when the secrets verifier failed.
3. `verify receipt --print` outputs the last receipt; exit code is non-zero iff the last run blocked (so CI can `verify receipt --print` as a gate in Move 3).
4. With `config.receipt.history: true`, each run appends one line to `history.jsonl`; with it false (default), no history file is created.

## Decided

- **Gitignore the receipt; CI regenerates.** A committed receipt attests to the *last local run*, not the current state of the branch — run Verify, get a green receipt, make three more commits without re-running, and the committed receipt now says work is verified when it isn't. That stale attestation is exactly the failure class Verify exists to catch, so shipping it as a checked-in file undermines the product. It's also gameable: commit a green receipt, never run the checks; CI trusting a committed artifact is CI trusting an unverified claim. Use the model every test suite already uses — don't commit results, regenerate them. CI mode re-runs Verify against the PR HEAD and produces its own receipt at a known commit from a trusted runner. Gitignoring also removes the secret-safety concern from the commit path entirely (the receipt must still be secret-free per criterion 2, but it never enters history). Reviewability is preserved by having CI post the receipt as a PR comment / check annotation, not by committing the file.

- **One receipt (overwrite) plus opt-in history.** `last-receipt.json` is overwritten each run (the "current state" read); `history.jsonl` is append-only and gated by `config.receipt.history` (default `false`). A directory of per-run files buys nothing and costs rotation/cleanup logic. *Later, not now:* if `history.jsonl` ever becomes default-on, it needs a size cap — deferred while it's opt-in.

## Cross-link

CI mode (roadmap Move 3) is this receipt consumed at the merge boundary. Don't spec CI mode until the receipt schema is shipped and stable.

