'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require.resolve('../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
const context = vm.createContext({ window: { addEventListener() {} }, document: { addEventListener() {} } });
vm.runInContext(source, context);
const resolve = (subject, label, tests, draftKeys = [], preferredKey = '') => context.domainKeyForNewTest(subject, label, tests, draftKeys, preferredKey);
test('domain ID allocation reserves all tests, implicit definitions and draft IDs', () => {
  const tests = [{ subject: '英語', domains: [{ key: 'classification-domain-1', label: '聞く' }], questions: [{ domain: 'classification-domain-2' }] }];
  assert.equal(context.uniqueDomainKey(tests, ['classification-domain-3']), 'classification-domain-4');
});
test('new labels reuse one unambiguous identity in the same subject across renames', () => {
  const tests = [{ subject: '英語', domains: [{ key: 'stable', label: 'リスニング' }] }, { subject: '英語', domains: [{ key: 'stable', label: '音声理解' }] }];
  assert.equal(resolve('英語', ' 音声理解 ', tests), 'stable');
  assert.equal(resolve('英語', 'リスニング', tests), 'stable');
  assert.notEqual(resolve('国語', '音声理解', tests), 'stable');
  assert.equal(resolve('英語', '読解', tests), '読解');
});
test('ambiguous labels are rejected and an unknown label cannot collide with another identity', () => {
  const tests = [{ subject: '英語', domains: [{ key: 'a', label: '読解' }, { key: 'b', label: '読解' }, { key: '文章理解', label: '別分野' }] }];
  assert.throws(() => resolve('英語', '読解', tests), /別々の分野/);
  assert.equal(resolve('英語', '文章理解', tests), 'classification-domain-1');
  assert.equal(resolve('英語', '新分野', tests, ['reserved'], 'reserved'), '新分野');
});
test('implicit domain names and score-only changes preserve the identity fingerprint', () => {
  const tests = [{ id: 't', subject: '英語', questions: [{ domain: '読解' }] }];
  assert.equal(resolve('英語', '読解', tests), '読解');
  const before = context.domainIdentityFingerprint(tests);
  tests[0].name = '別のタイトル';
  assert.equal(context.domainIdentityFingerprint(tests), before);
  tests[0].domains = [{ key: 'read', label: '読解' }];
  assert.notEqual(context.domainIdentityFingerprint(tests), before);
});
