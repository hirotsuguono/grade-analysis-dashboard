'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const core = require(path.join(root, 'survey-core.js'));
const state = require(path.join(root, 'survey-state.js'));
const importer = require(path.join(root, 'survey-import.js'));
const fictional = require('./survey-fixtures.cjs');
const clone = v => JSON.parse(JSON.stringify(v));
const observed = (value, decimals = 0) => ({ value, status: 'observed', decimals });
const missing = (status = 'notProvided') => ({ value: null, status, decimals: null });
function source(id, kind = 'schoolAggregate') {
  return { id, kind, title: '架空の資料', publisher: '架空の作成者', url: null, fileName: null,
    importedAt: '2026-05-01T00:00:00.000Z', fingerprint: null, reader: null, locations: [], notes: [] };
}
function references() {
  const data = core.empty(), official = source('official', 'official');
  official.fingerprint = { algorithm: 'sha256', value: '1'.repeat(64) }; data.sources.push(official);
  const question = { id: 'q1', version: 1, year: 2026, schoolLevel: 'lowerSecondary', grade: 3, respondent: 'student',
    kind: 'question', code: 'fictional-question-1', text: '架空の質問1です。', subject: null, skills: [], formId: null,
    options: [{ code: 'a', label: '架空の選択肢A', responseStatus: 'answered' }, { code: 'b', label: '架空の選択肢B', responseStatus: 'answered' }],
    scale: { kind: 'response', unit: 'category', version: null, minimum: null, maximum: null, step: null, bands: [] }, sourceIds: ['official'] };
  const subject = { ...clone(question), id: 'subject', kind: 'subject', code: 'fictional-subject', text: '架空の教科', subject: 'fictional', skills: ['knowledge'], formId: 'fictional-form', options: [], rawScoreMaximum: 5,
    scale: { kind: 'percentCorrect', unit: 'percent', version: 'fictional-scale', minimum: 0, maximum: 100, step: null, bands: [] } };
  data.instruments.push(question, { ...clone(question), id: 'q2', code: 'fictional-question-2', text: '架空の質問2です。' }, subject);
  const ref = { id: 'r1', version: 1, sourceId: 'official', instrumentId: 'q1', type: 'distribution', observationUnit: 'student',
    geography: { level: 'national', code: 'fictional-nation', label: '架空の全国' }, ownership: 'public', notes: [],
    population: { participation: 'question', definition: '当該質問の参加者' }, denominator: { basis: 'questionParticipants', definition: '当該質問の参加者数', count: observed(10) },
    basis: 'percent', partition: true, values: [{ code: 'a', value: observed(40, 1) }, { code: 'b', value: observed(60, 1) }] };
  data.references.push(ref, { ...clone(ref), id: 'r2', instrumentId: 'q2' });
  const conditional = { ...clone(ref), id: 'conditional', type: 'conditionalMean', subjectInstrumentId: 'subject',
    population: { participation: 'joint', definition: '当該質問と教科の有効な対応' }, denominator: { basis: 'jointParticipants', definition: '質問と教科の有効な組数', count: missing() },
    values: [{ code: 'a', count: missing(), mean: observed(30, 1), standardDeviation: missing() }, { code: 'b', count: missing(), mean: observed(70, 1), standardDeviation: missing() }] };
  delete conditional.basis; delete conditional.partition; data.references.push(conditional);
  return data;
}
const participants = () => [1, 2, 3].map(n => ({ id: 'p' + n, name: null, grade: 3, className: '架空A組', number: String(n) }));
function dataset(individual = false) {
  return state.createWave(references(), { id: 'wave', label: '架空の調査回', administeredOn: '2026-04-20', administration: 'official',
    referenceIds: ['r1', 'r2', 'conditional'], ownership: 'public', schoolLabel: '架空の自校', ...(individual ? { participants: participants() } : {}) }).surveys;
}
function schoolPayload(data, suffix, refId = 'r1', counts = [1, 1]) {
  const ref = clone(data.references.find(r => r.id === refId)), schoolSource = source('school-source-' + suffix);
  delete ref.version;
  Object.assign(ref, { id: 'school-result-' + suffix, sourceId: schoolSource.id, revision: 1, supersedes: null,
    ownership: 'public', geography: { level: 'school', code: 'wave', label: '架空の自校' }, basis: 'count',
    denominator: { ...ref.denominator, count: observed(counts.reduce((a, b) => a + b, 0)) }, values: ref.values.map((v, i) => ({ code: v.code, value: observed(counts[i]) })) });
  return { waveId: 'wave', source: schoolSource, results: [ref] };
}
function applySchool(data, suffix, refId = 'r1', counts) {
  return state.apply(data, state.prepareSchool(data, schoolPayload(data, suffix, refId, counts)));
}
function responseSet() {
  return { id: 'responses', sourceId: 'individual', instrumentIds: ['q1', 'subject'], records: [
    { participantId: 'p1', values: [{ instrumentId: 'q1', value: 'a', status: 'observed' }, { instrumentId: 'subject', value: 0, status: 'observed', rawScore: 0 }] },
    { participantId: 'p2', values: [{ instrumentId: 'q1', value: 'a', status: 'observed' }, { instrumentId: 'subject', value: null, status: 'noResponse' }] },
    { participantId: 'p3', values: [{ instrumentId: 'q1', value: 'b', status: 'observed' }, { instrumentId: 'subject', value: 100, status: 'observed', rawScore: 5 }] },
  ] };
}
function individualPayload(data, set = responseSet()) {
  const inputSource = source('individual', 'schoolIndividual');
  const aggregated = state.aggregateResponses(data, 'wave', set, { referenceIds: ['r1', 'conditional'], source: inputSource, ownership: 'public', schoolLabel: '架空の自校' });
  return { waveId: 'wave', source: inputSource, responseSet: set, results: aggregated.results };
}
const current = data => state.getLatest(data, 'wave', { instrumentId: 'q1', type: 'distribution' });
const officialCandidates = new Map();
function official(kinds) {
  const key = kinds.join(',');
  if (!officialCandidates.has(key)) officialCandidates.set(key, importer.parseOfficialFiles(fictional.officialFiles(kinds),
    { XLSX: fictional.XLSX, importedAt: '2026-11-14T00:00:00.000Z' }).then(result => result.candidate));
  return officialCandidates.get(key);
}
const importReferences = (data, candidate) => state.apply(data, state.prepareReferences(data, candidate));
const referenceContent = r => { const { id, version, supersedes, instrumentId, ...content } = r; return content; };
function incompleteReferences() {
  const data = references(); data.instruments = data.instruments.slice(0, 1); data.references = data.references.slice(0, 1);
  data.instruments[0].definitionStatus = 'codesOnly';
  data.instruments[0].options.forEach(o => { o.label = '未掲載コード' + o.code; });
  data.instruments[0].locations = [{ sourceId: 'official', sheet: '架空のコード', range: 'A1:B2' }];
  return data;
}
function completionDonor(data, id = 'label-source') {
  const donor = { ...clone(data.instruments[0]), id: id + '-question', definitionStatus: 'complete', sourceIds: [id],
    locations: [{ sourceId: id, sheet: '架空の回答原文', range: 'A1:B2' }] };
  donor.options.forEach(o => { o.label = '架空の選択肢' + o.code; });
  return { ...core.empty(), sources: [source(id, 'official')], instruments: [donor] };
}

test('402 then 424 then 427 adds one immutable completion and later combined reimports are no-ops', async () => {
  const base = await official(['402']), cross = await official(['424']), means = await official(['427']);
  const first = importReferences(core.empty(), base), before = JSON.stringify(first.surveys), candidateBefore = JSON.stringify(cross);
  const second = importReferences(first.surveys, cross), data = second.surveys;
  assert.equal(second.summary.promoted, base.references.length);
  assert.equal(second.summary.added, cross.references.length + base.references.length);
  assert.equal(second.summary.unchanged, 0);
  assert.equal(JSON.stringify(first.surveys), before); assert.equal(JSON.stringify(cross), candidateBefore);
  for (const previous of base.references) {
    assert.deepEqual(data.references.find(r => r.id === previous.id), previous);
    const completed = data.references.find(r => r.supersedes === previous.id);
    assert.equal(completed.version, previous.version + 1); assert.deepEqual(referenceContent(completed), referenceContent(previous));
    const definition = data.instruments.find(i => i.id === completed.instrumentId), old = base.instruments.find(i => i.id === previous.instrumentId);
    assert.equal(definition.supersedes, old.id); assert.equal(definition.version, old.version + 1); assert.equal(definition.definitionStatus, 'complete');
    assert.ok(old.sourceIds.every(id => definition.sourceIds.includes(id))); assert.ok(definition.sourceIds.includes(cross.sources[0].id));
    assert.deepEqual(data.instruments.find(i => i.id === old.id), old);
  }
  const third = importReferences(data, means);
  assert.equal(third.summary.promoted, 0); assert.equal(third.summary.added, means.references.length);
  assert.deepEqual(third.surveys.instruments.filter(i => i.supersedes), data.instruments.filter(i => i.supersedes));
  const combined = await official(['402', '424', '427']), again = importReferences(third.surveys, combined);
  assert.equal(again.summary.added, 0); assert.equal(again.summary.promoted, 0); assert.equal(again.summary.unchanged, combined.references.length);
  assert.deepEqual(again.surveys, third.surveys);
  assert.equal(state.getAvailableReferences(again.surveys).length, combined.references.length);
  assert.ok(state.getAvailableReferences(again.surveys).every(r => !base.references.some(old => old.id === r.id)));
});
test('402 then 427 completes only the matched answered options and keeps every original non-answer category', async () => {
  const base = await official(['402']), means = await official(['427']), first = importReferences(core.empty(), base);
  const second = importReferences(first.surveys, means);
  assert.equal(second.summary.promoted, base.references.length, 'all question texts match in these fictional workbooks');
  for (const previous of base.instruments) {
    const completed = second.surveys.instruments.find(i => i.supersedes === previous.id);
    assert.deepEqual(completed.options.filter(o => o.responseStatus !== 'answered'), previous.options.filter(o => o.responseStatus !== 'answered'));
    assert.deepEqual(completed.options.filter(o => o.responseStatus === 'answered').map(o => o.label), fictional.optionLabels);
    assert.ok(completed.sourceIds.includes(base.sources[0].id)); assert.ok(completed.sourceIds.includes(means.sources[0].id));
    assert.equal(completed.options.length, previous.options.length);
  }
  const again = importReferences(second.surveys, means);
  assert.equal(again.summary.added, 0); assert.equal(again.summary.unchanged, means.references.length); assert.deepEqual(again.surveys, second.surveys);
});
test('same-ID combined 402 completion, reverse arrival and bundle-first imports never downgrade or duplicate definitions', async () => {
  const base = await official(['402']), cross = await official(['424']), combined = await official(['402', '424']);
  const first = importReferences(core.empty(), base), completed = importReferences(first.surveys, combined);
  assert.equal(completed.summary.promoted, base.references.length);
  assert.equal(completed.summary.added, cross.references.length + base.references.length);
  assert.equal(completed.summary.unchanged, base.references.length);
  const again = importReferences(completed.surveys, combined);
  assert.equal(again.summary.added, 0); assert.equal(again.summary.unchanged, combined.references.length); assert.deepEqual(again.surveys, completed.surveys);
  const bundleFirst = importReferences(core.empty(), combined), aloneLater = importReferences(bundleFirst.surveys, base);
  assert.equal(aloneLater.summary.added, 0); assert.equal(aloneLater.summary.unchanged, base.references.length); assert.deepEqual(aloneLater.surveys, bundleFirst.surveys);
  const crossFirst = importReferences(core.empty(), cross), baseLater = importReferences(crossFirst.surveys, base);
  assert.equal(baseLater.summary.promoted, base.references.length); assert.equal(baseLater.summary.unchanged, 0);
  assert.equal(state.getAvailableReferences(baseLater.surveys).length, combined.references.length);
  assert.ok(state.getAvailableReferences(baseLater.surveys).every(r => baseLater.surveys.instruments.find(i => i.id === r.instrumentId).definitionStatus === 'complete'));
});
test('completion preserves old school results and wave pins, restores cleanly on undo, and refuses undo after new-wave use', () => {
  const base = incompleteReferences(), withWave = state.createWave(base, { id: 'wave', label: '架空', administeredOn: '2026-05-01', administration: 'official', referenceIds: ['r1'], ownership: 'public' }).surveys;
  const withResult = applySchool(withWave, 'pinned').surveys, donor = completionDonor(base), before = JSON.stringify(withResult);
  const selection = { waveId: 'wave', resultId: current(withResult).id, referenceId: 'r1' }, comparison = core.compare(withResult, selection);
  const completed = importReferences(withResult, donor), reference = completed.surveys.references.find(r => r.supersedes === 'r1');
  assert.equal(completed.summary.added, 1); assert.equal(completed.summary.promoted, 1); assert.equal(completed.summary.unchanged, 0, 'auto-added references must not make unchanged negative');
  assert.deepEqual(completed.surveys.waves, withResult.waves); assert.deepEqual(current(completed.surveys), current(withResult));
  assert.deepEqual(core.compare(completed.surveys, selection), comparison); assert.equal(comparison.status, 'referenceOnly');
  assert.deepEqual(state.getAvailableReferences(completed.surveys).map(r => r.id), [reference.id]);
  const used = state.createWave(completed.surveys, { id: 'new-wave', label: '架空の新しい回', administeredOn: '2026-05-02', administration: 'official', referenceIds: [reference.id] }).surveys;
  const usedBefore = JSON.stringify(used);
  assert.throws(() => state.undo(used, completed.undo), /参照|出典/); assert.equal(JSON.stringify(used), usedBefore);
  const restored = state.undo(completed.surveys, completed.undo).surveys;
  assert.deepEqual(restored, withResult); assert.equal(JSON.stringify(withResult), before);
  assert.deepEqual(state.getAvailableReferences(restored).map(r => r.id), ['r1']);
  assert.equal(importReferences(restored, donor).summary.promoted, 1);
});
test('completion refuses contradictory donors and does not guess a question match from code or similar wording', () => {
  const base = incompleteReferences(), donor = completionDonor(base), other = completionDonor(base, 'other-labels');
  const original = JSON.stringify(base);
  for (const change of [
    i => { i.options[0].label = '矛盾する原文'; },
    i => { i.options[0].responseStatus = 'noResponse'; },
    i => { i.options[0].code = 'different-code'; },
  ]) {
    const conflicting = clone(other); change(conflicting.instruments[0]);
    const candidate = { ...core.empty(), sources: donor.sources.concat(conflicting.sources), instruments: donor.instruments.concat(conflicting.instruments) };
    assert.throws(() => state.prepareReferences(base, candidate), /矛盾|選択肢/); assert.equal(JSON.stringify(base), original);
  }
  const promoted = importReferences(base, donor), conflicting = clone(other); conflicting.instruments[0].options[0].label = '後から来た矛盾';
  assert.throws(() => state.prepareReferences(promoted.surveys, conflicting), /矛盾/);
  for (const change of [
    i => { i.text += '。'; }, i => { i.grade = 2; }, i => { i.year++; },
    i => { i.schoolLevel = 'upperSecondary'; }, i => { i.respondent = 'school'; }, i => { i.scale.version = '別の尺度版'; },
  ]) {
    const different = clone(donor); change(different.instruments[0]);
    const result = importReferences(base, different);
    assert.equal(result.summary.promoted, 0); assert.equal(result.summary.added, 0);
    assert.equal(result.surveys.instruments[0].definitionStatus, 'codesOnly');
  }
});
test('combined completion accepts only the reader annotation change and rejects altered statistics, precision, and extra notes', async () => {
  const base = await official(['402']), combined = await official(['402', '424']), first = importReferences(core.empty(), base);
  for (const change of [
    r => { r.values[0].value.provenance.raw = 99; },
    r => { r.values[0].publishedPercent.decimals = 2; },
    r => { r.population.definition = '別の対象者'; },
    r => { r.notes.push('追加の不正注記'); },
  ]) {
    const candidate = clone(combined); change(candidate.references[0]);
    assert.throws(() => state.prepareReferences(first.surveys, candidate), /公式統計ID|掲載精度/);
  }
});

test('official import is immutable, deduplicates fingerprints and semantic IDs, and pins existing waves', () => {
  const original = core.empty(), candidate = references(), before = JSON.stringify(original);
  const plan = state.prepareReferences(original, candidate);
  assert.ok(Object.isFrozen(plan.candidate.references[0]));
  const first = state.apply(original, plan); assert.equal(first.summary.added, 3); assert.equal(JSON.stringify(original), before);
  const duplicate = clone(candidate); duplicate.sources[0].id = 'same-file-new-id'; duplicate.sources[0].importedAt = '2026-06-01T00:00:00.000Z';
  duplicate.instruments.forEach(i => { i.id += '-duplicate'; i.sourceIds = ['same-file-new-id']; });
  duplicate.references.forEach(r => { r.id += '-duplicate'; r.sourceId = 'same-file-new-id'; r.instrumentId += '-duplicate'; if (r.subjectInstrumentId) r.subjectInstrumentId += '-duplicate'; });
  const again = state.apply(first.surveys, state.prepareReferences(first.surveys, duplicate));
  assert.equal(again.summary.added, 0); assert.equal(again.summary.unchanged, 3); assert.deepEqual(again.surveys, first.surveys);
  const withWave = state.createWave(first.surveys, { id: 'wave', label: '架空', administeredOn: '2026-05-01', administration: 'official', referenceIds: ['r1'] }).surveys;
  const conflict = clone(candidate); conflict.references[0].values[0].value.value = 45; conflict.references[0].values[1].value.value = 55;
  assert.throws(() => state.prepareReferences(withWave, conflict), /ID|訂正/);
  assert.deepEqual(withWave.waves[0].referenceIds, ['r1']); assert.equal(withWave.references[0].values[0].value.value, 40);
  assert.throws(() => state.undo(withWave, first.undo), /参照|出典/);
});
test('official undo removes only its additions and preserves a later unrelated import', () => {
  const first = state.apply(core.empty(), state.prepareReferences(core.empty(), references()));
  const unrelated = references(); unrelated.sources[0].id = 'another-source'; unrelated.sources[0].fingerprint.value = '2'.repeat(64);
  unrelated.instruments.forEach(i => { i.id += '-other'; i.code += '-other'; i.sourceIds = ['another-source']; });
  unrelated.references.forEach(r => { r.id += '-other'; r.sourceId = 'another-source'; r.instrumentId += '-other'; if (r.subjectInstrumentId) r.subjectInstrumentId += '-other'; });
  const second = state.apply(first.surveys, state.prepareReferences(first.surveys, unrelated));
  const undone = state.undo(second.surveys, first.undo).surveys;
  assert.deepEqual(undone.references.map(r => r.id), unrelated.references.map(r => r.id));
  assert.deepEqual(core.validate(undone), []);
});
test('wave participants are snapshots independent of future roster changes and missing school ownership stays unknown', () => {
  const roster = participants();
  const created = state.createWave(references(), { id: 'snapshot', label: '架空', administeredOn: '2026-05-01', administration: 'official', referenceIds: ['r1'], participants: roster });
  roster[0].grade = 1; roster.splice(1);
  assert.equal(created.surveys.waves[0].participants.length, 3); assert.equal(created.surveys.waves[0].participants[0].grade, 3);
  assert.equal(created.surveys.waves[0].ownership, 'unknown');
  assert.throws(() => state.createWave(created.surveys, { id: 'snapshot', referenceIds: ['r1'] }), /ID/);
});
test('a wave cannot collapse different population, denominator or observation definitions into one school result', () => {
  for (const change of [
    r => { r.population.participation = 'joint'; },
    r => { r.population.definition = '架空の別対象条件'; },
    r => { r.denominator.basis = 'jointParticipants'; },
    r => { r.denominator.definition = '架空の別の分母定義'; },
    r => { r.observationUnit = 'unknown'; },
  ]) {
    const data = references(), alternate = { ...clone(data.references[0]), id: 'different-condition' };
    change(alternate); data.references.push(alternate);
    assert.deepEqual(core.validate(data), [], 'distinct conditions may coexist as saved references');
    const spec = { id: 'conditions', label: '架空', administeredOn: '2026-05-01', administration: 'official', referenceIds: ['r1', alternate.id] };
    const before = JSON.stringify(data);
    assert.throws(() => state.createWave(data, spec), /別の調査回/); assert.equal(JSON.stringify(data), before);
    const separate = state.createWave(data, { ...spec, referenceIds: [alternate.id] }).surveys;
    assert.deepEqual(core.validate(separate), []);
    separate.waves[0].referenceIds.push('r1');
    assert.match(core.validate(separate).join('\n'), /別の調査回/, 'JSON validation also rejects a bypassed mixed wave');
  }
});
test('one school result may use benchmarks differing only by geography, ownership, counts and values', () => {
  const data = references(), region = { ...clone(data.references[0]), id: 'region' };
  region.geography = { level: 'prefecture', code: 'fictional-region', label: '架空の地域' }; region.ownership = 'all';
  region.denominator.count = observed(20); region.values[0].value = observed(55, 1); region.values[1].value = observed(45, 1);
  // Object property order is not a difference in the population definition.
  region.population = { definition: region.population.definition, participation: region.population.participation };
  const noCount = { ...clone(region), id: 'no-published-count', denominator: { ...region.denominator, count: missing('suppressed') } };
  data.references.push(region, noCount);
  const created = state.createWave(data, { id: 'benchmarks', label: '架空', administeredOn: '2026-05-01', administration: 'official', referenceIds: ['r1', 'region', 'no-published-count'] });
  assert.deepEqual(core.validate(created.surveys), []);
  assert.deepEqual(created.surveys.waves[0].referenceIds, ['r1', 'region', 'no-published-count']);
});
test('invalid candidates fail atomically and saved plans cannot be forged or silently patched', () => {
  const data = dataset(), before = JSON.stringify(data), payload = schoolPayload(data, 'invalid');
  payload.results[0].values[0].value.value = 9;
  assert.throws(() => state.prepareSchool(data, payload), /人数|分母/); assert.equal(JSON.stringify(data), before);
  const plan = state.prepareSchool(data, schoolPayload(data, 'valid'));
  assert.throws(() => { plan.changes[0].result.values[0].value.value = 9; }, TypeError);
  assert.throws(() => state.apply(data, clone(plan)), /プレビュー/);
  assert.throws(() => state.undo(data, {}), /取消対象/);
});
test('school commits and undo preserve edits in another statistic and ordinary application data', () => {
  const app = { surveys: dataset(), tests: [{ id: 'ordinary-test', score: 42 }], notes: ['架空のメモ'] };
  const firstPlan = state.prepareSchool(app.surveys, schoolPayload(app.surveys, 'q1'));
  const second = applySchool(app.surveys, 'q2', 'r2');
  const first = state.apply(second.surveys, firstPlan); app.surveys = first.surveys;
  assert.equal(state.getLatest(app.surveys, 'wave').length, 2);
  app.tests[0].score = 43; app.notes.push('取込後の架空メモ');
  app.surveys = state.undo(app.surveys, first.undo).surveys;
  assert.equal(current(app.surveys), null); assert.equal(state.getLatest(app.surveys, 'wave')[0].instrumentId, 'q2');
  assert.equal(app.tests[0].score, 43); assert.equal(app.notes.length, 2);
});
test('result revisions retain correction history; duplicate values are no-ops within a wave', () => {
  const first = applySchool(dataset(), 'first');
  const second = applySchool(first.surveys, 'second', 'r1', [2, 0]);
  assert.equal(current(second.surveys).revision, 2); assert.equal(current(second.surveys).supersedes, 'school-result-first');
  const duplicate = applySchool(second.surveys, 'same-values', 'r1', [2, 0]);
  assert.equal(duplicate.summary.unchanged, 1); assert.equal(duplicate.surveys.waves[0].results.length, 2);
  const undone = state.undo(second.surveys, second.undo).surveys;
  assert.equal(current(undone).revision, 3); assert.deepEqual(current(undone).values.map(v => v.value.value), [1, 1]);
  assert.equal(undone.waves[0].results.length, 3); assert.equal(undone.waves[0].results[1].values[0].value.value, 2);
});
test('stale previews, changed snapshots, and undo after a later edit reject without partial changes', () => {
  const base = dataset(), preview = state.prepareSchool(base, schoolPayload(base, 'preview'));
  const first = applySchool(base, 'first'), before = JSON.stringify(first.surveys);
  assert.throws(() => state.apply(first.surveys, preview), /後で変更/); assert.equal(JSON.stringify(first.surveys), before);
  const correction = applySchool(first.surveys, 'correction', 'r1', [2, 0]);
  assert.throws(() => state.undo(correction.surveys, first.undo), /後で変更/);
  const changed = clone(base); changed.waves[0].label = '別の調査回に変更';
  assert.throws(() => state.apply(changed, preview), /調査回/);
});
test('preview guards cover unchanged values in the issued scope while undo only covers changed results', () => {
  const first = applySchool(dataset(), 'existing'), payload = schoolPayload(first.surveys, 'unchanged-q1');
  payload.results.push(schoolPayload(first.surveys, 'new-q2', 'r2').results[0]);
  const plan = state.prepareSchool(first.surveys, payload);
  assert.equal(plan.summary.unchanged, 1); assert.equal(plan.changes.length, 1); assert.equal(plan.scope.length, 2);
  const edited = applySchool(first.surveys, 'later-q1', 'r1', [2, 0]).surveys, before = JSON.stringify(edited);
  assert.throws(() => state.apply(edited, plan), /入力対象.*後で変更/); assert.equal(JSON.stringify(edited), before);
  const applied = state.apply(first.surveys, plan), later = applySchool(applied.surveys, 'later-outside-undo', 'r1', [2, 0]);
  const undone = state.undo(later.surveys, applied.undo).surveys;
  assert.deepEqual(current(undone).values.map(v => v.value.value), [2, 0]);
  assert.equal(state.getLatest(undone, 'wave', { instrumentId: 'q2', type: 'distribution' }), null);
});
test('adopting individual input requires an explicit mode switch and records the chosen response version', () => {
  const first = applySchool(dataset(true), 'aggregate', 'r1', [2, 1]);
  const payload = individualPayload(first.surveys), before = JSON.stringify(first.surveys), plan = state.prepareSchool(first.surveys, payload);
  assert.equal(plan.summary.modeChanges.length, 1);
  assert.throws(() => state.apply(first.surveys, plan), /切替/); assert.equal(JSON.stringify(first.surveys), before);
  const next = state.apply(first.surveys, plan, { allowModeSwitch: true });
  assert.equal(current(next.surveys).responseSetId, 'responses'); assert.equal(current(next.surveys).sourceId, 'individual');
  assert.equal(next.surveys.waves[0].responseSets[0].records[0].values[1].rawScore, 0);
  const undone = state.undo(next.surveys, next.undo).surveys;
  assert.equal(undone.sources.find(s => s.id === current(undone).sourceId).kind, 'schoolAggregate');
  assert.deepEqual(core.validate(undone), []);
});
test('paired conditional means use valid pairs for each option, preserving zero and original raw scores', () => {
  const data = dataset(true), set = responseSet(), before = JSON.stringify(set), payload = individualPayload(data, set);
  const distribution = payload.results.find(r => r.type === 'distribution'), conditional = payload.results.find(r => r.type === 'conditionalMean');
  assert.equal(distribution.denominator.count.value, 3); assert.equal(conditional.denominator.count.value, 2);
  assert.deepEqual(conditional.values.map(v => [v.count.value, v.mean.value]), [[1, 0], [1, 100]]);
  const stored = state.apply(data, state.prepareSchool(data, payload)).surveys;
  assert.equal(JSON.stringify(set), before); assert.deepEqual(core.validate(clone(stored)), []);
  assert.equal(core.compare(stored, { waveId: 'wave', resultId: conditional.id, referenceId: 'conditional' }).status, 'comparable');
  const malformed = responseSet(); malformed.records[0].values[1].rawScore = 1;
  assert.throws(() => individualPayload(data, malformed), /正答数/);
  const outsider = responseSet(); outsider.records[0].participantId = 'not-a-participant';
  assert.throws(() => individualPayload(data, outsider), /対象者|ID/);
});
test('unentered and unavailable responses remain distinct; question-only input cannot prove joint participation', () => {
  const data = dataset(true), blank = responseSet(); blank.records[0].values[0] = { instrumentId: 'q1', value: null, status: 'unentered' };
  const emptyResult = individualPayload(data, blank).results;
  assert.ok(emptyResult.find(r => r.type === 'distribution').values.every(v => v.value.status === 'unentered'));
  assert.ok(emptyResult.find(r => r.type === 'conditionalMean').values.every(v => v.mean.status === 'unentered'));
  const unavailable = responseSet(); unavailable.records.forEach(r => { r.values[1] = { instrumentId: 'subject', value: null, status: 'notProvided' }; });
  assert.ok(individualPayload(data, unavailable).results.find(r => r.type === 'conditionalMean').values.every(v => v.mean.status === 'notProvided'));
  data.references[0].population.participation = 'joint'; data.references[0].denominator.basis = 'jointParticipants';
  const payload = individualPayload(data), result = payload.results.find(r => r.type === 'distribution');
  const stored = state.apply(data, state.prepareSchool(data, payload)).surveys;
  assert.equal(core.compare(stored, { waveId: 'wave', resultId: result.id, referenceId: 'r1' }).status, 'referenceOnly');
});
test('school ownership is independent from all-owner national data and cohort grade affects comparison', () => {
  const data = dataset(true); data.references[0].ownership = 'all'; data.waves[0].participants[0].grade = 2;
  const payload = individualPayload(data), result = payload.results.find(r => r.type === 'distribution');
  const stored = state.apply(data, state.prepareSchool(data, payload)).surveys;
  assert.equal(result.ownership, 'public');
  const comparison = core.compare(stored, { waveId: 'wave', resultId: result.id, referenceId: 'r1' });
  assert.equal(comparison.status, 'referenceOnly'); assert.ok(comparison.reasons.some(r => r.code === 'ownershipMismatch'));
  assert.ok(comparison.reasons.some(r => r.code === 'participantGradeMismatch'));
  const invalid = schoolPayload(data, 'all'); invalid.results[0].ownership = 'all';
  assert.throws(() => state.prepareSchool(data, invalid), /設置者/);
});
