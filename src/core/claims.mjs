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

const SECRET_CLAIM_PATTERNS = [
  /\b(?:no|zero)\s+secrets?\s+(?:were\s+)?(?:committed|leaked|exposed|included)\b/gi,
  /\b(?:safe|ok|fine)\s+to\s+push\b/gi,
  /\b(?:didn't|did\s+not|haven't|have\s+not)\s+(?:commit|include|leak|expose)\s+(?:any\s+)?(?:secrets?|keys?|credentials?|tokens?)\b/gi,
  /\bno\s+(?:api\s+)?keys?\s+(?:in|were\s+in)\s+(?:the\s+)?(?:diff|commit|changes?)\b/gi,
  /\b(?:scrubbed|removed|stripped)\s+(?:the\s+)?(?:secrets?|keys?|credentials?)\b/gi
];

const SECRET_SKIP_PATTERNS = [
  /\bshould\s+be\s+safe\s+to\s+push\b/i,
  /\bI\s+think\s+(?:there\s+are\s+)?no\s+secrets?\b/i,
  /\.env\.example\b/i,
  /\bplaceholder\b/i,
  /\bdummy\s+(?:key|secret|token|credential)\b/i,
  /\bfor\s+the\s+test\s+fixture\b/i
];

// Credential patterns scanned against added (`+`) lines of a diff. Kept in one
// exported constant so the list is auditable and extendable (spec 02).
export const SECRET_PATTERNS = [
  { name: "anthropic-key", regex: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai-key", regex: /sk-[A-Za-z0-9]{20,}/ },
  { name: "stripe-live-key", regex: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: "github-pat", regex: /ghp_[A-Za-z0-9]{36}/ },
  { name: "aws-access-key-id", regex: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key-block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "jwt", regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ }
];

const NEGATION_WINDOW = 28;
const NEGATION_PATTERN = /(?:^|[^\w-])(?:not|never|no|didn't|did not|haven't|have not|hasn't|has not|wasn't|was not|won't|will not|cannot|can't)(?=$|[^\w-])/i;

export function detectClaims(message) {
  const text = String(message ?? "");
  return dedupeClaims([
    ...detectTestClaims(text),
    ...detectFileClaims(text),
    ...detectGitClaims(text),
    ...detectProtectedClaims(text),
    ...detectSecretsClaims(text)
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

function detectSecretsClaims(text) {
  const matches = [];

  for (const regex of SECRET_CLAIM_PATTERNS) {
    for (const match of text.matchAll(regex)) {
      const claimText = match[0].trim();
      const index = match.index ?? 0;
      if (hasNearbyNegation(text, index) || hasSecretsSkipPhrase(text, index, claimText)) {
        continue;
      }
      matches.push(claimText);
    }
  }

  if (matches.length === 0) {
    return [];
  }

  return [{
    type: "secrets",
    text: matches[0],
    push: matches.some((claimText) => /\bpush\b/i.test(claimText))
  }];
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

function hasSecretsSkipPhrase(text, index, claimText) {
  const windowText = text.slice(Math.max(0, index - 40), index + claimText.length + 40);
  return SECRET_SKIP_PATTERNS.some((regex) => regex.test(windowText));
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
