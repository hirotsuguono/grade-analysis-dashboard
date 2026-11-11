"""Synthetic canaries are generated locally, never sent to network tools or printed."""
import contextlib
import importlib.util
import io
from pathlib import Path
import sys
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import check_content_privacy as privacy


class ContentPrivacyTests(unittest.TestCase):
    def test_personal_address_rejected_without_value_in_error(self):
        secret = ('synthetic-private' + '@' + 'school.example.org').encode()
        try:
            privacy.check_bytes(secret, 'synthetic source')
        except ValueError as error:
            self.assertTrue(secret.decode() not in str(error), 'private value must be withheld')
        else:
            self.fail('unreviewed address was accepted')

    def test_noreply_and_reserved_synthetic_addresses(self):
        privacy.check_bytes(b'123+test@users.noreply.github.com fictional@example.invalid', 'synthetic')

    def test_credentials_are_rejected(self):
        for secret in [b'ghp_' + b'a' * 36, b'AKIA' + b'A' * 16,
                       b'github_pat_' + b'b' * 60, b'-----BEGIN ' + b'PRIVATE KEY-----']:
            with self.assertRaisesRegex(ValueError, 'withheld'):
                privacy.check_bytes(secret, 'synthetic')

    def test_zip_text_is_scanned(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, 'w') as archive:
            archive.writestr('grade-analysis-dashboard/files/script.js', 'synthetic' + '@' + 'school.example.org')
        with self.assertRaisesRegex(ValueError, 'withheld'):
            privacy.check_file(content.getvalue(), 'synthetic.zip')

    def test_upstream_contacts_require_exact_reviewed_bytes(self):
        root = Path(__file__).resolve().parents[1]
        name = 'files/vendor/exceljs.BUNDLED-LICENSES.txt'
        content = (root / 'src' / name).read_bytes()
        privacy.check_bytes(content, 'third-party notices', name)
        with self.assertRaises(ValueError):
            privacy.check_bytes(content + b'\n', 'modified notices', name)

    def test_echarts_component_licenses_do_not_allow_unreviewed_content(self):
        root = Path(__file__).resolve().parents[1]
        private = ('synthetic-private' + '@' + 'school.example.org').encode()
        for name in ['files/vendor/echarts.LICENSE-d3', 'files/vendor/zrender.LICENSE']:
            with self.subTest(name=name):
                content = (root / 'src' / name).read_bytes()
                privacy.check_file(content, 'src/' + name)
                with self.assertRaisesRegex(ValueError, 'withheld'):
                    privacy.check_file(content + b'\n' + private, 'src/' + name)
                for data, rejected in [(content, False), (content + b'\n' + private, True)]:
                    archive = io.BytesIO()
                    with zipfile.ZipFile(archive, 'w') as z:
                        z.writestr('grade-analysis-dashboard/' + name, data)
                    if rejected:
                        with self.assertRaisesRegex(ValueError, 'withheld'):
                            privacy.check_file(archive.getvalue(), 'synthetic.zip')
                    else:
                        privacy.check_file(archive.getvalue(), 'synthetic.zip')


if __name__ == '__main__':
    unittest.main()
