# Verify — Roadmap

**Owner:** Orthogon AI Labs
**Last updated:** 2026-05-29

This roadmap is ordered as one arc: **from a local Stop hook to the verification layer the agent ecosystem needs.** Each move deepens the same core — verifying the agent's claims — rather than widening into general-purpose linting. If a proposed check doesn't verify a *claim the agent made*, it does not belong in Verify.

The build order below is the order a coding agent should implement in. Each item links to its spec and its acceptance criteria.

---

## Principles (do not violate)

1. **Verify the claim, not the code.** Verify's category is verification, not testing or linting. The moment it ships its own knip/madge/dead-code checks it becomes one more capability plugin. Stay in the claim-verification lane.
2. **Inconclusive is never failure.** A missing dependency, no git repo, no upstream — these return `inconclusive`, never `fail`. This property is the product's trust credential; protect it in every new verifier.
3. **Surface, never fix.** Verify reports and forces a correction. It does not edit code, redact secrets, or rewrite history.
4. **Never emit a secret value.** No verifier, report, or receipt prints or stores a matched credential. Paths, line numbers, and pattern names only.
5. **No telemetry.** Local artifacts only. Any future "verified" status is backed by the local receipt, not by phoning home.

---

## Move 1 — Broaden the claim class toward security (v1.1)

The two worst failures are *silent*: content quietly overwritten, and secrets quietly committed. The loud checks (tests, types) miss both. v1.1 catches them.

### 1a. Protected-sections verifier — `docs/specs/01-protected-sections.md`
**Status:** shipped (live alongside tests, files, git).
Detects "protected sections are intact" claims and checks that `<!-- canon:protected:start -->` blocks weren't modified. Vendors canon's checker so Verify works standalone.

### 1b. Secrets verifier — `docs/specs/02-secrets.md`
**Status:** specced, ready — the next thing to build.
Detects "no secrets committed" / "safe to push" claims and scans the diff for credential patterns. This is the verifier that earns Verify the word "security" and a place on the directory's security shelf rather than the crowded workflow shelf. Small surface, high trust-per-line.

**Ship 1b as v1.1.** Protected (1a) is already live; secrets completes the "two worst silent failures" pair. Frame the release as: *Verify now catches both silent failures — overwriting protected content and leaking secrets.*

---

## Move 2 — Make the result a portable artifact (v1.2)

### 2a. Verification receipt — `docs/specs/03-receipt.md`
**Status:** specced, ready.
After each run, write a machine-readable receipt (`.verify/last-receipt.json`, gitignored) recording each claim, what was checked, the per-check result, and what was inconclusive.

This is the single highest-leverage net-new item on the roadmap, because it turns verification from an *event* into *evidence*. Two later moves depend on it:
- CI mode (Move 3) reads/regenerates it at the merge boundary.
- Any future "verified" badge points at it instead of at telemetry.

Build the receipt before CI mode and before any badge conversation. It is the foundation both stand on. The receipt is gitignored and regenerated, never committed — a committed receipt attests to an old run and is exactly the stale claim Verify exists to catch.

---

## Move 3 — Move verification to the merge boundary (v2)

### 3a. CI mode
**Status:** not yet specced. Do not spec until the receipt schema (2a) is shipped and stable.
A GitHub Action (or equivalent) that regenerates the receipt against the PR HEAD on a trusted runner, gates the merge on the outcome, and posts the fresh receipt back to the pull request as a comment or check annotation. This is the move that makes Verify infrastructure instead of a convenience, and it's what belongs in the directory's "security scanning" category. CI mode is just the receipt consumed at a different boundary.

### 3b. Custom verifier registry
**Status:** not yet specced. Sequence after 2a.
Let projects define their own claim→check pairs (deploy succeeded, health check green, migration applied). Turns Verify from a fixed checklist into the place a team encodes "what counts as done here." Only worth building once the receipt gives custom verifiers a stable artifact to write into.

### 3c. Breadth: Cursor adapter, native Codex enforcement
**Status:** lower priority — ship after the trust-layer story (1+2+3a) is real.
These widen the surface; they don't deepen the moat. The depth (security verifier + receipt + CI) is the story that makes the adapters worth installing. Migration verifiers (Alembic, Prisma, Rails, Django), language-aware symbol verification, and local verification history slot in here as registry instances or follow-ons.

---

## Build order (for the implementer)

1. **Spec 01 — protected-sections.** Done — shipped and live.
2. **Spec 02 — secrets.** Next. Hard rule: matched secret values never reach output. Ship as **v1.1**.
3. **Spec 03 — receipt.** Implement once secrets is live, so the receipt has the full claim set to record. Ship as **v1.2**. Verify criterion: no secret value or file body appears in the receipt.
4. **Spec 04 — CI mode** (write the spec only after 03 ships and the schema is stable), then the **custom verifier registry**, then **Cursor/Codex breadth**. This is **v2**.

Do not reorder 3 before 2 (the receipt needs the full claim set) or CI mode before 3 (CI consumes the receipt).

---

## Explicitly out of scope

- General-purpose linting (knip, madge, dead-code, type consolidation). Crowded, and out of the claim-verification lane.
- Auto-fixing / redaction / history rewriting. Surface only.
- Telemetry of any kind, including to back a "verified" badge.
- Entropy/ML-based secret detection in v1.1 (pattern list only; revisit for v2).
- Widening agent support before the trust-layer depth is real.
