'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
function api(dataset) {
  const context = vm.createContext({ window: { addEventListener() {} }, document: { addEventListener() {} }, dataset });
  vm.runInContext(source + '\ndata=dataset;rebuildIndex();ui.rtiSubject="理科";ui.rtiKind="unit";ui.rtiBasis="avg";globalThis.api={rate:(subject,kind)=>rtiRateFor("a",subject,"latest",kind),sortedInterventions,ui};', context);
  return context.api;
}
test('支援の基準は明示した教科・種類の直近有効回を使い、RTIの画面条件を変えない', () => {
  const d = { tests: [
    { id: 'f1', name: '架空期末1', subject: '数学', kind: 'final', maxScore: 100, date: '2026-04-01' },
    { id: 'u', name: '架空単元', subject: '数学', kind: 'unit', maxScore: 100, date: '2026-05-01' },
    { id: 'f2', name: '架空期末2', subject: '数学', kind: 'final', maxScore: 100, date: '2026-06-01' },
    { id: 'f3', name: '架空期末3', subject: '数学', kind: 'final', maxScore: 100, date: '2026-07-01' }
  ], scores: [
    { studentId: 'a', testId: 'f1', total: 40 }, { studentId: 'a', testId: 'u', total: 90 },
    { studentId: 'a', testId: 'f2', total: 0 }, { studentId: 'a', testId: 'f3', total: 100, absent: true }
  ] };
  const a = api(d), saved = JSON.stringify(d), selected = JSON.stringify(a.ui);
  assert.equal(a.rate('数学', 'final').rate, 0);
  assert.equal(a.rate('数学', 'unit').rate, 90);
  assert.equal(a.rate('理科', 'final').rate, null);
  assert.equal(JSON.stringify(a.ui), selected); assert.equal(JSON.stringify(d), saved);
});
test('支援履歴は実施中を先に並べ、状態未設定の旧記録も残して入力を並べ替えない', () => {
  const records = [{ id: 'old', startDate: '' }, { id: 'done', status: 'done', startDate: '2026-05-01' },
    { id: 'active', status: 'active', startDate: '2026-04-01' }, { id: 'new', status: 'active', startDate: '2026-06-01' }];
  const a = api({ tests: [], scores: [], interventions: records });
  const before = JSON.stringify(records);
  assert.deepEqual(Array.from(a.sortedInterventions(), x => x.id), ['new', 'active', 'done', 'old']);
  assert.equal(JSON.stringify(records), before);
});
