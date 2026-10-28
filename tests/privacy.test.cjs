'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
test('source and ZIP privacy checks reject synthetic canaries without logging them', () => {
  const result = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_content_privacy.py'], { cwd: require('node:path').join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, 'privacy checker tests failed; inspect the local test result');
});
