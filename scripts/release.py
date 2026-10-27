"""Verify, attach and publish an existing stable release using GitHub Actions."""
import argparse
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPOSITORY = 'hirotsuguono/grade-analysis-dashboard'
FILENAME = 'grade-analysis-dashboard.zip'


def require(condition, message):
    if not condition:
        raise ValueError(message)


@dataclass(frozen=True)
class Release:
    version: str
    commit: str
    release_id: str

    def __post_init__(self):
        number = r'(?:0|[1-9][0-9]*)'
        require(re.fullmatch(f'v{number}\\.{number}\\.{number}', self.version),
                'Use a stable version such as v0.5.0')
        require(re.fullmatch(r'[0-9a-f]{40}', self.commit), 'Use a full lowercase commit SHA')
        require(re.fullmatch(r'[1-9][0-9]*', self.release_id), 'Use an existing numeric Release ID')

    @property
    def endpoint(self):
        return f'repos/{REPOSITORY}/releases/{self.release_id}'

    @property
    def urls(self):
        base = f'https://github.com/{REPOSITORY}/releases/'
        return [base + f'download/{self.version}/{FILENAME}', base + f'latest/download/{FILENAME}']


class GitHub:
    def api(self, endpoint, payload=None, binary=False):
        args = ['gh', 'api', endpoint, '--method', 'GET' if payload is None else 'PATCH']
        if binary:
            args += ['-H', 'Accept: application/octet-stream']
        if payload is not None:
            args += ['--input', '-']
        result = subprocess.run(args, input=None if payload is None else json.dumps(payload).encode(),
                                capture_output=True, check=True, timeout=90)
        return result.stdout if binary else json.loads(result.stdout)

    def upload(self, version, asset):
        subprocess.run(['gh', 'release', 'upload', version, str(asset), '--repo', REPOSITORY],
                       check=True, timeout=120)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def source_zip(release):
    subprocess.run(['git', 'merge-base', '--is-ancestor', release.commit, 'origin/main'],
                   cwd=ROOT, check=True, capture_output=True)
    package = json.loads(git('show', release.commit + ':package.json'))
    require(package['version'] == release.version[1:], 'Version differs from target package.json')
    original = git('show', release.commit + ':downloads/' + FILENAME)
    source_files = git('ls-tree', '-r', '--name-only', '-z', release.commit, '--', 'src').decode().split('\0')
    source_files = [name for name in source_files if name]
    expected = {'grade-analysis-dashboard/' + name.removeprefix('src/'):
                git('show', release.commit + ':' + name) for name in source_files}
    with zipfile.ZipFile(io.BytesIO(original)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)) and set(names) == set(expected), 'ZIP runtime files differ')
        for name, data in expected.items():
            require(archive.read(name) == data, 'ZIP differs from target source: ' + name)
            require('..' not in pathlib.PurePosixPath(name).parts, 'Unsafe ZIP path')
            require((archive.getinfo(name).external_attr >> 16) & 0o170000 != 0o120000,
                    'ZIP contains a symlink')
        require(archive.testzip() is None, 'Corrupt ZIP')
    return original


def verify_tag(client, release, required):
    refs = client.api(f'repos/{REPOSITORY}/git/matching-refs/tags/{release.version}')
    refs = [ref for ref in refs if ref['ref'] == 'refs/tags/' + release.version]
    require(len(refs) <= 1, 'Multiple matching tags')
    if not refs:
        require(not required, 'Published tag is missing')
        return False
    obj, seen = refs[0]['object'], set()
    while obj['type'] == 'tag':
        require(obj['sha'] not in seen, 'Tag reference cycle')
        seen.add(obj['sha'])
        obj = client.api(f'repos/{REPOSITORY}/git/tags/{obj["sha"]}')['object']
    require(obj['type'] == 'commit' and obj['sha'] == release.commit,
            'Tag points to a different commit')
    return True


def verify_release(client, release, record):
    require(str(record['id']) == release.release_id, 'Release ID differs')
    require(record['tag_name'] == release.version, 'Release version differs')
    has_tag = verify_tag(client, release, required=not record['draft'])
    if record['target_commitish'] != release.commit and not has_tag:
        ref = urllib.parse.quote(record['target_commitish'], safe='')
        resolved = client.api(f'repos/{REPOSITORY}/commits/{ref}')['sha']
        require(resolved == release.commit, 'Draft target resolves to a different commit')
    if not record['draft']:
        require(not record['prerelease'], 'Existing published release is a prerelease')
        latest = client.api(f'repos/{REPOSITORY}/releases/latest')
        require(latest['id'] == record['id'], 'Published release is not Latest; refuse to change it')


def verify_asset(client, record, original):
    matches = [asset for asset in record['assets'] if asset['name'] == FILENAME]
    require(len(matches) <= 1, 'Duplicate release ZIP assets')
    if not matches:
        return False
    asset = matches[0]
    require(asset['state'] == 'uploaded' and asset['size'] == len(original), 'Asset is incomplete or differs')
    digest = 'sha256:' + hashlib.sha256(original).hexdigest()
    require(asset.get('digest') in (None, digest), 'Existing asset digest differs; it will not be replaced')
    uploaded = client.api(f'repos/{REPOSITORY}/releases/assets/{asset["id"]}', binary=True)
    require(uploaded == original, 'Downloaded release asset differs; it will not be replaced')
    return True


def download_public(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'release-verification'})
    with urllib.request.urlopen(request, timeout=45) as response:
        require(response.status == 200, 'Download did not return HTTP 200')
        return response.read()


def run_release(client, release, original, asset_path=None, publish=False, preflight=False,
                download=download_public):
    before = client.api(release.endpoint)
    verify_release(client, release, before)
    if preflight:
        return 'Preflight passed'
    require(asset_path is not None and asset_path.read_bytes() == original,
            'Tested artifact differs from the committed ZIP')
    attached = verify_asset(client, before, original)
    if publish and before['draft']:
        if not attached:
            client.upload(release.version, asset_path)
        ready = client.api(release.endpoint)
        verify_release(client, release, ready)
        require(ready['draft'], 'Release changed during publication; retry to verify it')
        require((ready['name'], ready['body']) == (before['name'], before['body']),
                'Release notes or title changed during verification; retry')
        require(verify_asset(client, ready, original), 'Uploaded ZIP is missing')
        after = client.api(release.endpoint, payload={
            'target_commitish': release.commit, 'draft': False, 'prerelease': False, 'make_latest': 'true',
        })
        require(not after['draft'] and not after['prerelease'], 'Release is not a stable public release')
        require((after['name'], after['body']) == (before['name'], before['body']),
                'Release notes or title differ after publishing')
        verify_release(client, release, after)
        require(verify_asset(client, after, original), 'Published ZIP is missing')
    elif before['draft']:
        return 'Verified draft and tested ZIP; no changes made (publish=false)'
    else:
        require(attached, 'Published ZIP is missing; refuse to change the published release')
    for url in release.urls:
        for attempt in range(6):
            try:
                require(download(url) == original, 'Public download differs: ' + url)
                break
            except (urllib.error.URLError, TimeoutError, ValueError):
                if attempt == 5:
                    raise
                time.sleep(5)
        print('Verified public download: ' + url)
    return 'Stable release and Latest downloads verified' if not before['draft'] else 'Published and verified as Latest'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--release-id', required=True)
    parser.add_argument('--asset', type=pathlib.Path)
    parser.add_argument('--publish', action='store_true', help='Attach and publish; otherwise verify only')
    parser.add_argument('--preflight', action='store_true', help='Read-only input and release checks')
    args = parser.parse_args()
    require(os.environ.get('GITHUB_REPOSITORY', REPOSITORY) == REPOSITORY, 'Unexpected repository')
    if args.publish:
        require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Publish only from the main workflow')
        require(not args.preflight, 'Preflight cannot publish')
    release = Release(args.version, args.commit, args.release_id)
    original = source_zip(release)
    result = run_release(GitHub(), release, original, args.asset, args.publish, args.preflight)
    digest = hashlib.sha256(original).hexdigest()
    summary = f'{result}\nVersion: {release.version}\nCommit: {release.commit}\nZIP: {len(original)} bytes\nSHA-256: {digest}\n'
    print(summary)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as report:
            report.write('```text\n' + summary + '```\n')


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or b'').decode(errors='replace').strip()
        raise SystemExit(f'{error}\n{detail}')
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        raise SystemExit(str(error))
