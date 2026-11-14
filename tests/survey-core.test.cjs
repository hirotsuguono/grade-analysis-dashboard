'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const root = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const core = require(path.join(root, 'survey-core.js'));
const clone = v => JSON.parse(JSON.stringify(v));
const observed = (value, decimals = 0) => ({ value, status: 'observed', decimals });
const missing = (status = 'notProvided') => ({ value: null, status, decimals: null });
const selection = { waveId: 'wave-1', resultId: 'school-1', referenceId: 'reference-1' };

// Entirely fictional metadata and aggregates. No official workbook is emulated.
function fixture() {
  const data = core.empty();
  const source = { id: 'source-official', kind: 'official', title: '架空の比較用資料', publisher: '架空の発行元',
    url: null, fileName: null, importedAt: '2026-05-01T00:00:00.000Z', fingerprint: null, reader: null, locations: [], notes: [] };
  data.sources.push(source, { ...source, id: 'source-school', kind: 'schoolAggregate', title: '架空の自校集計' });
  data.instruments.push({ id: 'question-1', version: 1, year: 2026, schoolLevel: 'lowerSecondary', grade: 3,
    respondent: 'student', kind: 'question', code: 'fictional-Q1', text: '架空の選択質問です。',
    options: [{ code: 'a', label: '選択肢A', responseStatus: 'answered' }, { code: 'b', label: '選択肢B', responseStatus: 'answered' }],
    subject: null, skills: [], formId: null,
    scale: { kind: 'response', unit: 'category', version: null, minimum: null, maximum: null, step: null, bands: [] } });
  const reference = { id: 'reference-1', version: 1, instrumentId: 'question-1', sourceId: 'source-official', type: 'distribution',
    observationUnit: 'student', geography: { level: 'national', code: 'fictional-country', label: '架空の全国' }, ownership: 'public',
    population: { participation: 'question', definition: '当該質問の調査参加者' },
    denominator: { basis: 'questionParticipants', definition: '当該質問の調査参加者数', count: observed(1000) },
    notes: [], basis: 'percent', partition: true, values: [{ code: 'a', value: observed(40, 1) }, { code: 'b', value: observed(60, 1) }] };
  data.references.push(reference);
  const school = { ...clone(reference), id: 'school-1', sourceId: 'source-school', revision: 1, supersedes: null,
    geography: { level: 'school', code: 'fictional-school', label: '架空の自校' },
    denominator: { ...reference.denominator, count: observed(10) }, basis: 'count',
    values: [{ code: 'a', value: observed(0) }, { code: 'b', value: observed(10) }] };
  delete school.version;
  data.waves.push({ id: 'wave-1', label: '架空の実施回', administeredOn: '2026-04-20', administration: 'official',
    instrumentIds: ['question-1'], referenceIds: ['reference-1'], results: [school] });
  return data;
}
function splitInstrument(data) {
  const instrument = { ...clone(data.instruments[0]), id: 'reference-definition' };
  data.instruments.push(instrument);
  data.references[0].instrumentId = instrument.id;
  return instrument;
}
function summaryFixture(scale = 'irtScore') {
  const data = fixture(), instrument = data.instruments[0];
  Object.assign(instrument, { kind: 'subject', code: 'fictional-english', text: '架空の英語試験', options: [], subject: 'english',
    skills: ['listening', 'reading', 'writing'], formId: 'fictional-form-2026',
    scale: { kind: scale, unit: scale === 'percentCorrect' ? 'percent' : scale === 'rawScore' ? 'points' : 'irtScore',
      version: 'fictional-scale-1', minimum: scale === 'irtScore' ? null : 0, maximum: scale === 'irtScore' ? null : 100, step: null, bands: [] } });
  for (const stat of [data.references[0], data.waves[0].results[0]]) {
    stat.type = 'summary'; stat.mean = observed(scale === 'irtScore' ? 501.2 : 50.2, 1); stat.standardDeviation = missing();
    stat.population = { participation: 'subject', definition: '当該教科の調査参加者' };
    stat.denominator.basis = 'subjectParticipants'; stat.denominator.definition = '当該教科の調査参加者数';
    delete stat.basis; delete stat.partition; delete stat.values;
  }
  data.waves[0].results[0].mean.value += 5;
  return data;
}
function bandFixture() {
  const data = summaryFixture(), instrument = data.instruments[0];
  instrument.scale = { kind: 'irtBand', unit: 'category', version: 'fictional-bands-1', minimum: null, maximum: null, step: null,
    bands: [{ code: 'low', label: '架空バンド低', lower: null, upper: 500, lowerInclusive: false, upperInclusive: false },
      { code: 'high', label: '架空バンド高', lower: 500, upper: null, lowerInclusive: true, upperInclusive: false }] };
  for (const stat of [data.references[0], data.waves[0].results[0]]) {
    stat.type = 'distribution'; stat.basis = 'percent'; stat.partition = true;
    stat.values = [{ code: 'low', value: observed(50, 1) }, { code: 'high', value: observed(50, 1) }];
    delete stat.mean; delete stat.standardDeviation;
  }
  return data;
}
const school = d => d.waves[0].results[0];
function pairedFixture(type = 'conditionalMean', knownBands = false) {
  const data = fixture(), subject = clone(summaryFixture('percentCorrect').instruments[0]);
  subject.id = 'subject-axis'; data.instruments.push(subject); data.waves[0].instrumentIds.push(subject.id);
  for (const stat of [data.references[0], school(data)]) {
    stat.type = type; stat.subjectInstrumentId = subject.id;
    stat.population = { participation: 'joint', definition: '質問と当該教科の有効な組' };
    stat.denominator = { basis: 'jointParticipants', definition: '質問と当該教科の有効な組数', count: type === 'crossTab' ? observed(8) : missing() };
    delete stat.basis; delete stat.partition; delete stat.values;
    if (type === 'conditionalMean') {
      stat.values = [{ code: 'a', count: missing(), mean: observed(40, 1), standardDeviation: missing() }, { code: 'b', count: missing(), mean: observed(60, 1), standardDeviation: missing() }];
    } else {
      stat.basis = 'count'; stat.normalization = 'column';
      stat.grouping = { kind: 'quartile', scope: 'national', definitionId: 'fictional-quartile-definition', bands: knownBands ? [
        { code: 'A', label: '架空層A', lower: null, upper: 25, lowerInclusive: false, upperInclusive: false },
        { code: 'B', label: '架空層B', lower: 25, upper: 50, lowerInclusive: true, upperInclusive: false },
        { code: 'C', label: '架空層C', lower: 50, upper: 75, lowerInclusive: true, upperInclusive: false },
        { code: 'D', label: '架空層D', lower: 75, upper: null, lowerInclusive: true, upperInclusive: false },
      ] : null };
      stat.groups = ['A', 'B', 'C', 'D'].map(code => ({ code, label: '架空層' + code, count: observed(2), publishedPercent: observed(25, 1) }));
      stat.rows = ['a', 'b'].map(code => ({ code, count: observed(4), publishedPercent: observed(50, 1), values: stat.groups.map(g => ({ code: g.code, value: observed(1), publishedPercent: observed(50, 1) })) }));
    }
  }
  return data;
}
function valid(data) { assert.deepEqual(core.validate(data), []); }
function invalid(edit, pattern = /./, create = fixture) {
  const data = create(); edit(data);
  const errors = core.validate(data);
  assert.ok(errors.length, 'expected validation error');
  assert.match(errors.join('\n'), pattern);
  assert.equal(core.compare(data, selection).status, 'blocked');
}
function decision(edit, expected, code, create = fixture) {
  const data = create(); edit(data); valid(data);
  const result = core.compare(data, selection);
  assert.equal(result.status, expected, JSON.stringify(result));
  assert.ok(result.reasons.some(r => r.code === code), JSON.stringify(result));
  assert.equal(result.differences, null);
  return result;
}

test('schema 1 empty objects are independent and usable in classic browsers and Node', () => {
  assert.deepEqual(core.empty(), { schemaVersion: 1, sources: [], instruments: [], references: [], waves: [] });
  valid(core.empty());
  const first = core.empty(); first.sources.push({}); assert.equal(core.empty().sources.length, 0);
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(root, 'survey-core.js'), 'utf8'), context);
  assert.equal(typeof context.window.GD_SURVEY.validate, 'function');
  assert.equal(context.window.GD_SURVEY.validate(fixture()).length, 0);
  assert.equal(context.window.GD_SURVEY.compare(fixture(), selection).status, 'comparable');
});
test('fictional nonempty storage round-trips, preserves published values, and never mutates its input', () => {
  const data = fixture(), before = JSON.stringify(data); valid(data); valid(clone(data));
  const result = core.compare(data, selection);
  assert.equal(result.status, 'comparable');
  assert.equal(result.differences.values[0].school, 0);
  assert.equal(result.differences.values[0].difference, -40);
  assert.equal(result.differences.unit, 'percentagePoint');
  assert.equal(JSON.stringify(data), before);
});
test('null, newer schemas, unknown fields and unsupported statistics fail closed', () => {
  for (const value of [null, undefined, [], {}, { ...core.empty(), schemaVersion: 2 }, { ...core.empty(), future: {} }]) assert.ok(core.validate(value).length);
  for (const type of ['individualResponses']) invalid(d => { d.references[0].type = type; }, /未対応/);
  invalid(d => { d.waves[0].individualResponses = []; }, /未対応/);
  invalid(d => { delete d.references[0].population.definition; }, /項目がありません/);
});
test('numeric cells distinguish zero from each missing state and reject coercion', () => {
  for (const status of core.statuses.filter(s => s !== 'observed')) {
    const data = fixture(); data.references[0].values[0].value = missing(status); valid(data);
    const result = core.compare(data, selection);
    assert.equal(result.status, 'comparable');
    assert.equal(result.differences.values[0].difference, null);
    assert.equal(result.differences.values[0].referenceStatus, status);
    assert.equal(result.differences.values[0].school, 0);
  }
  for (const value of ['', '0', null, true, Infinity, NaN, -1, 1.1]) invalid(d => { school(d).values[0].value.value = value; });
  invalid(d => { school(d).values[0].value.status = 'suppressed'; }, /欠測/);
  invalid(d => { d.references[0].values[0].value.value = 101; }, /割合|合計/);
  invalid(d => { d.references[0].values[0].value.decimals = -1; }, /整数/);
});
test('rounded percentages are retained without renormalization or inferred counts', () => {
  const data = fixture(), instrument = data.instruments[0];
  instrument.options.push({ code: 'c', label: '選択肢C', responseStatus: 'noResponse' });
  data.references[0].values = ['a', 'b', 'c'].map(code => ({ code, value: observed(33.3, 1) }));
  data.references[0].denominator.count = missing();
  school(data).values = [{ code: 'a', value: observed(0) }, { code: 'b', value: observed(10) }, { code: 'c', value: observed(0) }];
  const before = JSON.stringify(data); valid(data);
  const result = core.compare(data, selection);
  assert.equal(result.status, 'comparable');
  assert.deepEqual(result.differences.values.map(v => v.reference), [33.3, 33.3, 33.3]);
  assert.equal(result.differences.values[0].difference, -33.3);
  assert.ok(result.notices.some(n => n.code === 'countUnavailable'));
  assert.equal(JSON.stringify(data), before);
});
test('published percentages take precedence over calculated ratios even with missing population counts', () => {
  const data = fixture(), reference = data.references[0]; reference.basis = 'count'; reference.denominator.count = observed(3);
  reference.values = [{ code: 'a', value: observed(1), publishedPercent: observed(33.3, 1) }, { code: 'b', value: observed(2), publishedPercent: observed(66.7, 1) }];
  valid(data); assert.equal(core.compare(data, selection).differences.values[0].reference, 33.3);
  reference.denominator.count = missing(); reference.values[0].value = missing('suppressed'); valid(data);
  const result = core.compare(data, selection);
  assert.equal(result.status, 'comparable'); assert.equal(result.differences.values[0].reference, 33.3);
  assert.equal(result.differences.values[0].referenceStatus, 'observed');
  reference.values[0].publishedPercent.value = 100;
  assert.match(core.validate(data).join('\n'), /割合合計/);
});
test('codes-only questions and unknown observation units remain reference information', () => {
  decision(d => { const reference = splitInstrument(d); reference.definitionStatus = 'codesOnly'; reference.options[0].label = 'コードAのみ'; }, 'referenceOnly', 'definitionIncomplete');
  decision(d => { d.references[0].observationUnit = 'unknown'; }, 'referenceOnly', 'observationUnitUnknown');
});
test('conditional means retain per-subject paired counts and validate both question and score axes', () => {
  const data = pairedFixture(); school(data).values[0].mean.value = 0; school(data).values[0].count = observed(3); school(data).values[1].count = observed(7); school(data).denominator.count = observed(10);
  valid(data);
  const result = core.compare(data, selection);
  assert.equal(result.status, 'comparable'); assert.equal(result.differences.type, 'conditionalMean');
  assert.equal(result.differences.values[0].difference, -40); assert.equal(result.differences.unit, 'percentagePoint');
  const alternate = { ...clone(data.instruments[1]), id: 'other-subject', skills: ['listening', 'reading', 'writing', 'speaking'] };
  data.instruments.push(alternate); data.references[0].subjectInstrumentId = alternate.id; valid(data);
  assert.equal(core.compare(data, selection).status, 'blocked');
  invalid(d => { d.references[0].values[0].count = observed(0); }, /0人/, pairedFixture);
  invalid(d => { d.references[0].values[0].code = 'not-a-choice'; }, /条件|選択肢/, pairedFixture);
  invalid(d => { school(d).denominator.count = observed(1); school(d).values.forEach(v => { v.count = observed(1); }); }, /合計/, pairedFixture);
});
test('quartile cross tables preserve both margins and use explicit normalization and boundaries', () => {
  const unknown = pairedFixture('crossTab'); valid(unknown);
  const referenceOnly = core.compare(unknown, selection); assert.equal(referenceOnly.status, 'referenceOnly');
  assert.ok(referenceOnly.reasons.some(r => r.code === 'groupThresholdsUnknown'));
  const data = pairedFixture('crossTab', true), local = school(data);
  local.rows[0].values[0].value = observed(0); local.rows[0].values[0].publishedPercent = observed(0, 1);
  local.rows[1].values[0].value = observed(2); local.rows[1].values[0].publishedPercent = observed(100, 1);
  local.rows[0].count = observed(3); local.rows[0].publishedPercent = observed(37.5, 1);
  local.rows[1].count = observed(5); local.rows[1].publishedPercent = observed(62.5, 1); valid(data);
  const result = core.compare(data, selection); assert.equal(result.status, 'comparable');
  assert.equal(result.differences.rows[0].values[0].difference, -50); assert.equal(result.differences.normalization, 'column');
  const ownQuartiles = pairedFixture('crossTab', true); school(ownQuartiles).grouping.scope = 'school'; valid(ownQuartiles);
  assert.equal(core.compare(ownQuartiles, selection).status, 'blocked');
  for (const normalization of ['row', 'total']) {
    const other = pairedFixture('crossTab', true); school(other).normalization = normalization;
    school(other).rows.forEach(row => row.values.forEach(v => { v.publishedPercent = observed(normalization === 'row' ? 25 : 12.5, 1); }));
    valid(other); assert.equal(core.compare(other, selection).status, 'blocked');
  }
  invalid(d => { school(d).rows[0].values[0].value = observed(2); }, /合計|公表割合/, () => pairedFixture('crossTab', true));
  invalid(d => { d.references[0].grouping.bands[1].lower = 20; }, /重なり|空白/, () => pairedFixture('crossTab', true));
});
test('source cells and question definitions preserve bounded lineage and raw missing markers', () => {
  const data = fixture(); data.instruments[0].locations = [{ sourceId: 'source-official', sheet: '架空', range: 'A1:B2' }];
  data.instruments[0].schoolAvailability = 'notReturned'; data.instruments[0].sourceIds = ['source-official'];
  data.references[0].values[0].value = { ...missing(), provenance: { sourceId: 'source-official', sheet: '架空', range: 'B2', raw: '－', derivation: 'literal' } };
  valid(data); valid(clone(data));
  data.references[0].values[0].value.provenance.range = "=HYPERLINK(\"x\")";
  assert.match(core.validate(data).join('\n'), /A1/);
  invalid(d => { d.instruments[0].locations = [{ sourceId: 'absent', sheet: '架空', range: 'A1' }]; }, /出典/);
});
test('geography and sample sizes may differ; ownership remains an explicit population axis', () => {
  const data = fixture(); data.references[0].geography = { level: 'prefecture', code: 'fictional-region', label: '架空の地域' };
  valid(data); assert.equal(core.compare(data, selection).status, 'comparable');
  decision(d => { d.references[0].ownership = 'all'; }, 'referenceOnly', 'ownershipMismatch');
  decision(d => { d.references[0].ownership = 'unknown'; }, 'referenceOnly', 'ownershipUnknown');
  decision(d => { d.references[0].geography.level = 'unknown'; }, 'referenceOnly', 'geographyUnknown');
});
test('known definitions with unpublished counts allow descriptive means and percentages', () => {
  for (const create of [fixture, summaryFixture]) {
    const data = create(); data.references[0].denominator.count = missing('suppressed'); valid(data);
    assert.equal(core.compare(data, selection).status, 'comparable');
  }
  decision(d => { school(d).denominator.count = missing(); }, 'referenceOnly', 'countDenominatorUnavailable');
  decision(d => { d.references[0].denominator.definition = null; }, 'referenceOnly', 'denominatorUnknown');
  decision(d => { d.references[0].denominator.basis = 'unknown'; }, 'referenceOnly', 'denominatorBasisUnknown');
  decision(d => { d.references[0].denominator.basis = 'jointParticipants'; }, 'blocked', 'denominatorBasisMismatch');
  decision(d => { d.references[0].population.participation = 'joint'; }, 'blocked', 'participationMismatch');
  decision(d => { d.references[0].population.definition = '別の抽出条件'; }, 'blocked', 'populationMismatch');
});
test('definition, year, grade and respondent mismatches do not produce differences', () => {
  for (const [key, value, reason] of [['year', 2025, 'yearMismatch'], ['grade', 2, 'gradeMismatch'],
    ['schoolLevel', 'elementary', 'schoolLevelMismatch'], ['code', 'fictional-Q2', 'instrumentCodeMismatch'],
    ['text', '似ている別の設問原文です。', 'instrumentTextMismatch']]) {
    decision(d => { splitInstrument(d)[key] = value; }, 'blocked', reason);
  }
  decision(d => { splitInstrument(d).year = null; }, 'referenceOnly', 'yearUnknown');
  decision(d => { splitInstrument(d).options[0].label = '異なる選択肢'; }, 'blocked', 'optionsMismatch');
  decision(d => { splitInstrument(d).respondent = 'school'; d.references[0].observationUnit = 'school'; }, 'blocked', 'observationUnitMismatch');
  decision(d => { d.waves[0].administration = 'local'; }, 'referenceOnly', 'localAdministration');
  const data = fixture(); data.waves[0].administeredOn = '2027-02-28'; valid(data);
  assert.equal(core.compare(data, selection).status, 'comparable', 'administration date is not a replacement for source year');
});
test('a single-school answer is contextual information, never a 100 percent comparison', () => {
  decision(d => {
    d.instruments[0].respondent = 'school';
    for (const s of [school(d), d.references[0]]) s.observationUnit = 'school';
    school(d).denominator.count = observed(1); school(d).values[1].value = observed(1);
  }, 'referenceOnly', 'singleSchoolResponse');
});
test('count totals and category identity are validated without hiding missing cells', () => {
  invalid(d => { school(d).values[0].value = observed(1); }, /合計/);
  invalid(d => { school(d).values[1].value = observed(11); }, /分母/);
  invalid(d => { school(d).values.pop(); }, /全選択肢/);
  invalid(d => { school(d).values[1].code = 'a'; }, /重複|全選択肢/);
  invalid(d => { d.references[0].values[0].value = observed(70, 1); }, /合計/);
  invalid(d => { d.references[0].values.forEach(v => { v.value = observed(100, null); }); }, /合計/);
  invalid(d => { d.references[0].values.forEach(v => { v.value = observed(0, null); }); }, /合計/);
  const unknownPrecision = fixture(); unknownPrecision.references[0].values[0].value.decimals = null; valid(unknownPrecision);
  const partial = fixture(); school(partial).values[1].value = missing('unentered'); valid(partial);
  assert.equal(core.compare(partial, selection).differences.values[1].difference, null);
  decision(d => { school(d).values.forEach(v => { v.value = observed(0); }); school(d).denominator.count = observed(0); }, 'referenceOnly', 'emptyDenominator');
  invalid(d => { d.references[0].denominator.count = observed(0); }, /0人/);
  decision(d => { for (const r of d.references[0].values) r.value = missing(); }, 'referenceOnly', 'valuesUnavailable');
});
test('IRT means are independent real-valued statistics, with form, skill and scale checks', () => {
  for (const scale of ['percentCorrect', 'rawScore', 'irtScore']) {
    const data = summaryFixture(scale); valid(data);
    const result = core.compare(data, selection); assert.equal(result.status, 'comparable');
    assert.equal(result.differences.difference, 5);
    assert.equal(result.differences.unit, scale === 'percentCorrect' ? 'percentagePoint' : scale === 'rawScore' ? 'points' : 'irtScore');
  }
  decision(d => { splitInstrument(d).skills.push('speaking'); }, 'blocked', 'skillsMismatch', summaryFixture);
  decision(d => { splitInstrument(d).formId = 'fictional-other-form'; }, 'blocked', 'formMismatch', summaryFixture);
  decision(d => { splitInstrument(d).scale.version = 'fictional-scale-2'; }, 'blocked', 'scaleVersionMismatch', summaryFixture);
  decision(d => { splitInstrument(d).formId = null; }, 'referenceOnly', 'formUnknown', summaryFixture);
  decision(d => { school(d).mean = missing('suppressed'); }, 'referenceOnly', 'meanUnavailable', summaryFixture);
  invalid(d => { school(d).standardDeviation = observed(-1); }, /標準偏差/, summaryFixture);
  invalid(d => { school(d).denominator.count = observed(0); }, /0人/, summaryFixture);
  invalid(d => { school(d).mean = observed(101); }, /範囲外|割合/, () => summaryFixture('percentCorrect'));
  decision(d => { school(d).mean = observed(Number.MAX_VALUE); d.references[0].mean = observed(-Number.MAX_VALUE); },
    'referenceOnly', 'numericRange', summaryFixture);
});
test('skill order and object property insertion order cannot change equivalence', () => {
  const data = summaryFixture(), other = splitInstrument(data); other.skills.reverse(); valid(data);
  assert.equal(core.compare(data, selection).status, 'comparable');
  const categorical = fixture(); splitInstrument(categorical).options.reverse(); valid(categorical);
  assert.equal(core.compare(categorical, selection).status, 'comparable');
});
test('IRT bands retain their boundaries and do not imply an IRT mean', () => {
  valid(bandFixture()); assert.equal(core.compare(bandFixture(), selection).status, 'comparable');
  decision(d => { const s = splitInstrument(d).scale; s.bands[0].upper = s.bands[1].lower = 501; }, 'blocked', 'bandsMismatch', bandFixture);
  decision(d => { const s = splitInstrument(d).scale; s.bands[0].upperInclusive = true; s.bands[1].lowerInclusive = false; }, 'blocked', 'bandsMismatch', bandFixture);
  invalid(d => { d.instruments[0].scale.bands[1].lowerInclusive = false; }, /重なり|空白/, bandFixture);
  invalid(d => { const s = school(d); s.type = 'summary'; s.mean = observed(500); s.standardDeviation = missing(); delete s.basis; delete s.partition; delete s.values; }, /平均/, bandFixture);
});
test('discrete IRT bands preserve inclusive integer endpoints without assuming real continuity', () => {
  function discreteFixture() {
    const data = bandFixture(), scale = data.instruments[0].scale;
    scale.step = 1;
    scale.bands[0].upper = 499; scale.bands[0].upperInclusive = true;
    return data;
  }
  const data = discreteFixture(); valid(data);
  assert.equal(core.compare(data, selection).status, 'comparable');
  invalid(d => { d.instruments[0].scale.step = null; }, /重なり|空白/, discreteFixture);
  invalid(d => { d.instruments[0].scale.bands[1].lower = 501; }, /重なり|空白/, discreteFixture);
  invalid(d => { d.instruments[0].scale.bands[1].lower = 499; }, /重なり|空白/, discreteFixture);
  invalid(d => { d.instruments[0].scale.bands[1].lower = 499.5; }, /刻み幅/, discreteFixture);
  invalid(d => { d.instruments[0].scale.step = 0; }, /刻み幅/, discreteFixture);
  invalid(d => { const s = d.instruments[0].scale; s.step = 1e-12; s.bands[0].upperInclusive = true; }, /重なり|空白/, bandFixture);
  decision(d => { splitInstrument(d).scale.step = 0.5; }, 'blocked', 'scaleStepMismatch', bandFixture);
  const fractionalMean = summaryFixture(); fractionalMean.instruments[0].scale.step = 1; valid(fractionalMean);
  assert.equal(core.compare(fractionalMean, selection).status, 'comparable', 'a mean need not be on the individual-score lattice');
});
test('source identities, definitions, fixed selections and result history have valid references', () => {
  invalid(d => { d.sources.push(clone(d.sources[0])); }, /重複/);
  invalid(d => { school(d).sourceId = 'absent'; }, /出典/);
  invalid(d => { school(d).sourceId = 'source-official'; }, /区分/);
  invalid(d => { d.references[0].instrumentId = 'absent'; }, /参照先/);
  invalid(d => { d.waves[0].referenceIds = ['absent']; }, /比較対象/);
  invalid(d => { d.waves[0].instrumentIds = []; }, /固定/);
  invalid(d => { school(d).revision = 2; }, /最初/);
  invalid(d => { school(d).supersedes = 'school-1'; }, /直前/);
  const data = fixture(), next = { ...clone(school(data)), id: 'school-2', revision: 2, supersedes: 'school-1' };
  next.values = [{ code: 'a', value: observed(1) }, { code: 'b', value: observed(9) }];
  data.waves[0].results.push(next); valid(data); valid(clone(data));
  assert.equal(core.compare(data, { ...selection, resultId: 'school-2' }).differences.values[0].difference, -30);
  assert.equal(school(data).values[0].value.value, 0);
  const secondWave = clone(data.waves[0]); secondWave.id = 'wave-2'; data.waves.push(secondWave); valid(data);
  data.waves[0].results.push({ ...clone(next), id: 'school-3' });
  assert.match(core.validate(data).join('\n'), /複数/);
  invalid(d => { d.waves[0].results.push({ ...clone(school(d)), id: 'duplicate-active' }); }, /複数の採用結果/);
  const selected = fixture(); selected.waves[0].referenceIds = []; valid(selected);
  assert.equal(core.compare(selected, selection).status, 'blocked');
});
test('source metadata retains provenance without accepting non-JSON or executable values', () => {
  const data = fixture(); Object.assign(data.sources[0], { url: 'https://example.invalid/fictional', fileName: 'fictional.xlsx',
    fingerprint: { algorithm: 'sha256', value: '0'.repeat(64) }, reader: { id: 'fictional-reader', version: 'test-only' },
    locations: [{ sheet: '架空資料', range: 'A1:D8' }], notes: ['指紋は真正性の証明ではありません。'] }); valid(data);
  invalid(d => { d.sources[0].url = 'javascript:alert(1)'; }, /http/);
  invalid(d => { d.sources[0].importedAt = '2026-02-30T00:00:00.000Z'; }, /日時/);
  invalid(d => { d.waves[0].administeredOn = '2026-02-30'; }, /実施日/);
  invalid(d => { d.sources[0].fingerprint = { algorithm: 'sha256', value: 'made-up' }; }, /SHA-256/);
  let accessed = false; const getter = core.empty();
  Object.defineProperty(getter, 'evil', { enumerable: true, get() { accessed = true; return 1; } });
  assert.ok(core.validate(getter).length); assert.equal(accessed, false);
  const cyclic = core.empty(); cyclic.extra = cyclic; assert.match(core.validate(cyclic).join('\n'), /循環/);
  const dangerous = JSON.parse('{"schemaVersion":1,"sources":[],"instruments":[],"references":[],"waves":[],"__proto__":{}}');
  assert.match(core.validate(dangerous).join('\n'), /プロパティ/);
  const sparse = core.empty(); sparse.sources = Array(1); assert.match(core.validate(sparse).join('\n'), /空き要素/);
  invalid(d => { d.sources[0].importedAt = new Date(); }, /JSON/);
});
test('JSON-representable hostile scalar types return errors instead of escaping validation', () => {
  const paths = [
    ['references', 0, 'values', 0, 'value', 'value'], ['references', 0, 'values', 0, 'value', 'decimals'],
    ['references', 0, 'denominator', 'count', 'value'], ['instruments', 0, 'scale', 'kind'],
    ['instruments', 0, 'scale', 'minimum'], ['instruments', 0, 'scale', 'maximum'], ['instruments', 0, 'scale', 'step'],
    ['instruments', 0, 'year'], ['waves', 0, 'results', 0, 'instrumentId'], ['waves', 0, 'results', 0, 'revision'],
    ['waves', 0, 'results', 0, 'supersedes'],
  ];
  for (const location of paths) {
    const data = fixture(), parent = location.slice(0, -1).reduce((v, key) => v[key], data);
    parent[location.at(-1)] = { toString: 0, valueOf: 0 };
    const persisted = clone(data);
    assert.doesNotThrow(() => core.validate(persisted), location.join('.'));
    assert.ok(core.validate(persisted).length, location.join('.'));
    assert.equal(core.compare(persisted, selection).status, 'blocked');
  }
  for (const bound of ['lower', 'upper']) invalid(d => {
    d.instruments[0].scale.step = 1;
    d.instruments[0].scale.bands[1][bound] = { toString: 0, valueOf: 0 };
  }, /./, bandFixture);
});
test('custom prototypes cannot replace valid data through inherited toJSON hooks', () => {
  let called = false;
  const prototype = Object.create(null);
  prototype.toJSON = function () { called = true; return null; };
  const objectWithHook = Object.assign(Object.create(prototype), fixture());
  assert.ok(core.validate(objectWithHook).length); assert.equal(called, false);
  assert.equal(core.compare(objectWithHook, selection).status, 'blocked');
  const arrayWithHook = fixture(), arrayPrototype = Object.create(Array.prototype);
  arrayPrototype.toJSON = prototype.toJSON;
  Object.setPrototypeOf(arrayWithHook.references, arrayPrototype);
  assert.ok(core.validate(arrayWithHook).length); assert.equal(called, false);
  const nullPrototype = Object.assign(Object.create(null), fixture()); valid(nullPrototype); valid(clone(nullPrototype));
});
test('storage work is bounded before schema traversal and future fields cannot hide payloads', () => {
  const largeString = core.empty(); largeString.future = 'x'.repeat(core.limits.characters + 1);
  assert.match(core.validate(largeString).join('\n'), /上限/);
  const largeArray = core.empty(); largeArray.sources = Array(core.limits.array + 1).fill(null);
  assert.match(core.validate(largeArray).join('\n'), /上限/);
  const tooMany = core.empty(); tooMany.sources = Array(core.limits.sources + 1).fill({});
  assert.match(core.validate(tooMany).join('\n'), /件数/);
  const deep = core.empty(); let p = deep;
  for (let i = 0; i <= core.limits.depth; i++) p = p.child = {};
  assert.match(core.validate(deep).join('\n'), /階層/);
  const manyNodes = core.empty(); manyNodes.future = Array.from({ length: Math.ceil(core.limits.nodes / 2000) + 1 }, () => Array(2000).fill(0));
  assert.match(core.validate(manyNodes).join('\n'), /項目数/);
});
