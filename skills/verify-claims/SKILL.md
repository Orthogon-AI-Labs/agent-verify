---
name: verify-claims
description: Use before a final response when Codex has made or is about to make claims about tests passing, files changed, commits, pushes, or pull requests. Runs Verify in notification mode and reports what was false, missing, or inconclusive.
---

# Verify Claims

Use this skill before finalizing an answer that claims work was completed.

Verify is a notification workflow in Codex. It does not have Claude Code's Stop-hook enforcement, so you must run the notifier and include any failures or inconclusive checks in the final response.

## When To Run

Run Verify when the final answer includes claims like:

- tests pass
- all tests passed
- I updated or created a file
- I committed changes
- I pushed the branch
- I opened a pull request
- protected sections are intact or unchanged

## How To Run

From the repository root, run:

```powershell
npm.cmd run codex:notify -- --message "<final answer draft>"
```

On non-Windows shells, use:

```bash
npm run codex:notify -- --message "<final answer draft>"
```

If the user asks to verify a different project, pass its path:

```powershell
npm.cmd run codex:notify -- --cwd "C:\path\to\project" --message "<final answer draft>"
```

## How To Report

If Verify prints `Verify notification: all detected claims checked out.`, you may answer normally.

If Verify reports `Not done or unverified`, include those items in the final answer and correct any success claims. Do not say tests passed, files changed, commits were made, branches were pushed, PRs were opened, or protected sections stayed intact when Verify says they failed or were inconclusive.

If Verify reports `No supported completion claims detected.`, no verification note is needed.

## Important

- Do not treat a Verify notification as a shell failure. The notifier exits 0 even when it finds false claims.
- Do not run the Claude hook scripts directly for Codex final-answer checks.
- Do not edit `CLAUDE_TEST_HANDOFF.md` while using this skill.
