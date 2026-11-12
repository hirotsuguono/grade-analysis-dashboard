'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/files/assessment-classification.js');
const exam = { domains: [{ key: 'listen', label: 'リスニング' }, { key: 'read', label: '読解' }], questions: [
  { key: 'a', max: 2, domain: 'listen', perspective: 'knowledge' },
  { key: 'b', max: 3, domain: 'listen', perspective: 'thinking' },
  { key: 'c', max: 5, domain: 'read', perspective: 'knowledge' },
  { key: 'd', max: 2 },
] };
test('the same scored items form independent domain and perspective groups without changing source', () => {
  const rec = { questions: { a: 2, b: 1, c: 3, d: 0 } }, before = JSON.stringify({ exam, rec });
  const domains = C.groups(exam), perspectives = C.groups(exam, 'perspective');
  assert.deepEqual(domains.map(g => [g.label, g.max, C.score(rec, g)]), [['リスニング', 5, 3], ['読解', 5, 3], ['未設定', 2, 0]]);
  assert.deepEqual(perspectives.map(g => [g.label, g.max, C.score(rec, g)]), [['知識・技能', 7, 5], ['思考・判断・表現', 3, 1], ['未設定', 2, 0]]);
  for (const groups of [domains, perspectives]) assert.equal(groups.reduce((n, g) => n + C.score(rec, g), 0), 6);
  assert.equal(JSON.stringify({ exam, rec }), before);
});
test('zero is scored, absent and incomplete groups are excluded independently', () => {
  const rows = [{ questions: { a: 0, b: 0, c: 0 } }, { questions: { a: 2, b: 3 } }, { absent: true, questions: { a: 2, b: 3, c: 5 } }];
  const s = C.summarize(exam, rows, 'perspective');
  assert.deepEqual(s.map(g => [g.key, g.n, g.rate]), [['knowledge', 1, 0], ['thinking', 2, 50], ['', 0, null]]);
});
test('inherited keys, strings, invalid scores and total-only tests do not fabricate classified points', () => {
  const group = C.groups(exam)[0];
  for (const rec of [{ total: 5 }, { questions: { a: '2', b: 3 } }, { questions: { a: -1, b: 3 } }, { questions: { a: 3, b: 3 } }, { questions: Object.create({ a: 2, b: 3 }) }]) assert.equal(C.score(rec, group), null);
  assert.deepEqual(C.groups({ maxScore: 100 }, 'perspective'), []);
});
test('classification text including prototype names is treated as text and perspective keys are strict', () => {
  assert.equal(C.groups({ questions: [{ key: 'x', max: 1, domain: '__proto__' }] })[0].label, '__proto__');
  for (const value of [undefined, null, '', 'knowledge', 'thinking']) assert.equal(C.validPerspective(value), true);
  for (const value of [{}, [], 'constructor', '知識技能', 1]) assert.equal(C.validPerspective(value), false);
});
