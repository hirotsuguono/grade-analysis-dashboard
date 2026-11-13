'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../src/files');
const XLSX = require(path.join(root, 'vendor/xlsx.full.min.js'));
const ExcelJS = require(path.join(root, 'vendor/exceljs.min.js'));
const plain = value => JSON.parse(JSON.stringify(value));
function harness() {
  const context = vm.createContext({ Blob, DecompressionStream, TextEncoder, window: { ExcelJS } });
  for (const file of ['import-core.js', 'roster-reassign.js', 'excel-templates.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { core: context.window.GD_ROSTER, excel: context.window.GD_EXCEL, imports: context.window.GD_IMPORT };
}
const config = overrides => ({ operation: 'whole', schoolYear: 2027, sourceType: 'all', sourceValue: '', mode: 'all', kind: 'move',
  naming2: 'letters', count2: 2, naming3: 'letters', count3: 2, date: '2027-04-01', ...overrides });
function fixture() {
  const students = Array.from({ length: 6 }, (_, i) => ({ id: 's' + i, name: i < 2 ? '架空同名' : '架空生徒' + i, className: `${Math.floor(i / 2) + 1}年${i % 2 ? 'B' : 'A'}組`, number: 1 }));
  students.push({ id: 'older', name: '架空の卒業済生徒', className: '3年A組', number: 1, enrollmentStatus: 'graduated', graduatedAt: '2026-03-31', lastPromotionYear: 2026 });
  return { version: 3, name: '架空の全名簿進級', students,
    tests: [{ id: 'exam', name: '架空テスト', subject: '英語', maxScore: 100 }],
    scores: students.map((s, i) => ({ studentId: s.id, testId: 'exam', total: i * 10, ...(i === 2 ? { absent: true } : {}) })),
    metrics: [{ id: 'm', values: { s0: 0, s4: 4 } }], interventions: [{ id: 'iv', studentId: 's4', title: '架空支援', status: 'active' }], settings: {} };
}
function put(wb, address, value, sheet = 'クラス替え') { XLSX.utils.sheet_add_aoa(wb.Sheets[sheet], [[value]], { origin: address }); }
// Build a completed fictional form; the issued application template itself stays blank.
function make(h, d, c = config()) {
  const wb = h.excel.reassignTemplate(XLSX, d, c);
  h.core.selectedStudents(d.students, c).forEach((student, i) => {
    const grade = Number(h.core.gradeOf(student)) + 1;
    if (grade > 3) return;
    const group = i % c['count' + grade];
    put(wb, 'F' + (10 + i), `${grade}年${c['naming' + grade] === 'letters' ? String.fromCharCode(65 + group) : group + 1}組`);
    put(wb, 'G' + (10 + i), student.number);
  });
  return wb;
}
const plan = (h, wb, d, today = '2027-04-01') => h.core.planWorkbook(wb, XLSX, d, today);

test('whole roster XLSX records each original pupil once and stores grade-specific validations and explicit school year', async () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d), wb = h.excel.reassignTemplate(XLSX, d, config());
  const bytes = await h.excel.writeBuffer(wb), read = new ExcelJS.Workbook(); await read.xlsx.load(bytes);
  const ws = read.getWorksheet('クラス替え'), settings = read.getWorksheet('発行設定');
  assert.deepEqual(read.worksheets.map(s => s.name), ['クラス替え', '発行設定']);
  assert.equal(settings.getCell('B7').value, 'gd-roster-promotion-v1'); assert.equal(settings.getCell('B9').value, 2027);
  assert.match(ws.getCell('A2').value, /2027年度/);
  assert.equal(ws.getCell('A10').value, 's0'); assert.equal(ws.getCell('A15').value, 's5'); assert.equal(ws.getCell('A16').value, null);
  assert.equal(ws.getCell('E10').value, '進級');
  for (const row of [10, 11, 12, 13]) { assert.equal(ws.getCell('F' + row).value, ''); assert.equal(ws.getCell('G' + row).value, ''); }
  assert.equal(ws.getCell('C12').value, '2年A組'); assert.equal(ws.getCell('D12').value, 1);
  assert.equal(ws.getCell('F10').dataValidation.formulae[0], 'ReassignGrade2Classes');
  assert.equal(ws.getCell('F12').dataValidation.formulae[0], 'ReassignGrade3Classes');
  assert.equal(ws.getCell('G10').dataValidation.type, 'whole'); assert.equal(ws.views[0].topLeftCell, 'F10');
  assert.equal(ws.getCell('E14').value, '卒業'); assert.equal(ws.getCell('F14').value, ''); assert.equal(ws.getCell('G14').value, '');
  assert.equal(ws.getCell('F10').fill.fgColor.argb, 'FFFFF5D6'); assert.equal(ws.getCell('F14').fill.fgColor.argb, 'FFF1F4F8');
  assert.equal(ws.getCell('E10').fill.fgColor.argb, 'FFF1F4F8'); assert.equal(read.definedNames.model.length, 2);
  const blank = await h.imports.readWorkbook(new Blob([bytes]), XLSX); assert.ok(plan(h, blank, d).errors.length); assert.equal(plan(h, blank, d).changes.length, 0);
  const imported = await h.imports.readWorkbook(new Blob([await h.excel.writeBuffer(make(h, d))]), XLSX), result = plan(h, imported, d);
  assert.deepEqual(plain(result.errors), []); assert.equal(result.changes.length, 6); assert.equal(result.targetCount, 6);
  assert.equal(result.config.schoolYear, 2027); assert.equal(JSON.stringify(d), before);
});

test('simultaneous 1→2, 2→3, 3→graduated checks final active slots and preserves original IDs, records and history', () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d), p = plan(h, make(h, d), d);
  assert.deepEqual(plain(p.errors), []);
  assert.deepEqual(Array.from(p.changes, c => c.action), ['promote', 'promote', 'promote', 'promote', 'graduate', 'graduate']);
  const next = h.core.changedStudents(d.students, p);
  assert.deepEqual(Array.from(next, s => [s.id, s.className, s.number]), [['s0', '2年A組', 1], ['s1', '2年B組', 1], ['s2', '3年A組', 1], ['s3', '3年B組', 1], ['s4', '3年A組', 1], ['s5', '3年B組', 1], ['older', '3年A組', 1]]);
  assert.equal(next.filter(h.core.isActive).length, 4); assert.equal(next.filter(s => !h.core.isActive(s)).length, 3);
  for (const s of next.slice(0, 6)) assert.equal(s.lastPromotionYear, 2027);
  assert.equal(next[4].graduatedAt, '2027-04-01'); assert.equal(next[4].enrollmentStatus, 'graduated');
  assert.deepEqual(plain(next[0].classHistory), [{ className: '1年A組', number: 1, at: '2027-04-01' }]);
  assert.deepEqual(plain(next[6]), d.students[6]);
  const candidate = { ...d, students: next }; assert.equal(candidate.scores, d.scores); assert.equal(candidate.metrics, d.metrics); assert.equal(candidate.interventions, d.interventions);
  assert.equal(JSON.stringify(d), before);
});

test('row order and identical names do not change matching; same final class/number across active pupils refuses the entire batch', () => {
  const h = harness(), d = fixture(), wb = make(h, d), rows = XLSX.utils.sheet_to_json(wb.Sheets['クラス替え'], { header: 1, defval: '' });
  [rows[9], rows[10]] = [rows[10], rows[9]]; wb.Sheets['クラス替え'] = XLSX.utils.aoa_to_sheet(rows);
  assert.deepEqual(Array.from(plan(h, wb, d).changes, c => c.id), ['s1', 's0', 's2', 's3', 's4', 's5']);
  const dup = make(h, d); put(dup, 'F11', '2年A組');
  const rejected = plan(h, dup, d); assert.match(rejected.errors.join(), /重複/); assert.equal(rejected.changes.length, 0);
});

test('missing/extra/duplicate pupils, original roster edits, wrong action/grade and nonempty graduation inputs all reject without changing data', () => {
  const h = harness();
  const edits = [w => put(w, 'A10', 'not-a-pupil'), w => put(w, 'A11', 's0'), w => put(w, 'B10', '架空の改名'), w => put(w, 'C10', '2年A組'), w => put(w, 'D10', 2),
    w => put(w, 'E10', '卒業'), w => put(w, 'E14', '進級'), w => put(w, 'F10', '3年A組'), w => put(w, 'F12', '2年A組'), w => put(w, 'F10', '2年C組'),
    w => put(w, 'F14', '3年A組'), w => put(w, 'G14', 1), w => put(w, 'G10', ''), w => put(w, 'F10', ''), w => put(w, 'G10', 0), w => put(w, 'G10', -1),
    w => put(w, 'G10', 1.5), w => put(w, 'G10', '1e3'), w => put(w, 'G10', Number.MAX_SAFE_INTEGER + 1), w => put(w, 'H10', 'extra'),
    w => put(w, 'A16', 'older'), w => { delete w.Sheets['クラス替え'].A15; }, w => put(w, 'F9', 'changed')];
  for (const edit of edits) {
    const d = fixture(), before = JSON.stringify(d), wb = make(h, d); edit(wb);
    const result = plan(h, wb, d); assert.ok(result.errors.length, String(edit)); assert.equal(result.changes.length, 0); assert.equal(JSON.stringify(d), before);
  }
});

test('real formula/error/boolean cells in either whole worksheet are refused before conversion', async () => {
  const h = harness();
  for (const [sheet, address, value] of [['クラス替え', 'G10', { formula: '1+1', result: 2 }], ['クラス替え', 'F10', { error: '#VALUE!' }],
    ['クラス替え', 'G10', true], ['発行設定', 'B9', { formula: '2027', result: 2027 }], ['発行設定', 'B9', { error: '#VALUE!' }]]) {
    const d = fixture(), before = JSON.stringify(d), bytes = await h.excel.writeBuffer(make(h, d));
    const x = new ExcelJS.Workbook(); await x.xlsx.load(bytes); x.getWorksheet(sheet).getCell(address).value = value;
    const bad = await h.imports.readWorkbook(new Blob([await x.xlsx.writeBuffer()]), XLSX), result = plan(h, bad, d);
    assert.ok(result.errors.length, address); assert.equal(result.changes.length, 0); assert.equal(JSON.stringify(d), before);
  }
});

test('unknown current grades, invalid configuration/year, future or reversed history dates and changed scope are rejected', () => {
  const h = harness();
  for (const change of [{ schoolYear: 0 }, { schoolYear: 2027.5 }, { schoolYear: 10000 }, { schoolYear: '2027' }, { sourceType: 'grade', sourceValue: '1' }, { mode: 'partial' }, { kind: 'correction' }, { operation: 'other' }, { count2: 0 }, { naming3: 'free' }, { date: '2027-02-30' }]) assert.ok(h.core.configErrors(config(change)).length);
  const d = fixture(); d.students[0].className = '所属未設定'; assert.throws(() => make(h, d), /学年を判別/);
  const current = fixture(), original = make(h, current); current.students[0].className = '所属未設定'; assert.ok(plan(h, original, current).errors.length);
  const future = fixture(); assert.match(plan(h, make(h, future, config({ date: '2027-04-02' })), future).errors.join(), /未来/);
  const history = fixture(); history.students[0].classHistory = [{ className: '1年C組', number: 1, at: '2027-04-01' }];
  assert.match(plan(h, make(h, history, config({ date: '2027-03-31' })), history).errors.join(), /記録済み/);
  const changed = fixture(), w = make(h, changed); changed.students.push({ id: 'new', name: '架空の追加', className: '1年A組', number: 2 }); assert.ok(plan(h, w, changed).errors.length);
  const archived = fixture(); archived.students.forEach(s => { s.enrollmentStatus = 'graduated'; }); assert.throws(() => make(h, archived), /在籍中/);
});

test('reimporting old templates and newly issuing the same or earlier promotion year cannot advance a pupil twice', () => {
  const h = harness(), d = fixture(), wb = make(h, d), p = plan(h, wb, d);
  const after = { ...d, students: h.core.changedStudents(d.students, p) }, before = JSON.stringify(after);
  assert.ok(plan(h, wb, after).errors.length); assert.equal(plan(h, wb, after).changes.length, 0);
  assert.throws(() => make(h, after), /進級履歴/);
  assert.throws(() => make(h, after, config({ schoolYear: 2026 })), /進級履歴/);
  assert.equal(JSON.stringify(after), before);
  const laterConfig = config({ schoolYear: 2029, date: '2029-04-01' }), later = plan(h, make(h, after, laterConfig), after, '2029-04-01');
  assert.equal(later.errors.length, 0); assert.equal(later.targetCount, 4);
  const next = h.core.changedStudents(after.students, later); assert.equal(next.find(s => s.id === 's0').className, '3年A組');
  assert.equal(next.find(s => s.id === 's0').lastPromotionYear, 2029);
  // A cancellation/undo restores the original snapshot; issuing again is then legitimate.
  assert.doesNotThrow(() => make(h, { ...after, students: plain(d.students) }));
});

test('current grade spelling variants are recognized without suggesting a new class or number; bad years and oversized exports are refused', () => {
  const h = harness(), c = config({ naming2: 'numbers', count2: 2 });
  const s = { id: 'x', name: '架空の表記ゆれ', className: '１年０１組', number: '０２' };
  assert.deepEqual(plain(h.core.promotionTarget(s, c)), { action: 'promote', grade: 2 });
  assert.deepEqual(plain(h.core.promotionTarget({ ...s, className: '1b' }, config())), { action: 'promote', grade: 2 });
  for (const value of ['2026', {}, 0, 2026.5]) assert.throws(() => h.core.promotionTarget({ ...s, lastPromotionYear: value }, c), /進級年度/);
  const d = fixture(); d.students = Array.from({ length: 9992 }, (_, i) => ({ id: 's' + i, name: '架空生徒', className: '1年A組', number: i + 1 }));
  assert.throws(() => make(h, d), /行数上限/);
});

test('a completed year remains blocked when all previous pupils graduated and a new first grade is added', () => {
  const h = harness(), d = fixture(); d.students = d.students.filter(s => h.core.gradeOf(s) === '3');
  const old = make(h, d), p = plan(h, old, d);
  assert.equal(p.errors.length, 0); const after = { ...d, students: h.core.changedStudents(d.students, p) };
  after.students.push({ id: 'new', name: '架空の新1年生', className: '1年A組', number: 1 });
  assert.throws(() => make(h, after), /進級履歴/);
  // A workbook forged from a new-roster-only view still cannot evade the archived marker.
  const forged = make(h, { ...after, students: after.students.filter(h.core.isActive) });
  assert.match(plan(h, forged, after).errors.join(), /進級履歴/); assert.equal(plan(h, forged, after).changes.length, 0);
  const nextYear = config({ schoolYear: 2028, date: '2028-04-01' });
  assert.equal(plan(h, make(h, after, nextYear), after, '2028-04-01').errors.length, 0);
});

test('matching 3年A組 in the displayed list and pupil row remains valid through a real XLSX round trip', async () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d), wb = make(h, d);
  put(wb, 'F12', '3年A組');
  const read = await h.imports.readWorkbook(new Blob([await h.excel.writeBuffer(wb)]), XLSX);
  assert.equal(read.Sheets['発行設定'].E8.v, '3年A組'); assert.equal(read.Sheets['クラス替え'].F12.v, '3年A組');
  const result = plan(h, read, d); assert.deepEqual(plain(result.errors), []); assert.equal(result.changes.length, 6); assert.equal(JSON.stringify(d), before);
});

test('a displayed class list that disagrees with the stored naming settings explains both values and refuses all changes', async () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d), wb = make(h, d, config({ naming3: 'numbers' }));
  put(wb, 'E8', '3年A組', '発行設定'); put(wb, 'F12', '3年A組'); put(wb, 'F13', '3年2組');
  const read = await h.imports.readWorkbook(new Blob([await h.excel.writeBuffer(wb)]), XLSX), result = plan(h, read, d);
  assert.match(result.errors.join(), /発行設定・E8.*3年A組.*3年1組.*アプリ.*発行し直/);
  assert.doesNotMatch(result.errors.join(), /12行目・F列/); assert.equal(result.changes.length, 0); assert.equal(JSON.stringify(d), before);
  const changedSetting = make(h, d); put(changedSetting, 'B14', 'numbers', '発行設定');
  assert.match(plan(h, changedSetting, d).errors.join(), /発行設定・E8.*3年A組.*3年1組/);
});

test('invalid new classes identify the typed value, valid class examples and how to change the configured classes', () => {
  const h = harness(), d = fixture(), wb = make(h, d), before = JSON.stringify(d);
  put(wb, 'F12', 'A'); const result = plan(h, wb, d);
  assert.match(result.errors.join(), /12行目・F列.*「A」.*新3年.*3年A組、3年B組.*アプリ.*発行し直/);
  assert.equal(result.changes.length, 0); assert.equal(JSON.stringify(d), before);
  const many = make(h, d, config({ count3: 26 })); put(many, 'F12', '3年AA組');
  const message = plan(h, many, d).errors.join(); assert.match(message, /3年A組、3年B組、3年C組 ほか23クラス/); assert.doesNotMatch(message, /3年Z組/);
});

test('missing new class or new number refuses the entire promotion batch without keeping old assignments', () => {
  const h = harness(), d = fixture(), before = JSON.stringify(d);
  for (const address of ['F12', 'G12']) {
    const wb = make(h, d); put(wb, address, ''); const result = plan(h, wb, d);
    assert.ok(result.errors.some(message => message.includes('12行目・' + address[0] + '列'))); assert.equal(result.changes.length, 0); assert.equal(JSON.stringify(d), before);
  }
});
