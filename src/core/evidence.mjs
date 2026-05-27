import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile } from "./json.mjs";
import { normalizePathForCompare } from "./paths.mjs";

export function getPluginDataRoot() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), "agent-verify-data");
}

export function evidencePath(dataRoot, sessionId) {
  const safeSessionId = String(sessionId || "unknown").replace(/[^a-zA-Z0-9_.-]/g, "_");
  return path.join(dataRoot, "sessions", `${safeSessionId}.json`);
}

export function emptyEvidence(sessionId, cwd) {
  const now = new Date().toISOString();
  return {
    sessionId: sessionId || "unknown",
    cwd: cwd || process.cwd(),
    startedAt: now,
    updatedAt: now,
    touchedFiles: [],
    bashCommands: []
  };
}

export function loadSessionEvidence(dataRoot, sessionId, cwd) {
  const file = evidencePath(dataRoot, sessionId);
  if (!fs.existsSync(file)) {
    return emptyEvidence(sessionId, cwd);
  }

  const parsed = readJsonFile(file);
  return {
    ...emptyEvidence(sessionId, cwd),
    ...parsed,
    touchedFiles: Array.isArray(parsed.touchedFiles) ? parsed.touchedFiles : [],
    bashCommands: Array.isArray(parsed.bashCommands) ? parsed.bashCommands : []
  };
}

export function saveSessionEvidence(dataRoot, evidence) {
  const file = evidencePath(dataRoot, evidence.sessionId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
}

export function recordPostToolUse(input, dataRoot = getPluginDataRoot()) {
  const sessionId = input.session_id || input.sessionId || "unknown";
  const cwd = input.cwd || process.cwd();
  const evidence = loadSessionEvidence(dataRoot, sessionId, cwd);
  const at = new Date().toISOString();

  evidence.cwd = cwd;
  evidence.updatedAt = at;

  if (input.tool_name === "Bash" && input.tool_input?.command) {
    evidence.bashCommands.push({
      command: String(input.tool_input.command),
      at
    });
  }

  for (const filePath of extractTouchedFiles(input)) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const normalized = normalizePathForCompare(absolutePath);
    if (!evidence.touchedFiles.some((entry) => entry.normalizedPath === normalized)) {
      evidence.touchedFiles.push({
        path: absolutePath,
        normalizedPath: normalized,
        at,
        tool: input.tool_name
      });
    }
  }

  saveSessionEvidence(dataRoot, evidence);
  return evidence;
}

export function hasTouchedFile(evidence, absolutePath) {
  const normalized = normalizePathForCompare(absolutePath);
  return evidence.touchedFiles.some((entry) => entry.normalizedPath === normalized);
}

function extractTouchedFiles(input) {
  const toolInput = input.tool_input ?? {};

  if (typeof toolInput.file_path === "string") {
    return [toolInput.file_path];
  }

  if (typeof toolInput.path === "string") {
    return [toolInput.path];
  }

  if (Array.isArray(toolInput.edits) && typeof toolInput.file_path === "string") {
    return [toolInput.file_path];
  }

  return [];
}
