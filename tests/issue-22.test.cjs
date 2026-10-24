'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const source=fs.readFileSync(path.join(__dirname,'../src/files/script.js'),'utf8').replace(/\ninit\(\);\s*$/,'');
const dataset=()=>({version:3,name:'架空',students:[{id:'s1',name:'架空生徒'}],tests:[],scores:[],metrics:[],interventions:[]});
function handle(name='original.json',text='original',fail='') {
  const h={name,text,writes:0,aborts:0,async requestPermission(){return 'granted'},async getFile(){return {text:async()=>h.text}},
    async isSameEntry(other){return h===other},async createWritable(){let next;h.writes++;return {
      async write(value){if(fail==='write')throw Error('fictional failure');next=value;},
      async close(){if(fail==='close')throw Error('fictional failure');h.text=next;},async abort(){h.aborts++;}
    };}};return h;
}
function harness(target=null) {
  const elements={},downloads=[],confirmations=[];
  const element=id=>elements[id]||={value:'',hidden:false,disabled:false,textContent:'',className:'',showModal(){this.hidden=false},close(){this.hidden=true}};
  const ctx=vm.createContext({console,Blob,setTimeout(){},URL:{createObjectURL(){return 'blob:fictional'},revokeObjectURL(){}},
    window:{location:{protocol:'file:'},isSecureContext:true,addEventListener(){},showSaveFilePicker:async()=>target},
    document:{addEventListener(){},getElementById:element,createElement(){return {click(){downloads.push(this.download)}}}},
    alert(){},confirm(message){confirmations.push(message);return ctx.confirmResult;}});
  ctx.confirmResult=true;
  vm.runInContext(source+`\nglobalThis.api={saveJson,openSaveDialog,canPickSaveFile,confirmDownloadedJson,
    load(value,handle=null,text='original'){data=value;fileHandle=handle;fileName='original.json';lastDiskText=text;dirty=true;activeDataToken++;pendingDownload=null;},
    state(){return {dirty,fileName,fileHandle,lastDiskText,data,pendingDownload}},edit(){data.name+='変更';markDirty();}};`,ctx);
  ctx.api.load(dataset());
  return {api:ctx.api,ctx,element,downloads,confirmations};
}
test('file://で保存先を選び、既存のJSONへ直接書き込みできる',async()=>{
  const target=handle('selected.json'),h=harness(target);assert.equal(h.api.canPickSaveFile(),true);
  await h.api.saveJson('overwrite');assert.equal(target.writes,1);assert.equal(JSON.parse(target.text).name,'架空');
  assert.equal(h.api.state().dirty,false);assert.equal(h.api.state().fileName,'selected.json');
  h.api.edit();await h.api.saveJson('overwrite');assert.equal(target.writes,2);assert.equal(JSON.parse(target.text).name,'架空変更');
});
test('キャンセル・権限拒否・書込失敗で保存先と未保存データを変えない',async()=>{
  const h=harness(),original=handle();h.api.load(dataset(),original);
  h.ctx.window.showSaveFilePicker=async()=>{throw Object.assign(Error(),{name:'AbortError'})};
  await h.api.saveJson('as');assert.equal(h.api.state().dirty,true);assert.equal(h.api.state().fileHandle,original);
  original.requestPermission=async()=> 'denied';await h.api.saveJson('overwrite');assert.equal(original.writes,0);
  for(const failure of ['write','close']){
    const target=handle('copy.json','untouched',failure);h.ctx.window.showSaveFilePicker=async()=>target;
    await h.api.saveJson('as');assert.equal(target.text,'untouched');assert.equal(target.aborts,1);
    assert.equal(h.api.state().fileHandle,original);assert.equal(h.api.state().dirty,true);
  }
});
test('外部変更を検出して取消せ、別名保存で元ファイルを残す',async()=>{
  const original=handle(),copy=handle('copy.json'),h=harness(copy);h.api.load(dataset(),original);
  original.text='external change';h.ctx.confirmResult=false;
  await h.api.saveJson('overwrite');assert.equal(original.text,'external change');assert.equal(h.api.state().dirty,true);
  h.ctx.confirmResult=true;await h.api.saveJson('as');assert.equal(original.text,'external change');assert.equal(JSON.parse(copy.text).name,'架空');
  h.ctx.window.showSaveFilePicker=async()=>copy;h.api.edit();await h.api.saveJson('as');assert.equal(h.api.state().dirty,true);
});
test('保存中の追加変更は未保存のままにし、別データへ切り替えたら保存先を引き継がない',async()=>{
  const target=handle('copy.json'),h=harness(target);
  const create=target.createWritable;target.createWritable=async()=>{const w=await create();const close=w.close;w.close=async()=>{await close();h.api.edit();};return w;};
  await h.api.saveJson('as');assert.equal(h.api.state().dirty,true);assert.equal(JSON.parse(target.text).name,'架空');
  h.ctx.window.showSaveFilePicker=async()=>{h.api.load({...dataset(),name:'別の架空データ'});return handle('different.json')};
  await h.api.saveJson('as');assert.equal(h.api.state().fileHandle,null);assert.equal(h.api.state().data.name,'別の架空データ');
});
test('ダウンロードだけで保存済みと断定せず、変更後の古いダウンロード確認を受理しない',async()=>{
  const h=harness();h.ctx.window.showSaveFilePicker=undefined;h.api.openSaveDialog();
  assert.equal(h.element('saveAsBtn').disabled,true);h.element('saveDownloadName').value='fictional';
  await h.api.saveJson('download');assert.deepEqual(h.downloads,['fictional.json']);assert.equal(h.api.state().dirty,true);
  h.api.edit();h.api.confirmDownloadedJson();assert.equal(h.api.state().dirty,true);
  await h.api.saveJson('download');h.api.confirmDownloadedJson();assert.equal(h.api.state().dirty,false);
});
