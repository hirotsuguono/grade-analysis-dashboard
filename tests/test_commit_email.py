import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "check_commit_email.py"
SAFE = "123+test-user@users.noreply.github.com"
PRIVATE = "fictional-private@example.invalid"


class CommitEmailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.env = dict(os.environ, GIT_AUTHOR_NAME="Test", GIT_COMMITTER_NAME="Test",
                        GIT_AUTHOR_EMAIL=SAFE, GIT_COMMITTER_EMAIL=SAFE)
        self.git("init", "--initial-branch=main")
        self.git("config", "core.hooksPath", str(self.repo / "no-hooks"))

    def git(self, *args, env=None):
        return subprocess.check_output(["git", *args], cwd=self.repo,
                                       env=env or self.env, stderr=subprocess.PIPE).decode().strip()

    def commit(self, *, author=SAFE, committer=SAFE, message="Test commit"):
        env = dict(self.env, GIT_AUTHOR_EMAIL=author, GIT_COMMITTER_EMAIL=committer)
        self.git("commit", "--allow-empty", "-m", message, env=env)
        return self.git("rev-parse", "HEAD")

    def check(self, *args, env=None, input="", good=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *args], cwd=self.repo,
                                env=env or self.env, input=input, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0 if good else 1, result.stdout + result.stderr)
        self.assertNotIn(PRIVATE, result.stdout + result.stderr)

    def test_noreply_history_and_github_committer(self):
        self.commit(committer="noreply@github.com")
        self.git("tag", "-a", "v1", "-m", "Release")
        self.git("tag", "lightweight")
        self.check()

    def test_personal_author(self):
        self.commit(author=PRIVATE)
        self.check(good=False)

    def test_github_bot_noreply(self):
        self.commit(author="41898282+github-actions[bot]@users.noreply.github.com")
        self.check()

    def test_personal_committer(self):
        self.commit(committer=PRIVATE)
        self.check(good=False)

    def test_bad_ancestor_is_rejected_before_push(self):
        self.commit(author=PRIVATE)
        head = self.commit()
        self.check("--pre-push", input=f"refs/heads/main {head} refs/heads/main {'0' * 40}\n", good=False)

    def test_personal_tagger(self):
        self.commit()
        self.git("tag", "-a", "v1", "-m", "Release", env=dict(self.env, GIT_COMMITTER_EMAIL=PRIVATE))
        tag = self.git("rev-parse", "v1")
        self.check("--pre-push", input=f"refs/tags/v1 {tag} refs/tags/v1 {'0' * 40}\n", good=False)

    def test_personal_coauthor_trailer(self):
        self.commit(message=f"Test\n\nCo-authored-by: Test <{PRIVATE}>")
        self.check(good=False)

    def test_commit_message_hook(self):
        message = self.repo / "message"
        message.write_text(f"Contact {PRIVATE}")
        self.check("--message", str(message), good=False)
        message.write_text(f"Co-authored-by: Test <{SAFE}>")
        self.check("--message", str(message))

    def test_environment_overrides_checked_before_commit(self):
        self.check("--identity")
        for field in ("GIT_AUTHOR_EMAIL", "GIT_COMMITTER_EMAIL"):
            self.check("--identity", env=dict(self.env, **{field: PRIVATE}), good=False)

    def test_domain_suffix_cannot_impersonate_noreply(self):
        self.commit(author=SAFE + ".example.invalid")
        self.check(good=False)

    def test_delete_and_invalid_pre_push_input(self):
        self.check("--pre-push", input=f"(delete) {'0' * 40} refs/heads/old {'1' * 40}\n")
        self.check("--pre-push", input="malformed\n", good=False)


if __name__ == "__main__":
    unittest.main()
