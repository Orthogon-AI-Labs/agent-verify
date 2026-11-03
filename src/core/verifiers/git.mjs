import { runBinary } from "../command.mjs";

const GIT_TIMEOUT_MS = 10000;
const SESSION_SKEW_MS = 2000;

export async function verifyGitClaim({ cwd, claim, evidence }) {
  const isRepo = await isGitRepo(cwd);
  if (!isRepo) {
    return {
      verifier: "git",
      status: "inconclusive",
      summary: "Claimed git work, but this project is not a git repository."
    };
  }

  if (claim.action === "committed") {
    return verifyCommitted(cwd, evidence);
  }

  if (claim.action === "pushed") {
    return verifyPushed(cwd);
  }

  if (claim.action === "opened-pr") {
    return verifyOpenedPr(cwd);
  }

  return {
    verifier: "git",
    status: "inconclusive",
    summary: `Verify does not know how to check git claim: ${claim.text}`
  };
}

async function verifyCommitted(cwd, evidence) {
  const result = await git(cwd, ["log", "-1", "--format=%ct"]);
  if (result.exitCode !== 0) {
    return {
      verifier: "git",
      status: "fail",
      summary: "Claimed a commit was made, but Verify found no commits in this repository.",
      details: result.stderr.trim()
    };
  }

  const latestCommitMs = Number(result.stdout.trim()) * 1000;
  const startedAtMs = Date.parse(evidence.startedAt);
  if (Number.isFinite(startedAtMs) && latestCommitMs >= startedAtMs - SESSION_SKEW_MS) {
    return {
      verifier: "git",
      status: "pass",
      summary: "Claimed a commit was made, and the latest commit is from this session."
    };
  }

  return {
    verifier: "git",
    status: "fail",
    summary: "Claimed a commit was made, but the latest commit predates this session."
  };
}

async function verifyPushed(cwd) {
  const upstream = await git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.exitCode !== 0) {
    return await sameNameRemoteHasHead(cwd) ?? {
      verifier: "git",
      status: "fail",
      summary: "Claimed the branch was pushed, but the current branch has no upstream."
    };
  }

  const aheadBehind = await git(cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
  if (aheadBehind.exitCode !== 0) {
    return {
      verifier: "git",
      status: "inconclusive",
      summary: "Claimed the branch was pushed, but Verify could not compare it to upstream.",
      details: aheadBehind.stderr.trim()
    };
  }

  const [behind, ahead] = aheadBehind.stdout.trim().split(/\s+/).map(Number);
  if (ahead === 0) {
    return {
      verifier: "git",
      status: "pass",
      summary: "Claimed the branch was pushed, and local HEAD is not ahead of upstream."
    };
  }

  return await sameNameRemoteHasHead(cwd) ?? {
    verifier: "git",
    status: "fail",
    summary: `Claimed the branch was pushed, but local HEAD is ${ahead} commit(s) ahead of upstream.`,
    details: Number.isFinite(behind) && behind > 0 ? `The branch is also ${behind} commit(s) behind upstream.` : ""
  };
}

// `git push <remote> <branch>` without -u sets no upstream, and a branch made from origin/main tracks origin/main, but
// either push still moves <remote>/<branch>. A pass when HEAD isn't ahead of one of those; null otherwise.
async function sameNameRemoteHasHead(cwd) {
  const branch = await git(cwd, ["symbolic-ref", "--short", "-q", "HEAD"]);
  const remotes = await git(cwd, ["remote"]);
  if (branch.exitCode !== 0 || remotes.exitCode !== 0) {
    return null;
  }

  const branchName = branch.stdout.trim();
  for (const remote of remotes.stdout.split("\n").map((name) => name.trim()).filter(Boolean)) {
    const ref = `refs/remotes/${remote}/${branchName}`;
    const ahead = await git(cwd, ["rev-list", "--count", `${ref}..HEAD`, "--"]);
    if (ahead.exitCode === 0 && ahead.stdout.trim() === "0") {
      return {
        verifier: "git",
        status: "pass",
        summary: `Claimed the branch was pushed, and local HEAD is not ahead of \`${remote}/${branchName}\`.`
      };
    }
  }
  return null;
}

async function verifyOpenedPr(cwd) {
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.exitCode !== 0) {
    return {
      verifier: "git",
      status: "inconclusive",
      summary: "Claimed a PR was opened, but Verify could not determine the current branch."
    };
  }

  const branchName = branch.stdout.trim();
  // `gh pr view` takes the branch as its argument; it has no --head flag.
  const result = await runBinary("gh", ["pr", "view", branchName, "--json", "url,state,title"], {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS
  });

  if (result.exitCode === null) {
    return {
      verifier: "git",
      status: "inconclusive",
      summary: "Claimed a PR was opened, but GitHub CLI (`gh`) is not installed or not available."
    };
  }

  if (result.exitCode === 0) {
    return {
      verifier: "git",
      status: "pass",
      summary: `Claimed a PR was opened, and \`gh pr view ${branchName}\` found it.`,
      details: result.stdout.trim()
    };
  }

  // Only "no pull requests found" shows there is no PR; a sign-in, network or repo error says nothing either way.
  if (!/no pull requests found/i.test(result.stderr)) {
    return {
      verifier: "git",
      status: "inconclusive",
      summary: `Claimed a PR was opened, but \`gh pr view ${branchName}\` failed, so Verify could not look it up.`,
      details: result.stderr.trim()
    };
  }

  return {
    verifier: "git",
    status: "fail",
    summary: `Claimed a PR was opened, but \`gh pr view ${branchName}\` found no PR for this branch.`,
    details: result.stderr.trim()
  };
}

async function isGitRepo(cwd) {
  const result = await git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0 && result.stdout.trim() === "true";
}

function git(cwd, args) {
  return runBinary("git", args, {
    cwd,
    timeoutMs: GIT_TIMEOUT_MS
  });
}
