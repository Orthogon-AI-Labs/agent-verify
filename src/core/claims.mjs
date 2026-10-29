const TEST_PATTERNS = [
  /\b(?:all\s+)?(?:tests?|test suite|unit tests|integration tests)\b(?:\s+(?:and|that|which|they|all|have|has|had|were|are|is|ran|run|passed|successfully|now|still|also|the|whole|full|entire)){0,8}\s+(?:pass(?:ed|es|ing)?|succeeded|green)\b/gi,
  /\b(?:pytest|npm test|pnpm test|yarn test|bun test|cargo test|go test)\b.{0,50}\b(?:pass(?:ed|es|ing)?|green|succeeded|successful)\b/gi
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

const KNOWN_FILE_EXTENSION = /\.(?:[cm]?[jt]sx?|json[c5l]?|md[cx]?|markdown|txt|rst|adoc|ya?ml|toml|ini|cfg|conf|lock|py|pyi|ipynb|rb|erb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|bat|sql|prisma|graphql|gql|proto|html?|css|scss|sass|less|vue|svelte|astro|xml|svg|png|jpe?g|gif|webp|ico|pdf|csv|tsv|tf|hcl|gradle|dart|lua|exs?|erl|hs|scala|r|jl|nix|zig|example|sample|template|tpl|j2|hbs|njk|liquid|plist|snap|patch|diff|log)$/i;
const EXTENSIONLESS_FILES = /^(?:Makefile|Dockerfile|Containerfile|Gemfile|Rakefile|Procfile|Justfile|Brewfile|Vagrantfile|LICENSE|NOTICE|README|CHANGELOG|CODEOWNERS|AUTHORS)$/;
// A sentence that says a test run fails now, e.g. "`npm test` still fails: 1 passes and 1 fails".
const TEST_SUBJECT = /\b(?:tests?|test suite|suites?|specs?|npm test|pnpm test|yarn test|bun test|cargo test|go test|pytest)\b/i;
const TEST_FAILURE = /\b(?:still\s+fail(?:s|ing)?|(?:is|are|keeps?|remains?)\s+(?:still\s+)?failing|fails|[1-9]\d*\s+(?:(?:other|more|unrelated|pre-?existing|remaining)\s+)?(?:tests?\s+)?(?:fail(?:s|ing)?|failures?)|failures?\s+(?:is|are)\s+(?:due|because|caused|from|unrelated|expected|pre-?existing))\b/gi;
// "a test that fails when the fix is removed" describes a check that works, not a failure now.
const COUNTERFACTUAL = /\b(?:when|if|without|unless|would|remov(?:e|ed|ing)|revert(?:ed|ing)?|mutat(?:e|ed|ion)|break(?:age|ing)?s?|old|before (?:the|my|this) (?:fix|change))\b/i;
const TABLE_CELL_AFTER = /^[ \t]*\|/;
const CONDITION_BEFORE = /\b(?:on|for|until|after|before|once)\s+(?:(?:the|all|its|their|[\w-]+['’]s)\s+){0,2}$/i;
// "Without changing any test files", "I did not modify the tests", "the test files are unchanged".
// Only claims about the tests as a whole: a claim about one named test or a scoped set is left alone.
const UNTOUCHED_TEST_OBJECT = String.raw`(?:any\s+(?:of\s+(?:the\s+)?)?|the\s+|all\s+(?:of\s+)?(?:the\s+)?)?(?:(?:existing|original|current|provided|given|failing)\s+)?(?:test\s+files?|test\s+code|test\s+suites?|test\s+cases?|spec\s+files?|tests?)\b(?!['’]s|\/|\s+(?:command|script|runner|output|results?|logic|config\w*|setup|names?|expectations?|assertions?|behaviou?r|timeouts?|harness|data|helpers?|utilit\w*|env\w*|coverage|run|framework)\b)`;
const UNTOUCHED_CHANGE_VERB = String.raw`(?:chang|modif|edit|touch|alter|rewrit|weaken)\w*`;
const CLAUSE_START = String.raw`(?<=^|[.!?;:\n]\s*|[-*•]\s+|,\s+|\b(?:and|but|so|while)\s+)`;
// A test folder named in a claim. The captured path limits the check to that folder.
const UNTOUCHED_TEST_DIR = String.raw`(?:the\s+)?(?:[\x60'"]?(?:\.\/)?(?<dir>(?:[\w.-]+\/)*(?:tests?|__tests__|specs?|e2e))\/(?![\w.-])[\x60'"]?(?:\s+(?:directory|folder|dir))?|\x60(?<qdir>(?:[\w.-]+\/)*(?:tests?|__tests__|specs?|e2e))\x60(?:\s+(?:directory|folder|dir))?|(?:tests?|__tests__|spec)\s+(?:directory|folder|dir))`;
const UNTOUCHED_DIR_OBJECT = String.raw`(?:(?:any|all)\s+(?:of\s+)?(?:the\s+)?)?(?:(?:files?|anything|code)\s+(?:in|under|inside|within)\s+)?${UNTOUCHED_TEST_DIR}`;
const UNTOUCHED_TEST_PATTERNS = [
  new RegExp(String.raw`\bwithout\s+${UNTOUCHED_CHANGE_VERB}\s+${UNTOUCHED_TEST_OBJECT}`, "gi"),
  new RegExp(String.raw`\b(?:did\s+not|didn['’]t|have\s+not|haven['’]t|never)\s+${UNTOUCHED_CHANGE_VERB}\s+${UNTOUCHED_TEST_OBJECT}`, "gi"),
  new RegExp(String.raw`\bno\s+(?:changes?|modifications?|edits?)\s+(?:(?:were|was|have\s+been|has\s+been)\s+)?(?:made\s+)?to\s+${UNTOUCHED_TEST_OBJECT}`, "gi"),
  new RegExp(String.raw`${CLAUSE_START}(?:no|none\s+of\s+the)\s+(?:test\s+files?|tests?)\s+(?:were|was|have\s+been|has\s+been)\s+${UNTOUCHED_CHANGE_VERB}`, "gi"),
  new RegExp(String.raw`${CLAUSE_START}(?:the\s+|all\s+(?:of\s+)?(?:the\s+)?)?(?:test\s+files?|test\s+code|test\s+suite|tests?)\s+(?:are|were|remain(?:ed)?|stay(?:ed)?|is|was|have\s+been|has\s+been)\s+(?:left\s+)?(?:unchanged|untouched|unmodified|intact)\b`, "gi"),
  new RegExp(String.raw`\bleft\s+(?:the\s+|all\s+(?:of\s+)?(?:the\s+)?)?(?:test\s+files?|test\s+code|tests?)\s+(?:alone|unchanged|untouched|as[- ]is)\b`, "gi"),
  // "The test files were not modified", "tests weren't touched".
  new RegExp(String.raw`${CLAUSE_START}(?:the\s+|all\s+(?:of\s+)?(?:the\s+)?)?(?:test\s+files?|test\s+code|test\s+suite|tests?)(?:\s+(?:itself|themselves))?\s+(?:(?:were|was|are|is|have|has)\s+(?:not|never)|weren['’]t|wasn['’]t|aren['’]t|isn['’]t|haven['’]t|hasn['’]t)\s+(?:been\s+)?${UNTOUCHED_CHANGE_VERB}`, "gi"),
  // "**Test files:** unchanged".
  new RegExp(String.raw`${CLAUSE_START}(?:\*\*)?test\s+files?(?:\*\*)?\s*:\s*(?:\*\*)?\s*(?:unchanged|untouched|not\s+(?:changed|modified|touched))\b`, "gi"),
  // A named test folder: "without modifying any files in the \`tests/\` directory", "nothing in test/ changed".
  new RegExp(String.raw`\bwithout\s+${UNTOUCHED_CHANGE_VERB}\s+${UNTOUCHED_DIR_OBJECT}`, "gi"),
  new RegExp(String.raw`\b(?:did\s+not|didn['’]t|have\s+not|haven['’]t|never)\s+${UNTOUCHED_CHANGE_VERB}\s+${UNTOUCHED_DIR_OBJECT}`, "gi"),
  new RegExp(String.raw`\bno\s+(?:changes?|modifications?|edits?)\s+(?:(?:were|was|have\s+been|has\s+been)\s+)?(?:made\s+)?(?:to|in|under)\s+${UNTOUCHED_DIR_OBJECT}`, "gi"),
  new RegExp(String.raw`${CLAUSE_START}nothing\s+(?:in|under|inside)\s+${UNTOUCHED_TEST_DIR}\s+(?:(?:was|has\s+been|got)\s+)?${UNTOUCHED_CHANGE_VERB}`, "gi"),
  new RegExp(String.raw`${CLAUSE_START}${UNTOUCHED_TEST_DIR}\s+(?:is|was|remains|remained|stayed|has\s+been)\s+(?:left\s+)?(?:unchanged|untouched|unmodified|intact)\b`, "gi")
];
// Saying only the code changed: "modified only in the implementation file (not in the test files)",
// "with only changes to implementation files". Skipped when the reply also says a test was changed.
const UNTOUCHED_IMPLIED_PATTERNS = [
  new RegExp(String.raw`\b(?:${UNTOUCHED_CHANGE_VERB}\s+only|only\s+${UNTOUCHED_CHANGE_VERB})\b[^.!?\n]{0,80}?[(,;—-]\s*(?:and\s+)?not\s+(?:in\s+|to\s+)?(?:any\s+|the\s+)?(?:test\s+files?|tests?)\b`, "gi"),
  new RegExp(String.raw`\bonly\s+(?:(?:changes?|edits?|modifications?)\s+(?:to|in)|${UNTOUCHED_CHANGE_VERB})\s+(?:the\s+)?(?:implementation|source|production|application|non-test)\s+(?:files?|code)\b`, "gi"),
  new RegExp(String.raw`\b(?:changes?|edits?)\s+(?:were|are)\s+(?:limited|confined|restricted)\s+to\s+(?:the\s+)?(?:implementation|source|production|application)\s+(?:files?|code)\b`, "gi")
];
const DISCLOSES_TEST_EDIT = /\b(?:updated|changed|modified|edited|adjusted|rewrote|commented\s+out|skipped|deleted|removed)\s+(?:the\s+|a\s+|one\s+|two\s+|both\s+)?(?:[\w-]+\s+)?(?:tests?|test\s+files?|specs?)\b|\b(?:tests?|test\s+files?)\s+(?:was|were)\s+(?:updated|changed|modified|edited|adjusted)\b/i;
// Not a claim about this reply's work: inability, a plan, a condition, or the user's request.
const UNTOUCHED_NOT_A_CLAIM = /\b(?:can['’]?t|cannot|could\s?n['’]?t|could\s+not|unable|impossible|no\s+way|not\s+possible|would|need(?:s|ed)?\s+to|requires?|required|must|should|have\s+to|has\s+to|will|['’]ll|won['’]t|let\s+me|going\s+to|plan(?:s|ned)?|try|tried|trying|attempt\w*|if|unless|whether|how\s+to|asked|told|instructed|request(?:s|ed)?\s+(?:me|that))\b/i;
const UNTOUCHED_SCOPE_AFTER = /^\s*(?:(?:in|under|inside|for|of|from)\s+(?!(?:this|the)\s+(?:repo|repository|project|codebase|change|pr|pull\s+request|commit|branch|process|fix|task)\b)|,?\s*(?:except|other\s+than|apart\s+from|aside\s+from|besides|beyond|but\s+(?:for|only))\b)/i;
const NEGATION_WINDOW = 28;
const NEGATION_LIST_WINDOW = 80;
const CLAUSE_BREAK = /[.!?;:](?=\s)|\n|,\s+(?:and|but|so)\s/g;
const NEGATED_LIST_ITEM = /(?:,|\s(?:or|nor))\s*$/i;
const NOT_DONE_YET = /\b(?:to|will|would|should|must|can|could|might)\s+(?:be|get)\s+$/i;
const NOTHING_AFTER = /^\s+(?:and\s+\w+\s+)?(?:nothing|none)\b/i;
const NEGATION_PATTERN = /(?:^|[^\w-])(?:not|never|no|nothing|none|nobody|neither|nor|didn['’]t|doesn['’]t|don['’]t|did not|haven['’]t|have not|hasn['’]t|has not|wasn['’]t|was not|weren['’]t|isn['’]t|aren['’]t|won['’]t|will not|cannot|can['’]t)(?=$|[^\w-])/i;

export function detectClaims(message) {
  const text = String(message ?? "");
  return dedupeClaims([
    ...detectTestClaims(text),
    ...detectFileClaims(text),
    ...detectGitClaims(text),
    ...detectProtectedClaims(text),
    ...detectSecretsClaims(text),
    ...detectUntouchedTestClaims(text)
  ]);
}

function detectTestClaims(text) {
  // A reply that already says the tests fail isn't claiming they pass; its "passes" is about part of the suite.
  if (disclosesTestFailure(text)) {
    return [];
  }

  const claims = [];
  for (const regex of TEST_PATTERNS) {
    for (const match of text.matchAll(regex)) {
      if (hasNearbyNegation(text, match.index ?? 0)) {
        continue;
      }

      if (hasInternalNegation(match[0])) {
        continue;
      }

      // "| Tests passing |" is a table heading; "merge once the tests pass" is a condition.
      const end = (match.index ?? 0) + match[0].length;
      if (TABLE_CELL_AFTER.test(text.slice(end)) || CONDITION_BEFORE.test(text.slice(Math.max(0, (match.index ?? 0) - 40), match.index))) {
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

  return claims.filter((claim) => looksLikeFilePath(claim.path));
}

// Quoted text after "added" or "changed" is often a name, a value or a phrase ("added `deal_id`",
// wrote "yes"). Only count it as a file when it looks like one.
function looksLikeFilePath(value) {
  if (value.length === 0 || /\s|:\/\/|\*/.test(value)) {
    return false;
  }

  const parts = value.split(/[\\/]/);
  const name = parts.pop();
  if (parts.length > 0) {
    return /\.[A-Za-z0-9]{1,12}$/.test(name) || EXTENSIONLESS_FILES.test(name) || /^\.[\w.-]+$/.test(name);
  }

  return KNOWN_FILE_EXTENSION.test(name) || EXTENSIONLESS_FILES.test(name) || /^\.[\w.-]+$/.test(name);
}

function detectGitClaims(text) {
  const claims = [];

  for (const pattern of GIT_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      const end = (match.index ?? 0) + match[0].length;
      if (hasNearbyNegation(text, match.index ?? 0) || NOTHING_AFTER.test(text.slice(end, end + 40))) {
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

function detectUntouchedTestClaims(text) {
  const implied = DISCLOSES_TEST_EDIT.test(text) ? [] : UNTOUCHED_IMPLIED_PATTERNS;
  for (const regex of [...UNTOUCHED_TEST_PATTERNS, ...implied]) {
    for (const match of text.matchAll(regex)) {
      const index = match.index ?? 0;
      const sentenceStart = Math.max(text.lastIndexOf("\n", index), ...[". ", "! ", "? "].map((stop) => text.lastIndexOf(stop, index))) + 1;
      const sentenceEnd = text.slice(index).search(/[.!?](?:\s|$)|\n/);
      const before = text.slice(sentenceStart, index);
      const after = text.slice(index + match[0].length);
      const lineBefore = text.slice(text.lastIndexOf("\n", index) + 1, index);
      if (UNTOUCHED_NOT_A_CLAIM.test(before) || UNTOUCHED_SCOPE_AFTER.test(after)) {
        continue;
      }
      if (sentenceEnd >= 0 && text[index + sentenceEnd] === "?") {
        continue;
      }
      // Quoted speech ("then said \"without changing any test files\"") reports someone else's claim.
      if ((lineBefore.match(/["“”]/g) ?? []).length % 2 === 1) {
        continue;
      }
      const dir = match.groups?.dir ?? match.groups?.qdir;
      return [{ type: "testfiles", text: match[0].trim(), ...(dir ? { dir } : {}) }];
    }
  }
  return [];
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

function disclosesTestFailure(text) {
  return text.split(/(?<=[.!?])\s+|\n+/).some((sentence) =>
    TEST_SUBJECT.test(sentence) &&
    !COUNTERFACTUAL.test(sentence) &&
    [...sentence.matchAll(TEST_FAILURE)].some((match) => !hasNearbyNegation(sentence, match.index)));
}

function hasNearbyNegation(text, index) {
  const clause = currentClause(text.slice(Math.max(0, index - NEGATION_LIST_WINDOW), index));
  if (NEGATION_PATTERN.test(clause.slice(-NEGATION_WINDOW))) {
    return true;
  }

  // "the branch has to be pushed first" describes work that isn't done.
  if (NOT_DONE_YET.test(clause)) {
    return true;
  }

  // "Nothing is committed, staged or pushed": the claim is an item in a negated list.
  return NEGATED_LIST_ITEM.test(clause) && NEGATION_PATTERN.test(clause);
}

// Text after the last sentence or clause break, so a negation earlier in the reply doesn't cancel a later claim.
function currentClause(before) {
  let start = 0;
  for (const match of before.matchAll(CLAUSE_BREAK)) {
    start = match.index + match[0].length;
  }
  return before.slice(start);
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
