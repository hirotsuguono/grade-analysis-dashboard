'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const scriptPath = path.join(process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files'), 'script.js');
const xlsxPath = path.join(process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files'), 'vendor', 'xlsx.full.min.js');
const XLSX = require(xlsxPath);
const source = fs.readFileSync(scriptPath, 'utf8').replace(/\ninit\(\);\s*$/, '');
const context = vm.createContext({
  console,
  alert() {},
  crypto: webcrypto,
  TextEncoder,
  XLSX,
  window: { addEventListener() {} },
  document: { addEventListener() {}, getElementById() { return null; } },
});

vm.runInContext(source + `
  globalThis.gradeDashboardTest = {
    localDateString,
    normalizeDateValue,
    parseBoundedNumber,
    sampleSd,
    independentCohensD,
    pairedCohensDz,
    pearson,
    quantile,
    formatBoxTooltip,
    validateDataset,
    applyJsonText,
    termOrderedList,
    removeStudentData,
    setData(value) { data = value; },
    getData() { return data; },
  };
`, context);

const core = context.gradeDashboardTest;

function validDataset() {
  return {
    version: 3,
    name: '架空データ',
    students: [{ id: 's1', name: '架空生徒A', className: '1A', number: 1 }],
    tests: [{
      id: 't1', name: '前期中間', subject: '英語', gradeYear: 1, date: '2026-05-20', maxScore: 10,
      questions: [{ key: 'q1', label: '問1', max: 10 }],
    }],
    scores: [{ studentId: 's1', testId: 't1', total: 8, domains: {}, questions: { q1: 8 } }],
    metrics: [],
    interventions: [],
  };
}

function validIntervention(overrides = {}) {
  return {
    id: 'iv1', studentId: 's1', title: '架空の支援', subject: '英語',
    startDate: '2026-05-20', createdAt: '2026-05-20',
    status: 'active', note: '', baseline: 80, ...overrides,
  };
}

test('点数は0点と満点を許可し、範囲外と非数値を拒否する', () => {
  assert.equal(JSON.stringify(core.parseBoundedNumber('', 10)), JSON.stringify({ valid: true, value: null }));
  assert.equal(JSON.stringify(core.parseBoundedNumber('0', 10)), JSON.stringify({ valid: true, value: 0 }));
  assert.equal(JSON.stringify(core.parseBoundedNumber('10', 10)), JSON.stringify({ valid: true, value: 10 }));
  assert.equal(core.parseBoundedNumber('-1', 10).valid, false);
  assert.equal(core.parseBoundedNumber('11', 10).valid, false);
  assert.equal(core.parseBoundedNumber('abc', 10).valid, false);
});

test('日付はローカル日付で作り、実在しない日付を拒否する', () => {
  assert.equal(core.localDateString(new Date(2026, 8, 26, 1, 30)), '2026-09-26');
  assert.equal(core.normalizeDateValue('2026/9/6'), '2026-09-06');
  assert.equal(core.normalizeDateValue(46300), '2026-10-05');
  assert.equal(core.normalizeDateValue('2026-02-30'), null);
});

test('独立2群のdと対応のあるdzを標準的な標本標準偏差で計算する', () => {
  assert.equal(core.sampleSd([1, 2, 3]), 1);
  assert.equal(core.independentCohensD([1, 2, 3], [2, 3, 4]), 1);
  assert.equal(core.pairedCohensDz([[1, 2], [2, 4], [3, 6]]), 2);
});

test('箱ひげ図のツールチップは5つの統計量をずらさず表示する', () => {
  assert.equal(
    core.formatBoxTooltip({ name: '問1', data: [0, 25, 50, 75, 100] }),
    '問1<br>最小 0% ／ 第1四分位 25%<br>中央値 50%<br>第3四分位 75% ／ 最大 100%'
  );
});

test('正常なデータセットを受理する', () => {
  assert.equal(core.validateDataset(validDataset()).length, 0);
});

test('支援の開始時基準値は有限な0〜100の数値に限る', () => {
  for (const baseline of ['<img src=x onerror="alert(1)">', '50', '', false, [], {}, NaN, Infinity, -Infinity, -1, 100.1]) {
    const dataset = validDataset();
    dataset.interventions = [{ id: 'iv1', studentId: 's1', title: '架空の支援', subject: '英語', baseline }];
    assert.match(core.validateDataset(dataset).join('\n'), /開始時.*0〜100/);
  }
});

test('JSON v1〜v3で開始時基準値の0・100・小数・未設定を受理する', () => {
  for (const version of [1, 2, 3]) {
    for (const baseline of [0, 100, 62.5, null, undefined]) {
      const dataset = validDataset();
      dataset.version = version;
      dataset.interventions = [{ id: 'iv1', studentId: 's1', title: '架空の支援', subject: '英語', baseline }];
      assert.equal(core.validateDataset(dataset).length, 0);
    }
  }
});

test('不正な開始時基準値を含むJSONは現在のデータを置換しない', () => {
  const original = validDataset();
  core.setData(original);
  for (const baseline of ['<img src=x onerror="alert(1)">', '50', false, [], {}, -1, 101]) {
    const invalid = validDataset();
    invalid.interventions = [{ id: 'iv1', studentId: 's1', title: '架空の支援', subject: '英語', baseline }];
    core.applyJsonText(JSON.stringify(invalid), 'fictional-invalid-baseline.json', null);
    assert.equal(core.getData(), original);
  }
});

test('支援記録の日付は文字列の実在する日付だけを受理する', () => {
  for (const field of ['startDate', 'endDate', 'createdAt']) {
    for (const value of [42, 43, 0, false, true, {}, [], '不明', '2026-02-30', '1900-02-29', '2026/05/20', '2026-5-20', ' 2026-05-20 ']) {
      const dataset = validDataset();
      dataset.interventions = [validIntervention({ [field]: value })];
      assert.ok(core.validateDataset(dataset).some(message => message.includes(field)), `${field}: ${JSON.stringify(value)}`);
    }
  }
});

test('支援記録の不正な状態・メモを拒否する', () => {
  for (const [field, values, pattern] of [
    ['status', ['', 'pending', 42, false, {}, []], /状態/],
    ['note', [42, false, {}, []], /メモ/],
  ]) {
    for (const value of values) {
      const dataset = validDataset();
      dataset.interventions = [validIntervention({ [field]: value })];
      assert.match(core.validateDataset(dataset).join('\n'), pattern);
    }
  }
});

test('JSON v1〜v3で正常な支援記録とうるう日・未設定項目を受理する', () => {
  for (const version of [1, 2, 3]) {
    for (const date of ['2024-02-29', '2026-05-20', '', null, undefined]) {
      for (const status of ['active', 'done', null, undefined]) {
        const dataset = validDataset();
        dataset.version = version;
        dataset.interventions = [validIntervention({ startDate: date, endDate: date, createdAt: date, status, note: null })];
        assert.equal(core.validateDataset(dataset).length, 0);
      }
    }
  }
});

test('開始日42・43の支援記録を反映前に拒否し、現在のデータを保持する', () => {
  const original = validDataset();
  core.setData(original);
  const invalid = validDataset();
  invalid.interventions = [
    validIntervention({ id: 'iv1', startDate: 42 }),
    validIntervention({ id: 'iv2', startDate: 43 }),
  ];
  assert.doesNotThrow(() => core.applyJsonText(JSON.stringify(invalid), 'fictional-invalid-dates.json', null));
  assert.equal(core.getData(), original);
});

test('公開用60名サンプルが既存スキーマ検証を通る', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'files', 'sample-data.json'), 'utf8'));
  assert.equal(core.validateDataset(sample).length, 0);
});

test('範囲外点数、重複ID、孤立した支援記録を拒否する', () => {
  const dataset = validDataset();
  dataset.students.push({ id: 's1', name: '架空生徒B' });
  dataset.scores[0].questions.q1 = 11;
  dataset.interventions.push({ id: 'iv1', studentId: 'missing', title: '架空の支援' });
  const errors = core.validateDataset(dataset).join('\n');
  assert.match(errors, /重複/);
  assert.match(errors, /0〜10の範囲外/);
  assert.match(errors, /存在しない生徒ID/);
});

test('テスト回は登録順ではなく実施日順に並ぶ', () => {
  core.setData({
    tests: [
      { id: 't2', name: '後期期末', subject: '英語', gradeYear: 1, date: '2027-02-20' },
      { id: 't1', name: '前期中間', subject: '英語', gradeYear: 1, date: '2026-05-20' },
    ],
  });
  assert.deepEqual(Array.from(core.termOrderedList()), ['1年・前期中間', '1年・後期期末']);
});

test('生徒削除では成績・指標・支援記録をすべて除去する', () => {
  const dataset = validDataset();
  dataset.metrics = [{ id: 'm1', label: '架空指標', type: 'number', values: { s1: 3 } }];
  dataset.interventions = [{ id: 'iv1', studentId: 's1', title: '架空の支援' }];
  core.setData(dataset);
  core.removeStudentData('s1');
  const current = core.getData();
  assert.equal(current.students.length, 0);
  assert.equal(current.scores.length, 0);
  assert.equal(Object.keys(current.metrics[0].values).length, 0);
  assert.equal(current.interventions.length, 0);
});

test('nullのJSONでも例外を出さず、現在のデータを維持する', () => {
  const original = validDataset();
  core.setData(original);
  assert.doesNotThrow(() => core.applyJsonText('null', 'invalid.json', null));
  assert.equal(core.getData(), original);
});

test('壊れた指標・問題・RTI設定を読み込み前に拒否する', () => {
  for (const mutate of [
    d => { d.metrics = [null]; },
    d => { d.metrics = [{ id: 'm1', label: '架空', type: 'scale', values: { s1: 6 } }]; },
    d => { d.tests[0].questions = [null]; },
    d => { d.settings = { rti: { tier3: 80, tier2: 40 } }; },
    d => { d.students[0].className = {}; },
  ]) {
    const dataset = validDataset();
    mutate(dataset);
    assert.ok(core.validateDataset(dataset).length > 0);
  }
});

test('旧形式の最小データは設定・指標が無くても読み込める', () => {
  const dataset = validDataset();
  delete dataset.version;
  delete dataset.metrics;
  delete dataset.interventions;
  delete dataset.students[0].number;
  assert.equal(core.validateDataset(dataset).length, 0);
});
