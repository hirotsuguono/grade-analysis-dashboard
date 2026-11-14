'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const files = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const core = require(path.join(files, 'survey-core.js'));
const templates = require(path.join(files, 'survey-templates.js'));
const ExcelJS = require(path.join(files, 'vendor/exceljs.min.js'));
const XLSX = require(path.join(files, 'vendor/xlsx.full.min.js'));
const clone = value => JSON.parse(JSON.stringify(value));
const observed = (value, decimals = 0) => ({ value, status: 'observed', decimals });
const missing = (status = 'notProvided') => ({ value: null, status, decimals: null });
const school = { label: '架空校', ownership: 'public' };

// Fictional short definitions and values. These are not copies of an official workbook.
function fixture(existing = false) {
  const surveys = core.empty();
  surveys.sources.push({ id: 'fictional-official', kind: 'official', title: '架空の公式集計', publisher: '架空の発行元',
    url: null, fileName: null, importedAt: '2026-05-01T00:00:00.000Z', fingerprint: null, reader: null, locations: [], notes: [] });
  const question = { id: 'q1', version: 1, year: 2026, schoolLevel: 'lowerSecondary', grade: 3, respondent: 'student',
    kind: 'question', code: '架空Q1', text: '架空の質問です。', options: [
      { code: '1', label: '架空の選択肢一', responseStatus: 'answered' },
      { code: '2', label: '架空の選択肢二', responseStatus: 'answered' },
      { code: '9', label: '無回答', responseStatus: 'noResponse' }],
    subject: null, skills: [], formId: null,
    scale: { kind: 'response', unit: 'category', version: null, minimum: null, maximum: null, step: null, bands: [] } };
  const second = { ...clone(question), id: 'q2', code: '架空Q2', text: '別の架空質問です。' };
  const subject = { ...clone(question), id: 'fictional-math', kind: 'subject', code: '架空数', text: '架空の数学問題', options: [], subject: 'mathematics',
    skills: [], formId: 'fictional-form', rawScoreMaximum: 4,
    scale: { kind: 'percentCorrect', unit: 'percent', version: 'fictional-scale', minimum: 0, maximum: 100, step: null, bands: [] } };
  surveys.instruments.push(question, second, subject);
  const reference = { id: 'ref-q1', version: 1, instrumentId: 'q1', sourceId: 'fictional-official', type: 'distribution',
    observationUnit: 'student', geography: { level: 'national', code: 'fictional-national', label: '架空の全国' }, ownership: 'public',
    population: { participation: 'question', definition: '架空の質問調査参加者' },
    denominator: { basis: 'questionParticipants', definition: 'この質問の参加者数', count: observed(100) }, notes: [],
    basis: 'percent', partition: true, values: [{ code: '1', value: observed(40, 1) }, { code: '2', value: observed(50, 1) }, { code: '9', value: observed(10, 1) }] };
  const summary = { ...clone(reference), id: 'ref-math', instrumentId: subject.id, type: 'summary',
    population: { participation: 'subject', definition: '架空の教科調査参加者' },
    denominator: { basis: 'subjectParticipants', definition: 'この教科の参加者数', count: observed(100) }, mean: observed(37.5, 1), standardDeviation: missing() };
  delete summary.basis; delete summary.partition; delete summary.values;
  const conditional = { ...clone(reference), id: 'ref-q1-math', type: 'conditionalMean', subjectInstrumentId: subject.id,
    population: { participation: 'joint', definition: '架空の質問と教科の両方に参加した者' },
    denominator: { basis: 'jointParticipants', definition: '架空の有効な組の数', count: observed(100) },
    values: question.options.map((o, i) => ({ code: o.code, count: observed([40, 50, 10][i]), mean: observed(37.5, 1), standardDeviation: missing() })) };
  delete conditional.basis; delete conditional.partition;
  surveys.references.push(reference, { ...clone(reference), id: 'ref-q2', instrumentId: 'q2' }, summary, conditional);
  surveys.waves.push({ id: 'wave-one', label: '架空の実施回', administeredOn: '2026-04-20', administration: 'official',
    instrumentIds: surveys.instruments.map(i => i.id), referenceIds: surveys.references.map(r => r.id), results: [],
    participants: [{ id: 'p1', name: '架空 あおい', grade: 3, className: '架空A組', number: '01' },
      { id: 'p2', name: null, grade: 3, className: '架空A組', number: '02' },
      { id: 'p3', name: '架空 はる', grade: 3, className: '架空B組', number: '03' }] });
  if (existing) {
    surveys.sources.push({ ...clone(surveys.sources[0]), id: 'school-before', kind: 'schoolAggregate', title: '架空の前の学校結果' });
    for (const id of ['ref-q1', 'ref-q2']) {
      const result = clone(surveys.references.find(r => r.id === id));
      delete result.version;
      Object.assign(result, { id: 'before-' + id, sourceId: 'school-before', revision: 1, supersedes: null,
        geography: { level: 'school', code: null, label: school.label }, basis: 'count',
        denominator: { ...result.denominator, count: observed(3) }, values: result.values.map(v => ({ code: v.code, value: observed(1) })) });
      surveys.waves[0].results.push(result);
    }
  }
  assert.deepEqual(core.validate(surveys), []);
  return surveys;
}
function crossFixture() {
  const surveys = fixture(), reference = surveys.references.find(r => r.id === 'ref-q1-math');
  const cross = { ...clone(reference), id: 'ref-cross', type: 'crossTab', basis: 'count', normalization: 'column',
    grouping: { kind: 'quartile', scope: 'national', definitionId: null, bands: null },
    groups: ['A', 'B', 'C', 'D'].map(code => ({ code, label: '架空群' + code, count: observed(25) })),
    rows: ['1', '2', '9'].map((code, i) => ({ code, count: observed([40, 40, 20][i]), values: ['A', 'B', 'C', 'D'].map(group => ({ code: group, value: observed([10, 10, 5][i]) })) })) };
  delete cross.values; surveys.references.push(cross); surveys.waves[0].referenceIds.push(cross.id);
  assert.deepEqual(core.validate(surveys), []); return surveys;
}
const options = (mode = 'aggregateCount', ids = ['ref-q1']) => ({ mode, scope: { referenceIds: ids }, school });
async function edit(buffer, fn) {
  const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer); await fn(book); return book.xlsx.writeBuffer();
}
function dataRows(sheet) { return Array.from({ length: sheet.rowCount - 1 }, (_, i) => sheet.getRow(i + 2)); }
function fillAggregate(book, values, referenceId = 'ref-q1') {
  const rows = dataRows(book.getWorksheet(templates.names.aggregate)).filter(row => row.getCell(1).value === referenceId);
  assert.equal(rows.length, values.length);
  rows.forEach((row, i) => { row.getCell(6).value = values[i]; });
}
async function parsed(surveys, settings, change) {
  const built = await templates.buildTemplate(surveys, 'wave-one', settings);
  return templates.parseTemplate(change ? await edit(built.buffer, change) : built.buffer, surveys, 'wave-one', { fileName: 'fictional-school.xlsx' });
}
function assertFailure(result, pattern) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(result.errors.length); assert.match(result.errors.join('\n'), pattern);
  assert.equal(Object.hasOwn(result, 'payload'), false); assert.equal(Object.hasOwn(result, 'plan'), false);
  assert.ok(Object.isFrozen(result));
}

test('classic browser export and independent school template budgets are available offline', () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(files, 'survey-templates.js'), 'utf8'), context);
  assert.equal(typeof context.window.GD_SURVEY_TEMPLATES.buildTemplate, 'function');
  assert.equal(typeof context.window.GD_SURVEY_TEMPLATES.parseTemplate, 'function');
  assert.equal(templates.limits.fileBytes, 5 * 1024 * 1024);
  assert.equal(require(path.join(files, 'survey-import.js')).limits.sheets, 200);
});

test('issued workbooks have blank yellow school inputs and immutable gray definitions with fixed units', async () => {
  const surveys = fixture(true), original = JSON.stringify(surveys);
  const built = await templates.buildTemplate(surveys, 'wave-one', options('aggregateCount', ['ref-q1', 'ref-math', 'ref-q1-math']));
  assert.match(built.fileName, /学校調査_人数\.xlsx$/);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(built.buffer);
  assert.deepEqual(book.worksheets.map(s => s.name), ['書き方', '発行情報', '設問定義', '集計入力']);
  const sheet = book.getWorksheet(templates.names.aggregate);
  assert.equal(sheet.sheetProtection.sheet, true);
  for (const row of dataRows(sheet)) {
    for (const col of [6, 7]) { assert.equal(row.getCell(col).value, ''); assert.equal(row.getCell(col).fill.fgColor.argb, 'FFFFF5D6'); }
    assert.equal(row.getCell(1).fill.fgColor.argb, 'FFF1F4F8');
    assert.equal(row.getCell(1).protection?.locked ?? true, true); assert.equal(row.getCell(6).protection.locked, false);
  }
  assert.ok(dataRows(sheet).some(r => r.getCell(3).value === '平均' && r.getCell(5).value === '%'));
  assert.equal(sheet.getCell('F2').dataValidation.type, 'whole');
  assert.equal(JSON.stringify(surveys), original);
  assert.ok(Object.isFrozen(built.manifest.scope.referenceIds));
});

test('counts preserve true zero, each question N, complete preview and frozen candidates without state mutation', async () => {
  const surveys = fixture(), before = JSON.stringify(surveys);
  const result = await parsed(surveys, options(), book => fillAggregate(book, [3, 0, 2, 1]));
  assert.equal(result.ok, true, result.errors.join('\n'));
  const value = result.payload.results[0];
  assert.equal(value.basis, 'count'); assert.equal(value.denominator.count.value, 3);
  assert.deepEqual(value.values.map(v => v.value.value), [0, 2, 1]);
  assert.equal(result.preview.observedCount, 4); assert.equal(result.preview.blankCount, 0);
  assert.equal(result.payload.source.kind, 'schoolAggregate');
  assert.ok(Object.isFrozen(result.payload.results[0].values[0])); assert.ok(Object.isFrozen(result.plan));
  assert.equal(JSON.stringify(surveys), before);
});

test('percentages retain their reported precision and never infer missing counts', async () => {
  const result = await parsed(fixture(), options('aggregatePercent'), book => fillAggregate(book, [null, 33.3, 33.3, 33.3]));
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.equal(result.payload.results[0].basis, 'percent');
  assert.deepEqual(result.payload.results[0].denominator.count, missing('unentered'));
  assert.deepEqual(result.payload.results[0].values.map(v => v.value), [observed(33.3, 1), observed(33.3, 1), observed(33.3, 1)]);
});

test('count totals, integer counts and explicit mode fail with sheet and row and no partial candidate', async () => {
  for (const [values, pattern] of [[[3, 2, 2, 0], /人数合計/], [[null, 1, 1, 0], /対象人数/], [[3, 1.1, 1, 1], /整数/], [[3, -1, 3, 1], /整数/]]) {
    const result = await parsed(fixture(), options(), book => fillAggregate(book, values));
    assertFailure(result, pattern); assert.equal(result.issues[0].sheet, templates.names.aggregate); assert.ok(result.issues[0].row >= 2);
  }
  const percent = await parsed(fixture(), options('aggregatePercent'), book => fillAggregate(book, [3, 101, 0, 0]));
  assertFailure(percent, /0〜100/);
});

test('different questions keep their own entered denominators', async () => {
  const result = await parsed(fixture(), options('aggregateCount', ['ref-q1', 'ref-q2']), book => {
    fillAggregate(book, [3, 1, 1, 1], 'ref-q1'); fillAggregate(book, [2, 0, 2, 0], 'ref-q2');
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.payload.results.map(r => r.denominator.count.value), [3, 2]);
});

test('blank scoped cells clear prior values while preserving every result outside the issued scope and history', async () => {
  const state = require(path.join(files, 'survey-state.js')), surveys = fixture(true), before = clone(surveys);
  const result = await parsed(surveys, options());
  assert.equal(result.ok, true, result.errors.join('\n'));
  const applied = state.apply(surveys, result.plan).surveys;
  assert.deepEqual(state.getLatest(applied, 'wave-one', { instrumentId: 'q1', type: 'distribution' }).values.map(v => v.value), Array.from({ length: 3 }, () => missing('unentered')));
  assert.deepEqual(state.getLatest(applied, 'wave-one', { instrumentId: 'q2', type: 'distribution' }), before.waves[0].results[1]);
  assert.deepEqual(applied.waves[0].results.find(r => r.id === 'before-ref-q1'), before.waves[0].results[0]);
  assert.deepEqual(surveys, before);
});

test('same-scope result edits stale the template; unrelated question and other-wave edits remain usable', async () => {
  const surveys = fixture(true), built = await templates.buildTemplate(surveys, 'wave-one', options());
  const changed = clone(surveys); changed.waves[0].results[0].notes.push('架空の修正');
  assertFailure(await templates.parseTemplate(built.buffer, changed, 'wave-one'), /更新|発行/);
  const otherQuestion = clone(surveys); otherQuestion.waves[0].results[1].notes.push('別の質問を修正');
  assert.equal((await templates.parseTemplate(built.buffer, otherQuestion, 'wave-one')).ok, true);
  const otherWave = clone(surveys); otherWave.waves.push({ ...clone(otherWave.waves[0]), id: 'wave-two', label: '別の架空実施回' });
  otherWave.waves[1].results[0].notes.push('別の調査回を修正');
  assert.equal((await templates.parseTemplate(built.buffer, otherWave, 'wave-one')).ok, true);
});

test('wave, exact definition, participant snapshot and fixed layout tampering are rejected', async () => {
  const surveys = fixture(), built = await templates.buildTemplate(surveys, 'wave-one', options());
  assertFailure(await templates.parseTemplate(built.buffer, surveys, 'wrong-wave'), /調査回/);
  const definition = clone(surveys); definition.instruments[0].options[0].label = '別の選択肢';
  assertFailure(await templates.parseTemplate(built.buffer, definition, 'wave-one'), /設問・尺度/);
  for (const change of [book => { book.getWorksheet(templates.names.aggregate).getCell('A2').value = 'ref-q2'; },
    book => { book.getWorksheet(templates.names.definitions).getCell('H2').value = '書換え'; },
    book => { book.getWorksheet(templates.names.aggregate).getCell('I2').value = 100; },
    book => { book.addWorksheet('追加の入力'); }]) {
    assertFailure(await templates.parseTemplate(await edit(built.buffer, change), surveys, 'wave-one'), /変更|発行|シート/);
  }
  const individual = await templates.buildTemplate(surveys, 'wave-one', options('individual'));
  const membership = clone(surveys); membership.waves[0].participants[0].className = '架空C組';
  assertFailure(await templates.parseTemplate(individual.buffer, membership, 'wave-one'), /対象者/);
});

test('formulas, booleans, hyperlinks, dates and percent-formatted cells are rejected without using cached values', async () => {
  for (const change of [cell => { cell.value = { formula: '1+1', result: 2 }; }, cell => { cell.value = true; },
    cell => { cell.value = { text: '1', hyperlink: 'https://example.invalid' }; },
    cell => { cell.value = new Date('2026-04-01T00:00:00Z'); cell.numFmt = 'yyyy-mm-dd'; },
    cell => { cell.value = .25; cell.numFmt = '0.0%'; }, cell => { cell.value = '25%'; }, cell => { cell.value = 'Infinity'; }]) {
    const result = await parsed(fixture(), options('aggregatePercent'), book => change(book.getWorksheet(templates.names.aggregate).getCell('F3')));
    assertFailure(result, /数式|文字列|真偽値|リンク|日付|パーセント|数字|有限/);
  }
});

test('aggregate means expose the official unit and preserve explicit missing status', async () => {
  const result = await parsed(fixture(), options('aggregateCount', ['ref-math']), book => {
    fillAggregate(book, [3, 50, null], 'ref-math'); book.getWorksheet(templates.names.aggregate).getCell('G4').value = '未提供';
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.payload.results[0].mean, observed(50));
  assert.deepEqual(result.payload.results[0].standardDeviation, missing());
  const conflict = await parsed(fixture(), options(), book => { fillAggregate(book, [3, 0, 2, 1]); book.getWorksheet(templates.names.aggregate).getCell('G3').value = '未提供'; });
  assertFailure(conflict, /同時/);
  const impossible = await parsed(fixture(), options('aggregateCount', ['ref-math']), book => fillAggregate(book, [0, 50, null], 'ref-math'));
  assertFailure(impossible, /0人/); assert.equal(impossible.issues[0].sheet, templates.names.aggregate); assert.ok(impossible.issues[0].row >= 2);
});

test('conditional means use per-choice paired counts and the selected subject scale', async () => {
  const result = await parsed(fixture(), options('aggregateCount', ['ref-q1-math']), book => {
    fillAggregate(book, [3, 2, 75, null, 1, 25, null, 0, null, null], 'ref-q1-math');
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  const statistic = result.payload.results[0];
  assert.equal(statistic.type, 'conditionalMean'); assert.equal(statistic.subjectInstrumentId, 'fictional-math');
  assert.equal(statistic.denominator.count.value, 3);
  assert.deepEqual(statistic.values.map(v => [v.count.value, v.mean.value]), [[2, 75], [1, 25], [0, null]]);
  const bad = await parsed(fixture(), options('aggregateCount', ['ref-q1-math']), book => {
    fillAggregate(book, [3, 2, 75, null, 2, 25, null, 0, null, null], 'ref-q1-math');
  });
  assertFailure(bad, /人数合計/); assert.equal(bad.issues[0].row, 2);
});

test('aggregate cross tables keep the published normalization and unknown boundaries as reference only', async () => {
  const surveys = crossFixture(), result = await parsed(surveys, options('aggregateCount', ['ref-cross']), book => {
    fillAggregate(book, [4, 1, 1, 1, 1, 2, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1], 'ref-cross');
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  const statistic = result.payload.results[0];
  assert.equal(statistic.normalization, 'column'); assert.equal(statistic.grouping.bands, null);
  assert.deepEqual(statistic.groups.map(g => g.count.value), [1, 1, 1, 1]);
  assert.ok(result.preview.warnings.some(w => /未公表/.test(w)));
  const state = require(path.join(files, 'survey-state.js')), applied = state.apply(surveys, result.plan).surveys;
  assert.equal(core.compare(applied, { waveId: 'wave-one', resultId: statistic.id, referenceId: 'ref-cross' }).status, 'referenceOnly');
  await assert.rejects(templates.buildTemplate(surveys, 'wave-one', options('individual', ['ref-cross'])), /四分位/);
});

test('school ownership remains separate from all-owner references and follows a fixed wave when supplied', async () => {
  const surveys = fixture(); surveys.references[0].ownership = 'all';
  const result = await parsed(surveys, options(), book => fillAggregate(book, [3, 1, 1, 1]));
  assert.equal(result.ok, true, result.errors.join('\n')); assert.equal(result.payload.results[0].ownership, 'public');
  await assert.rejects(templates.buildTemplate(surveys, 'wave-one', { ...options(), school: { label: '架空校', ownership: 'all' } }), /設置者/);
  surveys.waves[0].ownership = 'public'; surveys.waves[0].schoolLabel = '固定した架空校';
  const built = await templates.buildTemplate(surveys, 'wave-one', { mode: 'aggregateCount', scope: { referenceIds: ['ref-q1'] } });
  assert.equal(built.manifest.school.ownership, 'public'); assert.equal(built.manifest.school.label, '固定した架空校');
  await assert.rejects(templates.buildTemplate(surveys, 'wave-one', { ...options(), school: { label: '別の架空校', ownership: 'private' } }), /一致/);
});

test('issued plan remains anchored after parsing and cannot overwrite a later same-scope edit', async () => {
  const state = require(path.join(files, 'survey-state.js')), surveys = fixture(true);
  const result = await parsed(surveys, options(), book => fillAggregate(book, [3, 0, 2, 1]));
  assert.equal(result.ok, true, result.errors.join('\n'));
  const edited = clone(surveys); edited.waves[0].results[0].notes.push('後から訂正');
  assert.throws(() => state.apply(edited, result.plan), /後で変更/);
});

test('individual rows retain stable IDs, raw correct counts and distinguish blanks from actual no-response choices', async () => {
  const surveys = fixture(), result = await parsed(surveys, options('individual', ['ref-q1', 'ref-math', 'ref-q1-math']), book => {
    for (const row of dataRows(book.getWorksheet(templates.names.individual))) {
      const participant = row.getCell(1).value, instrument = row.getCell(6).value;
      row.getCell(9).value = instrument === 'q1' ? ({ p1: 1, p2: 9, p3: null })[participant] : ({ p1: 4, p2: 0, p3: 2 })[participant];
    }
  });
  assert.equal(result.ok, true, result.errors.join('\n'));
  const records = result.payload.responseSet.records;
  assert.deepEqual(records[0].values.find(v => v.instrumentId === 'fictional-math'), { instrumentId: 'fictional-math', value: 100, status: 'observed', rawScore: 4 });
  assert.deepEqual(records[1].values.find(v => v.instrumentId === 'fictional-math'), { instrumentId: 'fictional-math', value: 0, status: 'observed', rawScore: 0 });
  assert.deepEqual(records[1].values.find(v => v.instrumentId === 'q1'), { instrumentId: 'q1', value: '9', status: 'observed' });
  assert.deepEqual(records[2].values.find(v => v.instrumentId === 'q1'), { instrumentId: 'q1', value: null, status: 'unentered' });
  assert.equal(result.payload.source.kind, 'schoolIndividual');
  assert.equal(result.preview.blankCount, 1);
});

test('individual out-of-range scores, undefined codes, changed IDs and duplicate rows produce no candidate', async () => {
  for (const change of [sheet => { sheet.getCell('I2').value = 'absent-code'; },
    sheet => { sheet.getCell('I3').value = 5; }, sheet => { sheet.getCell('I3').value = 2.5; },
    sheet => { sheet.getCell('A2').value = 'p2'; }, sheet => { sheet.addRow(sheet.getRow(2).values); }]) {
    const result = await parsed(fixture(), options('individual', ['ref-q1', 'ref-math']), book => change(book.getWorksheet(templates.names.individual)));
    assertFailure(result, /選択肢|正答数|整数|変更|範囲/);
  }
});

test('incomplete definitions and unsupported individual IRT means cannot be issued', async () => {
  const incomplete = fixture(); incomplete.instruments[0].definitionStatus = 'codesOnly';
  await assert.rejects(templates.buildTemplate(incomplete, 'wave-one', options()), /原文|追加/);
  const irt = fixture(), subject = irt.instruments[2];
  delete subject.rawScoreMaximum; subject.subject = 'english'; subject.skills = ['listening', 'reading', 'writing'];
  subject.scale = { kind: 'irtScore', unit: 'irtScore', version: 'fictional-irt', minimum: null, maximum: null, step: null, bands: [] };
  await assert.rejects(templates.buildTemplate(irt, 'wave-one', options('individual', ['ref-math'])), /IRT|個人別/);
  const aggregate = await templates.buildTemplate(irt, 'wave-one', options('aggregateCount', ['ref-math']));
  const book = XLSX.read(aggregate.buffer, { type: 'array' });
  assert.match(book.Sheets['集計入力'].H3.v, /技能範囲.*公式返却平均/);
});

test('truncated ZIP, oversized files, expanded workbooks and extra cells cannot bypass template budgets', async () => {
  const surveys = fixture(), built = await templates.buildTemplate(surveys, 'wave-one', options());
  assertFailure(await templates.parseTemplate(new Uint8Array(built.buffer).slice(0, 30), surveys, 'wave-one'), /容量|展開|ファイル/);
  const huge = new Uint8Array(templates.limits.fileBytes + 1); huge[0] = 80; huge[1] = 75;
  assertFailure(await templates.parseTemplate(huge, surveys, 'wave-one'), /5MB/);
  const outOfRange = XLSX.read(built.buffer, { type: 'array' });
  outOfRange.Sheets['集計入力'].AG2 = { t: 'n', v: 1 }; outOfRange.Sheets['集計入力']['!ref'] = 'A1:AG5';
  assertFailure(await templates.parseTemplate(XLSX.write(outOfRange, { type: 'buffer', bookType: 'xlsx' }), surveys, 'wave-one'), /範囲|容量/);
});
