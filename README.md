# agent-verify

agent-verify checks what a coding agent says it did.

When Claude Code finishes a reply, agent-verify looks for claims like "tests pass", "I pushed the branch", "updated `src/app.ts`" or "I didn't change the tests" and checks each one against your project. If a claim is false, the agent has to correct its answer before the reply ends.

```text
Agent:   All tests pass and I pushed the branch.

agent-verify blocks the reply:
- Claimed tests passed, but `npm test` exited 1.
- Claimed the branch was pushed, but the current branch has no upstream.

Agent:   Correction: the tests fail (`npm test` exits 1), and the branch was not pushed.
```

agent-verify is a small, new project. I built it for my own Claude Code work and run it on my projects. It catches some false claims, not all of them, and it can occasionally flag a reply that was correct (see [Limits](#limits)). Issues are welcome.

## Install

In Claude Code:

```text
/plugin marketplace add Orthogon-AI-Labs/agent-verify
/plugin install agent-verify@orthogon-ai-labs
```

Or load a local checkout: `claude --plugin-dir /path/to/agent-verify`.

It also runs in [Codex](#codex) and [Qwen Code](#qwen-code).

agent-verify needs Node 18 or newer and has no npm dependencies. Once installed it runs at the end of every reply. You'll only see it when it thinks a claim is false.

## What it checks

| When the agent says | agent-verify checks that |
| --- | --- |
| "tests pass" | your test command exits 0 |
| "updated `src/app.ts`" | the file exists in the project and was edited in this session |
| "committed the changes" | the latest commit was made in this session |
| "pushed the branch" | the branch has an upstream and no unpushed commits |
| "opened a PR" | `gh pr view` finds a pull request for the current branch |
| "protected sections are intact" | no [canon](https://github.com/Orthogon-AI-Labs/canon) protected block has changed since the last commit |
| "I didn't change the tests", "without modifying any test files", "leaving the tests as they were" or "nothing in `tests/` changed" | git shows no test file (or no file in the named folder) modified, deleted or renamed this session. Adding a new test file is fine. |
| "no secrets committed" or "safe to push" | the staged changes contain no API keys, private keys or tokens. On a push claim, unpushed commits are scanned too. A match is reported by file, line and key type, never by its value. |

The test command comes from `verify.config.json` if you set one. Otherwise agent-verify uses the `test` script in `package.json` (run with npm, pnpm, yarn or bun, whichever lockfile is present), `cargo test`, `go test ./...` or `python3 -m pytest -q` (with the project's `.venv` Python if there is one). If the program that runs the tests isn't installed, a "tests pass" claim is marked inconclusive.

Some claims can't be checked: there's no test command, `python3` or `gh` is missing, or the folder isn't a git repository. Those claims are marked **inconclusive**, not false.

agent-verify blocks a reply at most once and never edits your code. It has no telemetry.

## Limits

- It finds claims by matching common English phrasing. A claim worded another way is missed, and now and then a sentence that isn't a claim is read as one, for example "pushed" used in a non-git sense. When that happens, it can block a correct reply once.
- A "tests pass" claim makes it run your whole test command, which adds that time to the end of the reply. A run longer than the timeout (2 minutes by default, `test.timeoutMs` in `verify.config.json`) is reported as inconclusive.
- It checks the project as it is when the reply ends. It can't tell which earlier test run or push the agent was talking about.
- It only reads the agent's final message.
- It recognizes test files by common names and folders (`test/`, `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `test_*.py`, `*_test.go` and similar). It counts changes since the first tool call of the session, so in a long session a test you asked the agent to change earlier also counts.

## Receipt

Each check writes `.verify/last-receipt.json`. It lists every claim, what was checked and the result. It never stores a secret's value or a file's contents. The `.verify/` folder has its own `.gitignore`, so git ignores it without any change to your project's `.gitignore`. (Versions before 1.4.1 added a `.verify/` line to your `.gitignore`; you can delete that line.)

To print it, run this from a checkout of this repo (exit code is non-zero if the last reply was blocked):

```bash
node src/cli.mjs receipt --print --cwd /path/to/project
```

## Configuration

Configuration is optional. Add `verify.config.json` to your project root, for example to set the test command or turn checks off:

```json
{
  "test": { "command": "npm test", "timeoutMs": 120000 },
  "enabledVerifiers": ["tests", "files", "git", "protected", "secrets", "testfiles"]
}
```

All options and their defaults are in [verify.config.example.json](verify.config.example.json).

## Codex

agent-verify runs in [Codex](https://github.com/openai/codex) too, using Codex's own hooks. Install it:

```bash
codex plugin marketplace add Orthogon-AI-Labs/agent-verify
codex plugin add agent-verify@orthogon-ai-labs
```

Codex doesn't run a plugin's hooks until you trust them. Start Codex, run `/hooks`, and trust agent-verify's two hooks. If an update changes the hooks, Codex asks again.

To check a message by hand from a checkout of this repo:

```bash
npm run codex:notify -- --message "I ran the tests and they pass."
```

## Qwen Code

agent-verify runs in [Qwen Code](https://github.com/QwenLM/qwen-code) as an extension, with whichever model you use there, including open-weight models you serve yourself. Install it:

```bash
qwen extensions install https://github.com/Orthogon-AI-Labs/agent-verify:agent-verify
```

I've tested it with Qwen Code 0.26 and Qwen3-Coder 30B running locally in Ollama.

## Development

```bash
npm test
npm run smoke
npm run check
```

Plans are in [ROADMAP.md](ROADMAP.md).

## License

MIT. Built by [Orthogon AI Labs](https://github.com/Orthogon-AI-Labs). Works alongside [canon](https://github.com/Orthogon-AI-Labs/canon), which stops agents rewriting the parts of your Markdown you've protected.
