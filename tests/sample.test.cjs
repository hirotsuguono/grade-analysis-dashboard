'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const DOMAINS = ['リスニング', '語彙', '文法', '読解', 'ライティング'];
const TEST_DATES = [['2025-05-15', '2025-07-10', '2025-09-11', '2025-11-13', '2026-02-12'], ['2026-04-23', '2026-05-28', '2026-07-09', '2026-09-10', '2026-10-08']];
const root = path.join(__dirname, '..', 'src', 'files');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'sample-data.json'), 'utf8'));
const students = new Map(sample.students.map(s => [s.id, s]));
const tests = new Map(sample.tests.map(t => [t.id, t]));
const sum = values => values.reduce((a, b) => a + b, 0);
const mean = values => sum(values) / values.length;

test('新サンプルは60名、10テスト、600記録で全識別子が一意', () => {
  assert.equal(sample.version, 3);
  assert.match(sample.name, /すべて架空/);
  assert.equal(sample.students.length, 60);
  assert.equal(students.size, 60);
  assert.equal(sample.tests.length, 10);
  assert.equal(tests.size, 10);
  assert.equal(sample.scores.length, 600);
  assert.equal(new Set(sample.scores.map(r => `${r.studentId}:${r.testId}`)).size, 600);
});

test('現在は2年A/B/C組各20名で、氏名・番号と1年時の組替え履歴が整合する', () => {
  const current = new Map(), historical = new Map();
  sample.students.forEach((s, index) => {
    assert.equal(s.id, `demo-student-${String(index + 1).padStart(3, '0')}`);
    assert.equal(s.name, `架空生徒${String(index + 1).padStart(3, '0')}`);
    assert.match(s.className, /^2年[ABC]組$/);
    assert.ok(Number.isInteger(s.number) && s.number >= 1 && s.number <= 20);
    assert.equal(s.classHistory.length, 1);
    const old = s.classHistory[0];
    assert.match(old.className, /^1年[ABC]組$/);
    assert.equal(old.at, '2026-04-01');
    assert.ok(Number.isInteger(old.number) && old.number >= 1 && old.number <= 20);
    for (const [map, record] of [[current, s], [historical, old]]) {
      if (!map.has(record.className)) map.set(record.className, []);
      map.get(record.className).push(record.number);
    }
  });
  for (const classes of [current, historical]) {
    assert.equal(classes.size, 3);
    for (const numbers of classes.values()) assert.deepEqual(numbers.sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  }
  for (const currentClass of current.keys()) assert.equal(new Set(sample.students.filter(s => s.className === currentClass).map(s => s.classHistory[0].className)).size, 3);
});

test('英語のみで1/2年各5回、実力テスト名と実施日が現コホートに一致', () => {
  assert.deepEqual(sample.tests.map(t => t.date), TEST_DATES.flat());
  assert.equal(new Set(sample.tests.map(t => t.date)).size, 10);
  for (const gradeYear of [1, 2]) {
    const gradeTests = sample.tests.filter(t => t.gradeYear === gradeYear);
    assert.equal(gradeTests.length, 5);
    gradeTests.forEach((t, index) => {
      assert.equal(t.id, `english-g${gradeYear}-practice-${index + 1}`);
      assert.equal(t.name, `第${index + 1}回実力テスト`);
      assert.equal(t.subject, '英語');
      assert.equal(new Date(t.date).toISOString().slice(0, 10), t.date);
      assert.ok(t.date <= '2026-10-15');
      assert.ok(t.date >= (gradeYear === 1 ? '2025-04-01' : '2026-04-01'));
      assert.ok(t.date < (gradeYear === 1 ? '2026-04-01' : '2027-04-01'));
    });
  }
});

test('全テストの5分野各20点・10小問各10点が100点と一致', () => {
  for (const t of sample.tests) {
    assert.equal(t.maxScore, 100);
    assert.deepEqual(t.domains.map(d => d.key), DOMAINS);
    assert.equal(sum(t.domains.map(d => d.max)), 100);
    assert.equal(t.questions.length, 10);
    assert.equal(new Set(t.questions.map(q => q.key)).size, 10);
    assert.equal(sum(t.questions.map(q => q.max)), 100);
    for (const d of t.domains) {
      assert.equal(d.label, d.key);
      assert.equal(d.max, 20);
      const questions = t.questions.filter(q => q.domain === d.key);
      assert.equal(questions.length, 2);
      assert.equal(sum(questions.map(q => q.max)), d.max);
    }
    t.questions.forEach((q, index) => {
      assert.equal(q.key, `q${index + 1}`);
      assert.equal(q.max, 10);
      assert.equal(q.label, `${q.domain}${index % 2 + 1}`);
      assert.ok(DOMAINS.includes(q.domain));
    });
  }
});

test('600記録すべての参照・小問・分野・合計点・欠席処理が整合', () => {
  const coverage = new Map(sample.students.map(s => [s.id, new Set()]));
  for (const r of sample.scores) {
    assert.ok(students.has(r.studentId));
    assert.ok(tests.has(r.testId));
    coverage.get(r.studentId).add(r.testId);
    const t = tests.get(r.testId);
    if (r.absent === true) {
      assert.equal(r.total, null);
      assert.deepEqual(r.questions, {});
      assert.deepEqual(r.domains, {});
      continue;
    }
    assert.equal(r.absent, undefined);
    assert.deepEqual(Object.keys(r.questions), t.questions.map(q => q.key));
    assert.deepEqual(Object.keys(r.domains), DOMAINS);
    for (const q of t.questions) {
      assert.ok(Number.isInteger(r.questions[q.key]));
      assert.ok(r.questions[q.key] >= 0 && r.questions[q.key] <= q.max);
    }
    for (const d of t.domains) {
      assert.ok(Number.isInteger(r.domains[d.key]));
      assert.ok(r.domains[d.key] >= 0 && r.domains[d.key] <= d.max);
      assert.equal(r.domains[d.key], sum(t.questions.filter(q => q.domain === d.key).map(q => r.questions[q.key])));
    }
    assert.ok(Number.isInteger(r.total) && r.total >= 0 && r.total <= 100);
    assert.equal(r.total, sum(Object.values(r.questions)));
    assert.equal(r.total, sum(Object.values(r.domains)));
  }
  for (const covered of coverage.values()) assert.deepEqual([...covered], [...tests.keys()]);
  for (const id of tests.keys()) assert.equal(sample.scores.filter(r => r.testId === id).length, 60);
});

test('家庭学習アンケート4項目が60名全員を参照し、回答範囲内', () => {
  assert.equal(sample.metrics.length, 4);
  assert.equal(new Set(sample.metrics.map(m => m.id)).size, 4);
  const bounds = { 'metric-study-minutes': [0, 120], 'metric-study-days': [0, 7], 'metric-motivation': [1, 5], 'metric-review': [1, 5] };
  for (const m of sample.metrics) {
    assert.match(m.label, /^家庭学習アンケート：/);
    assert.deepEqual(Object.keys(m.values), [...students.keys()]);
    assert.ok(Object.hasOwn(bounds, m.id));
    const [min, max] = bounds[m.id];
    assert.equal(m.type, min === 1 ? 'scale' : 'number');
    const values = Object.values(m.values);
    for (const value of values) assert.ok(Number.isInteger(value) && value >= min && value <= max);
    if (m.id === 'metric-study-minutes') assert.ok(values.every(v => v % 5 === 0));
    assert.ok(new Set(values).size >= (m.type === 'scale' ? 4 : 6));
  }
  assert.deepEqual(sample.interventions, []);
  assert.equal(sample.settings.adminPinHash, null);
});

test('JSONとfile対応のclassic JSが同一データ', () => {
  const context = vm.createContext({ window: {} });
  const js = fs.readFileSync(path.join(root, 'sample-data.js'), 'utf8');
  assert.doesNotMatch(js, /\b(?:import|export|fetch)\s*(?:\(|\{|\*)/);
  vm.runInContext(js, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.window.GRADE_DASHBOARD_SAMPLE)), sample);
});

test('5段階デモは成績帯との関連と例外を持ち、期待度数の不足を隠さない', () => {
  assert.equal(sample.samplePurpose, 'fabricated-association-demo');
  const latest = sample.tests.at(-1);
  for (const metric of sample.metrics.filter(m => m.type === 'scale')) {
    const pairs = sample.scores.filter(r => r.testId === latest.id && r.total != null).map(r => [metric.values[r.studentId], r.total]);
    assert.equal(pairs.length, 59); // One absence remains an absence, never zero.
    const table = Array.from({ length: 5 }, () => [0, 0, 0]);
    for (const [answer, total] of pairs) table[answer - 1][total < 40 ? 0 : total < 60 ? 1 : 2]++;
    const rowTotals = table.map(row => sum(row));
    const colTotals = [0, 1, 2].map(j => sum(table.map(row => row[j])));
    assert.ok(rowTotals.every(n => n > 0));
    let chi = 0, small = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) {
      const expected = rowTotals[i] * colTotals[j] / pairs.length;
      if (expected < 5) small++;
      chi += (table[i][j] - expected) ** 2 / expected;
    }
    const v = Math.sqrt(chi / (pairs.length * 2));
    assert.ok(v > 0.45 && v < 0.75, 'visible, imperfect association in synthetic demo');
    assert.ok(pairs.filter(([answer, total]) => answer <= 2 && total >= 60).length >= 3, 'counterexamples are retained');
    assert.ok(small > 15 * 0.2, 'sparse expected counts must still trigger the existing warning');
  }
});

test('欠席は散在し、学力・推移・分野に分析可能なばらつきがある', () => {
  const absences = sample.scores.filter(r => r.absent);
  assert.ok(absences.length >= 6 && absences.length <= 20);
  for (const t of sample.tests) {
    const scores = sample.scores.filter(r => r.testId === t.id && !r.absent).map(r => r.total);
    assert.ok(scores.length >= 57);
    assert.ok(new Set(scores).size >= 25);
    assert.ok(Math.max(...scores) - Math.min(...scores) >= 50);
    assert.ok(scores.some(v => v < 40) && scores.some(v => v >= 80));
  }
  const pairs = sample.students.map(s => {
    const records = sample.scores.filter(r => r.studentId === s.id && !r.absent);
    return [mean(records.filter(r => tests.get(r.testId).gradeYear === 1).map(r => r.total)), mean(records.filter(r => tests.get(r.testId).gradeYear === 2).map(r => r.total))];
  });
  assert.ok(pairs.every(pair => pair.every(Number.isFinite)));
  assert.ok(pairs.filter(([a, b]) => b > a).length >= 30);
  assert.ok(pairs.filter(([a, b]) => b < a).length >= 5);
  assert.ok(mean(pairs.map(([a, b]) => b - a)) > 0);
  assert.ok(sample.scores.filter(r => !r.absent).some(r => new Set(Object.values(r.domains)).size >= 4));
});
