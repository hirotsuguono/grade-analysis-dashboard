#!/usr/bin/env python3
"""Reject personal addresses in Git identities and commit/tag messages."""

import argparse
import re
import subprocess
import sys
from pathlib import Path

EMAIL = re.compile(rb"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~\[\]-]+@[A-Za-z0-9.-]+")
NOREPLY = re.compile(rb"(?:[a-z0-9._+\-]+(?:\[bot\])?@users\.noreply\.github\.com|noreply@github\.com)")
IDENTITY = re.compile(rb" <([^<>]+)> -?\d+ [+-]\d{4}$")


def git(*args):
    return subprocess.check_output(["git", *args], stderr=subprocess.PIPE)


def check_email(email, location):
    if not NOREPLY.fullmatch(email.lower()):
        # Never echo the rejected address into public CI logs.
        raise ValueError(f"{location}: use a GitHub noreply email address")


def check_identity(identity, location):
    match = IDENTITY.search(identity.strip())
    if not match:
        raise ValueError(f"{location}: invalid Git identity")
    check_email(match.group(1), location)
    for email in EMAIL.findall(identity):
        check_email(email, location)


def check_message(message, location):
    for email in EMAIL.findall(message):
        check_email(email.rstrip(b"."), location)


def check_object(sha, kind):
    raw = git("cat-file", kind, sha)
    headers, _, message = raw.partition(b"\n\n")
    fields = (b"author", b"committer") if kind == "commit" else (b"tagger",)
    for field in fields:
        lines = [line[len(field) + 1:] for line in headers.splitlines()
                 if line.startswith(field + b" ")]
        if len(lines) != 1:
            raise ValueError(f"{kind} {sha[:12]}: missing or repeated identity")
        check_identity(lines[0], f"{kind} {sha[:12]} {field.decode()}")
    check_message(message, f"{kind} {sha[:12]} message")
    return headers


def check_history(refs):
    commits = set()
    tags = set()
    tips = []
    for ref in refs:
        sha = git("rev-parse", "--verify", ref).decode().strip()
        kind = git("cat-file", "-t", sha).decode().strip()
        while kind == "tag":
            if sha in tags:
                break
            tags.add(sha)
            headers = check_object(sha, "tag")
            sha = headers.splitlines()[0].removeprefix(b"object ").decode()
            kind = git("cat-file", "-t", sha).decode().strip()
        if kind == "commit":
            tips.append(sha)
        elif kind != "tag":
            raise ValueError("Only tags pointing to commits may be published")
    if tips:
        commits.update(git("rev-list", *tips).decode().splitlines())
    for sha in sorted(commits):
        check_object(sha, "commit")
    print(f"Email privacy: {len(commits)} commits and {len(tags)} annotated tags checked")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--identity", action="store_true")
    mode.add_argument("--message", type=Path)
    mode.add_argument("--pre-push", action="store_true")
    args = parser.parse_args()
    try:
        if args.identity:
            for field in ("GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"):
                check_identity(git("var", field), field)
        elif args.message:
            check_message(args.message.read_bytes(), "commit message")
        elif args.pre_push:
            refs = []
            for line in sys.stdin:
                fields = line.split()
                if len(fields) != 4 or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", fields[1]):
                    raise ValueError("Invalid pre-push input")
                if set(fields[1]) != {"0"}:
                    refs.append(fields[1])
            check_history(refs)
        else:
            refs = git("for-each-ref", "--format=%(refname)").decode().splitlines()
            check_history(["HEAD", *refs])
    except (ValueError, subprocess.CalledProcessError, OSError) as error:
        message = str(error) if isinstance(error, ValueError) else "Unable to complete the Git email check"
        print(f"Email privacy check failed: {message}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
