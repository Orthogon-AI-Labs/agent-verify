import fs from "node:fs";
import { hasTouchedFile } from "../evidence.mjs";
import { resolveProjectPath } from "../paths.mjs";

const MTIME_SKEW_MS = 2000;

export function verifyFileClaim({ cwd, claim, evidence }) {
  const resolved = resolveProjectPath(cwd, claim.path);

  if (!resolved.insideProject) {
    return {
      verifier: "files",
      status: "fail",
      summary: `Claimed \`${claim.path}\` changed, but that path is outside the project.`,
      path: claim.path
    };
  }

  if (!fs.existsSync(resolved.absolutePath)) {
    return {
      verifier: "files",
      status: "fail",
      summary: `Claimed \`${claim.path}\` changed, but the file does not exist.`,
      path: claim.path
    };
  }

  if (hasTouchedFile(evidence, resolved.absolutePath)) {
    return {
      verifier: "files",
      status: "pass",
      summary: `Claimed \`${claim.path}\` changed, and Verify saw it touched this session.`,
      path: claim.path
    };
  }

  const stat = fs.statSync(resolved.absolutePath);
  const startedAt = Date.parse(evidence.startedAt);
  if (Number.isFinite(startedAt) && stat.mtimeMs >= startedAt - MTIME_SKEW_MS) {
    return {
      verifier: "files",
      status: "pass",
      summary: `Claimed \`${claim.path}\` changed, and its mtime is within this session.`,
      path: claim.path
    };
  }

  return {
    verifier: "files",
    status: "fail",
    summary: `Claimed \`${claim.path}\` changed, but Verify found no edit evidence this session.`,
    path: claim.path
  };
}
