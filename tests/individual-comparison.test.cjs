'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function readScore(rec, exam = { id: 'exam', maxScore: 50 }) {
  const dataset = { tests: [exam], scores: rec ? [{ studentId: 's1', testId: 'exam', ...rec }] : [] };
  const before = JSON.stringify(dataset);
  const context = vm.createContext({ window: { addEventListener() {} }, document: { addEventListener() {} }, dataset });
  vm.runInContext(source + '\ndata=dataset;rebuildIndex();globalThis.result=individualTestScore("s1", data.tests[0]);', context);
  assert.equal(JSON.stringify(dataset), before, 'display must not normalize or overwrite stored records');
  return JSON.parse(JSON.stringify(context.result));
}

test('個人比較は旧形式の集計得点を満点に対する率として扱い、0点を残す', () => {
  assert.deepEqual(readScore({ total: 37 }), { rate: 74, total: 37, reason: '' });
  assert.deepEqual(readScore({ total: 0 }), { rate: 0, total: 0, reason: '' });
});
test('欠席は復元用得点が残っていても無効にし、記録を保つ', () => {
  assert.deepEqual(readScore({ total: 37, absent: true }), { rate: null, total: null, reason: '欠席' });
});
test('レコードなし・未入力を0点に変換しない', () => {
  for (const rec of [null, { total: null }, {}]) {
    assert.deepEqual(readScore(rec), { rate: null, total: null, reason: '未入力・入力途中' });
  }
});
test('設問入力途中は古い部分合計があっても比較に使わない', () => {
  const exam = { id: 'exam', maxScore: 50, questions: [{ key: 'q1', max: 25 }, { key: 'q2', max: 25 }] };
  assert.equal(readScore({ total: 10, questions: { q1: 10 } }, exam).rate, null);
  assert.equal(readScore({ total: 50, questions: { q1: 0, q2: 0 } }, exam).rate, 0);
  assert.equal(readScore({ total: 50, questions: { q1: 10, q2: 15 } }, exam).rate, 50);
});
test('無効な得点・満点を率に変換しない', () => {
  for (const total of [-1, 51, '37', Infinity, NaN]) assert.equal(readScore({ total }).rate, null);
  for (const maxScore of [0, -1, null, '50', Infinity]) assert.equal(readScore({ total: 37 }, { id: 'exam', maxScore }).rate, null);
});

test('グループの共通読出しは未丸めの境界・欠測・0点を個人と同じ規則で扱う', () => {
  const rates = [[60, 80], [59.999, 61], [40, 50], [39.999, 45], [0, 0], [55, null], [null, 60], [70, 90]];
  const dataset = {
    tests: [{ id: 'before', maxScore: 100 }, { id: 'after', maxScore: 100 }],
    students: rates.map((_, i) => ({ id: 's' + i })),
    scores: rates.flatMap(([before, after], i) => [
      { studentId: 's' + i, testId: 'before', total: before },
      { studentId: 's' + i, testId: 'after', total: after, absent: i === 7 }
    ]), settings: { rti: { tier2: 60, tier3: 40 } }
  };
  const context = vm.createContext({ window: { addEventListener() {}, GD_PAIRED: require('../src/files/paired-comparison.js') }, document: { addEventListener() {} }, dataset });
  const saved = JSON.stringify(dataset);
  vm.runInContext(source + '\ndata=dataset;rebuildIndex();globalThis.result=groupComparisonData(data.students, data.tests[0], data.tests[1]);', context);
  const r = JSON.parse(JSON.stringify(context.result));
  assert.equal(r.pairs.length, 5);
  assert.deepEqual(r.groups.map(g => g.n), [5, 1, 2, 2]);
  assert.deepEqual(r.beforeCounts, { tier1: 2, tier2: 3, tier3: 2 });
  assert.equal(r.missingBefore, 1); assert.equal(r.missingAfter, 2);
  assert.deepEqual(r.pairs.at(-1), [0, 0]);
  assert.equal(r.groups[1].pAdjusted, null);
  assert.equal(JSON.stringify(dataset), saved);
});
