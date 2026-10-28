'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const XLSX = require('../src/files/vendor/xlsx.full.min.js');
const sample = () => JSON.parse(fs.readFileSync(path.join(root, 'src/files/sample-data.json')));
function harness() {
  const elements = new Map();
  const context = vm.createContext({ console, XLSX, TextEncoder, alert() {},
    window: { addEventListener() {} }, document: { addEventListener() {}, getElementById(id) {
      if (!elements.has(id)) elements.set(id, { hidden: false, disabled: false, textContent: '' });
      return elements.get(id);
    } } });
  vm.runInContext(fs.readFileSync(path.join(root, 'src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '') + `
    renderAll = () => {}; updateRoleUI = () => {}; updateSaveStatus = () => {};
    globalThis.api = { validateDataset, applyJsonText,
      failRender() { renderAll = () => { throw new Error('synthetic render failure'); }; },
      seed(d) { data = d; fileHandle = { name: 'original.json' }; fileName = 'original.json';
        dirty = true; lastDiskText = 'original bytes'; activeDataToken = 9;
        pendingDownload = { synthetic: true }; isAdmin = true; ui.ovClass = 'original'; rebuildIndex(); },
      state() { return { data, fileHandle, fileName, dirty, lastDiskText, activeDataToken,
        pendingDownload, isAdmin, scoreIndex, selected: ui.ovClass }; }
    };`, context);
  return context.api;
}
test('JSON rejects non-scalar roster numbers, grades, settings and nested score values', () => {
  const api = harness();
  for (const value of [{ formula: '1+1', result: 2 }, { hyperlink: 'https://example.invalid' }, [], true, -1, 1.5, '1x']) {
    const d = sample(); d.students[0].number = value;
    assert.ok(api.validateDataset(d).length, 'invalid number accepted');
  }
  for (const change of [d => d.tests[0].gradeYear = {}, d => d.settings.rti = [],
    d => d.settings.adminPinHash = {}, d => d.version = '3',
    d => d.students[0].classHistory = [{ number: {} }],
    d => d.scores[0].domains = { unknown: {} }, d => d.tests[0].questions[0].label = {}]) {
    const d = sample(); change(d); assert.ok(api.validateDataset(d).length);
  }
});
test('JSON v1-v3 retain numeric-string attendance numbers and missing optional fields', () => {
  const api = harness();
  for (const version of [1, 2, 3]) {
    const d = sample(); d.version = version; d.students[0].number = '01';
    delete d.settings; delete d.metrics; delete d.interventions;
    assert.equal(api.validateDataset(d).length, 0);
    assert.equal(api.applyJsonText(JSON.stringify(d), 'legacy.json', null), true);
  }
});
test('parse, validation and rendering failures preserve original dataset and every save-state field', () => {
  for (const mode of ['parse', 'number', 'settings', 'render']) {
    const api = harness(), original = sample(); api.seed(original);
    const before = api.state(); const next = sample();
    if (mode === 'number') next.students[0].number = { formula: '1+1', result: 2 };
    if (mode === 'settings') next.settings.rti = false;
    if (mode === 'render') api.failRender();
    api.applyJsonText(mode === 'parse' ? '{' : JSON.stringify(next), 'replacement.json', { name: 'replacement.json' });
    const after = api.state();
    for (const key of Object.keys(before)) assert.equal(after[key], before[key], mode + ': ' + key);
  }
});
test('ExcelJS boundary rejects injected object values and keeps formula-like strings as text', async () => {
  const context = vm.createContext({ console, window: { GD_IMPORT: require('../src/files/import-core.js') } });
  context.window.GD_IMPORT = globalThis.GD_IMPORT;
  context.window.ExcelJS = require('../src/files/vendor/exceljs.min.js');
  vm.runInContext(fs.readFileSync(path.join(root, 'src/files/excel-templates.js'), 'utf8'), context);
  const excel = context.window.GD_EXCEL;
  assert.throws(() => excel.testTemplate(XLSX, [{ id: 's', name: '架空生徒', className: '1年1組', number: { formula: '1+1', result: 2 } }]), /文字列/);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, { '!ref': 'A1', A1: { t: 's', v: {} } }, '架空');
  await assert.rejects(excel.writeBuffer(wb), /文字列/);
  wb.Sheets['架空'].A1.v = '=1+1';
  const output = await excel.writeBuffer(wb);
  const restored = XLSX.read(output, { type: 'array' }).Sheets['架空'].A1;
  assert.equal(restored.v, '=1+1'); assert.equal(restored.f, undefined);
});
