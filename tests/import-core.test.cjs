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
const splitTestRows = () => [
  ['テスト名', '架空4分野'], ['教科', '英語'], ['満点', 100], ['実施学年', 1], ['実施日', '2026-05-22'], [],
  ['分野', '', '', '', '', 'リスニング', '読解', 'ライティング', '文法'],
  ['配点', '', '', '', '', 25, 25, 25, 25],
  ['生徒ID', '学年', 'クラス', '出席番号', '氏名', '問1', '問2', '問3', '問4'],
  ['s1', 2, 'A', 1, '架空生徒001', 0, 20, 15, 25],
  ['s2', 2, 'A', 2, '架空生徒002', '', '', '', ''],
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
  assert.equal(rows[8][0], '生徒ID'); assert.equal(rows[9][0], 's1');
  rows[0][1] = '架空テスト'; rows[1][1] = '英語'; rows[9][5] = 4;
  d.students[0].classHistory.push({className: d.students[0].className, number: d.students[0].number});
  d.students[0].className = '3年C組'; d.students[0].number = 12;
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(d.scores.length, 1); assert.equal(d.scores[0].studentId, 's1');
});
test('test template separates left metadata, five roster columns, and expandable question columns', () => {
  const h = harness(); h.api.setData(dataset()); h.api.issueNewTestTemplate();
  const wb = h.downloads[0].wb;
  const rows = xlsx.utils.sheet_to_json(wb.Sheets['新規テスト'], {header: 1, defval: ''});
  assert.deepEqual(rows.slice(0, 5).map(r => r[0]), ['テスト名', '教科', '満点', '実施学年', '実施日']);
  assert.deepEqual(rows[8].slice(0, 5), ['生徒ID', '学年', 'クラス', '出席番号', '氏名']);
  assert.deepEqual(rows[9].slice(0, 5), ['s1', '2', 'A', 1, '架空生徒001']);
  assert.ok(rows.slice(9).every(r => r.slice(5).every(v => v === '')));
  assert.deepEqual(wb.SheetNames, ['新規テスト', '記入例', '説明']);
  assert.ok(xlsx.utils.sheet_to_json(wb.Sheets['説明'], {header: 1}).flat().some(v => /列全体/.test(String(v))));
});
test('four-domain workbook preserves roster and separate test grade/date, zero and blanks', async () => {
  const h = harness(), d = dataset(), roster = JSON.stringify(d.students); h.api.setData(d);
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', splitTestRows()]]));
  assert.equal(d.tests.length, 1); assert.equal(d.tests[0].maxScore, 100);
  assert.equal(d.tests[0].gradeYear, 1); assert.equal(d.tests[0].date, '2026-05-22');
  assert.equal(JSON.stringify(d.students), roster);
  assert.deepEqual(Array.from(d.tests[0].domains, v => v.label), ['リスニング', '読解', 'ライティング', '文法']);
  assert.equal(d.scores.length, 1); assert.equal(d.scores[0].total, 60);
  assert.equal(d.scores[0].questions.q1, 0); assert.equal(d.scores[0].studentId, 's1');
});
test('test kinds and series round-trip through Excel; invalid kinds abort the workbook', async () => {
  const h=harness(),d=dataset(),rows=splitTestRows();h.api.setData(d);
  rows[0][3]='テスト種類';rows[0][4]='実力テスト';rows[1][3]='比較系列';rows[1][4]='架空シリーズA';
  await h.api.importTestTemplate(fileFromSheets([['新規テスト',rows]]));
  assert.equal(d.tests[0].kind,'proficiency');assert.equal(d.tests[0].series,'架空シリーズA');
  for (const label of ['未分類','単元テスト','中間テスト','期末テスト','実力テスト','その他']) assert.ok(h.core.parseTestKind(label));
  rows[0][4]='不正な種類';const before=JSON.stringify(d);
  await h.api.importTestTemplate(fileFromSheets([['新規テスト',rows]]));
  assert.equal(JSON.stringify(d),before);
});
test('entire question-column insertions and additions never move new metadata or IDs', async () => {
  const h = harness(), d = dataset(); h.api.setData(d); h.api.issueNewTestTemplate();
  const rows = xlsx.utils.sheet_to_json(h.downloads[0].wb.Sheets['新規テスト'], {header: 1, defval: ''});
  rows[0][1] = '架空列追加'; rows[1][1] = '英語'; rows[3][1] = 2; rows[4][1] = '2026-06-10';
  // Insert a whole Excel column at G, then append enough questions to extend beyond J.
  rows.forEach(r => { while (r.length < 6) r.push(''); r.splice(6, 0, ''); });
  for (let c = 5; c < 17; c++) {
    rows[6][c] = c < 11 ? '読解' : '文法'; rows[7][c] = 10; rows[8][c] = '問' + (c - 4);
    rows[9][c] = c - 5; // 0..11; cap the last score below the 10-point maximum.
    if (rows[9][c] > 10) rows[9][c] = 10;
  }
  const metadata = rows.slice(0, 5).map(r => r.slice(0, 2));
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(d.tests.length, 1); assert.equal(d.tests[0].questions.length, 12);
  assert.equal(d.tests[0].maxScore, 120); assert.equal(d.tests[0].gradeYear, 2);
  assert.equal(d.tests[0].date, '2026-06-10'); assert.equal(d.scores[0].total, 65);
  assert.equal(d.tests[0].domains.length, 2); assert.equal(d.scores[0].domains['読解'], 15);
  assert.equal(d.scores[0].domains['文法'], 50);
  assert.equal(rows[9][0], 's1');
  assert.deepEqual(rows.slice(0, 5).map(r => r.slice(0, 2)), metadata);
});
test('new-format identity uses grade, class and number from the same current or historical roster entry', async () => {
  const rows = splitTestRows(); rows[9][1] = 1; rows[9][2] = 'B'; rows[9][3] = 3;
  const h = harness(), d = dataset(); h.api.setData(d);
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(d.scores[0].studentId, 's1');
  for (const edit of [r => {r[9][1] = 2;}, r => {r[9][2] = 'A';}, r => {r[9][3] = 1;}]) {
    const invalid = rows.map(r => r.slice()); edit(invalid);
    const check = harness(), original = dataset(), before = JSON.stringify(original); check.api.setData(original);
    await check.api.importTestTemplate(fileFromSheets([['新規テスト', invalid]]));
    assert.equal(JSON.stringify(original), before); assert.equal(check.confirms.length, 0);
  }
});
test('different grades with the same class, number and name retain distinct IDs', async () => {
  const h = harness(), d = dataset(), rows = splitTestRows();
  d.students[0].className = '1年A組'; d.students[1].number = 1; d.students[1].name = d.students[0].name;
  rows[9][1] = 1; rows[10] = ['s2', 2, 'A', 1, d.students[0].name, 25, 25, 25, 25];
  h.api.setData(d); await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.deepEqual(Array.from(d.scores, r => [r.studentId, r.total]), [['s1', 60], ['s2', 100]]);
});
test('compact and unrecognized class names round-trip without modifying stored class names', async () => {
  const h = harness(), d = dataset(); d.students[0].className = '2A'; d.students[1].className = '特別クラス';
  h.api.setData(d); h.api.issueNewTestTemplate();
  const rows = xlsx.utils.sheet_to_json(h.downloads[0].wb.Sheets['新規テスト'], {header:1, defval:''});
  assert.deepEqual(rows[9].slice(1, 3), ['2', 'A']);
  assert.deepEqual(rows[10].slice(1, 3), ['', '特別クラス']);
  rows[0][1] = '架空クラス'; rows[1][1] = '英語'; rows[9][5] = 0; rows[10][5] = 10;
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(d.scores.length, 2);
  assert.deepEqual(d.students.map(s => s.className), ['2A', '特別クラス']);
});
test('invalid new identities, metadata, headers and scores abort the entire workbook', async () => {
  for (const edit of [
    r => {r[9][0] = 'unknown';}, r => {r[9][0] = '';}, r => {r[9][1] = 3;},
    r => {r[9][1] = '2.5';}, r => {r[9][2] = 'B';}, r => {r[9][3] = 2;}, r => {r[9][4] = '別の架空生徒';},
    r => {r.push([...r[9]]);}, r => {r[9][5] = 'abc';}, r => {r[9][5] = 'Infinity';},
    r => {r[9][5] = -1;}, r => {r[9][5] = 26;}, r => {r[9][5] = '欠';},
    r => {r[7][5] = 0;}, r => {r[8][5] = '';}, r => {r[2][1] = 99;},
    r => {r[3][1] = '2.5';}, r => {r[4][1] = 60;}, r => {r[4][1] = '2026-02-30';},
    r => {r[5] = ['実施日', '2026-06-10'];}, r => {r[8][1] = '別の見出し';},
    r => {r[8][9] = '生徒ID'; r[9][9] = 's1';},
  ]) {
    const h = harness(), d = dataset(), before = JSON.stringify(d), rows = splitTestRows(); edit(rows); h.api.setData(d);
    await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
    assert.equal(JSON.stringify(d), before, JSON.stringify(rows));
    assert.equal(h.confirms.length, 0); assert.ok(h.alerts.length);
  }
});
test('new-format absence, serial dates, optional metadata and cancellation preserve existing data', async () => {
  const h = harness(), d = dataset(), rows = splitTestRows(); h.api.setData(d);
  rows[2][1] = ''; rows[3][1] = ''; rows[4][1] = 46132.75;
  rows[9].splice(5, 4, '欠', '', '', '');
  h.context.confirmResult = false;
  const before = JSON.stringify(d);
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(JSON.stringify(d), before);
  h.context.confirmResult = true;
  await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
  assert.equal(d.tests[0].maxScore, 100); assert.equal(d.tests[0].gradeYear, undefined);
  assert.equal(d.tests[0].date, '2026-04-20'); assert.equal(d.scores.length, 1);
  assert.equal(d.scores[0].absent, true); assert.equal(d.scores[0].total, null);
});
test('new metadata can be reordered; examples are ignored even when sheets are reordered or renamed', async () => {
  const h = harness(), d = dataset(), rows = splitTestRows(); h.api.setData(d);
  rows.splice(0, 5, ...rows.slice(0, 5).reverse());
  await h.api.importTestTemplate(fileFromSheets([['記入例', splitTestRows()], ['説明', []], ['架空の入力', rows]]));
  assert.equal(d.tests.length, 1); assert.equal(d.tests[0].date, '2026-05-22');
  const check = harness(), original = dataset(); check.api.setData(original);
  await assert.rejects(check.api.importTestTemplate(fileFromSheets([['記入例', splitTestRows()]])), /見つかりません/);
  assert.equal(original.tests.length, 0);
});
test('legacy templates with inserted whole columns keep shifted grade/date and optional IDs', async () => {
  for (const withId of [true, false]) {
    const h = harness(), d = dataset(), rows = testRows(); h.api.setData(d);
    // Start with the former three-question template (ID in G), then insert a whole G column.
    rows[1].splice(5, 0, '文法'); rows[2].splice(5, 0, 10); rows[3].splice(5, 0, '問3');
    rows[4].splice(5, 0, 5); rows[5].splice(5, 0, '');
    rows[0][5] = 50; // Deliberately different from the question maxima sum of 40.
    rows.forEach(r => {while (r.length < 6) r.push(''); r.splice(6, 0, '');});
    rows[1][6] = '読解'; rows[2][6] = 10; rows[3][6] = '問4'; rows[4][6] = 5;
    rows[4][4] = 0; // Explicit zero completes all four questions; a blank is still in progress.
    if (!withId) rows.slice(3).forEach(r => r.splice(7, 1));
    await h.api.importTestTemplate(fileFromSheets([['新規テスト', rows]]));
    assert.equal(d.tests.length, 1); assert.equal(d.tests[0].questions.length, 4);
    assert.equal(d.tests[0].maxScore, 50);
    assert.equal(d.tests[0].gradeYear, 2); assert.equal(d.tests[0].date, '2026-06-10');
    assert.equal(d.scores[0].total, 10); assert.equal(d.scores[0].studentId, 's1');
  }
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
