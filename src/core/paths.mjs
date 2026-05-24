import path from "node:path";

export function resolveProjectPath(cwd, claimedPath) {
  const root = path.resolve(cwd);
  const cleaned = cleanPathText(claimedPath);
  const absolutePath = path.isAbsolute(cleaned)
    ? path.normalize(cleaned)
    : path.resolve(root, cleaned);
  const relativePath = path.relative(root, absolutePath);
  const insideProject = relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));

  return {
    input: claimedPath,
    cleaned,
    absolutePath,
    relativePath,
    insideProject
  };
}

export function normalizePathForCompare(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function cleanPathText(value) {
  return String(value ?? "")
    .trim()
    .replace(/^[`'"]+|[`'",.;:]+$/g, "");
}
