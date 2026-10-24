'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../src/files/script.js'), 'utf8').replace(/\ninit\(\);\s*$/, '');
function harness() {
  const input = {version:3, name:'架空の記録', students:[
    {id:'s1',name:'<架空生徒>',className:'2年A組',number:1,classHistory:[{className:'1年B組',number:2}]},
    {id:'s2',name:'架空生徒2',className:'2年A組',number:2}],
    tests:[{id:'t1',name:'架空テスト',subject:'英語',maxScore:100}],
    scores:[{studentId:'s1',testId:'t1',total:0},{studentId:'s2',testId:'t1',total:100,absent:true}]};
  const ctx=vm.createContext({input, window:{addEventListener(){}},document:{addEventListener(){},getElementById(){return {hidden:false};}}});
  vm.runInContext(source+`\ndata=input; rebuildIndex(); ui.trendSelected=new Set(['s1']);
    chartImageFrom=()=> 'data:image/png;base64,AAAA';
    globalThis.api={buildKarteHtml, getData(){return data;}};`,ctx);
  return ctx.api;
}
test('カルテの表示項目を省いても、0点・欠席除外・氏名の文字表示を保つ',()=>{
  const h=harness(), before=JSON.stringify(h.getData());
  const all=h.buildKarteHtml();
  assert.match(all,/&lt;架空生徒&gt;/); assert.match(all,/<td>0 \/ 100<\/td><td>0%<\/td><td>0<\/td>/);
  const html=h.buildKarteHtml({basic:false,history:false,rate:false,average:false,trend:false,domain:false,memo:false});
  for(const text of ['氏名：','クラス履歴：','<th>得点率','<th>クラス平均','<img','面談メモ']) assert.ok(!html.includes(text),text);
  assert.match(html,/<th>得点<\/th>/); assert.match(html,/<td>0 \/ 100<\/td>/);
  assert.equal(JSON.stringify(h.getData()),before);
});
test('全項目を非表示にすると印刷内容を作らず、記録のみなら列数に応じた空欄表示にする',()=>{
  const h=harness();
  assert.equal(h.buildKarteHtml({basic:false,history:false,records:false,trend:false,domain:false,memo:false}),'');
  h.getData().scores.forEach(r => { r.absent=true; });
  assert.match(h.buildKarteHtml({score:false,rate:false,average:false}),/colspan="1"/);
});
