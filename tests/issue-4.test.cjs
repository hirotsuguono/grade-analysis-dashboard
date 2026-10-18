'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const progressDataset = require('./issue-4-fixtures.cjs');

const root = process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files');
const source = fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function render(dataset) {
  const elements = {};
  let option;
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: {
      addEventListener() {},
      getElementById(id) { return elements[id] ||= {}; },
    },
    capture(value) { option = value; },
  });
  vm.runInContext(source + `
    chart = () => ({ setOption: capture });
    globalThis.renderProgress = value => {
      data = value;
      rebuildIndex();
      ui.rtiSelectedIv = 'iv';
      renderRtiProgress();
    };
  `, context);
  context.renderProgress(dataset);
  return { note: elements.rtiEsNote, option: JSON.parse(JSON.stringify(option)) };
}

for (const subject of ['英語', 'all']) {
  for (const emptyIndex of [0, 1, 2]) {
    test(`支援変化量は空回を位置${emptyIndex}に除外しても同じ直近回のSDを使う (${subject})`, () => {
      const classRates = [[60, 80], [50, 50], [40, 20]];
      classRates.forEach(rates => rates.splice(emptyIndex, 0, null));
      const dataset = progressDataset(classRates, subject);
      const before = JSON.stringify(dataset);
      const { note, option } = render(dataset);
      assert.equal(note.hidden, false);
      assert.match(note.innerHTML, /直近 80%.*<strong>\+0\.67<\/strong>/);
      assert.deepEqual(option.series[0].data, [60, 80]);
      assert.deepEqual(option.series[1].data, [50, 50]);
      assert.deepEqual(option.xAxis.data, dataset.tests.filter((_, i) => i !== emptyIndex).map(t => t.name));
      assert.equal(JSON.stringify(dataset), before, 'rendering must preserve saved scores');
    });
  }
}

test('空回がなくても直近回のSDで標準化する', () => {
  assert.match(render(progressDataset([[60, 80], [50, 50], [40, 20]])).note.innerHTML, /<strong>\+0\.67<\/strong>/);
});

test('クラスだけ後続回に得点がある場合は本人の直近回のSDを使う', () => {
  const { note, option } = render(progressDataset([[null, 80, null], [null, 50, 60], [null, 20, 40]]));
  assert.match(note.innerHTML, /直近 80%.*<strong>\+0\.67<\/strong>/);
  assert.deepEqual(option.series[0].data, [80, null]);
  assert.deepEqual(option.series[1].data, [50, 50]);
});

test('本人の直近回でクラス標本が3人未満なら別の回で代用しない', () => {
  const { note } = render(progressDataset([[null, 60, 80], [null, 50, 50], [null, 40, null]]));
  assert.equal(note.hidden, true);
  assert.equal(note.innerHTML, '');
});

test('直近回の分散が0なら以前の回のSDで代用しない', () => {
  const { note } = render(progressDataset([[null, 60, 80], [null, 50, 80], [null, 40, 80]]));
  assert.equal(note.hidden, true);
});

test('全回が空または本人が未受験なら変化量を表示しない', () => {
  for (const classRates of [[[null, null], [null, null], [null, null]], [[null, null], [60, 50], [40, 30]]]) {
    const { note } = render(progressDataset(classRates));
    assert.equal(note.hidden, true);
  }
});

test('0点・開始時0%も空回として除外しない', () => {
  const { note, option } = render(progressDataset([[null, 0], [null, 30], [null, 60]], '英語', 0));
  assert.equal(note.hidden, false);
  assert.match(note.innerHTML, /開始時 0% → 直近 0%.*<strong>\+0\.00<\/strong>/);
  assert.deepEqual(option.series[0].data, [0]);
});
