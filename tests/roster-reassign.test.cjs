'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.join(__dirname, '../src/files');
const XLSX = require(path.join(root, 'vendor/xlsx.full.min.js'));
const ExcelJS = require(path.join(root, 'vendor/exceljs.min.js'));
const plain = x => JSON.parse(JSON.stringify(x));
const fixture = () => ({ version: 3, name: '架空のクラス替え',
  students: [{ id: 's1', name: '架空の同名', className: '1年A組', number: 1 }, { id: 's2', name: '架空の同名', className: '1年A組', number: 2 }, { id: 's3', name: '架空生徒003', className: '2年A組', number: 1 }],
  tests: [{ id: 't1', name: '架空テスト', subject: '英語', maxScore: 100 }], scores: [{ studentId: 's1', testId: 't1', total: 0 }],
  metrics: [{ id: 'm1', label: '架空指標', type: 'number', values: { s1: 5 } }],
  interventions: [{ id: 'iv1', studentId: 's1', title: '架空支援', subject: '英語', status: 'active' }], settings: { rti: { tier2: 60, tier3: 40 } } });
const config = overrides => ({ sourceType: 'grade', sourceValue: '1', grade: 2, naming: 'letters', count: 3, mode: 'all', kind: 'move', date: '2026-06-24', ...overrides });
function harness() {
  const elements = {}, alerts = [], downloads = [], blobs = [];
  for (const id of ['reassignPreview', 'reassignCommit', 'reassignApplyBtn', 'reassignBackupConfirmed', 'reassignUndoBtn', 'reassignScope', 'reassignGrade', 'reassignNaming', 'reassignCount', 'reassignMode', 'reassignKind', 'reassignDate']) elements[id] = { hidden: true, disabled: true, checked: false, value: '' };
  const context = vm.createContext({ Blob, DecompressionStream, TextEncoder, crypto: webcrypto, XLSX, console,
    window: { ExcelJS, addEventListener() {} }, setTimeout() {},
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:fictional-' + blobs.length; }, revokeObjectURL() {} },
    document: { addEventListener() {}, getElementById: id => elements[id] || null,
      createElement() { return { click() { if (context.failDownload) throw new Error('fictional download failure'); downloads.push(this.download); } }; } },
    alert: message => alerts.push(message), confirm: () => context.confirmChoice !== false });
  for (const name of ['import-core.js', 'roster-reassign.js', 'excel-templates.js']) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '') + `
    renderAll=()=>{};renderRosterTable=()=>updateReassignUndo();fillReassignScope=()=>{};switchRosterPane=()=>{};markDirty=()=>{};requireAdmin=()=>globalThis.allowAdmin!==false;
    globalThis.api={importReassignWorkbook,saveReassignBackup,applyReassign,undoReassign,invalidateReassignRoster,validateDataset,
      setData(d){data=d;activeDataToken++;},getData:()=>data,plan:()=>reassignPlan,backup:()=>reassignBackupText};`, context);
  return { core: context.window.GD_ROSTER, excel: context.window.GD_EXCEL, api: context.api, context, elements, alerts, downloads, blobs };
}
function put(wb, address, value) { XLSX.utils.sheet_add_aoa(wb.Sheets['クラス替え'], [[value]], { origin: address }); }
function filled(h, d = fixture(), c = config()) {
  const wb = h.excel.reassignTemplate(XLSX, d, c);
  for (const [i, s] of h.core.selectedStudents(d.students, c).entries()) { put(wb, 'E' + (10 + i), '2年B組'); put(wb, 'F' + (10 + i), i + 1); }
  return wb;
}
const plan = (h, wb, d) => h.core.planWorkbook(wb, XLSX, d, '2026-06-24');
async function file(h, wb) { return new Blob([await h.excel.writeBuffer(wb)]); }
async function ready(h, d = fixture(), wb = filled(h, d)) { h.api.setData(d); await h.api.importReassignWorkbook(await file(h, wb)); assert.ok(h.api.plan(), h.elements.reassignPreview.innerHTML); return d; }
function backed(h) { h.api.saveReassignBackup(); h.elements.reassignBackupConfirmed.checked = true; }

test('実XLSXに名簿・空の入力欄・名前付き選択肢・入力規則を保存する', async () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d), wb = h.excel.reassignTemplate(XLSX, d, config({ naming: 'numbers', count: 50 }));
  const bytes = await h.excel.writeBuffer(wb), read = new ExcelJS.Workbook(); await read.xlsx.load(bytes);
  const sheet = read.getWorksheet('クラス替え');
  assert.deepEqual(read.worksheets.map(s => s.name), ['クラス替え', '発行設定']);
  assert.equal(sheet.getCell('A10').value, 's1'); assert.equal(sheet.getCell('B10').value, '架空の同名');
  assert.equal(sheet.getCell('E10').value, ''); assert.equal(sheet.getCell('F10').value, '');
  assert.equal(sheet.getCell('E10').fill.fgColor.argb, 'FFFFF5D6');
  assert.equal(sheet.getCell('A10').fill.fgColor.argb, 'FFF1F4F8');
  assert.equal(sheet.getCell('E10').dataValidation.formulae[0], 'ReassignClasses');
  assert.equal(sheet.getCell('F10').dataValidation.type, 'whole');
  assert.equal(sheet.views[0].topLeftCell, 'E10');
  assert.equal(read.definedNames.model[0].name, 'ReassignClasses');
  assert.match(read.definedNames.model[0].ranges[0], /\$D\$8:\$D\$57/);
  assert.equal(read.getWorksheet('発行設定').getCell('D57').value, '2年50組');
  assert.equal(JSON.stringify(d), before);
});
test('同姓同名でもIDで照合し、行順が変わっても同じ生徒へ計画する', async () => {
  const h = harness(), d = fixture(), wb = filled(h, d), rows = XLSX.utils.sheet_to_json(wb.Sheets['クラス替え'], { header: 1, defval: '' });
  [rows[9], rows[10]] = [rows[10], rows[9]]; wb.Sheets['クラス替え'] = XLSX.utils.aoa_to_sheet(rows);
  const read = await h.context.window.GD_IMPORT.readWorkbook(await file(h, wb), XLSX), result = plan(h, read, d);
  assert.deepEqual(plain(result.errors), []); assert.deepEqual(Array.from(result.changes, c => [c.id, c.number]), [['s2', 2], ['s1', 1]]);
});
test('部分変更は両方空欄なら保持し、全員変更の未記入は拒否する', () => {
  const h = harness(), d = fixture(), c = config({ mode: 'partial' }), wb = h.excel.reassignTemplate(XLSX, d, c);
  put(wb, 'E10', '2年B組'); put(wb, 'F10', 3);
  const result = plan(h, wb, d); assert.equal(result.errors.length, 0); assert.equal(result.changes.length, 1); assert.equal(result.unchanged, 1);
  const all = h.excel.reassignTemplate(XLSX, d, config()); assert.ok(plan(h, all, d).errors.length);
  put(wb, 'E11', '2年B組'); assert.match(plan(h, wb, d).errors.join(), /11行目・F列/);
});
test('ID・氏名・現在所属・番号・見出し・列・候補・新番号の不正は全件拒否する', () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d);
  for (const edit of [w => put(w, 'A10', 'unknown'), w => put(w, 'A11', 's1'), w => put(w, 'B10', '架空の別人'),
    w => put(w, 'C10', '1年B組'), w => put(w, 'D10', 3), w => put(w, 'E9', '変更見出し'), w => put(w, 'G10', '余分'),
    w => put(w, 'E10', '2年Z組'), w => put(w, 'E10', '2B'), w => put(w, 'F10', 0), w => put(w, 'F10', -1),
    w => put(w, 'F10', 1.5), w => put(w, 'F10', '1e3'), w => put(w, 'F10', Number.MAX_SAFE_INTEGER + 1), w => put(w, 'F10', true)]) {
    const wb = filled(h, d); edit(wb); const result = plan(h, wb, d);
    assert.ok(result.errors.length); assert.equal(result.changes.length, 0); assert.equal(JSON.stringify(d), before);
  }
});
test('新規追加・削除・移動・改名後の古いテンプレートと行の削除を拒否する', () => {
  const h = harness();
  for (const edit of [d => d.students.push({ id: 's4', name: '架空追加', className: '1年A組', number: 4 }),
    d => d.students.shift(), d => d.students[0].className = '1年C組', d => d.students[0].name = '架空改名', d => d.students[0].number = 4]) {
    const d = fixture(), wb = filled(h, d); edit(d); assert.ok(plan(h, wb, d).errors.length);
  }
  const d = fixture(), wb = filled(h, d), rows = XLSX.utils.sheet_to_json(wb.Sheets['クラス替え'], { header: 1, defval: '' });
  rows.pop(); wb.Sheets['クラス替え'] = XLSX.utils.aoa_to_sheet(rows); assert.match(plan(h, wb, d).errors.join(), /生徒の行は削除せず/);
});
test('対象外の生徒を含む反映後の番号重複を拒否し、同時の番号交換は許可する', () => {
  const h = harness(), d = fixture(), wb = filled(h, d);
  put(wb, 'E10', '2年A組'); assert.match(plan(h, wb, d).errors.join(), /重複/);
  d.students[2].className = '2A'; assert.match(plan(h, wb, d).errors.join(), /重複/);
  const swap = h.excel.reassignTemplate(XLSX, d, config({ grade: 1, mode: 'partial' }));
  put(swap, 'E10', '1年A組'); put(swap, 'F10', 2); put(swap, 'E11', '1年A組'); put(swap, 'F11', 1);
  assert.equal(plan(h, swap, d).errors.length, 0);
});
test('数式・エラーセル・別データ・発行設定の不正や別形式を拒否する', () => {
  const h = harness(), d = fixture();
  for (const edit of [w => w.Sheets['クラス替え'].F10 = { t: 'n', f: '1+1', v: 2 },
    w => w.Sheets['クラス替え'].D10 = { t: 'n', f: '1', v: 1 },
    w => w.Sheets['クラス替え'].F10 = { t: 'e', v: 7 },
    w => w.Sheets['発行設定'].B8.v = '架空の別データ',
    w => w.Sheets['発行設定'].B13.v = 0,
    w => w.Sheets['発行設定'].B16.v = '2026-02-30',
    w => { w.SheetNames = ['クラス替え']; delete w.Sheets['発行設定']; }]) {
    const wb = filled(h, d); edit(wb); assert.ok(plan(h, wb, d).errors.length);
  }
});
test('未来の所属変更と記録済み履歴より前の日付を拒否し、訂正では履歴を増やさない', () => {
  const h = harness(), d = fixture(); d.students[0].classHistory = [{ className: '1年B組', number: 4, at: '2026-06-23' }];
  assert.match(plan(h, filled(h, d, config({ date: '2026-06-25' })), d).errors.join(), /未来/);
  assert.match(plan(h, filled(h, d, config({ date: '2026-06-22' })), d).errors.join(), /記録済み/);
  const move = plan(h, filled(h, d), d), after = h.core.changedStudents(d.students, move);
  assert.equal(after[0].classHistory.length, 2); assert.deepEqual(plain(after[0].classHistory[1]), { className: '1年A組', number: 1, at: '2026-06-24' });
  const correction = plan(h, filled(h, d, config({ kind: 'correction', date: '2026-06-22' })), d);
  assert.equal(correction.errors.length, 0);
  assert.deepEqual(plain(h.core.changedStudents(d.students, correction)[0].classHistory), d.students[0].classHistory);
  assert.equal(d.students[0].className, '1年A組');
});
test('無変更の再取込は履歴を増やさず、選んだクラス・学年だけを対象にする', () => {
  const h = harness(), d = fixture(), c = config({ sourceType: 'class', sourceValue: '1年A組', grade: 1 });
  const wb = h.excel.reassignTemplate(XLSX, d, c);
  for (let i = 0; i < 2; i++) { put(wb, 'E' + (10 + i), '1年A組'); put(wb, 'F' + (10 + i), i + 1); }
  const result = plan(h, wb, d); assert.equal(result.changes.length, 0); assert.equal(result.unchanged, 2);
  assert.equal(h.core.selectedStudents(d.students, config({ sourceType: 'all', sourceValue: '' })).length, 3);
});
test('バックアップ確認前・確認取消・反映確認の取消では元データを保つ', async () => {
  const h = harness(), d = await ready(h), before = JSON.stringify(d);
  h.api.applyReassign(); assert.equal(JSON.stringify(d), before);
  h.api.saveReassignBackup(); assert.equal(await h.blobs[0].text(), JSON.stringify(d, null, 2));
  h.api.applyReassign(); assert.equal(JSON.stringify(d), before);
  h.elements.reassignBackupConfirmed.checked = true; h.context.confirmChoice = false;
  h.api.applyReassign(); assert.equal(JSON.stringify(d), before); assert.ok(h.api.plan());
});
test('反映・取り消しでIDと点数・指標・支援記録を保持し、その後の点数入力も消さない', async () => {
  const h = harness(), d = await ready(h), students = JSON.stringify(d.students), rest = JSON.stringify([d.tests, d.scores, d.metrics, d.interventions]);
  backed(h); h.api.applyReassign();
  assert.equal(d.students[0].id, 's1'); assert.equal(d.students[0].className, '2年B組', h.elements.reassignPreview.innerHTML); assert.equal(d.students[0].classHistory[0].className, '1年A組');
  assert.equal(JSON.stringify([d.tests, d.scores, d.metrics, d.interventions]), rest);
  d.scores[0].total = 50; h.api.undoReassign();
  assert.equal(JSON.stringify(d.students), students); assert.equal(d.scores[0].total, 50); assert.equal(h.api.validateDataset(d).length, 0);
  assert.equal(h.elements.reassignUndoBtn.disabled, true);
});
test('プレビュー後の名簿変更・JSON切替とバックアップ後の別編集を検出する', async () => {
  for (const edit of [h => h.api.getData().students[0].name = '架空編集', h => h.api.setData(plain(h.api.getData())), h => h.api.getData().scores[0].total = 10]) {
    const h = harness(), d = await ready(h); backed(h); edit(h); const before = JSON.stringify(h.api.getData());
    h.api.applyReassign(); assert.equal(JSON.stringify(h.api.getData()), before); assert.ok(h.alerts.length || !h.api.plan());
  }
});
test('反映後の名簿編集・JSON切替で取り消しを止める', async () => {
  for (const edit of [h => { h.api.invalidateReassignRoster(); h.api.getData().students[0].name = '架空編集'; }, h => h.api.setData(plain(h.api.getData()))]) {
    const h = harness(); await ready(h); backed(h); h.api.applyReassign(); edit(h); const before = JSON.stringify(h.api.getData());
    h.api.undoReassign(); assert.equal(JSON.stringify(h.api.getData()), before); assert.match(h.alerts.at(-1), /取り消せません/);
  }
});
test('不正Excel・バックアップ失敗・管理者モード外では反映しない', async () => {
  const h = harness(), d = await ready(h), before = JSON.stringify(d);
  await h.api.importReassignWorkbook(new Blob(['fictional invalid workbook'])); assert.equal(h.api.plan(), null); assert.equal(JSON.stringify(d), before);
  await h.api.importReassignWorkbook(await file(h, filled(h, d))); h.context.failDownload = true; h.api.saveReassignBackup();
  assert.equal(h.api.backup(), null); assert.equal(h.elements.reassignBackupConfirmed.disabled, true);
  h.context.allowAdmin = false; h.api.applyReassign(); h.api.undoReassign(); assert.equal(JSON.stringify(d), before);
});
test('読み込み中に名簿や開いているJSONが変わった場合はプレビューを確定しない', async () => {
  const h = harness(), d = fixture(); h.api.setData(d);
  let release; const delayed = new Promise(resolve => { release = resolve; });
  const wb = filled(h, d); h.context.window.GD_IMPORT.readWorkbook = () => delayed;
  const loading = h.api.importReassignWorkbook(new Blob(['fictional'])); d.students[0].number = 9; release(wb); await loading;
  assert.equal(h.api.plan(), null); assert.match(h.elements.reassignPreview.innerHTML, /読み込み中/);
});
test('遅れて完了した旧ファイルの読込で新しいプレビューを上書きしない', async () => {
  const h = harness(), d = fixture(); h.api.setData(d);
  let first, second; const queue = [new Promise(resolve => { first = resolve; }), new Promise(resolve => { second = resolve; })];
  h.context.window.GD_IMPORT.readWorkbook = () => queue.shift();
  const oldFile = h.api.importReassignWorkbook(new Blob(['fictional old']));
  const newFile = h.api.importReassignWorkbook(new Blob(['fictional new']));
  const wb = filled(h, d); put(wb, 'F10', 3); second(wb); await newFile;
  const preview = h.elements.reassignPreview.innerHTML;
  first(filled(h, d)); await oldFile;
  assert.equal(h.elements.reassignPreview.innerHTML, preview); assert.equal(h.api.plan().changes[0].number, 3);
});
