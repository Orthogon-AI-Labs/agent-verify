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

export function recordPostToolUse(input, dataRoot = getPluginDataRoot(), options = {}) {
  const sessionId = input.session_id || input.sessionId || "unknown";
  const cwd = input.cwd || process.cwd();
  const evidence = loadSessionEvidence(dataRoot, sessionId, cwd);
  const at = new Date().toISOString();
  // Every shell command is recorded, failed ones too, so a turn with none recorded ran none.
  if (options.failedCommandsRecorded) {
    evidence.failedCommandsRecorded = true;
  }

  const ranIn = commandFolder(input, evidence, cwd);
  evidence.cwd = cwd;
  evidence.updatedAt = at;
  // The main agent's shell keeps a `cd`, and a hook gets the folder after the command, so the next command starts here.
  if (!input.agent_id) {
    evidence.shellCwd = cwd;
  }

  if (SHELL_TOOLS.has(input.tool_name) && input.tool_input?.command) {
    evidence.bashCommands.push({
      command: String(input.tool_input.command),
      at,
      ...(ranIn ? { cwd: ranIn } : {})
    });
  }

  for (const filePath of extractTouchedFiles(input)) {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
    const normalized = normalizePathForCompare(absolutePath);
    const known = evidence.touchedFiles.find((entry) => entry.normalizedPath === normalized);
    if (known) {
      known.lastAt = at;
    } else {
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

// The next turn's work is what the session records after this Stop.
export function recordStop(sessionId, cwd, dataRoot = getPluginDataRoot()) {
  const evidence = loadSessionEvidence(dataRoot, sessionId, cwd);
  evidence.lastStopAt = new Date().toISOString();
  evidence.shellCwd = cwd;
  saveSessionEvidence(dataRoot, evidence);
}

// Claude Code runs Bash, Qwen Code run_shell_command.
const SHELL_TOOLS = new Set(["Bash", "run_shell_command"]);
const CHANGES_FOLDER = /(?:^|&&|\|\||[;\n(])\s*(?:cd|pushd)\s/;

// The folder a shell command started in, or null when that can't be told. A subagent's shell doesn't keep a `cd`, and
// Qwen Code's tool takes the folder as an argument. For the main agent it is where the last command or Stop left the
// shell; failing that, a command that doesn't change folders started where it ended.
function commandFolder(input, evidence, cwd) {
  if (!SHELL_TOOLS.has(input.tool_name)) {
    return null;
  }
  const directory = input.tool_input?.directory;
  if (input.tool_name === "run_shell_command" && typeof directory === "string" && directory) {
    return path.resolve(cwd, directory);
  }
  if (input.agent_id) {
    return cwd;
  }
  if (typeof evidence.shellCwd === "string" && evidence.shellCwd) {
    return evidence.shellCwd;
  }
  return CHANGES_FOLDER.test(String(input.tool_input?.command ?? "")) ? null : cwd;
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

  // Codex reports file edits as apply_patch, with the patch text in tool_input.command.
  if (input.tool_name === "apply_patch" && typeof toolInput.command === "string") {
    return [...toolInput.command.matchAll(PATCH_FILE_HEADER)].map((match) => match[1].trim());
  }

  return [];
}

const PATCH_FILE_HEADER = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm;
