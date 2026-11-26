'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const files = path.join(__dirname, '../src/files');
const app = fs.readFileSync(path.join(files, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
const fixture = () => ({
  version: 3, name: '架空の調査保存', students: [], tests: [], scores: [], metrics: [], interventions: [],
  settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
});
function surveyFixture() {
  const observed = (value, decimals = 0) => ({ value, status: 'observed', decimals });
  const source = { id: 'fictional-reference-source', kind: 'official', title: '架空の比較資料', publisher: '架空の発行元',
    url: null, fileName: 'fictional-reference.xlsx', importedAt: '2026-06-01T00:00:00.000Z', fingerprint: null,
    reader: null, locations: [{ sheet: '架空の表', range: 'A1:C5' }], notes: ['架空の出典メモ'] };
  const instrument = { id: 'fictional-question', version: 1, year: 2026, schoolLevel: 'lowerSecondary', grade: 3,
    respondent: 'student', kind: 'question', code: 'fictional-Q1', text: '架空の質問',
    options: [{ code: 'a', label: '架空の選択肢A', responseStatus: 'answered' }, { code: 'b', label: '架空の選択肢B', responseStatus: 'answered' }],
    subject: null, skills: [], formId: null,
    scale: { kind: 'response', unit: 'category', version: null, minimum: null, maximum: null, step: null, bands: [] } };
  const reference = { id: 'fictional-reference', version: 1, instrumentId: instrument.id, sourceId: source.id,
    type: 'distribution', observationUnit: 'student', geography: { level: 'national', code: 'fictional-country', label: '架空の全国' },
    ownership: 'public', population: { participation: 'question', definition: '架空の質問参加者' },
    denominator: { basis: 'questionParticipants', definition: '架空の質問参加人数', count: observed(1000) },
    notes: [], basis: 'percent', partition: true, values: [{ code: 'a', value: observed(40, 1) }, { code: 'b', value: observed(60, 1) }] };
  const schoolSource = { ...source, id: 'fictional-school-source', kind: 'schoolAggregate', title: '架空の学校集計', fileName: 'fictional-school.xlsx' };
  const result = { ...reference, id: 'fictional-school-v1', sourceId: schoolSource.id, revision: 1, supersedes: null,
    geography: { level: 'school', code: 'fictional-school', label: '架空の学校' },
    denominator: { ...reference.denominator, count: observed(10) }, basis: 'count',
    values: [{ code: 'a', value: observed(0) }, { code: 'b', value: observed(10) }] };
  delete result.version;
  const revision = { ...result, id: 'fictional-school-v2', revision: 2, supersedes: result.id,
    values: [{ code: 'a', value: observed(1) }, { code: 'b', value: observed(9) }] };
  return { schemaVersion: 1, sources: [source, schoolSource], instruments: [instrument], references: [reference],
    waves: [{ id: 'fictional-wave', label: '架空の調査回', administeredOn: '2026-05-20', administration: 'official',
      instrumentIds: [instrument.id], referenceIds: [reference.id], results: [result, revision] }] };
}
function harness({ moduleAvailable = true } = {}) {
  const elements = new Map(), alerts = [];
  const context = vm.createContext({
    console, TextEncoder, alert: text => alerts.push(text), confirm: () => true,
    window: { addEventListener() {}, showSaveFilePicker() {} },
    document: { addEventListener() {}, getElementById(id) {
      if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: '', value: '', close() {} });
      return elements.get(id);
    } },
  });
  if (moduleAvailable) vm.runInContext(fs.readFileSync(path.join(files, 'survey-core.js'), 'utf8'), context);
  vm.runInContext(app + `
    let failRender = false;
    renderAll = () => { if (failRender) throw new Error('synthetic rendering failure'); };
    updateRoleUI = () => {};
    globalThis.api = {
      applyJsonText, validateDataset, saveJson,
      snapshot: () => ({ data, serializedData: JSON.stringify(data), fileHandle, fileName, dirty, lastDiskText, activeDataToken, pendingDownload, isAdmin }),
      edit: () => markDirty(),
      breakRendering: () => { failRender = true; },
      empty: () => window.GD_SURVEY.empty(),
    };
  `, context);
  return { api: context.api, alerts };
}
function memoryFile(initial) {
  let text = initial, writes = 0;
  return {
    name: 'fictional-survey.json', getFile: async () => ({ text: async () => text }),
    createWritable: async () => ({ write: async value => { text = value; writes++; }, close: async () => {} }),
    read: () => text, writes: () => writes,
  };
}
function sameState(after, before) {
  for (const key of Object.keys(before)) assert.equal(after[key], before[key], key);
}

test('調査拡張のないJSON v1〜v3に空の拡張を付け足さない', () => {
  for (const version of [1, 2, 3]) {
    const { api } = harness(), data = { ...fixture(), version };
    assert.equal(api.applyJsonText(JSON.stringify(data), 'fictional-legacy.json', null), true);
    assert.equal(Object.hasOwn(api.snapshot().data, 'surveys'), false);
    assert.equal(api.snapshot().data.version, 3);
  }
});

test('調査拡張は名簿・テストなしでもJSONに保存して再開できる', async () => {
  const { api } = harness(), data = fixture();
  data.surveys = api.empty();
  const original = JSON.stringify(data), file = memoryFile(original);
  assert.equal(api.applyJsonText(original, file.name, file), true);
  api.edit();
  await api.saveJson('overwrite');
  assert.equal(file.writes(), 1);
  assert.equal(api.snapshot().dirty, false);
  const saved = JSON.parse(file.read());
  assert.equal(JSON.stringify(saved.surveys), JSON.stringify(data.surveys));
  const reopened = harness();
  assert.equal(reopened.api.applyJsonText(file.read(), file.name, null), true);
  assert.equal(JSON.stringify(reopened.api.snapshot().data), JSON.stringify(saved));
});

test('非空の出典・設問・公式値・学校結果の訂正履歴を保存して再開する', async () => {
  const { api } = harness(), data = { ...fixture(), surveys: surveyFixture() };
  const file = memoryFile(JSON.stringify(data)), surveyText = JSON.stringify(data.surveys);
  assert.equal(api.applyJsonText(file.read(), file.name, file), true);
  api.edit();
  await api.saveJson('overwrite');
  assert.equal(file.writes(), 1);
  assert.equal(JSON.stringify(JSON.parse(file.read()).surveys), surveyText);
  const reopened = harness();
  assert.equal(reopened.api.applyJsonText(file.read(), file.name, null), true);
  assert.equal(JSON.stringify(reopened.api.snapshot().data.surveys), surveyText);
  assert.equal(reopened.api.snapshot().dirty, false);
});

test('調査拡張の読込検証に失敗したらデータ・ファイル名・保存先・未保存状態を保持する', () => {
  const { api, alerts } = harness(), original = fixture(), handle = { name: 'fictional-original.json' };
  original.surveys = api.empty();
  assert.equal(api.applyJsonText(JSON.stringify(original), handle.name, handle), true);
  api.edit();
  const before = api.snapshot();
  for (const invalid of [null, [], 'text', {}, { ...api.empty(), schemaVersion: 2 }, { ...api.empty(), sources: [{ formula: '1', result: 1 }] }]) {
    const candidate = { ...fixture(), surveys: invalid };
    assert.notEqual(api.applyJsonText(JSON.stringify(candidate), 'fictional-invalid.json', null), true);
    sameState(api.snapshot(), before);
  }
  assert.ok(alerts.every(text => text.includes('問題があります')));
});

test('調査拡張が不正なら上書き・別名保存・ダウンロードを実行しない', async () => {
  const { api, alerts } = harness(), data = fixture();
  data.surveys = api.empty();
  const file = memoryFile(JSON.stringify(data));
  assert.equal(api.applyJsonText(file.read(), file.name, file), true);
  api.snapshot().data.surveys.schemaVersion = 99;
  api.edit();
  const before = api.snapshot(), disk = file.read();
  for (const mode of ['overwrite', 'as', 'download']) {
    await api.saveJson(mode);
    sameState(api.snapshot(), before);
    assert.equal(file.writes(), 0);
    assert.equal(file.read(), disk);
  }
  assert.match(alerts.at(-1), /保存できません/);
});

test('表示処理の失敗でも読み込み前の調査・保存先・未保存状態を復元する', () => {
  const { api } = harness(), data = fixture(), file = { name: 'fictional-original.json' };
  data.surveys = api.empty();
  assert.equal(api.applyJsonText(JSON.stringify(data), file.name, file), true);
  api.edit();
  const before = api.snapshot();
  api.breakRendering();
  const candidate = { ...fixture(), name: '架空の別の調査', surveys: api.empty() };
  assert.notEqual(api.applyJsonText(JSON.stringify(candidate), 'fictional-next.json', null), true);
  sameState(api.snapshot(), before);
});

test('検証モジュール欠落時は調査付きJSONを拒否し既存形式は読み込める', () => {
  const { api, alerts } = harness({ moduleAvailable: false }), data = fixture();
  assert.equal(api.applyJsonText(JSON.stringify(data), 'fictional-existing.json', null), true);
  const before = api.snapshot();
  data.surveys = { schemaVersion: 1, sources: [], instruments: [], references: [], waves: [] };
  assert.notEqual(api.applyJsonText(JSON.stringify(data), 'fictional-survey.json', null), true);
  sameState(api.snapshot(), before);
  assert.match(alerts.at(-1), /調査データの検証機能/);
});
