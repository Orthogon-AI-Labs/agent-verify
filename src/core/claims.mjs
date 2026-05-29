const TEST_PATTERNS = [
  /\b(?:all\s+)?(?:tests?|test suite|unit tests|integration tests)\b(?:\s+(?:and|that|they|all|have|has|had|were|are|is|ran|run|passed|successfully|now|still|also|the|whole|full|entire)){0,8}\s+(?:pass(?:ed|es)?|are passing|is passing|succeeded|green)\b/gi,
  /\b(?:pytest|npm test|pnpm test|yarn test|bun test|cargo test|go test)\b.{0,50}\b(?:pass(?:ed|es)?|green|succeeded|successful)\b/gi
];

const FILE_PATTERNS = [
  {
    regex: /\b(created|modified|updated|changed|wrote|added)\s+(?:the\s+)?(?:file\s+)?[`'"]([^`'"]+)[`'"]/gi,
    actionIndex: 1,
    pathIndex: 2
  },
  {
    regex: /\b(created|modified|updated|changed|wrote|added)\s+(?:the\s+)?(?:file\s+)?([a-zA-Z0-9._-]+(?:[\\/][a-zA-Z0-9._-]+)+\.[a-zA-Z0-9]{1,12})\b/gi,
    actionIndex: 1,
    pathIndex: 2
  },
  {
    regex: /[`'"]([^`'"]+)[`'"]\s+(?:was|is|has been)\s+(created|modified|updated|changed|written|added)\b/gi,
    actionIndex: 2,
    pathIndex: 1
  }
];

const GIT_PATTERNS = [
  {
    action: "committed",
    regex: /\b(?:committed\s+(?:the\s+|all\s+|my\s+|our\s+|these\s+|those\s+)?(?:changes?|code|files?|fix(?:es)?|work|edits?|updates?|everything|them|it)|committed\s+(?:to|on)\s+(?:git|the\s+repo(?:sitory)?|the\s+branch|main|master|trunk)|(?:created|made)\s+(?:a\s+|the\s+)?commit|git\s+commit)\b/gi
  },
  {
    action: "pushed",
    regex: /\b(?:pushed|pushed the branch|branch is pushed|changes are pushed)\b/gi
  },
  {
    action: "opened-pr",
    regex: /\b(?:(?:opened|created)\s+(?:a\s+)?(?:pull request|pr)|pr\s+(?:is\s+)?open)\b/gi
  }
];

const PROTECTED_PATTERNS = [
  /\b(?:protected\s+sections?|protected\s+blocks?)\s+(?:are|stayed|remain|were)\s+(?:intact|untouched|preserved|unmodified)\b/gi,
  /\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:touch|modify|edit|change)\s+(?:any\s+)?protected\b/gi,
  /\b(?:left|kept)\s+(?:the\s+)?protected\s+(?:sections?|blocks?)\s+alone\b/gi,
  /\bpreserved\s+(?:the\s+)?protected\s+(?:sections?|blocks?|markers?)\b/gi,
  /\brespected\s+(?:the\s+)?(?:canon:)?protected\s+markers?\b/gi,
  /\bI\s+(?:did\s+not|didn't)\s+modify\s+(?:any\s+)?protected\b/gi
];

const PROTECTED_SKIP_PATTERNS = [
  /\bshould\s+leave\s+protected\s+(?:sections?|blocks?)\s+alone\b/i,
  /\btried\s+not\s+to\s+(?:touch|modify|edit|change)\s+(?:any\s+)?protected\b/i,
  /\bafter\s+override:\s+edited\s+protected\b/i
];

const NEGATION_WINDOW = 28;
const NEGATION_PATTERN = /(?:^|[^\w-])(?:not|never|no|didn't|did not|haven't|have not|hasn't|has not|wasn't|was not|won't|will not|cannot|can't)(?=$|[^\w-])/i;

export function detectClaims(message) {
  const text = String(message ?? "");
  return dedupeClaims([
    ...detectTestClaims(text),
    ...detectFileClaims(text),
    ...detectGitClaims(text),
    ...detectProtectedClaims(text)
  ]);
}

function detectTestClaims(text) {
  const claims = [];
  for (const regex of TEST_PATTERNS) {
    for (const match of text.matchAll(regex)) {
      if (hasNearbyNegation(text, match.index ?? 0)) {
        continue;
      }

      if (hasInternalNegation(match[0])) {
        continue;
      }

      claims.push({
        type: "tests",
        text: match[0].trim()
      });
    }
  }

  return claims.length > 0 ? [claims[0]] : [];
}

function detectFileClaims(text) {
  const claims = [];

  for (const pattern of FILE_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const pathText = match[pattern.pathIndex];
      const action = match[pattern.actionIndex];
      if (!pathText || hasNearbyNegation(text, match.index ?? 0)) {
        continue;
      }

      claims.push({
        type: "file",
        action: String(action ?? "changed").toLowerCase(),
        path: cleanClaimedPath(pathText),
        text: match[0].trim()
      });
    }
  }

  return claims.filter((claim) => claim.path.length > 0);
}

function detectGitClaims(text) {
  const claims = [];

  for (const pattern of GIT_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      if (hasNearbyNegation(text, match.index ?? 0)) {
        continue;
      }

      claims.push({
        type: "git",
        action: pattern.action,
        text: match[0].trim()
      });
    }
  }

  return claims;
}

function detectProtectedClaims(text) {
  const claims = [];

  for (const regex of PROTECTED_PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const claimText = match[0].trim();
      if (hasProtectedSkipPhrase(text, match.index ?? 0, claimText)) {
        continue;
      }

      claims.push({
        type: "protected",
        text: claimText
      });
    }
  }

  return claims.length > 0 ? [claims[0]] : [];
}

function cleanClaimedPath(value) {
  return String(value)
    .trim()
    .replace(/^[`'"]+|[`'",.;:]+$/g, "")
    .replace(/^\.[\\/]+/, "");
}

function hasNearbyNegation(text, index) {
  const before = text.slice(Math.max(0, index - NEGATION_WINDOW), index);
  return NEGATION_PATTERN.test(before);
}

function hasInternalNegation(text) {
  return NEGATION_PATTERN.test(text);
}

function hasProtectedSkipPhrase(text, index, claimText) {
  const windowText = text.slice(Math.max(0, index - 40), index + claimText.length + 40);
  return PROTECTED_SKIP_PATTERNS.some((regex) => regex.test(windowText));
}

function dedupeClaims(claims) {
  const seen = new Set();
  const unique = [];

  for (const claim of claims) {
    const key = `${claim.type}:${claim.action ?? ""}:${claim.path ?? ""}:${claim.text.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(claim);
  }

  return unique;
}
