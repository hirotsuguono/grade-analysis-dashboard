'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
function fixture(rates) {
  return { students: rates.map((_, i) => ({ id: 's' + i, name: '架空' + i, className: '架空A組' })),
    tests: [{ id: 'before', maxScore: 100 }, { id: 'after', maxScore: 100 }],
    scores: rates.flatMap(([before, after], i) => [{ studentId: 's' + i, testId: 'before', total: before }, { studentId: 's' + i, testId: 'after', total: after }]),
    settings: { rti: { tier2: 60, tier3: 40 } } };
}
function read(dataset, selectedId = 's0', className = 'all') {
  const before = JSON.stringify(dataset);
  const context = vm.createContext({ window: { addEventListener() {}, GD_PAIRED: require('../src/files/paired-comparison.js') }, document: { addEventListener() {} }, dataset, selectedId, className });
  vm.runInContext(source + '\ndata=dataset;rebuildIndex();ui.trendClass=className;const student=data.students.find(s=>s.id===selectedId);const before=data.tests[0],after=data.tests[1];globalThis.result=individualComparisonContext(student,before,after,individualTestScore(selectedId,before),individualTestScore(selectedId,after));', context);
  assert.equal(JSON.stringify(dataset), before);
  return JSON.parse(JSON.stringify(context.result));
}
test('本人を含む変化量0/10/20は平均10・標本SD10を基準に-1/0/+1となる', () => {
  const d = fixture([[50, 50], [50, 60], [50, 70]]);
  for (const [i, expected] of [-1, 0, 1].entries()) {
    const r = read(d, 's' + i);
    assert.equal(r.row.n, 3); assert.equal(r.tier, 2);
    assert.equal(r.row.meanChange, 10); assert.equal(r.row.sdChange, 10);
    assert.equal(r.gap, expected * 10); assert.equal(r.position, expected);
  }
});
test('本人が低下していてもグループ平均より低下が小さいなら相対位置は正になる', () => {
  const r = read(fixture([[50, 36], [50, 42], [50, 48]]), 's2');
  assert.equal(r.row.meanChange, -8); assert.equal(r.gap, 6); assert.equal(r.position, 1);
});
test('本人だけの場合は自分自身との差0を意味のある比較として表示しない', () => {
  const r = read(fixture([[50, 70]]));
  assert.equal(r.gap, null); assert.equal(r.position, null); assert.match(r.positionReason, /本人だけ/);
});
test('2名なら平均差を表示し、相対位置はアプリの表示方針で保留する', () => {
  const r = read(fixture([[50, 50], [50, 70]]));
  assert.equal(r.gap, -10); assert.equal(r.position, null); assert.match(r.positionReason, /2名.*3名/);
});
test('全員同じ変化なら平均との差0と算出不能な相対位置を区別する', () => {
  const r = read(fixture([[50, 60], [50, 60], [50, 60]]));
  assert.equal(r.gap, 0); assert.equal(r.position, null); assert.match(r.positionReason, /ばらつき/);
});
test('計算精度以下のばらつきも相対位置として割らない', () => {
  const r = read(fixture([[50, 60], [50, 60 + 1e-14], [50, 60 + 2e-14]]));
  assert.equal(r.row.status, 'constant'); assert.equal(r.position, null);
});
test('本人の比較元なしと今回なしを区別し、今回なしでも所属群の参考は残す', () => {
  let r = read(fixture([[null, 60], [50, 60], [50, 70]]));
  assert.equal(r.row, null); assert.match(r.reason, /所属グループを決められません/);
  r = read(fixture([[50, null], [50, 60], [50, 70]]));
  assert.equal(r.row.n, 2); assert.equal(r.gap, null); assert.equal(r.position, null);
  assert.match(r.positionReason, /本人の今回/);
});
test('本人が選択範囲外なら別クラスの基準を本人に当てはめない', () => {
  const r = read(fixture([[50, 60], [50, 70], [50, 80]]), 's0', '架空B組');
  assert.equal(r.row, null); assert.equal(r.position, null); assert.match(r.reason, /含まれていません/);
});
test('満点が違っても未丸めの率で比較し、0点をペアから落とさない', () => {
  const d = fixture([[0, 0], [0, 10], [0, 20]]);
  d.tests[0].maxScore = 50;
  const r = read(d, 's2');
  assert.equal(r.row.n, 3); assert.equal(r.tier, 3); assert.equal(r.gap, 10); assert.equal(r.position, 1);
});
test('未丸めの比較元Tierで参照群を選び、他のTierの変化を混ぜない', () => {
  const r = read(fixture([[59.999, 59.999], [59.999, 69.999], [59.999, 79.999], [60, 0]]), 's2');
  assert.equal(r.tier, 2); assert.equal(r.row.n, 3); assert.ok(Math.abs(r.position - 1) < 1e-12);
});
test('非ゼロかつ満点3/6の得点を率へ換算してから標準化する', () => {
  const d = fixture([[1, 1], [1, 2], [1, 3]]);
  d.tests[0].maxScore = 3; d.tests[1].maxScore = 6;
  const r = read(d, 's2');
  assert.equal(r.tier, 3); assert.equal(r.row.n, 3);
  assert.ok(Math.abs(r.row.meanChange) < 1e-12);
  assert.ok(Math.abs(r.gap - 100 / 6) < 1e-12);
  assert.ok(Math.abs(r.position - 1) < 1e-12);
});
test('全員の変化への定数加算・正倍率変更は相対位置を変えない', () => {
  const a = read(fixture([[50, 50], [50, 60], [50, 70]]), 's2');
  const shifted = read(fixture([[50, 55], [50, 65], [50, 75]]), 's2');
  const scaled = read(fixture([[50, 50], [50, 70], [50, 90]]), 's2');
  assert.ok(Math.abs(a.position - shifted.position) < 1e-12); assert.ok(Math.abs(a.gap - shifted.gap) < 1e-12);
  assert.ok(Math.abs(a.position - scaled.position) < 1e-12); assert.ok(Math.abs(a.gap * 2 - scaled.gap) < 1e-12);
});
