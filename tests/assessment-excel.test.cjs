'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../src/files');
const XLSX = require(path.join(root, 'vendor/xlsx.full.min.js'));
const ExcelJS = require(path.join(root, 'vendor/exceljs.min.js'));
const C = require(path.join(root, 'assessment-classification.js'));
function harness() {
  const alerts = [];
  const context = vm.createContext({ Blob, DecompressionStream, XLSX, window: { ExcelJS, addEventListener() {} }, document: { addEventListener() {} }, alert: value => alerts.push(value), confirm: () => true });
  for (const name of ['import-core.js', 'excel-templates.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '') + `
    data = {version:3,students:[{id:'a',name:'架空生徒A',className:'1年A組',number:1},{id:'b',name:'架空生徒B',className:'1年A組',number:2},{id:'c',name:'架空生徒C',className:'1年A組',number:3}],tests:[],scores:[],metrics:[],interventions:[]};
    fileName='fictional-unsaved.json';fileHandle={name:'fictional-unsaved.json'};dirty=true;
    markDirty=()=>{};renderAll=()=>{};rebuildIndex();
    globalThis.api={data,importTestTemplate,validateDataset, snapshot:()=>({data:JSON.stringify(data),fileName,fileHandle,dirty})};`, context);
  const excel = context.window.GD_EXCEL, wb = excel.testTemplate(XLSX, context.api.data.students);
  for (const [key, value] of Object.entries({ B8: '英語', B10: '架空の二軸テスト', B14: '2026-06-24' })) set(wb, '① テスト設定', key, value);
  return { api: context.api, excel, wb, alerts, core: context.window.GD_IMPORT };
}
function set(wb, sheet, address, value) { XLSX.utils.sheet_add_aoa(wb.Sheets[sheet], [[value]], { origin: address }); }
async function load(h) { await h.api.importTestTemplate(new Blob([await h.excel.writeBuffer(h.wb)])); }
test('new workbook stores three perspective choices, fixed headers and two input-granularity examples', async () => {
  const h = harness(), book = new ExcelJS.Workbook(); await book.xlsx.load(await h.excel.writeBuffer(h.wb));
  const sheet = book.getWorksheet('② 点数入力'), example = book.getWorksheet('記入例');
  assert.equal(sheet.getCell('A8').value, '2 評価の観点 →');
  for (let c = 6; c <= 55; c++) {
    assert.equal(sheet.getCell(8, c).dataValidation.type, 'list');
    assert.deepEqual(sheet.getCell(8, c).dataValidation.formulae, ['"知識・技能,思考・判断・表現,未設定"']);
    assert.equal(sheet.getCell(8, c).value, '');
  }
  assert.equal(sheet.views[0].topLeftCell, 'F11');
  assert.equal(book.getWorksheet('① テスト設定').getCell('B12').value.formula, "SUM('② 点数入力'!9:9)");
  assert.deepEqual(['F7', 'G7', 'F8', 'G8'].map(key => example.getCell(key).value), ['リスニング', 'リスニング', '知識・技能', '思考・判断・表現']);
  assert.deepEqual(['F10', 'G10', 'H10', 'I10'].map(key => example.getCell(key).value), ['大問1-(1)', '大問1-(2)', '大問2・知識技能分', '大問2・思考判断表現分']);
  assert.match(example.getCell('A5').value, /二重入力/);
});
test('real XLSX import stores each score once and supports independent domain and perspective totals', async () => {
  const h = harness();
  for (const [address, value] of Object.entries({ F7:'リスニング',G7:'リスニング',H7:'読解',I7:'その他',F8:'知識・技能',G8:'思考・判断・表現',H8:'知識・技能',I8:'未設定',F9:2,G9:3,H9:4,I9:5,F10:'大問1-(1)',G10:'大問1-(2)',H10:'大問2・知識技能分',I10:'内訳不明の合計',F11:2,G11:1,H11:4,I11:0,F12:0,G12:0,H12:0,I12:0,F13:'欠' })) set(h.wb, '② 点数入力', address, value);
  const roster = JSON.stringify(h.api.data.students);
  await load(h);
  const d = h.api.data;
  assert.equal(d.tests.length, 1, h.alerts.join('\n')); assert.equal(d.tests[0].maxScore, 14);
  assert.deepEqual(Array.from(d.tests[0].questions, q => q.perspective || ''), ['knowledge', 'thinking', 'knowledge', '']);
  assert.deepEqual(Array.from(d.scores, r => [r.studentId, r.total, !!r.absent]), [['a',7,false],['b',0,false],['c',null,true]]);
  assert.equal(Object.keys(d.scores[0].questions).length, 4);
  const groups = C.summarize(d.tests[0], d.scores, 'perspective');
  assert.deepEqual(groups.map(g => [g.key,g.max,g.n]), [['knowledge',6,2],['thinking',3,2],['',5,2]]);
  assert.equal(groups[0].rate, 50); assert.ok(Math.abs(groups[1].rate - 100/6) < 1e-12); assert.equal(groups[2].rate, 0);
  assert.equal(C.score(d.scores[0], C.groups(d.tests[0])[0]), 3);
  assert.equal(JSON.stringify(d.students), roster); assert.equal(h.api.validateDataset(d).length, 0);
});
test('unknown perspective labels, missing item names and missing perspective headers leave all state untouched', async () => {
  const edits = [
    h=>set(h.wb,'② 点数入力','F8','knowledge'), h=>set(h.wb,'② 点数入力','F8','知識技能'),
    h=>set(h.wb,'② 点数入力','F8',3), h=>set(h.wb,'② 点数入力','BD8','知識・技能'),
    h=>set(h.wb,'② 点数入力','BD7','遠い分野'), h=>set(h.wb,'② 点数入力','BD9',5),
    h=>set(h.wb,'② 点数入力','A8',''),
  ];
  for (const edit of edits) {
    const h = harness(), before = h.api.snapshot();
    set(h.wb,'② 点数入力','F11',1); edit(h); await load(h);
    const after = h.api.snapshot(); assert.deepEqual(after, before); assert.strictEqual(after.fileHandle, before.fileHandle);
    assert.ok(h.alerts.length); assert.equal(h.api.data.tests.length, 0);
  }
});
test('perspective parsing accepts only the displayed choices and empty cells', () => {
  const h = harness();
  for (const value of ['', undefined, null, '未設定']) assert.equal(h.core.parsePerspective(value), '');
  assert.equal(h.core.parsePerspective('知識・技能'), 'knowledge'); assert.equal(h.core.parsePerspective('思考・判断・表現'), 'thinking');
  for (const value of ['知識技能','knowledge','thinking',true,{},['知識・技能']]) assert.equal(h.core.parsePerspective(value), null);
});
