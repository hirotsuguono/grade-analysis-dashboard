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
vm.runInNewContext(fs.readFileSync(path.join(root, 'import-core.js'), 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync(path.join(root, 'excel-templates.js'), 'utf8'), sandbox);
vm.runInNewContext(fs.readFileSync(path.join(root, 'initial-import.js'), 'utf8'), sandbox);
const api = sandbox.window.GD_INITIAL;
const plain = value => JSON.parse(JSON.stringify(value));
function workbook(students, options = {}) {
  const wb = XLSX.utils.book_new();
  const rows = [
    ['データ名', options.name || '架空の登録試験'],
    ['テスト名', options.testName ?? '', '教科', options.subject ?? '英語', '満点', options.max ?? 100, '実施学年', options.grade ?? '', '実施日', options.date ?? ''],
    ['学年', 'クラス', '出席番号', '氏名', '合計点（任意）'],
    ...students,
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), options.sheet || '初回登録');
  return wb;
}
const two = [[2, 'A', 1, '架空 あおい', ''], [2, 'B', 1, '架空 そら', '']];
const plan = (rows, opts) => api.planWorkbook(workbook(rows, opts), XLSX);
function fails(rows, opts, pattern) {
  const result = plan(rows, opts);
  assert.equal(result.dataset, undefined, 'invalid workbook must never provide a partial dataset');
  assert.ok(result.errors.length);
  if (pattern) assert.match(result.errors.join('\n'), pattern);
}

test('initial template contains blank input rows and separate synthetic examples only', () => {
  const wb = api.createTemplate(XLSX);
  assert.equal(wb.SheetNames[0], '名簿入力');
  const input = XLSX.utils.sheet_to_json(wb.Sheets['名簿入力'], { header: 1, defval: '', blankrows: true });
  assert.equal(input.length, 114);
  assert.ok(input.slice(9).flat().every(v => v === ''));
  assert.deepEqual(input[7], ['学年', 'クラス', '出席番号', '氏名']);
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
    [2, 'A', 1, '架空 あおい', ''], [2, 'A', 2, '架空 そら', 0],
    [2, 'A', 3, '架空 みどり', '82.5'], [2, 'B', 1, '架空 しろ', '欠'],
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
  fails([...two, ['', '', '', '', 70]], { testName: '第1回' }, /学年/);
  fails([...two, [2, 'A', '', '架空 みどり', '']], {}, /すべて入力/);
  fails([...two, [2, 'A', '01', '架空 みどり', '']], {}, /重複/);
  for (const number of [0, -1, 1.5, 'NaN', '2A', Infinity]) fails([[2, 'A', number, '架空 あおい', '']]);
});

test('same names in different roster slots warn and never merge', () => {
  const result = plan([[2, 'A', 1, '架空 同名', 12], [2, 'B', 1, '架空 同名', 85]], { testName: '第1回' });
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.duplicateNameCount, 2);
  assert.match(result.warnings.join(), /別の生徒ID/);
  assert.notEqual(result.dataset.students[0].id, result.dataset.students[1].id);
  assert.notEqual(result.dataset.scores[0].studentId, result.dataset.scores[1].studentId);
});

test('different grades with identical class, number and name create separate students', () => {
  const result = plan([[1, 1, 1, '架空 同名', 0], [2, 1, 1, '架空 同名', 85]], {testName: '架空の過去テスト', grade: 1});
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.classCount, 2);
  assert.equal(result.summary.duplicateNameCount, 2);
  assert.deepEqual(Array.from(result.dataset.students, s => s.className), ['1年1組', '2年1組']);
  assert.equal(new Set(result.dataset.students.map(s => s.id)).size, 2);
  assert.equal(result.dataset.tests[0].gradeYear, 1);
  assert.deepEqual(Array.from(result.dataset.scores, r => r.total), [0, 85]);
});
test('first-test kind and series can be supplied in the initial workbook',()=>{
  const wb=workbook([[1,1,1,'架空生徒',0]],{testName:'架空の初回'});
  XLSX.utils.sheet_add_aoa(wb.Sheets['初回登録'],[['テスト種類','単元テスト','比較系列','Unit 3']],{origin:'E1'});
  const result=api.planWorkbook(wb,XLSX);
  assert.equal(result.errors.length,0);assert.equal(result.dataset.tests[0].kind,'unit');assert.equal(result.dataset.tests[0].series,'Unit 3');
  wb.Sheets['初回登録'].F1.v='不正な種類';
  assert.equal(api.planWorkbook(wb,XLSX).dataset,undefined);
});

test('grade/class normalization accepts school roster text and detects equivalent duplicate tuples', () => {
  const result = plan([['１', '０２組', '０１', '架空 あおい', ''], ['３', 'Ａ組', 1, '架空 そら', '']]);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(Array.from(result.dataset.students, s => [s.className, s.number]), [['1年2組', '1'], ['3年A組', '1']]);
  for (const klass of [1, '01', '1組', '０１組']) {
    fails([[1, '1', 1, '架空 あおい', ''], [1, klass, '01', '架空 そら', '']], {}, /重複/);
  }
});

test('invalid or missing student grades and class fields never produce a partial roster', () => {
  for (const grade of ['', 0, 4, -1, 1.5, '2年', 'abc', true]) {
    fails([...two, [grade, 'A', 3, '架空 みどり', '']], {}, /名簿の学年/);
  }
  for (const klass of ['', '組', '1年1組']) fails([[1, klass, 1, '架空 あおい', '']], {}, /クラス/);
  fails([[1, 1, 1, '', '']], {}, /すべて入力/);
});

test('old four-column roster is refused with current-template guidance instead of shifting fields', () => {
  const wb = workbook([]);
  wb.Sheets['初回登録'] = XLSX.utils.aoa_to_sheet([
    ['データ名', '架空の旧形式'],
    ['クラス', '出席番号', '氏名', '合計点（任意）'],
    ['1年1組', 1, '架空 あおい', 80],
  ]);
  const result = api.planWorkbook(wb, XLSX);
  assert.equal(result.dataset, undefined);
  assert.match(result.errors.join(), /最新版.*学年.*クラス/);
});

test('a serialized 105-pupil roster creates three classes of 35 and fresh IDs without editing workbook', () => {
  const entries = Array.from({length: 105}, (_, i) => [1, Math.floor(i / 35) + 1, i % 35 + 1, `架空生徒${String(i + 1).padStart(3, '0')}`, '']);
  const wb = workbook(entries);
  const reread = XLSX.read(XLSX.write(wb, {type: 'buffer', bookType: 'xlsx'}), {type: 'buffer'});
  const before = JSON.stringify(reread);
  const result = api.planWorkbook(reread, XLSX);
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary.studentCount, 105); assert.equal(result.summary.classCount, 3);
  for (const klass of ['1年1組', '1年2組', '1年3組']) assert.equal(result.dataset.students.filter(s => s.className === klass).length, 35);
  assert.equal(new Set(result.dataset.students.map(s => s.id)).size, 105);
  assert.equal(result.dataset.tests.length, 0);
  assert.equal(JSON.stringify(reread), before);
});

test('split-grade roster flows into test Excel, history matching and JSON save/reload without changing IDs', async () => {
  const data = plain(plan([[1, 1, 1, '架空 同名', ''], [2, 1, 1, '架空 同名', '']]).dataset);
  const downloads = [], alerts = [];
  const context = vm.createContext({console, crypto: webcrypto, TextEncoder,
    XLSX: {...XLSX, writeFile(wb) { downloads.push(wb); }},
    alert(m) { alerts.push(m); }, confirm() { return true; },
    window: {addEventListener() {}}, document: {addEventListener() {}, getElementById() {return null;}}});
  vm.runInContext(fs.readFileSync(path.join(root, 'import-core.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'excel-templates.js'), 'utf8'), context);
  context.window.GD_EXCEL.download = wb => downloads.push(wb);
  vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '') + `
    markDirty = () => {}; renderAll = () => {};
    globalThis.api = { load(v) {data = v; rebuildIndex();}, current() {return data;}, issueNewTestTemplate, importTestTemplate, validateDataset, gradeOf };
  `, context);
  context.api.load(data); context.api.issueNewTestTemplate();
  const wb = downloads[0], rows = XLSX.utils.sheet_to_json(wb.Sheets['② 点数入力'], {header:1, defval:''});
  assert.deepEqual(rows[9].slice(0, 5), [data.students[0].id, '1', '1', '1', '架空 同名']);
  assert.deepEqual(rows[10].slice(0, 5), [data.students[1].id, '2', '1', '1', '架空 同名']);
  wb.Sheets['① テスト設定'].B8 = {t:'s',v:'英語'}; wb.Sheets['① テスト設定'].B10 = {t:'s',v:'架空の追加'}; wb.Sheets['① テスト設定'].B14 = {t:'s',v:'2026-05-22'};
  rows[9][5] = 0; rows[10][5] = 8;
  // Complete the remaining questions explicitly; this test verifies identity, not partial totals.
  for (const row of [rows[9], rows[10]]) for (let c = 6; c < 9; c++) row[c] = 0;
  data.students[0].classHistory = [{className: data.students[0].className, number: data.students[0].number}];
  data.students[0].className = '2年A組'; data.students[0].number = '5';
  wb.Sheets['② 点数入力'] = XLSX.utils.aoa_to_sheet(rows);
  const bytes = XLSX.write(wb, {type:'buffer', bookType:'xlsx'});
  await context.api.importTestTemplate({arrayBuffer:async () => bytes});
  assert.equal(data.tests.length, 1, alerts.join('\n'));
  assert.deepEqual(Array.from(data.scores, s => [s.studentId, s.total]), [[data.students[0].id, 0], [data.students[1].id, 8]]);
  const saved = plain(context.api.current());
  assert.equal(context.api.validateDataset(saved).length, 0);
  assert.deepEqual(saved.students.map(s => context.api.gradeOf(s)), ['2', '2']);
  assert.deepEqual(saved.students[0].classHistory, [{className:'1年1組', number:'1'}]);
  assert.deepEqual(saved.students.map(s => s.id), data.students.map(s => s.id));
});

test('named input sheet wins after reordering; help/examples cannot autoimport', () => {
  const wb = workbook(two);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['学年','クラス','出席番号','氏名']]), '記入例');
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
  for (const score of [-1, 101, '未受験', true, 'Infinity']) fails([[2, 'A', 1, '架空 あおい', score]], { testName: '第1回' });
  fails([[2, 'A', 1, '架空 あおい', 0]], {}, /テスト名/);
  fails([[2, 'A', 1, '架空 あおい', '欠']], {}, /テスト名/);
  fails([[2, 'A', 1, '架空 あおい', 50]], { testName: '第1回', subject: '' }, /教科/);
  for (const max of [0, -1, 'abc', Infinity, true]) fails([[2, 'A', 1, '架空 あおい', 50]], { testName: '第1回', max });
});

test('dates, grade and serial-date parsing are validated with no partial dataset', () => {
  const rows = [[2, 'A', 1, '架空 あおい', 50]];
  for (const date of ['2026-02-30', '2026-13-01', '2025-02-29', 'yesterday', 60]) fails(rows, { testName: '第1回', date }, /実施日/);
  for (const grade of [0, 4, '2.5', '2年']) fails(rows, { testName: '第1回', grade }, /実施学年/);
  const valid = plan(rows, { testName: '第1回', date: 46132 });
  assert.equal(valid.errors.length, 0);
  assert.equal(valid.dataset.tests[0].date, '2026-04-20');
  assert.equal(plan(rows, { testName: '第1回', date: '2024-02-29' }).errors.length, 0);
});

test('serialized xlsx template accepts roster data without importing example sheet', () => {
  const wb = api.createTemplate(XLSX);
  XLSX.utils.sheet_add_aoa(wb.Sheets['名簿入力'], two.map(r=>r.slice(0,4)), { origin: 'A10' });
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
  for (const result of [plan(two), plan([[2, 'A', 1, '架空 あおい', 0], [2, 'B', 1, '架空 そら', '欠']], { testName: '第1回' })]) {
    const reloaded = plain(result.dataset);
    assert.equal(context.checkDataset(reloaded).length, 0);
  }
});
