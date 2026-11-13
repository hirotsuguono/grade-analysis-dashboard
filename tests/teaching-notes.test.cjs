'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../src/files/teaching-notes.js');
const now = '2026-06-01T09:00:00.000Z';
const input = () => ({date:'2026-06-01',observation:'架空の気づき',plan:'',reflection:''});
const dataset = () => ({version:3,name:'架空の指導メモ',students:[{id:'s1',name:'架空生徒001',className:'2年A組',number:1}],
  tests:[{id:'t1',name:'架空の確認テスト',subject:'英語',maxScore:100}],scores:[],metrics:[],interventions:[],settings:{rti:{tier2:60,tier3:40},adminPinHash:null}});
function draft(d=dataset()) { return core.create(d,core.target(d,'英語','2年A組','t1'),input(),now,'n1'); }
test('指導メモの下書き・記録・編集案・破棄を、元の記録を保って扱う', () => {
  const d=dataset(), note=draft(d); core.record(d,note.id,now);
  core.write(d,note.id,{...input(),observation:'',plan:'架空の次の指導'},now);
  assert.equal(note.observation,'架空の気づき'); assert.equal(core.values(note).plan,'架空の次の指導');
  core.discard(d,note.id); assert.equal(note.editing,undefined); assert.equal(note.observation,'架空の気づき');
  core.write(d,note.id,{...input(),reflection:'架空の振り返り'},now); core.record(d,note.id,now);
  assert.equal(note.reflection,'架空の振り返り'); assert.equal(note.editing,undefined);
  assert.deepEqual(core.validate(d.teachingNotes),[]);
});
test('一欄だけの指導方針と、未完成の日付を含む下書きを区別する', () => {
  const d=dataset(), n=draft(d);
  core.write(d,n.id,{date:'',observation:'',plan:'架空の方針',reflection:''},now);
  assert.deepEqual(core.validate(d.teachingNotes),[]);
  assert.throws(()=>core.record(d,n.id,now),/日付/); assert.equal(n.status,'draft');
  core.write(d,n.id,{date:'2026-06-02',observation:'',plan:'架空の方針',reflection:''},now);
  core.record(d,n.id,now); assert.equal(n.status,'recorded');
  core.write(d,n.id,{date:'2026-06-02',observation:' ',plan:'',reflection:''},now);
  assert.throws(()=>core.record(d,n.id,now),/少なくとも1欄/);
  assert.equal(n.plan,'架空の方針');
});
test('所属変更・テスト削除後も記録時の対象とIDを保持する', () => {
  const d=dataset(), note=draft(d), original=structuredClone(note.target);
  core.record(d,note.id,now); d.students[0].className='3年B組'; d.tests=[];
  assert.deepEqual(note.target,original); assert.deepEqual(core.validate(d.teachingNotes),[]);
  const next=core.target(d,'英語','3年B組',null);
  assert.notEqual(core.key(next),core.key(note.target));
  d.students=[]; assert.deepEqual(core.validate(d.teachingNotes),[]);
});
test('共通方針はテスト未登録でも記録でき、対象スナップショットを分離する', () => {
  const d=dataset(); d.tests=[];
  const t=core.target(d,null,null,null), note=core.create(d,t,input(),now,'n1');
  t.studentIds.push('later'); core.record(d,note.id,now);
  assert.deepEqual(note.target.studentIds,['s1']); assert.equal(note.target.testId,null);
  assert.deepEqual(core.validate(d.teachingNotes),[]);
  assert.throws(()=>core.target(d,null,'不在のクラス',null),/現在の名簿/);
});
test('同じクラス名でも対象生徒が変われば下書きのキーを分ける', () => {
  const d=dataset(), old=core.target(d,'英語','2年A組','t1');
  d.students[0].id='new-cohort'; const next=core.target(d,'英語','2年A組','t1');
  assert.notEqual(core.key(old),core.key(next));
});
test('旧JSONでテスト名が空でも参照対象を安全な表示名で保持する', () => {
  const d=dataset(); d.tests[0].name=''; const note=draft(d);
  assert.equal(note.target.testId,'t1'); assert.ok(note.target.testName.length>0);
  assert.deepEqual(core.validate(d.teachingNotes),[]);
});
test('不正な型・日付・ID・状態・過大入力は受理しない', () => {
  for (const change of [n=>n.observation={formula:'1'},n=>n.date='2026-02-30',n=>n.date=20260601,
    n=>n.target.className=2,n=>n.target.subject={},n=>n.target.studentIds=['s1','s1'],n=>n.target.studentIds=[{}],
    n=>n.target.testName=null,n=>n.status='unknown',n=>n.createdAt='不明',n=>n.plan='a'.repeat(core.MAX_TEXT+1),
    n=>n.editing={...input()}]) {
    const n=draft(); change(n); assert.ok(core.validate([n]).length);
  }
  const n=draft(); assert.ok(core.validate([n,structuredClone(n)]).length);
  assert.ok(core.validate(Array(core.MAX_NOTES+1).fill(n)).length);
  for(const bad of [null,{},'text']) assert.ok(core.validate(bad).length);
});
test('削除と下書き破棄は別の記録や成績へ影響しない', () => {
  const d=dataset(), before=JSON.stringify(d); draft(d); core.discard(d,'n1');
  delete d.teachingNotes; assert.equal(JSON.stringify(d),before);
  draft(d); core.record(d,'n1',now); core.remove(d,'n1'); assert.deepEqual(d.teachingNotes,[]);
});
function harness() {
  const elements=new Map();
  const c=vm.createContext({console,alert(){},confirm:()=>true,TextEncoder,
    window:{addEventListener(){},showSaveFilePicker(){}},document:{addEventListener(){},getElementById(id){
      if(!elements.has(id)) elements.set(id,{hidden:false,disabled:false,textContent:'',value:'',close(){}}); return elements.get(id);
    }}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/files/teaching-notes.js'),'utf8'),c);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/files/script.js'),'utf8').replace(/\ninit\(\);\s*$/,'')+`
    renderAll=()=>{};updateRoleUI=()=>{};
    globalThis.api={applyJsonText,validateDataset,saveJson,state:()=>({data,dirty,fileName,fileHandle}),edit:()=>markDirty()};`,c);
  return c.api;
}
test('既存JSON v1〜v3を変更せず受け入れ、指導メモがなくても空の機能として使える', () => {
  for(const version of [1,2,3]) { const d=dataset(); d.version=version; const api=harness();
    assert.equal(api.applyJsonText(JSON.stringify(d),'fictional.json',null),true);
    assert.equal(api.state().data.teachingNotes,undefined);
    assert.equal(api.state().data.students[0].id,'s1');
  }
});
test('記録と編集中の内容を実際のJSON保存処理で再開できる',async()=>{
  const d=dataset(); draft(d); core.record(d,'n1',now); core.write(d,'n1',{...input(),reflection:'架空の書きかけ'},now);
  let text=JSON.stringify(d); const file={name:'fictional.json',getFile:async()=>({text:async()=>text}),createWritable:async()=>({write:async t=>{text=t;},close:async()=>{}})};
  const api=harness(); assert.equal(api.applyJsonText(text,file.name,file),true); api.edit(); await api.saveJson('overwrite');
  assert.equal(api.state().dirty,false); assert.equal(JSON.parse(text).teachingNotes[0].editing.reflection,'架空の書きかけ');
  const next=harness(); assert.equal(next.applyJsonText(text,file.name,null),true);
  assert.equal(next.state().data.teachingNotes[0].observation,'架空の気づき');
  assert.equal(next.state().data.teachingNotes[0].editing.reflection,'架空の書きかけ');
});
test('不正な指導メモの読込失敗で元データ・保存先・未保存状態を保持する',()=>{
  const api=harness(), d=dataset(); draft(d); const file={name:'fictional.json'};
  api.applyJsonText(JSON.stringify(d),file.name,file); api.edit(); const before=api.state();
  d.teachingNotes[0].plan={result:3}; api.applyJsonText(JSON.stringify(d),'invalid.json',null);
  const after=api.state(); assert.equal(after.data,before.data); assert.equal(after.fileHandle,file); assert.equal(after.fileName,file.name); assert.equal(after.dirty,true);
});

test('新しい指導メモは在籍者だけを対象にし、卒業前の記録対象は保持する', () => {
  const d=dataset(), note=draft(d), snapshot=structuredClone(note.target);
  d.students[0].enrollmentStatus='graduated';d.students.push({id:'s2',name:'架空の在籍者',className:'2年A組',number:1});
  assert.deepEqual(core.target(d,null,null,null).studentIds,['s2']);
  assert.deepEqual(core.target(d,'英語','2年A組','t1').studentIds,['s2']);
  assert.deepEqual(note.target,snapshot);assert.deepEqual(core.validate(d.teachingNotes),[]);
  d.students.pop();assert.throws(()=>core.target(d,'英語','2年A組','t1'),/現在の名簿/);
});
