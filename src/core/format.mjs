export function formatBlockReason(results) {
  const failures = results.filter((result) => result.status === "fail");
  const lines = [
    "Verify found claim mismatches. Revise your final answer to include these verification results:"
  ];

  for (const result of failures) {
    lines.push(`- ${result.summary}`);
    if (result.details) {
      lines.push(indentDetails(result.details));
    }
  }

  lines.push("");
  lines.push("Do not claim failed or unverified work succeeded.");
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
