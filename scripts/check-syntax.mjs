import fs from "node:fs";
import path from "node:path";
import { runBinary } from "../src/core/command.mjs";

const roots = ["src", "scripts", "test"];
const files = roots.flatMap((root) => collectFiles(path.resolve(root)));

for (const file of files) {
  const result = await runBinary(process.execPath, ["--check", file], {
    cwd: process.cwd(),
    timeoutMs: 10000
  });

  if (result.exitCode !== 0) {
    process.stderr.write(`${result.stderr || result.stdout}\n`);
    process.exit(result.exitCode ?? 1);
  }
}

process.stdout.write(`Checked ${files.length} JavaScript files.\n`);

function collectFiles(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(fullPath);
    }
    return entry.isFile() && entry.name.endsWith(".mjs") ? [fullPath] : [];
  });
}
