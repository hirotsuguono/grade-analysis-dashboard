"""Release side-effect boundaries, provenance and reruns, without remote writes."""
import copy
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('release_automation', ROOT / 'scripts/release.py')
automation = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = automation
spec.loader.exec_module(automation)
REQUEST = automation.Release('v0.4.0', 'a' * 40, '423716403')
PAYLOAD = b'fictional ZIP bytes for release API state tests'


class FakeGitHub:
    def __init__(self, draft=True, attached=False):
        self.record = {'id': int(REQUEST.release_id), 'tag_name': REQUEST.version,
                       'target_commitish': REQUEST.commit, 'draft': draft, 'prerelease': False,
                       'name': 'Release title', 'body': 'Release notes to preserve', 'assets': []}
        self.tag = None if draft else {'type': 'commit', 'sha': REQUEST.commit}
        self.tags = {}
        self.latest_id = self.record['id']
        self.resolved_commit = REQUEST.commit
        self.uploads, self.patches = [], []
        self.asset_bytes = PAYLOAD
        if attached:
            self.attach()

    def attach(self):
        self.record['assets'] = [{'id': 100, 'name': automation.FILENAME, 'state': 'uploaded',
                                  'size': len(PAYLOAD),
                                  'digest': 'sha256:' + hashlib.sha256(PAYLOAD).hexdigest()}]

    def api(self, endpoint, payload=None, binary=False):
        if endpoint == REQUEST.endpoint:
            if payload is not None:
                self.patches.append(payload)
                self.record.update({k: v for k, v in payload.items() if k != 'make_latest'})
                self.tag = {'type': 'commit', 'sha': REQUEST.commit}
            return copy.deepcopy(self.record)
        if '/git/matching-refs/' in endpoint:
            return [] if self.tag is None else [{'ref': 'refs/tags/' + REQUEST.version, 'object': self.tag}]
        if '/git/tags/' in endpoint:
            return {'object': self.tags[endpoint.rsplit('/', 1)[1]]}
        if '/commits/' in endpoint:
            return {'sha': self.resolved_commit}
        if endpoint.endswith('/releases/latest'):
            return {'id': self.latest_id}
        if endpoint.endswith('/releases/assets/100') and binary:
            return self.asset_bytes
        raise AssertionError('Unexpected API operation: ' + endpoint)

    def upload(self, version, path):
        assert version == REQUEST.version and path.read_bytes() == PAYLOAD
        self.uploads.append(version)
        self.attach()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.asset = pathlib.Path(self.temp.name) / automation.FILENAME
        self.asset.write_bytes(PAYLOAD)
        self.downloads = []

    def execute(self, client, publish=False, preflight=False):
        def download(url):
            self.downloads.append(url)
            return PAYLOAD
        return automation.run_release(client, REQUEST, PAYLOAD, self.asset, publish, preflight, download)

    def test_rejects_invalid_inputs(self):
        for version, commit, release_id in [('v0.4.0-rc1', 'a' * 40, '1'),
                                             ('v01.4.0', 'a' * 40, '1'),
                                             ('v0.4.0', 'main', '1'),
                                             ('v0.4.0', 'a' * 40, '1; command')]:
            with self.subTest(version=version, commit=commit, release_id=release_id):
                with self.assertRaises(ValueError):
                    automation.Release(version, commit, release_id)

    def test_dry_run_and_preflight_make_no_changes(self):
        for preflight in [False, True]:
            with self.subTest(preflight=preflight):
                client = FakeGitHub()
                self.execute(client, preflight=preflight)
                self.assertEqual(client.uploads, [])
                self.assertEqual(client.patches, [])
                self.assertEqual(self.downloads, [])
                self.assertTrue(client.record['draft'])

    def test_publishes_verified_draft_and_preserves_notes(self):
        client = FakeGitHub()
        self.execute(client, publish=True)
        self.assertEqual(len(client.uploads), 1)
        self.assertEqual(client.patches, [{'target_commitish': REQUEST.commit, 'draft': False,
                                          'prerelease': False, 'make_latest': 'true'}])
        self.assertEqual(client.record['body'], 'Release notes to preserve')
        self.assertEqual(client.record['name'], 'Release title')
        self.assertEqual(self.downloads, REQUEST.urls)

    def test_reuses_matching_attached_zip(self):
        client = FakeGitHub(attached=True)
        self.execute(client, publish=True)
        self.assertEqual(client.uploads, [])
        self.assertEqual(len(client.patches), 1)

    def test_rejects_mismatching_asset_even_when_metadata_matches(self):
        client = FakeGitHub(attached=True)
        client.asset_bytes = b'changed content'
        with self.assertRaisesRegex(ValueError, 'Downloaded release asset differs'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_rejects_duplicate_zip_assets(self):
        client = FakeGitHub(attached=True)
        client.record['assets'] *= 2
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_rejects_wrong_tag_before_upload(self):
        client = FakeGitHub()
        client.tag = {'type': 'commit', 'sha': 'b' * 40}
        with self.assertRaisesRegex(ValueError, 'Tag points to a different commit'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_accepts_annotated_tag_resolving_to_target(self):
        client = FakeGitHub()
        client.tag = {'type': 'tag', 'sha': 'c' * 40}
        client.tags['c' * 40] = {'type': 'commit', 'sha': REQUEST.commit}
        self.execute(client, publish=True)
        self.assertFalse(client.record['draft'])

    def test_resolves_branch_target_and_refuses_a_different_commit(self):
        client = FakeGitHub()
        client.record['target_commitish'] = 'main'
        client.resolved_commit = 'b' * 40
        with self.assertRaisesRegex(ValueError, 'Draft target resolves to a different commit'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_published_rerun_is_read_only(self):
        client = FakeGitHub(draft=False, attached=True)
        self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])
        self.assertEqual(self.downloads, REQUEST.urls)

    def test_refuses_to_promote_an_older_published_release(self):
        client = FakeGitHub(draft=False, attached=True)
        client.latest_id += 1
        with self.assertRaisesRegex(ValueError, 'not Latest'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_missing_published_asset_is_not_repaired_implicitly(self):
        client = FakeGitHub(draft=False)
        with self.assertRaisesRegex(ValueError, 'Published ZIP is missing'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_corrupted_upload_prevents_publication(self):
        client = FakeGitHub()
        client.asset_bytes = b'corrupted upload'
        with self.assertRaisesRegex(ValueError, 'Downloaded release asset differs'):
            self.execute(client, publish=True)
        self.assertTrue(client.record['draft'])
        self.assertEqual(client.patches, [])

    def test_changed_test_artifact_prevents_publication(self):
        client = FakeGitHub()
        self.asset.write_bytes(b'untested replacement')
        with self.assertRaisesRegex(ValueError, 'Tested artifact differs'):
            self.execute(client, publish=True)
        self.assertEqual(client.uploads + client.patches, [])

    def test_retries_stale_latest_download(self):
        client = FakeGitHub(draft=False, attached=True)
        responses = iter([PAYLOAD, b'previous release ZIP', PAYLOAD])
        with patch.object(automation.time, 'sleep') as sleep:
            automation.run_release(client, REQUEST, PAYLOAD, self.asset,
                                   download=lambda url: next(responses))
        sleep.assert_called_once_with(5)


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.root_patch = patch.object(automation, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.git('init', '-q')
        self.git('config', 'user.name', 'Release Test')
        self.git('config', 'user.email', 'release-test@example.invalid')
        (self.root / 'src').mkdir()
        (self.root / 'src/Index.html').write_text('fictional offline app')
        (self.root / 'src/はじめに.txt').write_text('Fictional getting-started fixture')
        (self.root / 'downloads').mkdir()
        (self.root / 'package.json').write_text(json.dumps({'version': '0.4.0'}))
        self.zip_path = self.root / 'downloads' / automation.FILENAME
        with zipfile.ZipFile(self.zip_path, 'w') as archive:
            archive.writestr('grade-analysis-dashboard/Index.html', b'fictional offline app')
            archive.writestr('grade-analysis-dashboard/はじめに.txt', b'Fictional getting-started fixture')
        self.git('add', '.')
        self.git('commit', '-qm', 'Fictional release fixture')
        self.commit = self.git('rev-parse', 'HEAD').strip()
        self.git('update-ref', 'refs/remotes/origin/main', self.commit)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.PIPE).decode()

    def test_reads_exact_committed_source_zip(self):
        request = automation.Release('v0.4.0', self.commit, '1')
        self.assertEqual(automation.source_zip(request), self.zip_path.read_bytes())

    def test_rejects_version_mismatch(self):
        request = automation.Release('v0.5.0', self.commit, '1')
        with self.assertRaisesRegex(ValueError, 'Version differs'):
            automation.source_zip(request)

    def test_rejects_unmerged_commit_and_stale_zip(self):
        (self.root / 'src/Index.html').write_text('changed fictional app')
        self.git('add', '.')
        self.git('commit', '-qm', 'Unmerged fixture change')
        commit = self.git('rev-parse', 'HEAD').strip()
        request = automation.Release('v0.4.0', commit, '1')
        with self.assertRaises(subprocess.CalledProcessError):
            automation.source_zip(request)
        self.git('update-ref', 'refs/remotes/origin/main', commit)
        with self.assertRaisesRegex(ValueError, 'ZIP differs from target source'):
            automation.source_zip(request)


if __name__ == '__main__':
    unittest.main()
