export function formatBlockReason(results) {
  const failures = results.filter((result) => result.status === "fail");
  const lines = [
    "Verify found claim mismatches. Revise your final answer to include these verification results:"
  ];

  for (const result of failures) {
    lines.push(`- ${result.summary}`);
    const evidence = formatEvidence(result);
    if (evidence) {
      lines.push(evidence);
    }
  }

  lines.push("");
  lines.push("Do not claim failed or unverified work succeeded.");
  return lines.join("\n").slice(0, 12000);
}

function formatBlocks(blocks) {
  return blocks
    .map((block) => `${block.path} (block: ${block.name})`)
    .join("\n");
}

export function formatNotificationItems(results) {
  const lines = [];

  for (const result of results) {
    const label = result.status === "fail" ? "FAILED" : "UNVERIFIED";
    lines.push(`- ${label}: ${result.summary}`);
    const evidence = formatEvidence(result);
    if (evidence) {
      lines.push(evidence);
    }
  }

  return lines.join("\n").slice(0, 12000);
}

// Renders a result's supporting evidence (protected blocks, secret hits, or a
// details string) as an indented list. Never includes a matched secret value —
// `hits` carries only file, line, and pattern name (spec 02).
function formatEvidence(result) {
  if (Array.isArray(result.blocks) && result.blocks.length > 0) {
    return indentDetails(formatBlocks(result.blocks));
  }
  if (Array.isArray(result.hits) && result.hits.length > 0) {
    return indentDetails(formatHits(result.hits));
  }
  if (result.details) {
    return indentDetails(result.details);
  }
  return "";
}

function formatHits(hits) {
  return hits
    .map((hit) => `${hit.file}:${hit.line}  (${hit.pattern})`)
    .join("\n");
}

export function formatTextReport(results) {
  if (results.length === 0) {
    return "Verify found no supported claims.";
  }

  return results
    .map((result) => {
      const label = result.status.toUpperCase();
      return `[${label}] ${result.summary}${result.details ? `\n${indentDetails(result.details)}` : ""}`;
    })
    .join("\n");
}

function indentDetails(details) {
  return String(details)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => `  ${line}`)
    .join("\n");
}
