export function formatBlockReason(results) {
  const failures = results.filter((result) => result.status === "fail");
  const lines = [
    "Verify found claim mismatches. Revise your final answer to include these verification results:"
  ];

  for (const result of failures) {
    lines.push(`- ${result.summary}`);
    if (Array.isArray(result.blocks) && result.blocks.length > 0) {
      lines.push(indentDetails(formatBlocks(result.blocks)));
    } else if (result.details) {
      lines.push(indentDetails(result.details));
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
    if (Array.isArray(result.blocks) && result.blocks.length > 0) {
      lines.push(indentDetails(formatBlocks(result.blocks)));
    } else if (result.details) {
      lines.push(indentDetails(result.details));
    }
  }

  return lines.join("\n").slice(0, 12000);
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
