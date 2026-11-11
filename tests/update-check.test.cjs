'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseVersion, releaseStatus } = require('../src/files/update-check.js');
const endpoint = 'https://api.github.com/repos/hirotsuguono/grade-analysis-dashboard/releases/latest';
function release(tag = 'v0.4.1') {
  return { tag_name: tag, draft: false, prerelease: false, assets: [{ name: 'grade-analysis-dashboard.zip', state: 'uploaded', size: 100, browser_download_url: `https://github.com/hirotsuguono/grade-analysis-dashboard/releases/download/${tag}/grade-analysis-dashboard.zip` }] };
}
test('stable versions use numeric ordering, rejecting unsupported and unsafe forms', () => {
  assert.deepEqual(parseVersion('v0.4.1'), [0, 4, 1]);
  for (const invalid of [null, {}, '01.4.1', '0.4', '0.4.1-beta', '0.4.1+build', ' 0.4.1', '0.4.1\n', '9007199254740992.0.0', '<img src=x>']) assert.equal(parseVersion(invalid), null);
  assert.equal(releaseStatus('0.4.1', release()).state, 'current');
  assert.equal(releaseStatus('0.4.1', release('v0.4.0')).state, 'ahead');
  for (const tag of ['v0.4.2', 'v0.10.0', 'v1.0.0']) assert.equal(releaseStatus('0.4.1', release(tag)).state, 'available');
});
test('only a published stable release with the official uploaded ZIP is accepted', () => {
  for (const bad of [null, {}, { ...release(), draft: true }, { ...release(), prerelease: true }, { ...release(), draft: undefined }, release('v0.4.2-rc.1'), { ...release(), assets: [] }]) assert.throws(() => releaseStatus('0.4.1', bad));
  for (const change of [{ size: 0 }, { size: '100' }, { state: 'new' }, { browser_download_url: 'https://example.invalid/download.zip' }, { name: 'other.zip' }]) {
    const bad = release(); Object.assign(bad.assets[0], change);
    assert.throws(() => releaseStatus('0.4.1', bad));
  }
});
function checker(fetch, timers = {}) {
  const sandbox = { module: { exports: {} }, fetch, AbortController, setTimeout, clearTimeout, ...timers };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/files/update-check.js'), 'utf8'), sandbox);
  return sandbox.module.exports.checkRelease;
}
test('request is a fixed credential-free GET without student data, path or referrer', async () => {
  let calls = 0;
  const check = checker(async (url, options) => {
    calls++; assert.equal(url, endpoint);
    assert.deepEqual(JSON.parse(JSON.stringify({ ...options, signal: undefined })), {
      method: 'GET', mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/vnd.github+json' },
    });
    return { ok: true, json: async () => release('v0.4.2') };
  });
  assert.equal((await check('0.4.1')).state, 'available'); assert.equal(calls, 1);
});
test('HTTP errors, rejected requests and invalid JSON fail closed', async () => {
  for (const status of [403, 404, 429, 500]) await assert.rejects(checker(async () => ({ ok: false, status }))('0.4.1'));
  await assert.rejects(checker(async () => { throw new Error('offline'); })('0.4.1'));
  await assert.rejects(checker(async () => ({ ok: true, json: async () => { throw new Error('JSON'); } }))('0.4.1'));
});
test('timeout includes a stalled response body and aborts the request', async () => {
  let timeout, cleared, signal;
  const check = checker(async (_, options) => { signal = options.signal; return { ok: true, json: () => new Promise(() => {}) }; }, {
    setTimeout: callback => { timeout = callback; return 17; }, clearTimeout: id => { cleared = id; },
  });
  const pending = check('0.4.1'); await Promise.resolve(); timeout();
  await assert.rejects(pending, /timed out/); assert.equal(signal.aborted, true); assert.equal(cleared, 17);
});
