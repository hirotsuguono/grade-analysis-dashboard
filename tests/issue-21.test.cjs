'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../src/files/script.js'),'utf8').replace(/\ninit\(\);\s*$/,'');
function fixture() {
  const students=Array.from({length:4},(_,i)=>({id:'s'+i,name:'架空生徒'+i,className:'1年1組',number:i+1}));
  const tests=[
    {id:'a',name:'架空期末1',subject:'英語',kind:'final',date:'2026-05-01',maxScore:20},
    {id:'b',name:'架空単元',subject:'英語',kind:'unit',date:'2026-06-01',maxScore:10},
    {id:'c',name:'架空期末2',subject:'英語',kind:'final',date:'2026-07-01',maxScore:100},
    {id:'d',name:'架空実力',subject:'英語',kind:'proficiency',date:'2026-08-01',maxScore:100},
  ];
  return {version:3,students,tests,scores:tests.flatMap(t=>students.map((s,i)=>({studentId:s.id,testId:t.id,total:t.maxScore*[0,.5,.8,1][i]}))),metrics:[],interventions:[],settings:{rti:{tier2:60,tier3:40},adminPinHash:null}};
}
function harness(d=fixture()) {
  const elements={};const element=id=>elements[id]||={innerHTML:'',textContent:'',hidden:false,closest(){return this},querySelectorAll(){return []},querySelector(){return this}};
  const ctx=vm.createContext({input:d,window:{addEventListener(){}},document:{addEventListener(){},getElementById:element},alert(){},confirm(){return true;}});
  vm.runInContext(source+`\ndata=input;rebuildIndex();chart=()=>({setOption(){},clear(){}});renderAll=()=>{};markDirty=()=>{};
    globalThis.api={comparisonTarget,validateDataset,rtiRateFor,termSeriesFor,trendAxis,renderOverview,deleteCurrentTest,
      run(code){return eval(code)},getData(){return data},ui};`,ctx);
  return {api:ctx.api,elements,element};
}
test('単元・未分類は自動比較せず、期末は途中の単元を飛ばし同じ種類を選ぶ',()=>{
  const {api}=harness(),d=api.getData(),before=JSON.parse(JSON.stringify(d));
  assert.equal(api.comparisonTarget(d.tests[1]),null);
  assert.equal(api.comparisonTarget(d.tests[2]).id,'a');
  assert.equal(api.comparisonTarget(d.tests[3]),null);
  delete d.tests[2].kind;
  assert.equal(api.comparisonTarget(d.tests[2]),null);
  d.tests[2].kind='final';
  assert.deepEqual(d,before);
});
test('実力テストの自動比較は同一シリーズに限定し、明示した比較は変更・解除できる',()=>{
  const {api}=harness(),d=api.getData();
  d.tests[0].kind='proficiency'; d.tests[0].series='架空A';
  d.tests[3].series='架空B'; assert.equal(api.comparisonTarget(d.tests[3]),null);
  d.tests[3].series='架空A'; assert.equal(api.comparisonTarget(d.tests[3]).id,'a');
  d.tests[3].compareTo='b'; assert.equal(api.comparisonTarget(d.tests[3]).id,'b');
  d.tests[3].compareTo=null; assert.equal(api.comparisonTarget(d.tests[3]),null);
});
test('満点が違う比較は得点率差と両方受験した人数を示し、0点を保ち欠席・未入力を除く',()=>{
  const h=harness(),d=h.api.getData();h.api.ui.ovTest='c';
  d.scores.find(r=>r.testId==='a'&&r.studentId==='s2').absent=true;
  d.scores.find(r=>r.testId==='c'&&r.studentId==='s3').total=null;
  h.api.renderOverview();
  assert.match(h.element('kpiGrid').innerHTML,/両方受験 2名/);
  assert.match(h.element('kpiGrid').innerHTML,/得点率差 0ポイント/);
  d.tests[2].compareTo=null; h.api.renderOverview();
  assert.doesNotMatch(h.element('kpiGrid').innerHTML,/得点率差|比較：|効果量 dz/);
});
test('保存JSONの種類・系列・比較相手を検証し、旧JSONを推測で分類しない',()=>{
  for(const version of [1,2,3]) {
    const d=fixture();d.version=version;d.tests.forEach(t=>delete t.kind);
    const h=harness(d),before=JSON.stringify(d);
    assert.equal(h.api.validateDataset(d).length,0);assert.equal(h.api.comparisonTarget(d.tests[2]),null);
    assert.equal(JSON.stringify(d),before);
  }
  for(const edit of [d=>d.tests[2].kind='unknown',d=>d.tests[2].kind={toString:1},d=>d.tests[2].series=7,
    d=>d.tests[2].compareTo='missing',d=>d.tests[2].compareTo='c',d=>d.tests[0].compareTo='c',
    d=>{d.tests[0].subject='数学';d.tests[2].compareTo='a';}]) {
    const d=fixture();edit(d);assert.ok(harness().api.validateDataset(d).length);
  }
  const d=fixture();d.tests[2].compareTo='a';assert.equal(harness().api.validateDataset(d).length,0);
});
test('推移・支援は種類で絞り込み、支援の差は設定された比較相手を使う',()=>{
  const {api}=harness();api.ui.trendSubject='英語';api.ui.trendKind='final';api.ui.rtiKind='final';
  assert.deepEqual(Array.from(api.trendAxis().labels),['架空期末1','架空期末2']);
  assert.equal(api.termSeriesFor('s1','英語').rates.length,2);
  assert.equal(api.rtiRateFor('s1','英語').delta,0);
  api.getData().tests[2].compareTo=null;assert.equal(api.rtiRateFor('s1','英語').delta,null);
  assert.equal(api.rtiRateFor('s1','all').delta,null);
});
test('比較相手を削除したら参照を解除し、保存可能なJSONを保つ',()=>{
  const {api}=harness(),d=api.getData();d.tests[2].compareTo='a';api.ui.inTest='a';api.run('isAdmin=true');
  api.deleteCurrentTest();assert.equal(d.tests[1].compareTo,null);assert.equal(api.validateDataset(d).length,0);
});
