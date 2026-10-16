'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const root = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const xlsx = require(path.join(root, 'vendor/xlsx.full.min.js'));
const importSource = fs.readFileSync(path.join(root, 'import-core.js'), 'utf8');
const scriptSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
const students = () => [
  { id: 's1', name: '架空生徒001', className: '2年A組', number: 1, classHistory: [{ className: '1年B組', number: 3 }] },
  { id: 's2', name: '架空生徒002', className: '2年A組', number: 2 },
];
const dataset = () => ({ version: 3, name: '架空', students: students(), tests: [], scores: [], metrics: [{ id: 'm1', label: '家庭学習時間', type: 'number', values: { s1: 45, s2: 20 } }] });
function harness() {
  const alerts = [], confirms = [], downloads = [], elements = {};
  const context = vm.createContext({
    console, crypto: webcrypto, TextEncoder,
    XLSX: { ...xlsx, writeFile(wb, name) { downloads.push({ wb, name }); } },
    alert(message) { alerts.push(message); }, confirm(message) { confirms.push(message); return context.confirmResult; },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById(id) { return elements[id] || null; } },
  });
  context.confirmResult = true;
  vm.runInContext(importSource, context);
  vm.runInContext(scriptSource + `\nrebuildIndex = function() {}; markDirty = function() {}; renderAll = function() {}; fillAxisSelects = function() {}; fillMetricSelect = function() {}; renderMetricsTab = function() {};\n globalThis.api = { importTestTemplate, importMetricTemplate, issueNewTestTemplate, issueMetricTemplate, exportTemplate, buildReassignPlan, submitNewDialog, setData(d) {data=d;}, getData() {return data;}, setUI(v) {Object.assign(ui,v);} };`, context);
  return { api: context.api, core: context.window.GD_IMPORT, alerts, confirms, downloads, elements, context };
}
function fileFromSheets(sheets) {
  const wb = xlsx.utils.book_new();
  for (const [name, rows] of sheets) xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(rows), name);
  const buf = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { arrayBuffer: async () => buf };
}
const metricRows = () => [[], ['出席番号', '氏名', 'クラス', '家庭学習時間', '生徒ID'], [1, '架空生徒001', '2年A組', 0, 's1'], [2, '架空生徒002', '2年A組', '', 's2']];
const testRows = () => [
  ['テスト名→', '架空第2回', '教科→', '英語', '満点→', 20, '実施学年→', 2, '実施日→', '2026-06-10'],
  ['分野→', '', '', '語彙', '文法'], ['配点→', '', '', 10, 10],
  ['出席番号', '氏名', 'クラス', '語彙', '文法', '生徒ID'],
  [1, '架空生徒001', '2年A組', 0, '', 's1'], [2, '架空生徒002', '2年A組', '', '', 's2'],
];

test('ID is authoritative; unknown, contradictory and mixed history identities never fall back', () => {
  const { core } = harness(), match = core.createMatcher(students());
  assert.equal(match({ id: 's1', name: '架空生徒001', className: '1年B組', number: 3 }).student.id, 's1');
  assert.ok(match({ id: 'unknown', name: '架空生徒001' }).error);
  assert.ok(match({ id: 's1', name: '架空生徒002' }).error);
  assert.ok(match({ id: 's1', name: '架空生徒001', className: '2年A組', number: 3 }).error);
  assert.ok(match({ name: '架空生徒001', className: '2年A組', number: 2 }).error);
  assert.equal(match({ name: '架空生徒001' }).student.id, 's1');
});
test('duplicated names require unique tuple, including history; ambiguous tuples refuse', () => {
  const { core } = harness(); const roster = students(); roster[1].name = roster[0].name;
  let match = core.createMatcher(roster);
  assert.ok(match({ name: roster[0].name }).error);
  assert.equal(match({ name: roster[0].name, className: '2年A組', number: 2 }).student.id, 's2');
  roster[1].classHistory = [{ className: '1年B組', number: 3 }];
  match = core.createMatcher(roster);
  assert.ok(match({ name: roster[0].name, className: '1年B組', number: 3 }).error);
});
test('sheet selection prefers 指標 regardless of order and never imports examples', () => {
  const { core } = harness(); const wb = xlsx.utils.book_new();
  for (const name of ['記入例', '書き方', '指標']) xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(metricRows()), name);
  assert.equal(core.selectSheet(wb, xlsx, ['指標']).name, '指標');
  delete wb.Sheets['指標']; wb.SheetNames.pop();
  assert.throws(() => core.selectSheet(wb, xlsx, ['指標']), /見つかりません/);
  for (const name of ['入力1', '入力2']) xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(metricRows()), name);
  assert.throws(() => core.selectSheet(wb, xlsx, ['指標']), /複数/);
});
test('unfilled metric names and blank values explain exact cells without inventing values', () => {
  const { core } = harness();
  const blank = metricRows(); blank[1][3] = '指標名①（ここを書き換え）'; blank[2][3] = '';
  let result = core.parseMetricRows(blank, students(), []);
  assert.match(result.errors.join(''), /D2.*D3/);
  blank[1][3] = '家庭学習時間'; result = core.parseMetricRows(blank, students(), []);
  assert.match(result.errors.join(''), /数値がまだ/);
});
test('metric plan excludes ID; preserves zero and omits blanks; rejects malformed or duplicate rows', () => {
  const { core } = harness(); const rows = metricRows();
  let result = core.parseMetricRows(rows, students(), dataset().metrics);
  assert.equal(result.errors.length, 0); assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].values.s1, 0); assert.equal(result.plans[0].values.s2, undefined);
  for (const value of ['文字', 'Infinity', true]) {
    rows[2][3] = value; result = core.parseMetricRows(rows, students(), []); assert.ok(result.errors.length);
  }
  rows[2][3] = 2; rows.push([...rows[2]]);
  assert.match(core.parseMetricRows(rows, students(), []).errors.join(''), /重複/);
});
test('unknown or invalid metric rows abort all mutations; valid import requires confirmation', async () => {
  const h = harness(), original = dataset(); h.api.setData(original);
  for (const edit of [r => {r[3][4] = 'unknown'; r[3][3] = 3;}, r => {r[3][3] = 'abc';}, r => {r.push([...r[2]]);}]) {
    const rows = metricRows(); edit(rows); const before = JSON.stringify(original);
    await h.api.importMetricTemplate(fileFromSheets([['指標', rows]]));
    assert.equal(JSON.stringify(original), before); assert.equal(h.confirms.length, 0);
  }
  h.context.confirmResult = false;
  await h.api.importMetricTemplate(fileFromSheets([['指標', metricRows()]])); assert.equal(original.metrics[0].values.s1, 45);
  h.context.confirmResult = true;
  await h.api.importMetricTemplate(fileFromSheets([['記入例', metricRows()], ['指標', metricRows()]]));
  assert.equal(original.metrics[0].values.s1, 0); assert.equal(original.metrics[0].values.s2, 20);
});
test('test import preserves zero and missing question scores; no record for all-blank pupil', async () => {
  const h = harness(), d = dataset(); h.api.setData(d);
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', testRows()]]));
  assert.equal(d.tests.length, 1); assert.equal(d.tests[0].questions.length, 2);
  assert.equal(d.scores.length, 1); assert.equal(d.scores[0].questions.q1, 0); assert.equal(d.scores[0].questions.q2, undefined);
});
test('test import rejects unknown, duplicates, text, nonfinite, mixed absence, and invalid maxima atomically', async () => {
  for (const edit of [
    r => {r[5][5] = 'unknown';}, r => {r.push([...r[4]]);}, r => {r[4][3] = 'abc';},
    r => {r[4][3] = 'Infinity';}, r => {r[4][3] = '欠'; r[4][4] = 5;}, r => {r[2][3] = 'bad';},
    r => {r[0][5] = 'bad';}, r => {r[4][3] = 11;},
  ]) {
    const h = harness(), d = dataset(), before = JSON.stringify(d), rows = testRows(); h.api.setData(d); edit(rows);
    await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
    assert.equal(JSON.stringify(d), before); assert.ok(h.alerts.length);
  }
});
test('new template IDs round-trip after class reassignment using recognized history', async () => {
  const h = harness(), d = dataset(); h.api.setData(d); h.api.issueNewTestTemplate();
  const rows = xlsx.utils.sheet_to_json(h.downloads[0].wb.Sheets['新規テスト'], { header: 1, defval: '' });
  const id = rows[3].indexOf('生徒ID'); assert.equal(rows[4][id], 's1');
  rows[0][1] = '架空テスト'; rows[0][3] = '英語'; rows[4][3] = 4;
  d.students[0].classHistory.push({className: d.students[0].className, number: d.students[0].number});
  d.students[0].className = '3年C組'; d.students[0].number = 12;
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(d.scores.length, 1); assert.equal(d.scores[0].studentId, 's1');
});
test('metric template IDs round-trip and all examples are explicit synthetic names', async () => {
  const h = harness(), d = dataset(); h.api.setData(d); h.api.issueMetricTemplate();
  const wb = h.downloads[0].wb, rows = xlsx.utils.sheet_to_json(wb.Sheets['指標'], {header: 1, defval: ''});
  const id = rows[1].indexOf('生徒ID'); assert.equal(id, 5); assert.equal(rows[2][id], 's1');
  rows[1][3] = '家庭学習時間'; rows[2][3] = 10;
  await h.api.importMetricTemplate(fileFromSheets([['指標', rows]]));
  assert.equal(d.metrics[0].values.s1, 10); assert.equal(d.metrics.length, 1);
  const examples = xlsx.utils.sheet_to_json(wb.Sheets['記入例'], {header: 1, defval: ''});
  assert.ok(examples.filter(r => typeof r[0] === 'number').every(r => /^架空生徒/.test(r[1])));
});
test('class reassignment rejects duplicate names, duplicate rows, and occupied destination tuples', () => {
  const h = harness(), d = dataset(); h.api.setData(d); h.elements.reassignAddNew = {checked: true};
  h.elements.reassignText = {value: '架空生徒001\t2年A組\t2'};
  assert.ok(h.api.buildReassignPlan().dupes.length);
  h.elements.reassignText.value = '架空生徒001\t3年A組\t1\n架空生徒001\t3年A組\t2';
  assert.ok(h.api.buildReassignPlan().dupes.length);
  d.students[1].name = d.students[0].name;
  h.elements.reassignText.value = '架空生徒001\t3年A組\t1';
  assert.ok(h.api.buildReassignPlan().dupes.length);
});
