'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '../src/files');
const XLSX = require(path.join(root, 'vendor/xlsx.full.min.js'));
const ExcelJS = require(path.join(root, 'vendor/exceljs.min.js'));
function harness() {
  const alerts = [], confirms = [];
  const context = vm.createContext({ XLSX, console, window: { ExcelJS, crypto: webcrypto, addEventListener() {} },
    document: { addEventListener() {}, getElementById() { return null; } },
    alert: s => alerts.push(s), confirm: s => { confirms.push(s); return context.allowImport !== false; } });
  for (const name of ['import-core.js', 'excel-templates.js', 'initial-import.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '') + `
    renderAll=()=>{};markDirty=()=>{};
    data={version:3,students:['a','b','c'].map((id,i)=>({id,name:'架空生徒'+(i+1),className:'1年1組',number:i+1})),tests:[],scores:[],metrics:[],interventions:[]};rebuildIndex();
    globalThis.api={getData:()=>data,importTestTemplate,validateDataset};`, context);
  return { context, alerts, confirms, excel: context.window.GD_EXCEL, initial: context.window.GD_INITIAL, api: context.api };
}
async function written(excel, wb) {
  const bytes = await excel.writeBuffer(wb);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes);
  return { bytes, book };
}
function set(wb, sheet, address, value) {
  const ws = wb.Sheets[sheet], style = ws[address]?.s;
  XLSX.utils.sheet_add_aoa(ws, [[value]], { origin: address });
  if (style) ws[address].s = style;
}
function configured(h) {
  const wb = h.excel.testTemplate(XLSX, h.api.getData().students);
  for (const [key, value] of Object.entries({ B8: '英語', B10: '架空の新形式テスト', B14: '2026/06/24', B16: 1, B18: '期末テスト', B20: '架空シリーズ' })) set(wb, '① テスト設定', key, value);
  return wb;
}
async function importWorkbook(h, wb) {
  const bytes = await h.excel.writeBuffer(wb);
  await h.api.importTestTemplate({ arrayBuffer: async () => bytes });
}
test('#30 名簿専用の実ファイルに統一書式・入力規則・固定行を保存する', async () => {
  const h = harness(), wb = h.initial.createTemplate(XLSX);
  const before = JSON.stringify(wb), { book } = await written(h.excel, wb);
  const ws = book.getWorksheet('名簿入力');
  assert.deepEqual(book.worksheets.map(s => s.name), ['名簿入力', '記入例']);
  assert.deepEqual([1, 2, 3, 4].map(c => ws.getCell(8, c).value), ['学年', 'クラス', '出席番号', '氏名']);
  assert.equal(ws.columnCount, 4);
  assert.equal(ws.getCell('A1').fill.fgColor.argb, 'FF18334F');
  assert.equal(ws.getCell('A8').fill.fgColor.argb, 'FF245B86');
  assert.equal(ws.getCell('A10').fill.fgColor.argb, 'FFFFF5D6');
  assert.equal(ws.getCell('A10').border.bottom.style, 'thin');
  assert.equal(ws.getCell('A10').dataValidation.type, 'list');
  assert.equal(ws.views[0].topLeftCell, 'A10');
  assert.ok(!book.worksheets.some(s => /テスト/.test(s.name)));
  assert.equal(JSON.stringify(wb), before, 'writing must not mutate the template');
});
test('#30 テスト実ファイルの書式・配点数式・日付・選択欄・F10固定を確認する', async () => {
  const h = harness(), { book, bytes } = await written(h.excel, configured(h));
  assert.deepEqual(book.worksheets.map(s => s.name), ['① テスト設定', '② 点数入力', '記入例']);
  const settings = book.worksheets[0], scores = book.worksheets[1];
  assert.equal(settings.getCell('B12').value.formula, "SUM('② 点数入力'!8:8)");
  assert.equal(settings.getCell('B12').fill.fgColor.argb, 'FFF1F4F8');
  assert.equal(settings.getCell('B14').numFmt, 'yyyy/mm/dd');
  assert.ok(settings.getCell('B14').dataValidation.formulae.every(d => Number.isFinite(d.getTime())));
  assert.match(settings.getCell('B18').dataValidation.formulae[0], /期末テスト/);
  assert.equal(scores.getCell('A10').fill.fgColor.argb, 'FFF1F4F8');
  assert.equal(scores.getCell('F10').fill.fgColor.argb, 'FFFFF5D6');
  assert.equal(scores.getCell('F10').dataValidation.type, 'custom');
  assert.equal(scores.views[0].topLeftCell, 'F10');
  assert.equal(scores.getCell('A10').value, 'a');
  assert.equal(scores.getCell('F10').value, '');
  assert.equal(XLSX.read(bytes, { type: 'array' }).Workbook.CalcPr.fullCalcOnLoad, '1');
});
test('#30 名簿4列の書式付きExcelを読んでもテスト・点数は作られない', async () => {
  const h = harness(), wb = h.initial.createTemplate(XLSX);
  XLSX.utils.sheet_add_aoa(wb.Sheets['名簿入力'], [[1, '1', 1, '架空あおい'], [2, 'A', 1, '架空そら']], { origin: 'A10' });
  const { bytes } = await written(h.excel, wb);
  const read = XLSX.read(bytes, { type: 'array' }), plan = h.initial.planWorkbook(read, XLSX);
  assert.equal(plan.errors.length, 0);
  assert.deepEqual(Array.from(plan.dataset.students, s => s.className), ['1年1組', '2年A組']);
  assert.equal(plan.dataset.tests.length, 0); assert.equal(plan.dataset.scores.length, 0);
  assert.equal(new Set(plan.dataset.students.map(s => s.id)).size, 2);
});
test('#30 名簿の点数列・不正行は黙って捨てずに全体を拒否する', () => {
  const h = harness();
  for (const row of [[1, '1', 1, '架空生徒', 80], [4, '1', 1, '架空生徒'], [1, '1', '', '架空生徒']]) {
    const wb = h.initial.createTemplate(XLSX);
    XLSX.utils.sheet_add_aoa(wb.Sheets['名簿入力'], [[1, '1', 2, '架空生徒2'], row], { origin: 'A10' });
    const result = h.initial.planWorkbook(wb, XLSX);
    assert.ok(result.errors.length); assert.equal(result.dataset, undefined);
  }
});
test('#30 識別された説明行だけを飛ばし、実際の不正な生徒行は検証する', () => {
  const h = harness(), wb = h.initial.createTemplate(XLSX);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['名簿入力'], { header: 1, defval: '' });
  rows.splice(8, 1);
  rows[8] = [1, '1', 1, '架空生徒'];
  wb.Sheets['名簿入力'] = XLSX.utils.aoa_to_sheet(rows);
  assert.equal(h.initial.planWorkbook(wb, XLSX).dataset.students.length, 1);
  rows[8] = ['説明のつもり', '不正', '', ''];
  wb.Sheets['名簿入力'] = XLSX.utils.aoa_to_sheet(rows);
  assert.ok(h.initial.planWorkbook(wb, XLSX).errors.length);
});
test('#30 列を追加し満点のキャッシュが古い・未計算でも配点から取り込む', async () => {
  for (const cache of [0, 100, 9999, undefined]) {
    const h = harness(), wb = configured(h);
    wb.Sheets['① テスト設定'].B12.v = cache;
    for (const [address, value] of Object.entries({ F10: 20, G10: 10, H10: 10, I10: 10, K7: '読解', K8: 10, K9: '追加問題', K10: 0 })) set(wb, '② 点数入力', address, value);
    await importWorkbook(h, wb);
    const d = h.api.getData(); assert.equal(d.tests.length, 1, h.alerts.join('\n'));
    assert.equal(d.tests[0].maxScore, 110); assert.equal(d.tests[0].questions.length, 5);
    assert.equal(d.tests[0].date, '2026-06-24'); assert.equal(d.tests[0].kind, 'final');
    assert.equal(d.tests[0].series, '架空シリーズ'); assert.equal(d.scores[0].total, 50);
    assert.equal(h.api.validateDataset(d).length, 0);
  }
});
test('#30 書式付きの新形式でも途中入力・0点・欠席・未入力を区別する', async () => {
  const h = harness(), wb = configured(h);
  for (const [address, value] of Object.entries({ F10: 25, F11: 0, G11: 0, H11: 0, I11: 0, F12: '欠' })) set(wb, '② 点数入力', address, value);
  await importWorkbook(h, wb);
  const d = h.api.getData();
  assert.equal(d.tests.length, 1, h.alerts.join('\n'));
  assert.deepEqual(Array.from(d.scores, r => [r.studentId, r.total, !!r.absent]), [['a', null, false], ['b', 0, false], ['c', null, true]]);
  assert.deepEqual(Object.keys(d.scores[0].questions), ['q1']);
});
test('#30 新形式の必須日付・種類・照合・得点の不正値で一部反映しない', async () => {
  for (const edit of [wb => set(wb,'① テスト設定','B14',''), wb => set(wb,'① テスト設定','B14','2026-02-30'),
    wb => set(wb,'① テスト設定','B14',60), wb => set(wb,'① テスト設定','B18','unknown'),
    wb => set(wb,'② 点数入力','A10','missing'), wb => set(wb,'② 点数入力','F10',26)]) {
    const h = harness(), wb = configured(h), before = JSON.stringify(h.api.getData());
    set(wb, '② 点数入力', 'F11', 1); edit(wb); await importWorkbook(h, wb);
    assert.equal(JSON.stringify(h.api.getData()), before); assert.ok(h.alerts.length); assert.equal(h.confirms.length, 0);
  }
});
test('#30 設定シートの重複・消失と取込の取消を安全に扱う', async () => {
  for (const mode of ['missing', 'duplicate', 'cancel']) {
    const h = harness(), wb = configured(h), before = JSON.stringify(h.api.getData());
    if (mode === 'missing') { wb.SheetNames = wb.SheetNames.filter(n => n !== '① テスト設定'); delete wb.Sheets['① テスト設定']; }
    if (mode === 'duplicate') XLSX.utils.book_append_sheet(wb, wb.Sheets['① テスト設定'], 'テスト設定');
    if (mode === 'cancel') h.context.allowImport = false;
    await importWorkbook(h, wb); assert.equal(JSON.stringify(h.api.getData()), before);
  }
});
test('#30 生徒名の先頭の等号をExcelの数式として書き出さない', async () => {
  const h = harness(), wb = h.excel.testTemplate(XLSX, [{ id: 'a', name: '=1+1', className: '1年1組', number: 1 }]);
  const { book } = await written(h.excel, wb);
  assert.equal(book.worksheets[1].getCell('E10').value, '=1+1');
  assert.notEqual(book.worksheets[1].getCell('E10').type, ExcelJS.ValueType.Formula);
});
