'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/files/survey-import.js');
const core = require('../src/files/survey-core.js');
const f = require('./survey-fixtures.cjs');
const { XLSX } = f;
const importedAt = '2026-11-14T00:00:00.000Z';
const buffers = new Map(), parsed = new Map();
const buffer = kind => { if (!buffers.has(kind)) buffers.set(kind, f.officialBuffer(kind)); return buffers.get(kind); };
const parse = (bytes, fileName = 'fictional-renamed.xlsx') => api.parseOfficialWorkbook(bytes, { fileName, importedAt }, { XLSX });
const result = async kind => { if (!parsed.has(kind)) parsed.set(kind, await parse(buffer(kind))); return parsed.get(kind); };
const instrument = (data, code = '1', schoolLevel = 'lowerSecondary') => data.instruments.find(i => i.kind === 'question' && i.code === code && i.schoolLevel === schoolLevel);
const reference = (data, type, code = '1', subject = null) => {
  const question = instrument(data, code);
  return data.references.find(r => r.instrumentId === question.id && r.type === type && (!subject || data.instruments.find(i => i.id === r.subjectInstrumentId)?.subject === subject));
};
const changed = (kind, change) => { const wb = f.officialWorkbook(kind); change(wb.Sheets[wb.SheetNames[0]], wb); return f.officialBuffer(kind, { workbook: wb }); };

test('native File uploads remain files when Blob also exposes a bytes() method', async () => {
  const file = new File([buffer(402)], 'fictional-native-upload.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (typeof file.bytes !== 'function') Object.defineProperty(file, 'bytes', { value: async () => { throw new Error('arrayBuffer should be used'); } });
  const actual = await api.parseOfficialFiles([file], { XLSX, importedAt });
  assert.equal(actual.candidate.references.length, 131);
  assert.equal(actual.candidate.sources[0].fileName, file.name);
  assert.deepEqual(core.validate(actual.candidate), []);
});

test('official recognition uses internal year, ownership and table headers, never the filename', async () => {
  for (const [kind, ownership, count] of [[402, 'public', 131], [424, 'all', 786], [427, 'all', 609]]) {
    const actual = await result(kind), data = actual.candidate;
    assert.equal(actual.recognition[0].year, 2026); assert.deepEqual(actual.recognition[0].ownerships, [ownership]);
    assert.equal(data.references.length, count); assert.deepEqual(core.validate(data), []);
    assert.equal(data.sources[0].fileName, 'fictional-renamed.xlsx');
    assert.equal(data.sources[0].url, 'https://www.nier.go.jp/26chousakekkahoukoku/factsheet/data/' + ({ 402: '26m_402.xlsx', 424: '26m_424.xlsx', 427: '26pm_427.xlsx' })[kind]);
    assert.ok(data.sources[0].notes.some(note => note.includes('真正性を検証した証明ではありません')));
    assert.equal(data.sources[0].fingerprint.algorithm, 'sha256');
    assert.equal(data.sources[0].reader.version, api.version);
  }
  await assert.rejects(parse(changed(402, sheet => { sheet.A1.v = '令和９年度全国学力・学習状況調査'; }), '26m_402.xlsx'), /対応年度/);
  await assert.rejects(parse(changed(402, sheet => { sheet.B3.v = '全国－生徒（国・公・私立）'; })), /見出し/);
  await assert.rejects(parse(changed(424, sheet => { sheet.I12.v = '国語（１６問）'; })), /見出し/);
});

test('402 preserves question-specific counts, rounded published percentages and missing-result categories', async () => {
  const { candidate: data } = await result(402), ordinary = reference(data, 'distribution'), random = reference(data, 'distribution', '18-1');
  assert.equal(ordinary.denominator.count.value, 10);
  assert.equal(random.denominator.count.value, 6, 'the workbook-wide 100 is not the random question denominator');
  assert.equal(random.values[0].value.value, 2); assert.equal(random.values[0].publishedPercent.value, 33.3);
  assert.equal(random.values[0].publishedPercent.decimals, 1);
  assert.equal(random.denominator.count.provenance.derivation, 'sum');
  assert.equal(random.denominator.count.provenance.range, 'G80:AB80');
  assert.equal(random.values[0].publishedPercent.provenance.range, 'G81');
  assert.equal(random.values[0].publishedPercent.provenance.raw, 33.3);
  assert.equal(instrument(data).definitionStatus, 'codesOnly');
  assert.equal(instrument(data, '18-1').schoolAvailability, 'notReturned');
  assert.equal(data.instruments.filter(i => i.schoolAvailability === 'notReturned').length, 52);
  assert.deepEqual(instrument(data).locations.map(loc => loc.range), ['B12:C12', 'G10:AB11']);
  assert.equal(instrument(data).options.find(o => o.code === 'other').responseStatus, 'unknown');
  assert.equal(instrument(data).options.find(o => o.code === 'noResponse').responseStatus, 'noResponse');
  assert.ok(random.notes.some(note => note.includes('ランダム')));
});

test('424 retains conditional means and actual quartile tables without using the common N for a subject mean', async () => {
  const { candidate: data } = await result(424), distribution = reference(data, 'distribution');
  assert.equal(distribution.denominator.count.value, 20);
  const mean = reference(data, 'conditionalMean', '1', 'japanese');
  assert.equal(mean.values[0].mean.value, 68); assert.equal(mean.values[0].count.status, 'notProvided');
  assert.equal(mean.denominator.count.value, null); assert.equal(mean.total.mean.value, 55);
  assert.equal(mean.values[2].mean.status, 'notProvided'); assert.equal(mean.values[2].mean.provenance.raw, '－');
  const english = reference(data, 'conditionalMean', '1', 'english'), subject = data.instruments.find(i => i.id === english.subjectInstrumentId);
  assert.equal(subject.scale.kind, 'irtScore'); assert.deepEqual(subject.skills, ['listening', 'reading', 'writing']);
  assert.equal(subject.formId, 'nier:2026:lowerSecondary:english:3skills:main');
  assert.equal(subject.scale.version, 'nier:2026:lowerSecondary:english:3skills:scale');
  assert.equal(data.instruments.find(i => i.id === mean.subjectInstrumentId).rawScoreMaximum, 15);
  assert.equal(english.values[0].mean.value, 515);
  const cross = reference(data, 'crossTab', '1', 'japanese');
  assert.equal(cross.denominator.count.value, 16); assert.equal(cross.normalization, 'column');
  assert.equal(cross.groups[0].count.value, 4); assert.equal(cross.groups[0].publishedPercent.value, 25);
  assert.equal(cross.rows[0].count.value, 8); assert.equal(cross.rows[0].publishedPercent.value, 50);
  assert.equal(cross.rows[0].values[0].value.value, 4); assert.equal(cross.rows[0].values[0].publishedPercent.value, 100);
  assert.equal(cross.rows[0].values[0].value.provenance.range, 'E37');
  assert.equal(cross.rows[0].values[0].publishedPercent.provenance.range, 'E38');
  assert.equal(cross.grouping.bands, null); assert.equal(cross.grouping.definitionId, null);
  assert.equal(data.references.filter(r => r.type === 'crossTab' && data.instruments.find(i => i.id === r.subjectInstrumentId).subject === 'english').length, 0);
});

test('427 preserves elementary and middle means with ambiguous observation unit explicitly unknown', async () => {
  const { candidate: data, warnings } = await result(427);
  assert.ok(instrument(data, '1', 'elementary')); assert.ok(instrument(data, '1', 'lowerSecondary'));
  assert.equal(instrument(data, '1', 'elementary').grade, 6); assert.equal(instrument(data, '1').grade, 3);
  assert.ok(data.references.every(r => r.observationUnit === 'unknown' && r.denominator.basis === 'unknown' && r.denominator.count.status === 'notProvided'));
  assert.equal(reference(data, 'conditionalMean', '1', 'english').values[0].mean.value, 515);
  assert.ok(data.instruments.filter(i => i.kind === 'subject').every(i => i.formId === null && i.scale.version === null));
  assert.ok(warnings.some(w => w.code === 'observationUnitUnknown'));
  assert.ok(reference(data, 'conditionalMean').notes.some(note => note.includes('全国－学校')));
});

test('a multi-file candidate enriches exact definitions without copying population or statistics and is immutable', async () => {
  const files = [402, 424, 427].map(kind => ({ bytes: buffer(kind), fileName: 'fictional-' + kind + '.xlsx' }));
  const actual = await api.parseOfficialFiles(files, { XLSX, importedAt });
  assert.equal(actual.definitionMatches.length, 131);
  const publicSource = actual.candidate.sources.find(s => s.reader.id === 'nier-2026-distribution');
  const question = actual.candidate.instruments.find(i => i.sourceIds[0] === publicSource.id && i.code === '1');
  assert.equal(question.definitionStatus, 'complete'); assert.equal(question.options[0].label, f.optionLabels[0]);
  assert.ok(question.sourceIds.length > 1);
  const distribution = actual.candidate.references.find(r => r.instrumentId === question.id);
  assert.equal(distribution.ownership, 'public'); assert.equal(distribution.denominator.count.value, 10);
  assert.equal(distribution.values[0].value.value, 3); assert.equal(distribution.values[0].publishedPercent.value, 30);
  assert.equal(distribution.values[0].value.provenance.sourceId, publicSource.id);
  assert.deepEqual(core.validate(actual.candidate), []);
  assert.ok(Object.isFrozen(actual)); assert.ok(Object.isFrozen(distribution.values[0].value.provenance));
  assert.throws(() => { distribution.values[0].value.value = 123; }, TypeError);
  assert.throws(() => { actual.candidate.sources.push({}); }, TypeError);
  await assert.rejects(api.parseOfficialFiles([{ bytes: buffer(402) }, { bytes: buffer(402) }], { XLSX, importedAt }), /同じ内容/);
});

test('similar question text and conflicting option definitions do not enrich a codes-only question', async () => {
  const differentText = changed(424, sheet => { sheet.D8.v += '（別の質問）'; });
  const actual = await api.parseOfficialFiles([{ bytes: buffer(402) }, { bytes: differentText }], { XLSX, importedAt });
  assert.equal(actual.definitionMatches.length, 130);
  const publicSource = actual.candidate.sources.find(s => s.reader.id === 'nier-2026-distribution');
  assert.equal(actual.candidate.instruments.find(i => i.sourceIds[0] === publicSource.id && i.code === '1').definitionStatus, 'codesOnly');
  const conflicting = changed(427, sheet => { sheet.L7.v = '別の架空選択肢'; });
  const conflict = await api.parseOfficialFiles([{ bytes: buffer(402) }, { bytes: buffer(424) }, { bytes: conflicting }], { XLSX, importedAt });
  assert.ok(conflict.warnings.some(w => w.code === 'definitionConflict'));
  assert.equal(conflict.definitionMatches.length, 130);
});

test('formulas, errors, non-finite values and changed precision are not trusted as published statistics', async () => {
  for (const change of [
    sheet => { sheet.G12.f = '1+2'; },
    sheet => { sheet.G12 = { t: 'e', v: 7 }; },
    sheet => { sheet.G12 = { t: 'b', v: true }; },
    sheet => { sheet.G13.z = '0.00'; },
    sheet => { sheet.G13.z = '0.0%'; },
    sheet => { sheet.G13.v = 50; },
    sheet => { sheet.G13.v = 30.1; },
    sheet => { sheet.G12.v = -1; },
  ]) await assert.rejects(parse(changed(402, change)), /数式|エラー|有限|数値|精度|割合/);
  const wb = f.make402(); wb.Sheets[wb.SheetNames[0]].G12.v = Infinity;
  assert.throws(() => api.validateWorkbook(wb, XLSX), /有限/);
  const emptyFormula = f.make402(); emptyFormula.Sheets[emptyFormula.SheetNames[0]].G12.f = '';
  assert.throws(() => api.validateWorkbook(emptyFormula, XLSX), /数式/);
});

test('clipped workbooks, duplicate primary sheets, missing questions and unexplained cells fail atomically', async () => {
  for (const [kind, change] of [
    [402, (sheet, wb) => XLSX.utils.book_append_sheet(wb, sheet, '架空の重複')],
    [402, sheet => { delete sheet.B12; }],
    [402, sheet => { sheet.A20 = { t: 's', v: '未対応の別表' }; }],
    [402, sheet => { sheet.B5.v = 'ランダム方式ですが範囲指定を削除しました。回答対象とされた設問'; }],
    [424, (sheet, wb) => { delete wb.Sheets[wb.SheetNames.pop()]; }],
    [424, (sheet, wb) => { wb.Sheets[wb.SheetNames[1]].B8.v = '(1)'; }],
    [424, sheet => { sheet.B5.v = sheet.B5.v.replace('生徒質問調査を実施した生徒', '生徒質問調査を実施した生徒を除く生徒'); }],
    [424, sheet => { sheet.B75.v = sheet.B75.v.replace('上位の層に含む', '下位の層に含む'); }],
    [424, sheet => { sheet.E37.v += 1; }],
    [427, sheet => { sheet.B7.v = '(999)'; }],
  ]) await assert.rejects(parse(changed(kind, change)), /取込は反映していません/);
  const wb = f.make402(), sheet = wb.Sheets[wb.SheetNames[0]];
  sheet['!fullref'] = 'A1:AC999999'; assert.throws(() => api.validateWorkbook(wb, XLSX), /上限/);
  delete sheet['!fullref']; sheet.XFD1 = { t: 's', v: '架空' }; assert.throws(() => api.validateWorkbook(wb, XLSX), /上限/);
});

test('dedicated capacity checks run before reading, decoding or changing a caller dataset', async () => {
  let read = false, decoded = false;
  await assert.rejects(api.parseOfficialWorkbook({ size: api.limits.fileBytes + 1, arrayBuffer() { read = true; } }, {}, { XLSX: { ...XLSX, read() { decoded = true; } } }), /上限/);
  assert.equal(read, false); assert.equal(decoded, false);
  assert.equal(api.limits.sheets, 200); assert.ok(api.limits.entries > 403);
  const existing = { tests: [{ id: 'fictional-test', score: 0 }], surveys: core.empty() }, before = JSON.stringify(existing);
  await assert.rejects(api.parseOfficialFiles([{ bytes: buffer(402) }, { bytes: Buffer.from('fictional invalid XLSX') }], { XLSX, importedAt }), /上限|XLSX/);
  assert.equal(JSON.stringify(existing), before);
  const schoolBudgets = { ...api.limits, sheets: 32 };
  assert.throws(() => api.validateWorkbook(f.make424(), XLSX, schoolBudgets), /上限/);
  api.validateWorkbook(f.make424(), XLSX);
});

test('ZIP inspection detects corrupt CRC, forged expansion declarations, truncation and foreign packages', async () => {
  const original = buffer(402), central = original.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const local = original.readUInt32LE(central + 42);
  const wrongCRC = Buffer.from(original), wrongValue = (wrongCRC.readUInt32LE(central + 16) ^ 1) >>> 0;
  wrongCRC.writeUInt32LE(wrongValue, central + 16); wrongCRC.writeUInt32LE(wrongValue, local + 14);
  await assert.rejects(api.inspectZip(wrongCRC), /CRC/);
  const forged = Buffer.from(original); forged.writeUInt32LE(1, central + 24); forged.writeUInt32LE(1, local + 22);
  await assert.rejects(api.inspectZip(forged), /展開量|上限|破損/);
  const declaredHuge = Buffer.from(original); declaredHuge.writeUInt32LE(api.limits.entryBytes + 1, central + 24);
  await assert.rejects(api.inspectZip(declaredHuge), /上限/);
  await assert.rejects(api.inspectZip(original.subarray(0, -1)), /上限/);
  const macro = Buffer.from(original), from = Buffer.from('xl/workbook.xml'), to = Buffer.from('xl/vbaProject.x');
  for (let pos = macro.indexOf(from); pos >= 0; pos = macro.indexOf(from, pos + from.length)) to.copy(macro, pos);
  await assert.rejects(api.inspectZip(macro), /マクロ|不正/);
  const inspection = await api.inspectZip(buffer(424));
  assert.ok(inspection.entries > 131); assert.ok(inspection.expandedBytes > 0);
});
