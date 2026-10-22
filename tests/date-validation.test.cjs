'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const root = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const XLSX = require(path.join(root, 'vendor', 'xlsx.full.min.js'));
const source = name => fs.readFileSync(path.join(root, name), 'utf8');

function harness() {
  const alerts = [], confirms = [];
  const context = vm.createContext({
    console, crypto: webcrypto, TextEncoder, XLSX,
    alert: message => alerts.push(message),
    confirm(message) { confirms.push(message); return true; },
    window: { crypto: webcrypto, addEventListener() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
  });
  vm.runInContext(source('import-core.js'), context);
  vm.runInContext(source('initial-import.js'), context);
  vm.runInContext(source('script.js').replace(/\ninit\(\);\s*$/, '') + `
    renderAll = function() {};
    markDirty = function() { dirty = true; };
    globalThis.api = {
      normalizeDateValue, importTestTemplate, validateDataset,
      setData(value) { data = value; dirty = true; rebuildIndex(); },
      getData() { return data; }, isDirty() { return dirty; }
    };
  `, context);
  return { api: context.api, initial: context.window.GD_INITIAL, alerts, confirms };
}

const dataset = () => ({
  version: 3, name: '架空の日付検証',
  students: [{ id: 's1', name: '架空生徒001', className: '2年A組', number: 1 }],
  tests: [], scores: [], metrics: [], interventions: [],
});

function workbook(sheet, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  return wb;
}
function initialWorkbook(date) {
  return workbook('初回登録', [
    ['データ名', '架空の日付検証'],
    ['テスト名', '架空初回', '教科', '英語', '満点', 10, '実施学年', 2, '実施日', date],
    ['学年', 'クラス', '出席番号', '氏名', '合計点（任意）'],
    [2, 'A', 1, '架空生徒001', 0],
  ]);
}
function newWorkbook(date) {
  return workbook('新規テスト', [
    ['テスト名→', '架空追加', '教科→', '英語', '満点→', 10, '実施学年→', 2, '実施日→', date],
    ['分野→', '', '', '語彙'], ['配点→', '', '', 10],
    ['出席番号', '氏名', 'クラス', '問1', '生徒ID'],
    [1, '架空生徒001', '2年A組', 0, 's1'],
  ]);
}
function bufferOf(wb) { return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); }
function initialPlan(h, date) {
  const reread = XLSX.read(bufferOf(initialWorkbook(date)), { type: 'buffer' });
  return h.initial.planWorkbook(reread, XLSX);
}
async function importNew(h, date) {
  const buffer = bufferOf(newWorkbook(date));
  await h.api.importTestTemplate({ arrayBuffer: async () => buffer });
}

const validDates = [
  [1, '1900-01-01'], [59, '1900-02-28'], [61, '1900-03-01'],
  [45000, '2023-03-15'], [45000.5, '2023-03-15'], [45000.000001, '2023-03-15'],
  [45351.75, '2024-02-29'], [2958465, '9999-12-31'],
  ['2023/3/15', '2023-03-15'], ['2024-02-29', '2024-02-29'],
];
const invalidDates = [0, 0.5, 60, 60.5, -1, 2958466, '1900-01-00', '1900-02-29', '2023-02-29', '2026-02-30', '2026-13-01'];

test('Excel serials and text both require real calendar days while times use the same day', () => {
  const h = harness();
  for (const [value, expected] of validDates) assert.equal(h.api.normalizeDateValue(value), expected, String(value));
  for (const value of invalidDates) assert.equal(h.api.normalizeDateValue(value), null, String(value));
  for (const value of [NaN, Infinity, -Infinity]) assert.equal(h.api.normalizeDateValue(value), null, String(value));
  assert.equal(h.api.normalizeDateValue(''), '');
  assert.equal(h.api.normalizeDateValue(undefined), '');
  // Existing JSON dates before the Excel epoch remain readable.
  assert.equal(h.api.normalizeDateValue('1800-01-01'), '1800-01-01');
});

test('initial Excel import rejects invalid serials without creating a partial dataset', () => {
  const h = harness();
  for (const value of invalidDates) {
    const result = initialPlan(h, value);
    assert.equal(result.dataset, undefined, String(value));
    assert.match(result.errors.join('\n'), /実施日/, String(value));
  }
  // Nonfinite cells cannot round-trip through XLSX; test the planner before serialization as well.
  for (const value of [NaN, Infinity, -Infinity]) {
    const wb = initialWorkbook('');
    wb.Sheets['初回登録'].J2 = { t: 'n', v: value };
    const result = h.initial.planWorkbook(wb, XLSX);
    assert.equal(result.dataset, undefined);
    assert.match(result.errors.join('\n'), /実施日/);
  }
});

test('new-test Excel import rejects invalid dates before changing existing unsaved data', async () => {
  for (const value of invalidDates) {
    const h = harness(), original = dataset();
    h.api.setData(original);
    const before = JSON.stringify(original);
    await importNew(h, value);
    assert.equal(h.api.getData(), original);
    assert.equal(JSON.stringify(original), before, String(value));
    assert.equal(h.api.isDirty(), true);
    assert.equal(h.confirms.length, 0);
    assert.match(h.alerts.join('\n'), /実施日/, String(value));
  }
});

test('both serialized Excel import routes save the same normalized dates and preserve zero scores', async () => {
  for (const [value, expected] of [...validDates, ['', undefined]]) {
    const h = harness(), current = dataset();
    const result = initialPlan(h, value);
    assert.equal(result.errors.length, 0, String(value));
    assert.equal(result.dataset.tests[0].date, expected);
    assert.equal(result.dataset.scores[0].total, 0);
    h.api.setData(current);
    await importNew(h, value);
    assert.equal(current.tests.length, 1, String(value));
    assert.equal(current.tests[0].date, expected);
    assert.equal(current.scores[0].total, 0);
    for (const imported of [result.dataset, current]) {
      assert.deepEqual(Array.from(h.api.validateDataset(JSON.parse(JSON.stringify(imported)))), []);
    }
  }
});
