'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'files', 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function harness(dataset) {
  const context = vm.createContext({
    console,
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById() {
      return { closest() { return { querySelector() { return {}; } }; } };
    } },
  });
  vm.runInContext(source + `
    chart = () => ({ setOption(option) { globalThis.option = option; } });
    globalThis.dashboard = {
      load(value) { data = value; rebuildIndex(); ui.trendSubject = SUM_KEY; },
      values(sid) { return trendAxis().valueOf(sid); },
      cell(sid, tests) { return listCell({ kind: 'termTotal', tests, maxSum: tests.reduce((n, t) => n + t.maxScore, 0) }, { id: sid }); },
      draw(ids, klass = 'all') { ui.trendSelected = new Set(ids); ui.trendClass = klass; renderTrendChart(); return globalThis.option; },
    };
  `, context);
  context.dashboard.load(dataset);
  return context.dashboard;
}

function fixture() {
  return {
    students: [
      { id: 'a', name: '架空生徒A', className: '1A', number: 1 },
      { id: 'b', name: '架空生徒B', className: '1A', number: 2 },
    ],
    tests: [
      { id: 'math', name: '前期中間', gradeYear: 1, subject: '数学', maxScore: 100 },
      { id: 'english', name: '前期中間', gradeYear: 1, subject: '英語', maxScore: 100 },
    ],
    scores: [
      { studentId: 'a', testId: 'math', total: 80 },
      { studentId: 'b', testId: 'math', total: 80 },
      { studentId: 'b', testId: 'english', total: 80 },
    ],
  };
}

test('全教科推移は部分合計を表示せず、完成した合計だけでクラス平均を描画する', () => {
  const data = fixture();
  const core = harness(data);
  assert.deepEqual(Array.from(core.values('a')), [null]);
  assert.deepEqual(Array.from(core.values('b')), [160]);
  assert.equal(core.cell('a', data.tests).raw, undefined);
  assert.equal(core.cell('b', data.tests).raw, 160);
  const chart = core.draw(['a', 'b']);
  assert.deepEqual(Array.from(chart.series[0].data), [null]);
  assert.deepEqual(Array.from(chart.series[1].data), [160]);
  assert.deepEqual(Array.from(chart.series[2].data), [160]);
});

test('全教科合計は0点を有効とし、未入力・欠席の保存済み得点を除外する', () => {
  for (const missing of ['none', null, undefined, 'absent']) {
    const data = fixture();
    data.scores[1].total = 0;
    data.scores[2].total = 0;
    if (missing !== 'none') data.scores.push({ studentId: 'a', testId: 'english', total: missing === 'absent' ? 100 : missing, ...(missing === 'absent' ? { absent: true } : {}) });
    const core = harness(data);
    assert.equal(core.values('a')[0], null);
    assert.equal(core.values('b')[0], 0);
    assert.equal(core.cell('a', data.tests).raw, undefined);
    assert.equal(core.cell('b', data.tests).raw, 0);
    assert.deepEqual(Array.from(core.draw(['a', 'b']).series[2].data), [0]);
  }
});

test('全教科の完成判定は回ごとに独立し、別クラスの完成者をクラス平均へ混ぜない', () => {
  const data = fixture();
  data.students[1].className = '1B';
  data.tests.push({ id: 'later', name: '前期期末', gradeYear: 1, subject: '数学', maxScore: 100 });
  data.scores.push({ studentId: 'a', testId: 'later', total: 70 });
  const core = harness(data);
  assert.deepEqual(Array.from(core.values('a')), [null, 70]);
  assert.deepEqual(Array.from(core.values('b')), [160, null]);
  const chart = core.draw(['a'], '1A');
  assert.deepEqual(Array.from(chart.xAxis.data), ['1年・前期期末']);
  assert.deepEqual(Array.from(chart.series[1].data), [70]);
  assert.equal(core.cell('a', data.tests.slice(2)).raw, 70);
});

test('全員の合計が未完成の回では平均やゼロ点を捏造しない', () => {
  const data = fixture();
  data.scores.pop();
  const core = harness(data);
  assert.equal(core.values('a')[0], null);
  assert.equal(core.values('b')[0], null);
  const chart = core.draw(['a', 'b']);
  assert.equal(chart.xAxis.data.length, 0);
  assert.ok(chart.series.every(series => series.data.length === 0));
});
