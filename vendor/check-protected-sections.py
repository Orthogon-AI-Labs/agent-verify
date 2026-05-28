#!/usr/bin/env python3
"""Check canon protected Markdown blocks against HEAD."""

from __future__ import annotations

__version__ = "canon-0.4.0"

import argparse
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


START_RE = re.compile(r"<!--\s*canon:protected:start\s+name=\"([^\"]+)\"\s*-->")
END_RE = re.compile(r"<!--\s*canon:protected:end\s*-->")


@dataclass
class Block:
    name: str
    body: str
    start_line: int
    end_line: int


class ParseError(Exception):
    def __init__(self, message: str, block_name: str | None = None) -> None:
        super().__init__(message)
        self.block_name = block_name


def run_git(args: list[str], cwd: Path, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=check,
    )


def repo_root() -> Path:
    result = run_git(["rev-parse", "--show-toplevel"], Path.cwd())
    return Path(result.stdout.strip())


def changed_markdown_files(root: Path, cached: bool = False) -> list[Path]:
    names: set[str] = set()
    args = ["diff"]
    if cached:
        args.append("--cached")
    args.extend(["--name-only", "--", "*.md"])
    result = run_git(args, root)
    for line in result.stdout.splitlines():
        if line.strip():
            names.add(line.strip())
    return [Path(name) for name in sorted(names)]


def read_head(root: Path, path: Path) -> str:
    result = run_git(["show", f"HEAD:{path.as_posix()}"], root, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout


def read_worktree(root: Path, path: Path) -> str:
    full_path = root / path
    if not full_path.exists():
        return ""
    return full_path.read_text(encoding="utf-8")


def read_index(root: Path, path: Path) -> str:
    result = run_git(["show", f":{path.as_posix()}"], root, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout


def parse_blocks(text: str) -> dict[str, Block]:
    blocks: dict[str, Block] = {}
    active_name: str | None = None
    active_start_line = 0
    active_body: list[str] = []

    for line_number, line in enumerate(text.splitlines(keepends=True), start=1):
        start = START_RE.fullmatch(line.strip())
        end = END_RE.fullmatch(line.strip())

        if start:
            if active_name is not None:
                raise ParseError(
                    f'nested protected block "{start.group(1)}" inside "{active_name}"',
                    active_name,
                )
            active_name = start.group(1)
            active_start_line = line_number
            active_body = []
            continue

        if end:
            if active_name is None:
                raise ParseError("end marker without matching start marker")
            if active_name in blocks:
                raise ParseError(f'duplicate protected block "{active_name}"', active_name)
            blocks[active_name] = Block(
                name=active_name,
                body="".join(active_body),
                start_line=active_start_line,
                end_line=line_number,
            )
            active_name = None
            active_body = []
            continue

        if active_name is not None:
            active_body.append(line)

    if active_name is not None:
        raise ParseError(f'protected block "{active_name}" is missing an end marker', active_name)

    return blocks


def compare_file(root: Path, path: Path, current_text: str, source_label: str, allowed: set[str]) -> list[str]:
    failures: list[str] = []
    try:
        base_blocks = parse_blocks(read_head(root, path))
    except ParseError as exc:
        return [f'{path}: invalid protected marker syntax in HEAD: {exc}']

    try:
        current_blocks = parse_blocks(current_text)
    except ParseError as exc:
        return [f'{path}: invalid protected marker syntax in {source_label}: {exc}']

    for name, base_block in base_blocks.items():
        if name in allowed:
            continue
        current_block = current_blocks.get(name)
        if current_block is None:
            failures.append(
                f'{path} ({source_label}): removed or renamed protected block "{name}" '
                f"(was lines {base_block.start_line}-{base_block.end_line})"
            )
            continue
        if current_block.body != base_block.body:
            failures.append(
                f'{path} ({source_label}): touched protected block "{name}" '
                f"(lines {current_block.start_line}-{current_block.end_line})"
            )

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check changed Markdown files for edits to canon protected blocks."
    )
    parser.add_argument(
        "--allow",
        action="append",
        default=[],
        metavar="NAME",
        help="Allow a specific protected block name to differ from HEAD.",
    )
    args = parser.parse_args()

    try:
        root = repo_root()
    except subprocess.CalledProcessError:
        print("[canon protected-sections] not inside a git repository", file=sys.stderr)
        return 2

    failures: list[str] = []
    allowed = set(args.allow)
    for path in changed_markdown_files(root, cached=False):
        failures.extend(compare_file(root, path, read_worktree(root, path), "working tree", allowed))
    for path in changed_markdown_files(root, cached=True):
        failures.extend(compare_file(root, path, read_index(root, path), "index", allowed))

    print("[canon protected-sections]")
    if not failures:
        print("ok: protected sections are intact")
        return 0

    for failure in failures:
        print(f"x {failure}")
    print()
    print("To proceed, explicitly confirm: I approve editing protected section: <name>")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
