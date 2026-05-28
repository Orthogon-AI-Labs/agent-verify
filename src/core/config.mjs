import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "./json.mjs";

const DEFAULT_CONFIG = {
  test: {
    command: null,
    timeoutMs: 120000
  },
  enabledVerifiers: ["tests", "files", "git", "protected"],
  protected: {
    allowed: [],
    skipPaths: ["node_modules", "dist", "_archive"],
    checkerPath: null
  },
  reportMode: "failures-only"
};

export function loadConfig(cwd) {
  const projectRoot = path.resolve(cwd ?? process.cwd());
  const candidates = [
    path.join(projectRoot, "verify.config.json"),
    path.join(projectRoot, ".verify", "config.json")
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) {
      continue;
    }

    const userConfig = readJsonFile(file);
    return normalizeConfig(mergeConfig(DEFAULT_CONFIG, userConfig), file);
  }

  return normalizeConfig({ ...DEFAULT_CONFIG }, null);
}

export function resolveTestCommand(cwd, config = loadConfig(cwd)) {
  if (config.test.command) {
    return {
      command: config.test.command,
      timeoutMs: config.test.timeoutMs,
      source: config.configPath ? "config" : "default"
    };
  }

  const detected = detectTestCommand(cwd);
  if (!detected) {
    return null;
  }

  return {
    ...detected,
    timeoutMs: config.test.timeoutMs
  };
}

export function isVerifierEnabled(config, verifier) {
  return config.enabledVerifiers.includes(verifier);
}

function normalizeConfig(config, configPath) {
  const enabled = Array.isArray(config.enabledVerifiers)
    ? config.enabledVerifiers
    : DEFAULT_CONFIG.enabledVerifiers;

  const timeoutMs = Number(config.test?.timeoutMs ?? DEFAULT_CONFIG.test.timeoutMs);

  return {
    configPath,
    test: {
      command: typeof config.test?.command === "string" && config.test.command.trim()
        ? config.test.command.trim()
        : null,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_CONFIG.test.timeoutMs
    },
    enabledVerifiers: enabled.filter((name) => ["tests", "files", "git", "protected"].includes(name)),
    protected: normalizeProtectedConfig(config.protected),
    reportMode: config.reportMode === "always" ? "always" : "failures-only"
  };
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    test: {
      ...base.test,
      ...(override.test ?? {})
    },
    protected: {
      ...base.protected,
      ...(override.protected ?? {})
    }
  };
}

function normalizeProtectedConfig(protectedConfig = {}) {
  return {
    allowed: normalizeStringArray(protectedConfig.allowed),
    skipPaths: normalizeStringArray(protectedConfig.skipPaths, DEFAULT_CONFIG.protected.skipPaths),
    checkerPath: typeof protectedConfig.checkerPath === "string" && protectedConfig.checkerPath.trim()
      ? protectedConfig.checkerPath.trim()
      : null
  };
}

function normalizeStringArray(value, fallback = []) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return value
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => item.trim());
}

function detectTestCommand(cwd) {
  const root = path.resolve(cwd);
  const packageJsonPath = path.join(root, "package.json");

  if (fs.existsSync(packageJsonPath)) {
    const pkg = readJsonFile(packageJsonPath);
    const testScript = pkg.scripts?.test;
    if (typeof testScript === "string" && testScript.trim() && !isDefaultNpmPlaceholder(testScript)) {
      return {
        command: `${detectPackageManager(root)} test`,
        source: "autodetect:package-json"
      };
    }
  }

  if (fs.existsSync(path.join(root, "Cargo.toml"))) {
    return {
      command: "cargo test",
      source: "autodetect:cargo"
    };
  }

  if (fs.existsSync(path.join(root, "go.mod"))) {
    return {
      command: "go test ./...",
      source: "autodetect:go"
    };
  }

  if (hasPythonTestMarkers(root)) {
    return {
      command: "python -m pytest -q",
      source: "autodetect:pytest"
    };
  }

  return null;
}

function detectPackageManager(root) {
  if (fs.existsSync(path.join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (fs.existsSync(path.join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (fs.existsSync(path.join(root, "bun.lockb")) || fs.existsSync(path.join(root, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function hasPythonTestMarkers(root) {
  return [
    "pytest.ini",
    "tox.ini",
    "setup.cfg",
    "pyproject.toml"
  ].some((file) => fs.existsSync(path.join(root, file))) || fs.existsSync(path.join(root, "tests"));
}

function isDefaultNpmPlaceholder(script) {
  return /no test specified/i.test(script) || /exit 1/.test(script);
}
