'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { fixture, noAxes } = require('./correlation-fixtures.cjs');

const source = fs.readFileSync(path.join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function harness() {
  const elements = new Map(), alerts = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', hidden: false });
    return elements.get(id);
  };
  let lastChartOption;
  const instance = { setOption(option) { lastChartOption = option; }, clear() { lastChartOption = undefined; } };
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: element },
    alert(message) { alerts.push(message); },
    echarts: { registerTheme() {}, getInstanceByDom(el) { assert.equal(el, element('corrChart')); return instance; } },
    instance,
  });
  vm.runInContext(source + `
    chart=()=>instance;
    updateRoleUI=()=>{};
    renderAll=()=>{ if(ui.tab==='metrics') renderCorrelation(); };
    globalThis.api={ applyJsonText, renderCorrelation, ui };
  `, context);
  const { applyJsonText, renderCorrelation, ui } = context.api;
  const load = data => {
    assert.equal(applyJsonText(JSON.stringify(data), 'fictional.json', null), true, alerts.join('\n'));
  };
  return { element, load, renderCorrelation, ui, getOption: () => lastChartOption };
}

test('loading a new dataset scrubs previous correlation output even off the metrics tab', () => {
  const h = harness();
  h.ui.tab = 'metrics';
  h.load(fixture([[15, 1], [0, 16]]));
  assert.match(h.element('corrOutliers').innerHTML, /架空生徒fictional-16/);
  assert.match(h.element('chiTableWrap').innerHTML, /架空アンケート/);
  assert.match(h.element('chiResult').innerHTML, /1%水準で有意/);
  assert.ok(h.getOption());

  h.ui.tab = 'overview';
  h.load(noAxes);
  for (const card of ['corrBanner', 'corrOutlierCard', 'corrChiCard']) assert.equal(h.element(card).hidden, true);
  for (const content of ['corrBanner', 'corrOutliers', 'chiTableWrap', 'chiResult']) assert.equal(h.element(content).innerHTML, '');
  assert.equal(h.getOption(), undefined);
  h.renderCorrelation();
  for (const card of ['corrOutlierCard', 'corrChiCard']) assert.equal(h.element(card).hidden, true);
});

test('sparse 2×2 tables retain observed counts and omit a test verdict; adequately sized cells still report one', () => {
  const h = harness();
  h.ui.tab = 'metrics';
  h.load(fixture([[1, 0], [0, 9]]));
  assert.equal(h.element('corrChiCard').hidden, false);
  assert.match(h.element('chiTableWrap').innerHTML, /<td>1<\/td><td>0<\/td>[\s\S]*<td>0<\/td><td>9<\/td>/);
  assert.match(h.element('chiResult').innerHTML, /期待度数.*少なすぎます/);
  assert.match(h.element('chiResult').innerHTML, /実際の人数の内訳/);
  assert.doesNotMatch(h.element('chiResult').innerHTML, /水準で有意|統計的に確かな関連|χ² = |V = /);

  // A 2×2 with all expected counts exactly five is testable despite observed zeros.
  h.load(fixture([[10, 0], [0, 10]]));
  assert.equal(h.element('corrChiCard').hidden, false);
  assert.match(h.element('chiResult').innerHTML, /関連あり（1%水準で有意）/);
  assert.match(h.element('chiResult').innerHTML, /χ² = 20\.00/);

  h.ui.corrX = h.ui.corrY;
  h.renderCorrelation();
  assert.equal(h.element('corrChiCard').hidden, true);
  assert.equal(h.element('chiTableWrap').innerHTML, '');
  assert.equal(h.element('chiResult').innerHTML, '');
});
