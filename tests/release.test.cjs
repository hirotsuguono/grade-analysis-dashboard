'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

test('release automation validates provenance and refuses unsafe publication', () => {
  const result = spawnSync(process.env.PYTHON || 'python3',
    ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_release.py', '-v'],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
