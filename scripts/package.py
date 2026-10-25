"""Build or verify the offline ZIP from the explicit src runtime allowlist."""
import argparse
import hashlib
import json
import pathlib
import posixpath
import re
import tempfile
import zipfile
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = (
    'Index.html', 'LICENSE', 'はじめに.txt',
    'files/style.css', 'files/script.js', 'files/accessibility.js',
    'files/import-core.js', 'files/initial-import.js', 'files/onboarding.js', 'files/excel-templates.js',
    'files/manual.html', 'files/sample-data.json', 'files/sample-data.js',
    'files/vendor/echarts.min.js', 'files/vendor/xlsx.full.min.js', 'files/vendor/exceljs.min.js',
    'files/vendor/echarts.LICENSE', 'files/vendor/echarts.NOTICE',
    'files/vendor/sheetjs.LICENSE', 'files/vendor/exceljs.LICENSE', 'files/vendor/exceljs.BUNDLED-LICENSES.txt', 'files/licenses/THIRD-PARTY-NOTICES.md',
)
VENDOR = {
    'files/vendor/echarts.min.js': 'e84270bd0cd5bdf60fefc26d00c2a391cb2e81f4d26a7a9ee16185a54773a3cf',
    'files/vendor/echarts.LICENSE': '634293835b43a6dd2094fa39182a3d9a6b9ca43b7fdb9ac354e8037af2a3093a',
    'files/vendor/echarts.NOTICE': 'fa99ac3af859d0e13166906dc53a73ad34a08898da7e8ae83407275496e9e30c',
    'files/vendor/xlsx.full.min.js': 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41',
    'files/vendor/sheetjs.LICENSE': '4d2a38ac35cda06a555c84074a819d413339cd3691b822cae50f8f322fe01f64',
    'files/vendor/exceljs.min.js': '7e49da68588e250dbb8bba190d2caa8ab3787cc0284bda1d8b2f805c4df742c9',
    'files/vendor/exceljs.BUNDLED-LICENSES.txt': 'f0fb05d61f9a9a62bc199cda8039e9d1198aff0773d5aa2f3d2ef65937730501',
    'files/vendor/exceljs.LICENSE': '2ee88321435317a4dbf464f275b88fe2efe6968c381f5ce34b5de539200e5855',
}
PREFIX = 'grade-analysis-dashboard/'


def require(condition, message):
    if not condition:
        raise ValueError(message)


class References(HTMLParser):
    def __init__(self):
        super().__init__()
        self.references = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        require(not (tag == 'script' and attrs.get('type') == 'module'),
                'ES modules are not allowed in the offline app')
        for key in ('src', 'href'):
            if key in attrs:
                self.references.append((tag, key, attrs[key]))


def payloads(source):
    require(source.is_dir() and not source.is_symlink(), 'Source directory missing or symlinked')
    actual = set()
    for item in source.rglob('*'):
        require(not item.is_symlink(), 'Source contains a symlink')
        if item.is_file() and item.name != '.DS_Store':
            actual.add(item.relative_to(source).as_posix())
    require(actual == set(FILES), 'Source runtime allowlist mismatch (missing or unexpected files)')
    data = {name: (source / name).read_bytes() for name in FILES}
    for name, digest in VENDOR.items():
        require(hashlib.sha256(data[name]).hexdigest() == digest, 'Vendor checksum mismatch: ' + name)
    require(data['LICENSE'] == (ROOT / 'LICENSE').read_bytes(), 'Application LICENSE mismatch')
    require(data['LICENSE'].startswith(b'MIT License\n'), 'Application MIT license missing')
    for name, content in data.items():
        if name in VENDOR:
            continue
        text = content.decode('utf-8-sig')
        require(not re.search(r'/(?:Users|home)/[^/]+/|[A-Z]:\\Users\\', text),
                'Machine-specific path in ' + name)
        require(not re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|'
                              r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}\b', text),
                'Possible credential in ' + name)
        if name.endswith('.js'):
            require(not re.search(r'\bfetch\s*\(|\bimport\s*\(', text),
                    'Network or dynamic-module dependency in ' + name)
        if not name.endswith('.html'):
            continue
        parser = References()
        parser.feed(text)
        for tag, key, value in parser.references:
            target = urlsplit(value)
            if target.scheme:
                require(target.scheme in ('data', 'blob') or (tag == 'a' and key == 'href'),
                        'External runtime asset in ' + name)
                continue
            if not target.path:
                continue
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(target.path)))
            require(resolved in data, 'Broken or incorrectly cased reference: ' + name + ' -> ' + value)
    sample = json.loads(data['files/sample-data.json'])
    require(len(sample['students']) == 60 and len(sample['tests']) == 10, 'Unexpected sample structure')
    require(all(re.fullmatch(r'架空生徒\d{3}', s['name']) for s in sample['students']),
            'Sample names must be explicitly fictional')
    require(sample['settings']['adminPinHash'] is None and sample['interventions'] == [],
            'Sample must not contain a PIN or personal support records')
    match = re.search(r'window\.GRADE_DASHBOARD_SAMPLE\s*=\s*(.*);\s*$',
                      data['files/sample-data.js'].decode('utf-8'), re.S)
    require(match is not None and json.loads(match.group(1)) == sample, 'Sample JSON/JS mismatch')
    return {PREFIX + name: content for name, content in data.items()}


def verify(output, expected):
    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and set(names) == set(expected), 'ZIP allowlist mismatch')
        for name, content in expected.items():
            require(archive.read(name) == content, 'Stale or changed ZIP entry: ' + name)
            require(not name.startswith('/') and '..' not in pathlib.PurePosixPath(name).parts,
                    'Unsafe ZIP entry')
            require((archive.getinfo(name).external_attr >> 16) & 0o170000 != 0o120000,
                    'ZIP contains a symlink')
        require(archive.testzip() is None, 'Corrupt ZIP entry')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=pathlib.Path, default=ROOT / 'src')
    parser.add_argument('--output', type=pathlib.Path, default=ROOT / 'downloads/grade-analysis-dashboard.zip')
    parser.add_argument('--check', action='store_true', help='Verify the existing ZIP without writing it')
    args = parser.parse_args()
    expected = payloads(args.source.absolute())
    output = args.output.absolute()
    require(not output.is_relative_to(args.source.absolute()), 'Output must be outside src')
    require(not output.is_symlink(), 'Output must not be a symlink')
    if not args.check:
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=output.parent, suffix='.zip.tmp', delete=False) as handle:
            temporary = pathlib.Path(handle.name)
        try:
            with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as archive:
                for name, content in sorted(expected.items()):
                    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, content)
            verify(temporary, expected)
            temporary.replace(output)
        finally:
            temporary.unlink(missing_ok=True)
    verify(output, expected)
    print(f'Verified {len(FILES)} runtime files: exact source bytes, local references, licenses and fictional sample.')
    print(output)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error))
