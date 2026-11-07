#!/usr/bin/env python3
"""Check canon protected Markdown blocks against HEAD."""

from __future__ import annotations

__version__ = "canon-0.6.0+e18787c"

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
        errors="surrogateescape",
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
    # -z: paths verbatim (without it git C-quotes non-ASCII names, which then match no file).
    # --no-renames: a renamed file shows as its old path deleted, so its blocks count as removed.
    # icase: NOTES.MD is Markdown too.
    args.extend(["--name-only", "-z", "--no-renames", "--", ":(icase)*.md"])
    result = run_git(args, root)
    for name in result.stdout.split("\0"):
        if name:
            names.add(name)
    return [Path(name) for name in sorted(names)]


def unmerged_files(root: Path) -> set[Path]:
    """Paths with merge conflicts. Their index has no stage 0 to compare, only the working tree."""
    result = run_git(["ls-files", "--unmerged", "-z"], root, check=False)
    return {Path(entry.split("\t", 1)[1]) for entry in result.stdout.split("\0") if "\t" in entry}


def read_head(root: Path, path: Path) -> str:
    result = run_git(["show", f"HEAD:{path.as_posix()}"], root, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout


def read_worktree(root: Path, path: Path) -> str:
    full_path = root / path
    if not full_path.exists():
        return ""
    return full_path.read_text(encoding="utf-8", errors="surrogateescape")


def read_index(root: Path, path: Path) -> str:
    result = run_git(["show", f":{path.as_posix()}"], root, check=False)
    if result.returncode != 0:
        return ""
    return result.stdout


def marker_text(line: str) -> str:
    # A UTF-8 byte order mark before a first-line marker is not part of the marker.
    return line.strip().lstrip("\ufeff").strip()


def parse_blocks(text: str) -> dict[str, Block]:
    blocks: dict[str, Block] = {}
    active_name: str | None = None
    active_start_line = 0
    active_body: list[str] = []

    for line_number, line in enumerate(text.splitlines(keepends=True), start=1):
        start = START_RE.fullmatch(marker_text(line))
        end = END_RE.fullmatch(marker_text(line))

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


def parse_blocks_lenient(text: str) -> dict[str, list[Block]]:
    """Every block that still parses when markers are broken, by name.

    An end marker with no open block is skipped, and a start marker inside an open block
    drops the open one. A name maps to more than one block when it appears more than once.
    For text that parse_blocks accepts, each name maps to that one block.
    """
    blocks: dict[str, list[Block]] = {}
    active_name: str | None = None
    active_start_line = 0
    active_body: list[str] = []

    for line_number, line in enumerate(text.splitlines(keepends=True), start=1):
        start = START_RE.fullmatch(marker_text(line))
        if start:
            active_name, active_start_line, active_body = start.group(1), line_number, []
        elif END_RE.fullmatch(marker_text(line)):
            if active_name is not None:
                blocks.setdefault(active_name, []).append(
                    Block(active_name, "".join(active_body), active_start_line, line_number)
                )
            active_name = None
        elif active_name is not None:
            active_body.append(line)
    return blocks


def compare_blocks(path: Path, base_blocks: dict, current_blocks: dict, source_label: str, allowed: set[str]) -> list[str]:
    failures: list[str] = []
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


def compare_file(root: Path, path: Path, current_text: str, source_label: str, allowed: set[str]) -> list[str]:
    head_text = read_head(root, path)
    try:
        base_blocks = parse_blocks(head_text)
    except ParseError as exc:
        return [f'{path}: invalid protected marker syntax in HEAD: {exc}']

    try:
        current_blocks = parse_blocks(current_text)
    except ParseError as exc:
        # Report the broken markers, and still check every block that can be found, so a
        # broken marker can't hide a change to another block in the same file.
        lenient = {name: found[0] for name, found in parse_blocks_lenient(current_text).items() if len(found) == 1}
        return [f'{path}: invalid protected marker syntax in {source_label}: {exc}'] + compare_blocks(
            path, base_blocks, lenient, source_label, allowed
        )

    return compare_blocks(path, base_blocks, current_blocks, source_label, allowed)


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
    # Block names and paths can hold bytes that aren't UTF-8; print them escaped rather than crash mid-report.
    sys.stdout.reconfigure(errors="backslashreplace")

    try:
        root = repo_root()
    except subprocess.CalledProcessError:
        print("[canon protected-sections] not inside a git repository", file=sys.stderr)
        return 2

    failures: list[str] = []
    allowed = set(args.allow)
    for path in changed_markdown_files(root, cached=False):
        failures.extend(compare_file(root, path, read_worktree(root, path), "working tree", allowed))
    unmerged = unmerged_files(root)
    for path in changed_markdown_files(root, cached=True):
        if path not in unmerged:
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
