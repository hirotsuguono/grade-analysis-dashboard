'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const retainedAbsenceDataset = require('./issue-3-fixtures.cjs');
const source = fs.readFileSync(path.join(process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files'), 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function harness(dataset) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id, hidden: false, innerHTML: '', textContent: '',
      closest() { return this; }, querySelector() { return this; }, querySelectorAll() { return []; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    console, input: dataset, window: { addEventListener() {}, print() {} },
    document: { addEventListener() {}, getElementById: element },
  });
  vm.runInContext(source + `
    data = input; rebuildIndex();
    globalThis.options = {};
    chart = id => ({ setOption(value) { options[id] = value; } });
    renderInput = () => {};
    ui.inTest = ui.ovTest = ui.anTest = data.tests.at(-1).id;
    ui.trendSubject = '英語';
  `, context);
  return {
    run(code) { return vm.runInContext(code, context); },
    read(code) { return JSON.parse(JSON.stringify(vm.runInContext(code, context))); },
    element,
  };
}

function fictionalDataset(points = [100, 0]) {
  const students = points.map((_, i) => ({ id: `s${i}`, name: `架空生徒${i}`, className: '架空組', number: i + 1 }));
  const test = {
    id: 't1', name: '架空中間', subject: '英語', gradeYear: 1, date: '2026-05-20', maxScore: 100,
    domains: [{ key: 'd1', label: '架空分野', max: 100 }],
    questions: [{ key: 'q1', label: '架空設問', domain: 'd1', max: 100 }],
  };
  return { version: 3, students, tests: [test], scores: students.map((s, i) => ({
    studentId: s.id, testId: test.id, total: points[i], domains: { d1: points[i] }, questions: { q1: points[i] },
  })), metrics: [], interventions: [] };
}

function rates(h) {
  h.run('renderAnalysis()');
  return h.read('[options.anDomainChart.series[0].data[0].value, options.anQuestionChart.series[0].data[0].value]');
}

test('欠席切替で保持した設問・分野を平均から除外し、出席復帰で再集計する（0点は有効）', () => {
  const h = harness(fictionalDataset());
  assert.deepEqual(rates(h), [50, 50]);
  h.run("handleAbsentToggle({ dataset: { sid: 's0' }, checked: true })");
  assert.deepEqual(rates(h), [0, 0]);
  assert.deepEqual(h.read("getScore('s0', 't1')"), {
    studentId: 's0', testId: 't1', total: null, absent: true, domains: { d1: 100 }, questions: { q1: 100 },
  });
  h.run("handleAbsentToggle({ dataset: { sid: 's0' }, checked: false })");
  assert.deepEqual(rates(h), [50, 50]);
  assert.equal(h.run("getScore('s0', 't1').total"), 100);
  h.run('data.scores.forEach(r => { r.absent = true; })');
  assert.deepEqual(rates(h), [null, null]);
});

test('箱ひげ図は欠席者を除いた4名で計算し、4名未満ならデータ不足とする', () => {
  const h = harness(fictionalDataset([0, 20, 40, 60, 100]));
  h.run('data.scores[4].absent = true; renderQuestionBox(data.tests[0], data.students)');
  assert.deepEqual(h.read('options.anBoxChart.series[0].data[0]'), [0, 15, 30, 45, 60]);
  h.run('data.scores[3].absent = true; renderQuestionBox(data.tests[0], data.students)');
  assert.deepEqual(h.read('options.anBoxChart.series[0].data[0]'), [null, null, null, null, null]);
});

test('読み込んだ欠席レコードの合計が残っていても概要・相関・個人推移に使わない', () => {
  const dataset = fictionalDataset();
  dataset.scores[0].absent = true;
  const h = harness(dataset);
  h.run('renderOverview()');
  assert.match(h.element('kpiGrid').innerHTML, /受験者数[\s\S]*?kpi-value">1<small>/);
  assert.match(h.element('kpiGrid').innerHTML, /平均点[\s\S]*?kpi-value">0<small>/);
  assert.deepEqual(h.read('options.ovTrendChart.series.map(s => s.data)'), [[0], [0]]);
  assert.equal(h.run("axisInfo('t:t1').get('s0')"), null);
  assert.equal(h.run("axisInfo('t:t1').get('s1')"), 0);
  assert.deepEqual(h.read("trendAxis().valueOf('s0')"), [null]);
  assert.deepEqual(h.read("trendAxis().valueOf('s1')"), [0]);
  h.run("ui.trendSelected = new Set(['s0']); renderTrendDomainChart()");
  assert.deepEqual(h.read('options.trendDomainChart.xAxis.data'), []);
  h.run("ui.trendSelected = new Set(['s1']); renderTrendDomainChart(); printKarte()");
  assert.deepEqual(h.read('options.trendDomainChart.series[0].data'), [0]);
  assert.match(h.element('printArea').innerHTML, /<td>0 \/ 100<\/td><td>0%<\/td><td>0<\/td>/);
});

test('分野の前回比較は両方出席した生徒だけを数え、5名未満なら効果量を出さない', () => {
  const dataset = fictionalDataset([0, 10, 20, 30, 40, 100]);
  const second = { ...dataset.tests[0], id: 't2', name: '架空期末', date: '2026-07-20', compareTo: 't1' };
  dataset.tests.push(second);
  dataset.scores.push(...dataset.students.map((s, i) => ({
    studentId: s.id, testId: 't2', total: [0, 30, 60, 90, 100, 0][i],
    domains: { d1: [0, 30, 60, 90, 100, 0][i] }, questions: { q1: [0, 30, 60, 90, 100, 0][i] },
  })));
  dataset.scores[5].absent = true;
  const h = harness(dataset);
  h.run('renderAnalysis()');
  assert.match(h.element('weakBanner').innerHTML, /効果量 dz=/);
  h.run('data.scores[10].absent = true; renderAnalysis()');
  assert.doesNotMatch(h.element('weakBanner').innerHTML, /効果量 dz=/);
});

function combinedSeries(h) {
  h.run('ui.trendSubject = SUM_KEY; ui.trendSelected = new Set(data.students.map(s => s.id)); renderTrendChart()');
  return h.read('options.trendChart.series.map(series => series.data)');
}

test('JSON v1〜v3の保持した欠席得点は、保存・再読込後も全教科推移と平均に混入しない（出席者の0点は有効）', () => {
  for (const version of [1, 2, 3]) {
    const dataset = { ...retainedAbsenceDataset(), version };
    const text = JSON.stringify(dataset);
    const h = harness(JSON.parse(text));
    assert.deepEqual(h.read('validateDataset(data)'), []);
    assert.deepEqual(combinedSeries(h), [[null], [0], [120], [60]]);
    assert.equal(h.run('JSON.stringify(data)'), text, 'rendering must preserve retained scores');
    const reopened = harness(JSON.parse(h.run('JSON.stringify(data)')));
    assert.deepEqual(combinedSeries(reopened), [[null], [0], [120], [60]]);
  }
});

test('保存済み欠席JSONから問題別得点を復元でき、再度欠席にして保存しても保持値を失わない', () => {
  let h = harness(JSON.parse(JSON.stringify(retainedAbsenceDataset())));
  for (let roundtrip = 0; roundtrip < 2; roundtrip++) {
    assert.deepEqual(combinedSeries(h), [[null], [0], [120], [60]]);
    h.run(`for (const test of data.tests) {
      ui.inTest = test.id;
      handleAbsentToggle({ dataset: { sid: 'retained-a' }, checked: false });
    }`);
    assert.deepEqual(combinedSeries(h), [[160], [0], [120], [93.3]]);
    assert.deepEqual(h.read("data.scores.filter(r => r.studentId === 'retained-a').map(r => r.total)"), [100, 60]);
    h.run(`for (const test of data.tests) {
      ui.inTest = test.id;
      handleAbsentToggle({ dataset: { sid: 'retained-a' }, checked: true });
    }`);
    assert.deepEqual(combinedSeries(h), [[null], [0], [120], [60]]);
    assert.deepEqual(h.read("data.scores.filter(r => r.studentId === 'retained-a').map(r => r.questions.q1)"), [100, 60]);
    h = harness(JSON.parse(h.run('JSON.stringify(data)')));
  }
});

test('保持得点があっても全員欠席なら全教科の値も平均も0点に置き換えない', () => {
  const dataset = retainedAbsenceDataset();
  dataset.scores.forEach(record => { record.absent = true; });
  const h = harness(JSON.parse(JSON.stringify(dataset)));
  h.run('ui.trendSubject = SUM_KEY');
  assert.deepEqual(h.read('data.students.map(s => trendAxis().valueOf(s.id))'), [[null], [null], [null]]);
  assert.deepEqual(combinedSeries(h), [[], [], [], []]);
});

test('問題別得点のないJSONでも、保存した欠席合計を除外し、欠席解除で元の合計へ戻す', () => {
  const dataset = retainedAbsenceDataset();
  dataset.tests.forEach(test => { test.questions = []; test.domains = []; });
  dataset.scores.forEach(record => { record.questions = {}; record.domains = {}; });
  const h = harness(JSON.parse(JSON.stringify(dataset)));
  assert.deepEqual(h.read('validateDataset(data)'), []);
  assert.deepEqual(combinedSeries(h), [[null], [0], [120], [60]]);
  const reopened = harness(JSON.parse(h.run('JSON.stringify(data)')));
  reopened.run(`for (const test of data.tests) {
    ui.inTest = test.id;
    handleAbsentToggle({ dataset: { sid: 'retained-a' }, checked: false });
  }`);
  assert.deepEqual(combinedSeries(reopened), [[160], [0], [120], [93.3]]);
  assert.deepEqual(reopened.read("data.scores.filter(r => r.studentId === 'retained-a').map(r => r.total)"), [100, 60]);
});
