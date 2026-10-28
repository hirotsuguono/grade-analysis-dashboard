'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const XLSX = require('../src/files/vendor/xlsx.full.min.js');
const source = fs.readFileSync(path.join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');

function fixture() {
  return {
    version: 3, name: '架空の境界条件確認',
    students: ['a', 'b', 'c'].map((id, i) => ({ id, name: `架空生徒${i + 1}`, number: i + 1, className: '1年1組' })),
    tests: [{ id: 't', name: '架空テスト', subject: '英語', maxScore: 100, questions: [], domains: [] }],
    scores: [], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
  };
}
function questions(d = fixture()) {
  d.tests[0].questions = [1, 2].map(i => ({ key: 'q' + i, label: '問' + i, max: 50, domain: '読解' }));
  d.tests[0].domains = [{ key: '読解', label: '読解', max: 100 }];
  return d;
}
function harness(d = fixture()) {
  const elements = {}, alerts = [];
  const element = id => elements[id] ||= {
    innerHTML: '', textContent: '', hidden: false, classList: { toggle() {} },
    closest() { return this; }, querySelector() { return this; }, querySelectorAll() { return []; },
  };
  const ctx = vm.createContext({ Blob, DecompressionStream, input: d, XLSX, console, CSS: { escape: s => s },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById: element, querySelector() { return null; } },
    alert: s => alerts.push(s), confirm: () => true,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/files/import-core.js'), 'utf8'), ctx);
  vm.runInContext(source + `\ndata=input;rebuildIndex();ui.inTest=ui.ovTest=ui.anTest='t';ui.trendSubject='英語';
    chart=()=>({setOption(){},clear(){}});renderAll=()=>{};renderCorrelation=()=>{};`, ctx);
  return {
    run: code => vm.runInContext(code, ctx),
    read: code => JSON.parse(JSON.stringify(vm.runInContext(code, ctx))),
    element, alerts, ctx,
  };
}
function input(value, q = '__total__', sid = 'a') {
  return { value: String(value), dataset: { sid, q, row: '0', col: '0' }, classList: { toggle() {} }, setAttribute() {} };
}

test('#24 合計のみの80点・0点・未入力を欠席往復と保存再開で保持する', () => {
  for (const total of [80, 0, null]) {
    const d = fixture(); d.scores.push({ studentId: 'a', testId: 't', total, questions: {}, domains: {} });
    const h = harness(d);
    h.run("handleAbsentToggle({dataset:{sid:'a'},checked:true})");
    assert.equal(h.run("getAttendedScore('a','t')"), null);
    const reopened = harness(h.read('data'));
    reopened.run("handleAbsentToggle({dataset:{sid:'a'},checked:false})");
    assert.equal(reopened.run("getScore('a','t').total"), total);
    assert.equal(reopened.run('validateDataset(data).length'), 0);
  }
});
test('#24 設問得点を保持した欠席の解除でも0点と満点を復元する', () => {
  const d = questions(); d.scores.push({ studentId: 'a', testId: 't', total: 50, questions: { q1: 50, q2: 0 }, domains: { 読解: 50 } });
  const h = harness(d); h.run("handleAbsentToggle({dataset:{sid:'a'},checked:true});handleAbsentToggle({dataset:{sid:'a'},checked:false})");
  assert.equal(h.run("getScore('a','t').total"), 50);
});
test('#25 同名テストを逆順登録しても未来を比較せず、正しい比較を保存再開できる', () => {
  const d = fixture();
  d.tests = ['2026-07-01', '2026-05-01'].map((date, i) => ({ ...d.tests[0], id: ['july', 'may'][i], gradeYear: 2, kind: 'final', date }));
  const h = harness(d);
  assert.equal(h.run('comparisonTarget(data.tests[1])'), null);
  assert.equal(h.run('comparisonTarget(data.tests[0]).id'), 'may');
  h.run("data.tests[0].compareTo='may'");
  assert.equal(h.run('validateDataset(data).length'), 0);
  const reopened = harness(h.read('data'));
  assert.equal(reopened.run('comparisonTarget(data.tests[0]).id'), 'may');
  h.run("data.tests[1].compareTo='july'");
  assert.match(h.read('validateDataset(data)').join('\n'), /過去/);
});
test('#25 比較は個別の日付順、全教科の回は従来の学年と名前でまとめる', () => {
  const d = fixture();
  d.tests = [['july','英語','2026-07-01'],['math','数学','2026-05-02'],['may','英語','2026-05-01'],['june','英語','2026-06-01']]
    .map(([id, subject, date]) => ({ ...d.tests[0], id, subject, date, gradeYear: 2, kind: 'final' }));
  const h = harness(d);
  assert.deepEqual(h.read('comparisonCandidates(data.tests[0]).map(t=>t.id)'), ['may', 'june']);
  assert.equal(h.run('termOrderedList().length'), 1);
  assert.equal(h.run('comparisonTarget(data.tests[0]).id'), 'june');
  assert.deepEqual(h.read("sortTestsByTerm(data.tests.filter(t=>t.subject==='英語')).map(t=>t.id)"), ['may', 'june', 'july']);
});
test('#26 50点と空欄は入力途中、50点と明示的0点は入力完了として統計に採用する', () => {
  const h = harness(questions()); h.ctx.cell = input(50, 'q1'); h.run('handleCellInput(cell);renderInput()');
  assert.equal(h.run("getScore('a','t').total"), null);
  assert.match(h.element('inputStatus').innerHTML, /入力済 0名.*入力途中 1名/);
  assert.match(h.element('scoreTableWrap').innerHTML, /入力途中/);
  assert.equal(h.run("rtiRateFor('a','英語').rate"), null);
  assert.equal(h.run("completeTermTotal('a',data.tests)"), null);
  h.ctx.cell = input(0, 'q2'); h.run('handleCellInput(cell);renderInput()');
  assert.equal(h.run("getScore('a','t').total"), 50);
  assert.equal(h.run("rtiRateFor('a','英語').rate"), 50);
  assert.match(h.element('inputStatus').innerHTML, /入力済 1名.*入力途中 0名/);
  h.ctx.cell = input('', 'q2'); h.run('handleCellInput(cell)');
  assert.equal(h.run("getScore('a','t').total"), null);
});
test('#26 旧JSONの部分合計も一覧・平均・相関・推移・支援へ混ぜない', () => {
  const d = questions(); d.scores = [{ studentId: 'a', testId: 't', total: 50, questions: { q1: 50 }, domains: { 読解: 50 } }];
  const h = harness(d);
  assert.equal(h.run("getAttendedScore('a','t').total"), null);
  assert.deepEqual(h.read("getAttendedScore('a','t').domains"), {});
  assert.deepEqual(h.read("trendAxis().valueOf('a')"), [null]);
  assert.equal(h.run("listCell({kind:'test',test:data.tests[0]},{id:'a'}).raw"), undefined);
  assert.equal(h.run("listCell({kind:'avg'},{id:'a'}).raw"), undefined);
  assert.equal(h.run("axisInfo('t:t').get('a')"), null);
  assert.equal(h.run("rtiRateFor('a','英語').rate"), null);
  assert.equal(h.run("completeTermTotal('a',data.tests)"), null);
  assert.equal(h.run('validateDataset(data).length'), 0);
});
test('#26 分野も全設問が埋まった分野だけ集計し、完成した別分野の0点は保持する', () => {
  const d = questions(); d.tests[0].questions.forEach(q => q.max = 25); d.tests[0].domains[0].max = 50;
  d.tests[0].questions.push({ key: 'q3', label: '問3', max: 50, domain: '文法' });
  d.tests[0].domains.push({ key: '文法', label: '文法', max: 50 });
  const h = harness(d); h.run("const rec=ensureScore('a','t');rec.questions={q1:25,q3:0};recalcScore(rec,data.tests[0])");
  assert.equal(h.run("getScore('a','t').total"), null);
  assert.deepEqual(h.read("getScore('a','t').domains"), { 文法: 0 });
});
test('#26 Excel取込でも設問の未入力を保持し、明示的0点を完成とする', async () => {
  const h = harness();
  const rows = [['テスト名','架空の部分入力'],['教科','英語'],['満点',100],['実施学年',1],['実施日','2026-05-01'],[],
    ['分野','','','','','読解','読解'],['配点','','','','',50,50],['生徒ID','学年','クラス','出席番号','氏名','問1','問2'],
    ['a',1,'1',1,'架空生徒1',50,''],['b',1,'1',2,'架空生徒2',50,0],['c',1,'1',3,'架空生徒3','欠','']];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '新規テスト');
  h.ctx.importFile = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })]);
  await h.run('importTestTemplate(importFile)');
  assert.equal(h.run("getScore('a',data.tests.at(-1).id).total"), null);
  assert.equal(h.run("getScore('b',data.tests.at(-1).id).total"), 50);
  assert.equal(h.run("getScore('c',data.tests.at(-1).id).absent"), true);
  assert.equal(h.run('validateDataset(data).length'), 0);
});
test('#26 設問を使わない合計点のみのテストは引き続き集計する', () => {
  const d = fixture(); d.scores = [{ studentId: 'a', testId: 't', total: 80 }];
  const h = harness(d); assert.equal(h.run("rtiRateFor('a','英語').rate"), 80);
});
test('#26 JSON v1〜v3の設問明細がない旧集計値も読み取りを維持する', () => {
  for (const version of [1, 2, 3]) {
    const d = questions(); d.version = version; d.scores = [{ studentId: 'a', testId: 't', total: 80, domains: { 読解: 80 } }];
    const h = harness(d);
    assert.equal(h.run('validateDataset(data).length'), 0);
    assert.equal(h.run("getAttendedScore('a','t').total"), 80);
  }
});
test('#27 1名・複数名・最後の生徒を削除しても選択と元の描画関数が安全', () => {
  for (const selected of [['a'], ['a', 'b']]) {
    const h = harness(); h.ctx.ids = selected;
    h.run("ui.tab='trend';ui.trendSelected=new Set(ids);renderAll=renderCurrentTab");
    assert.doesNotThrow(() => h.run("handleRosterDelete('a')"));
    assert.equal(h.run("ui.trendSelected.has('a')"), false);
    assert.equal(h.run('ui.trendSelected.size'), selected.length - 1);
    assert.doesNotThrow(() => h.run("handleRosterDelete('b');handleRosterDelete('c')"));
    assert.equal(h.run('data.students.length'), 0);
  }
});
test('#27 分野グラフ単体も存在しない選択IDを安全に扱う', () => {
  const h = harness(); h.run("ui.trendSelected=new Set(['missing'])");
  assert.doesNotThrow(() => h.run('renderTrendDomainChart()'));
  assert.equal(h.element('trendDomainCard').hidden, true);
});
test('#28 5段階の小数入力を拒否して既存回答を保持し、空欄と整数は受理する', () => {
  const d = fixture(); d.metrics = [{ id: 'm', label: '架空の5段階', type: 'scale', values: { a: 2 } }];
  const h = harness(d); h.run("ui.metricId='m'"); h.ctx.cell = input(2.5);
  h.run('handleMetricInput(cell)'); assert.equal(h.run('data.metrics[0].values.a'), 2);
  for (const value of [1, 2, 3, 4, 5, '']) {
    h.ctx.cell = input(value); h.run('handleMetricInput(cell)');
    assert.equal(h.run('data.metrics[0].values.a'), value === '' ? undefined : value);
    assert.equal(h.run('validateDataset(data).length'), 0);
  }
});
test('#28 貼り付けの小数は既存回答を保持し、整数行は受理する', () => {
  const d = fixture(); d.metrics = [{ id: 'm', label: '架空の5段階', type: 'scale', values: { a: 2 } }];
  const h = harness(d); h.run("ui.metricId='m'"); h.ctx.cell = input('');
  h.ctx.paste = { clipboardData: { getData: () => '2.5\n5' }, preventDefault() {} };
  h.run('handleMetricPaste(paste,cell)');
  assert.deepEqual(h.read('data.metrics[0].values'), { a: 2, b: 5 });
  assert.equal(h.alerts.length, 1);
});
test('#28 JSONとExcelも5段階の小数を拒否し、数値指標の小数は全経路で保持する', () => {
  for (const type of ['scale', 'number']) {
    const d = fixture(); d.metrics = [{ id: 'm', label: '架空指標', type, values: { a: 2.5 } }];
    const h = harness(d);
    assert.equal(h.run('validateDataset(data).length') > 0, type === 'scale');
    const rows = [['出席番号','氏名','クラス','架空指標','生徒ID'],[1,'架空生徒1','1年1組',2.5,'a']];
    h.ctx.rows = rows;
    assert.equal(h.run('window.GD_IMPORT.parseMetricRows(rows,data.students,data.metrics).errors.length') > 0, type === 'scale');
    if (type === 'number') {
      h.run("ui.metricId='m'"); h.ctx.cell = input(3.5); h.run('handleMetricInput(cell)');
      assert.equal(h.run('data.metrics[0].values.a'), 3.5);
      h.ctx.paste = { clipboardData: { getData: () => '4.5\n2.5' }, preventDefault() {} };
      h.run('handleMetricPaste(paste,cell)'); assert.deepEqual(h.read('data.metrics[0].values'), { a: 4.5, b: 2.5 });
    }
  }
});
