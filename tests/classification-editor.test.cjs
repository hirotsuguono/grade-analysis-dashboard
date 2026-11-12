'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/files/classification-editor-core.js');
function fixture() {
  return { version: 3, tests: [{ id: 't', name: '架空テスト', maxScore: 10, compareTo: 'other', domains: [{ key: 'listen', label: 'リスニング', max: 5 }, { key: 'read', label: '読解', max: 5 }], questions: [
    { key: 'a', label: '架空小問1', max: 2, domain: 'listen', perspective: 'knowledge' },
    { key: 'b', label: '架空小問2', max: 3, domain: 'listen', perspective: 'thinking' },
    { key: 'c', label: '架空内訳', max: 5, domain: 'read' },
  ] }, { id: 'other', name: '架空の別テスト' }],
  scores: [{ studentId: 's1', testId: 't', total: 7, questions: { a: 2, b: 1, c: 4 }, domains: { listen: 3, read: 4 } },
    { studentId: 's2', testId: 't', total: 0, questions: { a: 0, b: 0, c: 0 } },
    { studentId: 's3', testId: 't', total: null, questions: { a: 1 } },
    { studentId: 's4', testId: 't', total: 10, absent: true, questions: { a: 2, b: 3, c: 5 } },
    { studentId: 's1', testId: 'other', total: 8 }], settings: { fictional: true }, interventions: [] };
}
const domains = [{ key: 'listen', label: '音声理解' }, { key: 'read', label: '読解' }];
const assignments = [{ key: 'a', domain: 'listen', perspective: 'knowledge' }, { key: 'b', domain: 'listen', perspective: 'thinking' }, { key: 'c', domain: 'listen', perspective: 'thinking' }];
test('renaming keeps domain IDs, moving items recomputes maxima, all scored values and other records stay intact', () => {
  const d = fixture(), before = JSON.stringify(d), p = core.plan(d.tests[0], domains, assignments);
  const next = core.candidate(d, 't', p);
  assert.equal(JSON.stringify(d), before); assert.equal(p.changes.length, 2);
  assert.deepEqual(next.tests[0].domains, [{ key: 'listen', label: '音声理解', max: 10 }]);
  assert.deepEqual(next.tests[0].questions.map(q => [q.key, q.max, q.label]), d.tests[0].questions.map(q => [q.key, q.max, q.label]));
  for (let i = 0; i < d.scores.length; i++) {
    const { domains: _before, ...a } = d.scores[i], { domains: _after, ...b } = next.scores[i]; assert.deepEqual(b, a);
    assert.equal(next.scores[i].questions, d.scores[i].questions);
  }
  assert.deepEqual(next.scores.slice(0, 4).map(r => r.domains), [{ listen: 7 }, { listen: 0 }, {}, { listen: 10 }]);
  assert.equal(next.tests[1], d.tests[1]); assert.equal(next.scores[4], d.scores[4]);
  assert.equal(next.settings, d.settings); assert.equal(next.interventions, d.interventions);
});
test('latest score values are used at apply time rather than the preview snapshot', () => {
  const d = fixture(), p = core.plan(d.tests[0], domains, assignments);
  d.scores[0].questions.a = 1; d.scores[0].total = 6;
  const next = core.candidate(d, 't', p);
  assert.equal(next.scores[0].domains.listen, 6); assert.equal(next.scores[0].total, 6);
});
test('unassigned and prototype-shaped domain names are safe text', () => {
  const d = fixture(), a = structuredClone(assignments); a[0].domain = ''; a[0].perspective = '';
  const ds = [{ key: '__proto__', label: '<img src=x>' }];
  for (const row of a) if (row.domain) row.domain = '__proto__';
  const p = core.plan(d.tests[0], ds, a), next = core.candidate(d, 't', p);
  assert.equal(Object.hasOwn(p.nextTest.questions[0], 'domain'), false);
  assert.equal(Object.hasOwn(p.nextTest.questions[0], 'perspective'), false);
  assert.equal(next.tests[0].domains[0].label, '<img src=x>');
  assert.equal(Object.hasOwn(next.scores[0].domains, '__proto__'), true);
  assert.equal(next.scores[0].domains.__proto__, 5);
});
test('invalid domain IDs or labels, missing assignments and unexpected edits are refused without source changes', () => {
  const d = fixture(), before = JSON.stringify(d);
  for (const ds of [[{ key: '', label: 'a' }], [{ key: 'a', label: '' }], [{ key: 'a', label: 'a' }, { key: 'a', label: 'b' }], [{ key: 'a', label: 'a' }, { key: 'b', label: ' a ' }]]) assert.throws(() => core.plan(d.tests[0], ds, assignments));
  for (const a of [assignments.slice(1), [...assignments, assignments[0]], assignments.map((x, i) => i === 0 ? { ...x, key: 'wrong' } : x), assignments.map((x, i) => i === 0 ? { ...x, domain: 'wrong' } : x), assignments.map((x, i) => i === 0 ? { ...x, perspective: 'Knowledge' } : x), assignments.map((x, i) => i === 0 ? { ...x, max: 100 } : x)]) assert.throws(() => core.plan(d.tests[0], domains, a));
  assert.equal(JSON.stringify(d), before);
});
test('aggregate-only tests and broken source question keys cannot be edited', () => {
  assert.throws(() => core.plan({ id: 't', maxScore: 100 }, [], []), /問題ごと/);
  const d = fixture(), broken = structuredClone(d.tests[0]); broken.questions[1].key = 'a';
  assert.throws(() => core.plan(broken, domains, assignments), /元の問題/);
  assert.throws(() => core.candidate(d, 't', { nextTest: { id: 'other' } }), /反映先/);
});
