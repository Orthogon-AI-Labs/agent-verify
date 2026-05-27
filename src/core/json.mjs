import fs from "node:fs";

export function readJsonFile(file) {
  return JSON.parse(readTextFile(file));
}

export function readTextFile(file) {
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
