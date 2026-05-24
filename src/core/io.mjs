export async function readStdinJson() {
  let raw = "";
  process.stdin.setEncoding("utf8");

  for await (const chunk of process.stdin) {
    raw += chunk;
  }

  if (raw.charCodeAt(0) === 0xFEFF) {
    raw = raw.slice(1);
  }

  if (!raw.trim()) {
    return null;
  }

  return JSON.parse(raw);
}

export function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
