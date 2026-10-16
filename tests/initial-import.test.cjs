'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const XLSX = require(path.join(root, 'vendor/xlsx.full.min.js'));
const sandbox = { window: { crypto: webcrypto } };
vm.runInNewContext(fs.readFileSync(path.join(root, 'initial-import.js'), 'utf8'), sandbox);
const api = sandbox.window.GD_INITIAL;
const plain = value => JSON.parse(JSON.stringify(value));
function workbook(students, options = {}) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ['データ名', options.name || '架空の登録試験'],
    ['テスト名', options.testName ?? '', '教科', options.subject ?? '英語', '満点', options.max ?? 100, '実施学年', options.grade ?? '', '実施日', options.date ?? ''],
    ['クラス', '出席番号', '氏名', '合計点（任意）'],
    ...students,
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), options.sheet || '初回登録');
  return wb;
}
const two = [['2年A組', 1, '架空 あおい', ''], ['2年B組', 1, '架空 そら', '']];
const plan = (rows, opts) => api.planWorkbook(workbook(rows, opts), XLSX);
function fails(rows, opts, pattern) {
  const result = plan(rows, opts);
  assert.equal(result.dataset, undefined, 'invalid workbook must never provide a partial dataset');
  assert.ok(result.errors.length);
  if (pattern) assert.match(result.errors.join('\n'), pattern);
}

test('initial template contains blank input rows and separate synthetic examples only', () => {
  const wb = api.createTemplate(XLSX);
  assert.equal(wb.SheetNames[0], '初回登録');
  const input = XLSX.utils.sheet_to_json(wb.Sheets['初回登録'], { header: 1, defval: '', blankrows: true });
  assert.equal(input.length, 33);
  assert.ok(input.slice(3).flat().every(v => v === ''));
  assert.equal(input[1][3], '英語');
  assert.ok(XLSX.utils.sheet_to_json(wb.Sheets['記入例'], { header: 1 }).flat().some(v => /架空生徒/.test(String(v))));
  const result = api.planWorkbook(wb, XLSX);
  assert.equal(result.dataset, undefined);
  assert.match(result.errors.join(), /名簿/);
});

test('roster-only produces no tests/results and preserves zero-looking attendance numbers', () => {
  const wb = workbook(two, { testName: '任意の未実施テスト' });
  const original = JSON.stringify(wb);
  const result = api.planWorkbook(wb, XLSX);
  assert.equal(result.errors.length, 0);
  assert.equal(result.dataset.students.length, 2);
  assert.equal(result.dataset.tests.length, 0);
  assert.equal(result.dataset.scores.length, 0);
  assert.equal(result.dataset.students[0].number, '1');
  assert.equal(result.summary.blankCount, 2);
  assert.equal(result.summary.testName, '');
  assert.equal(JSON.stringify(wb), original, 'planner must not edit workbook');
  assert.deepEqual(plain(result.dataset.settings), { rti: { tier2: 60, tier3: 40 }, adminPinHash: null });
});

test('blank, 0, score and 欠 are distinct; IDs survive save/reload', () => {
  const rows = [
    ['2年A組', 1, '架空 あおい', ''], ['2年A組', 2, '架空 そら', 0],
    ['2年A組', 3, '架空 みどり', '82.5'], ['2年B組', 1, '架空 しろ', '欠'],
  ];
  const result = plan(rows, { testName: '第1回', grade: 2, date: '2026/4/20' });
  assert.equal(result.errors.length, 0);
  assert.deepEqual(plain(result.summary), { studentCount: 4, classCount: 2, scoreCount: 2, absentCount: 1, blankCount: 1, testName: '第1回', duplicateNameCount: 0 });
  const saved = plain(result.dataset);
  assert.equal(new Set(saved.students.map(s => s.id)).size, 4);
  assert.ok(saved.students.every(s => /^student-[0-9a-f-]{36}$/.test(s.id)));
  assert.equal(saved.tests[0].date, '2026-04-20');
  assert.equal(saved.tests[0].gradeYear, 2);
  assert.deepEqual(saved.tests[0].domains, []);
  assert.equal(saved.scores.length, 3);
  assert.equal(saved.scores[0].total, 0);
  assert.equal(saved.scores[2].total, null);
  assert.equal(saved.scores[2].absent, true);
  assert.equal(saved.scores.some(s => s.studentId === saved.students[0].id), false);
  assert.deepEqual(saved.students.map(s => s.id), Array.from(result.dataset.students, s => s.id));
});

test('partial roster, stray score and duplicate class/number roll back all rows', () => {
  fails([...two, ['', '', '', 70]], { testName: '第1回' }, /すべて入力/);
  fails([...two, ['2年A組', '', '架空 みどり', '']], {}, /すべて入力/);
  fails([...two, ['2年A組', '01', '架空 みどり', '']], {}, /重複/);
  for (const number of [0, -1, 1.5, 'NaN', '2A', Infinity]) fails([['2年A組', number, '架空 あおい', '']]);
});

test('same names in different roster slots warn and never merge', () => {
  const result = plan([['2年A組', 1, '架空 同名', 12], ['2年B組', 1, '架空 同名', 85]], { testName: '第1回' });
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.duplicateNameCount, 2);
  assert.match(result.warnings.join(), /別の生徒ID/);
  assert.notEqual(result.dataset.students[0].id, result.dataset.students[1].id);
  assert.notEqual(result.dataset.scores[0].studentId, result.dataset.scores[1].studentId);
});

test('named input sheet wins after reordering; help/examples cannot autoimport', () => {
  const wb = api.createTemplate(XLSX);
  wb.Sheets['初回登録'] = workbook(two).Sheets['初回登録'];
  wb.SheetNames.reverse();
  assert.equal(api.planWorkbook(wb, XLSX).dataset.students.length, 2);
  delete wb.Sheets['初回登録'];
  wb.SheetNames = wb.SheetNames.filter(n => n !== '初回登録');
  assert.equal(api.planWorkbook(wb, XLSX).dataset, undefined);
  const renamed = workbook(two, { sheet: '名簿2026' });
  assert.equal(api.planWorkbook(renamed, XLSX).dataset.students.length, 2);
  XLSX.utils.book_append_sheet(renamed, workbook(two).Sheets['初回登録'], '別の名簿');
  assert.match(api.planWorkbook(renamed, XLSX).errors.join(), /複数/);
});

test('invalid scores and missing test metadata prevent every registration', () => {
  for (const score of [-1, 101, '未受験', true, 'Infinity']) fails([['2年A組', 1, '架空 あおい', score]], { testName: '第1回' });
  fails([['2年A組', 1, '架空 あおい', 0]], {}, /テスト名/);
  fails([['2年A組', 1, '架空 あおい', '欠']], {}, /テスト名/);
  fails([['2年A組', 1, '架空 あおい', 50]], { testName: '第1回', subject: '' }, /教科/);
  for (const max of [0, -1, 'abc', Infinity, true]) fails([['2年A組', 1, '架空 あおい', 50]], { testName: '第1回', max });
});

test('dates, grade and serial-date parsing are validated with no partial dataset', () => {
  const rows = [['2年A組', 1, '架空 あおい', 50]];
  for (const date of ['2026-02-30', '2026-13-01', '2025-02-29', 'yesterday', 60]) fails(rows, { testName: '第1回', date }, /実施日/);
  for (const grade of [0, 4, '2.5', '2年']) fails(rows, { testName: '第1回', grade }, /実施学年/);
  const valid = plan(rows, { testName: '第1回', date: 46132 });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.dataset.tests[0].date, '2026-04-20');
  assert.equal(plan(rows, { testName: '第1回', date: '2024-02-29' }).errors.length, 0);
});

test('serialized xlsx template accepts roster data without importing example sheet', () => {
  const wb = api.createTemplate(XLSX);
  XLSX.utils.sheet_add_aoa(wb.Sheets['初回登録'], two, { origin: 'A4' });
  const reread = XLSX.read(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
  const result = api.planWorkbook(reread, XLSX);
  assert.equal(result.errors.length, 0);
  assert.equal(result.dataset.students.length, 2);
  assert.equal(result.dataset.tests.length, 0);
});

test('initial datasets satisfy application save/reload schema for roster and first scores', () => {
  const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, XLSX, window: { addEventListener() {} }, document: { addEventListener() {}, getElementById() { return null; } } });
  vm.runInContext(source + '\nglobalThis.checkDataset = validateDataset;', context);
  for (const result of [plan(two), plan([['2年A組', 1, '架空 あおい', 0], ['2年B組', 1, '架空 そら', '欠']], { testName: '第1回' })]) {
    const reloaded = plain(result.dataset);
    assert.equal(context.checkDataset(reloaded).length, 0);
  }
});
