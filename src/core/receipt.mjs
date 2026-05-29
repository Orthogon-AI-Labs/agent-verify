import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBinary } from "./command.mjs";
import { readJsonFile } from "./json.mjs";

const VERIFY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA = "orthogon.verify.receipt/1";

const CLAIM_TYPE_BY_VERIFIER = {
  tests: "tests",
  files: "file",
  git: "git",
  protected: "protected",
  secrets: "secrets"
};

// Assembles the receipt object from the results the dispatcher already collected.
// Pure: takes repo info + timestamp + version so it does no I/O itself.
export function buildReceipt(verification, { verifyVersion, repo, createdAt }) {
  const results = verification.results ?? [];
  const counts = { pass: 0, fail: 0, inconclusive: 0 };
  for (const result of results) {
    if (result.status in counts) {
      counts[result.status] += 1;
    }
  }

  return {
    schema: SCHEMA,
    createdAt,
    verifyVersion,
    repo,
    claims: results.map((result) => toClaimEntry(result, verification.claims ?? [])),
    outcome: {
      blocked: Boolean(verification.shouldBlock),
      fail: counts.fail,
      pass: counts.pass,
      inconclusive: counts.inconclusive
    }
  };
}

export async function writeReceipt(verification, options = {}) {
  const root = options.cwd || verification.cwd || process.cwd();
  const config = options.config ?? {};
  const receiptDirName = config.receipt?.path || ".verify";
  const receiptDir = path.resolve(root, receiptDirName);
  const verifyVersion = options.verifyVersion ?? getVerifyVersion();

  const repo = { root, ...(await collectRepoInfo(root)) };
  const receipt = buildReceipt(verification, {
    verifyVersion,
    repo,
    createdAt: new Date().toISOString()
  });

  fs.mkdirSync(receiptDir, { recursive: true });
  fs.writeFileSync(path.join(receiptDir, "last-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);

  if (config.receipt?.history) {
    fs.appendFileSync(path.join(receiptDir, "history.jsonl"), `${JSON.stringify(receipt)}\n`);
  }

  ensureGitignored(root, receiptDirName);
  return receipt;
}

export function readLastReceipt(cwd, config = {}) {
  const receiptDirName = config.receipt?.path || ".verify";
  const file = path.resolve(cwd || process.cwd(), receiptDirName, "last-receipt.json");
  if (!fs.existsSync(file)) {
    return null;
  }
  return readJsonFile(file);
}

// Whitelists only non-sensitive fields. Never copies `details` (which can carry
// test output) or any matched secret value — same safety rule as spec 02.
function toClaimEntry(result, claims) {
  const claimType = CLAIM_TYPE_BY_VERIFIER[result.verifier] ?? result.verifier;
  const claim = findClaim(result, claims, claimType);

  const entry = {
    type: claimType,
    text: claim?.text ?? "",
    verifier: result.verifier,
    status: result.status,
    summary: result.summary
  };

  const evidence = safeEvidence(result);
  if (evidence) {
    entry.evidence = evidence;
  }
  return entry;
}

function findClaim(result, claims, claimType) {
  if (result.verifier === "files" && result.path) {
    const byPath = claims.find((claim) => claim.type === "file" && claim.path === result.path);
    if (byPath) {
      return byPath;
    }
  }
  return claims.find((claim) => claim.type === claimType);
}

function safeEvidence(result) {
  const evidence = {};

  if (typeof result.command === "string") {
    evidence.command = result.command;
  }
  if (typeof result.exitCode === "number") {
    evidence.exitCode = result.exitCode;
  }
  if (Array.isArray(result.blocks)) {
    evidence.blocks = result.blocks.map((block) => ({ path: block.path, name: block.name }));
  }
  if (Array.isArray(result.hits)) {
    evidence.hits = result.hits.map((hit) => ({ file: hit.file, line: hit.line, pattern: hit.pattern }));
  }
  if (result.verifier === "files" && typeof result.path === "string") {
    evidence.path = result.path;
  }

  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

async function collectRepoInfo(root) {
  const head = await runBinary("git", ["rev-parse", "--short", "HEAD"], { cwd: root, timeoutMs: 5000 });
  const branch = await runBinary("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, timeoutMs: 5000 });
  return {
    head: head.exitCode === 0 ? head.stdout.trim() : null,
    branch: branch.exitCode === 0 ? branch.stdout.trim() : null
  };
}

function ensureGitignored(root, receiptDirName) {
  const entry = `${String(receiptDirName).replace(/\/+$/, "")}/`;
  const gitignorePath = path.join(root, ".gitignore");

  let current = "";
  if (fs.existsSync(gitignorePath)) {
    current = fs.readFileSync(gitignorePath, "utf8");
    const lines = current.split(/\r?\n/).map((line) => line.trim());
    if (lines.includes(entry) || lines.includes(receiptDirName)) {
      return;
    }
  }

  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(gitignorePath, `${prefix}${entry}\n`);
}

function getVerifyVersion() {
  try {
    const pkg = readJsonFile(path.join(VERIFY_ROOT, "package.json"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
