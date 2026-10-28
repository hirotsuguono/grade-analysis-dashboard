#!/usr/bin/env python3
"""Check tracked source and ZIP contents without printing matched private values."""
import argparse
import hashlib
from pathlib import Path
import re
import subprocess
import sys
import zipfile
import io

from package import VENDOR
from check_commit_email import NOREPLY

EMAIL = re.compile(rb"[A-Za-z0-9.!#$%&*+/=?^_`{|}~\[\]-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}(?![A-Za-z0-9.-])")

ROOT = Path(__file__).resolve().parent.parent
CREDENTIAL = re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b')


def check_bytes(data, location, runtime_path=None):
    if CREDENTIAL.search(data):
        raise ValueError(location + ': possible credential (value withheld)')
    # Full bytes are still scanned. Upstream copyright/contact addresses are intentional;
    # an exact reviewed checksum is required before allowing them, including inside ZIPs.
    third_party = runtime_path in VENDOR and hashlib.sha256(data).hexdigest() == VENDOR[runtime_path]
    for email in EMAIL.findall(data):
        email = email.rstrip(b'.').lower()
        if NOREPLY.fullmatch(email) or email.endswith(b'.invalid') or third_party:
            continue
        raise ValueError(location + ': unreviewed email address (value withheld)')


def check_file(data, name):
    if name.endswith('.zip'):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if sum(i.file_size for i in archive.infolist()) > 40 * 1024 * 1024:
                raise ValueError(name + ': ZIP is too large to inspect')
            for entry in archive.infolist():
                runtime = entry.filename.removeprefix('grade-analysis-dashboard/')
                check_bytes(archive.read(entry), name + ' entry', runtime)
    else:
        runtime = name.removeprefix('src/') if name.startswith('src/') else None
        check_bytes(data, name, runtime)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--staged', action='store_true', help='Inspect the staged index before committing')
    parser.add_argument('--ref', help='Inspect exactly the committed tree to publish')
    args = parser.parse_args()
    try:
        if args.ref:
            names = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', '-z', args.ref], cwd=ROOT).decode().split('\0')
        else:
            names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode().split('\0')
        count = 0
        for name in filter(None, names):
            data = subprocess.check_output(['git', 'show', args.ref + ':' + name], cwd=ROOT) if args.ref else subprocess.check_output(['git', 'show', ':' + name], cwd=ROOT) if args.staged else (ROOT / name).read_bytes()
            check_file(data, name)
            count += 1
        print(f'Content privacy: {count} tracked files and ZIP contents checked; reviewed upstream contacts retained')
    except (ValueError, OSError, subprocess.CalledProcessError, zipfile.BadZipFile):
        # Filenames and exception messages can themselves contain private data. Never echo them.
        print('Content privacy check failed: unreviewed email, possible credential, or unreadable content (values withheld)', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
