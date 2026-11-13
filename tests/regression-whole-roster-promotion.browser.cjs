'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('../src/files/vendor/exceljs.min.js');
const { download: saveJson } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const students = [1, 2, 3].flatMap(grade => [1, 2].map(number => ({ id: `p${grade}${number}`, name: `架空生徒${grade}${number}`, className: `${grade}年A組`, number })));
  const fixture = { version: 3, name: '架空の全名簿進級', students,
    tests: [{ id: 'before', name: '架空の比較元', subject: '英語', grade: 1, date: '2026-05-01', maxScore: 100, questions: [], domains: [] }, { id: 'after', name: '架空の今回', subject: '英語', grade: 1, date: '2026-06-01', maxScore: 100, compareTo: 'before', questions: [], domains: [] }],
    scores: students.flatMap((s, i) => [{studentId:s.id,testId:'before',total:i*10}, {studentId:s.id,testId:'after',total:i*10+5}]),
    metrics: [{id:'fictional-metric',label:'架空アンケート',type:'number',values:Object.fromEntries(students.map((s,i)=>[s.id,i]))}],
    interventions: [{id:'fictional-iv',studentId:'p31',title:'架空の支援記録',subject:'英語',kind:'all',startDate:'2026-05-01',note:'架空のメモ',status:'active',baseline:40}],
    settings: {rti:{tier2:60,tier3:40},adminPinHash:null} };
  const bytes = async download => { const chunks=[]; for await(const c of await download.createReadStream()) chunks.push(c); return Buffer.concat(chunks); };
  async function load(value) { await page.evaluate(v => { document.querySelectorAll('dialog[open]').forEach(d=>d.close()); applyJsonText(JSON.stringify(v),'fictional-whole-roster.json',null); isAdmin=true;updateRoleUI(); },value); }
  async function open() { await page.locator('#rosterBtn').click(); await page.locator('[data-rtab="reassign"]').click(); await page.locator('#reassignOperation').selectOption('whole'); }
  async function issue() { const event=page.waitForEvent('download'); await page.locator('#reassignTemplateBtn').click(); const wb=new ExcelJS.Workbook(); await wb.xlsx.load(await bytes(await event)); return wb; }
  async function upload(wb) { await page.locator('#reassignXlsxInput').setInputFiles({name:'fictional-promotion.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await wb.xlsx.writeBuffer())}); await page.locator('#reassignPreview').waitFor({state:'visible'}); }
  async function backup() { const event=page.waitForEvent('download'); await page.locator('#reassignBackupBtn').click();const value=JSON.parse((await bytes(await event)).toString('utf8'));await page.locator('#reassignBackupConfirmed').check();return value; }
  async function configure() { await page.locator('#reassignSchoolYear').fill('2026');for(const grade of[2,3]) {await page.locator('#reassignNaming'+grade).selectOption('letters');await page.locator('#reassignCount'+grade).fill('2');}await page.locator('#reassignDate').fill('2026-06-24'); }
  try {
    await load(fixture); const before=await page.evaluate(()=>data); await open(); await configure();
    assert.equal(await page.locator('#reassignWholeFields').isVisible(),true);assert.equal(await page.locator('#reassignPartialFields').isVisible(),false);
    assert.match(await page.locator('#reassignWholeSummary').textContent(),/現在1年 2名.*現在2年 2名.*現在3年 2名/);
    const wb=await issue(), sheet=wb.getWorksheet('クラス替え');
    for(const row of[10,11,12,13,14,15]){assert.equal(sheet.getCell('F'+row).value,'');assert.equal(sheet.getCell('G'+row).value,'');}
    assert.equal(sheet.getCell('C12').value,'2年A組');assert.equal(sheet.getCell('D12').value,1);assert.equal(sheet.getCell('E14').value,'卒業');
    await upload(wb);assert.match(await page.locator('#reassignPreview').textContent(),/新クラス「空欄」/);assert.deepEqual(await page.evaluate(()=>data),before);assert.equal(await page.locator('#reassignCommit').isVisible(),false);
    sheet.getCell('F10').value='2年B組';await upload(wb);assert.match(await page.locator('#reassignPreview').textContent(),/10行目・G列/);assert.deepEqual(await page.evaluate(()=>data),before);
    [['2年B組',11],['2年B組',12],['3年B組',21],['3年B組',22]].forEach(([klass,number],i)=>{sheet.getCell(10+i,6).value=klass;sheet.getCell(10+i,7).value=number;});
    sheet.getCell('F10').value='2年X組<img src=x onerror=window.rosterCandidateUnsafe=1>';await upload(wb);
    assert.match(await page.locator('#reassignPreview').textContent(),/2年X組<img.*使えるクラス：2年A組/);assert.equal(await page.locator('#reassignPreview img').count(),0);assert.equal(await page.evaluate(()=>window.rosterCandidateUnsafe),undefined);assert.deepEqual(await page.evaluate(()=>data),before);
    sheet.getCell('F10').value='2年B組';wb.getWorksheet('発行設定').getCell('E8').value='3年1組';sheet.getCell('F12').value='3年1組';await upload(wb);
    assert.match(await page.locator('#reassignPreview').textContent(),/発行設定・E8.*3年1組.*3年A組.*発行し直/);assert.deepEqual(await page.evaluate(()=>data),before);
    wb.getWorksheet('発行設定').getCell('E8').value='3年A組';sheet.getCell('F12').value='3年B組';
    sheet.getCell('F14').value='3年A組';await upload(wb);assert.match(await page.locator('#reassignPreview').textContent(),/卒業.*空欄/);assert.deepEqual(await page.evaluate(()=>data),before);
    assert.doesNotMatch(await page.locator('#reassignPreview').textContent(),/重複/);sheet.getCell('F14').value='';await upload(wb);assert.match(await page.locator('#reassignPreview').textContent(),/新2年 2名・新3年 2名・卒業 2名/);
    const viewport=page.viewportSize();for(const width of[320,768,1280]){await page.setViewportSize({width,height:950});assert.equal(await page.locator('.roster-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);}
    await page.screenshot({path:path.join(process.env.QA_OUTPUT||path.join(__dirname,'../test-results'),'whole-roster-promotion-preview.png'),fullPage:true});await page.setViewportSize(viewport);
    assert.deepEqual(await backup(),before);
    await page.evaluate(()=>{ui.ovClass='1年A組';ui.inClass='1年A組';ui.trendClass='1年A組';ui.trendSelected=new Set(['p11']);});
    await page.locator('#reassignApplyBtn').click();const after=await page.evaluate(()=>data);
    assert.deepEqual(after.students.map(s=>s.className),['2年B組','2年B組','3年B組','3年B組','3年A組','3年A組']);assert.equal(after.students.filter(s=>s.enrollmentStatus==='graduated').length,2);assert.deepEqual(after.students.map(s=>s.number),[11,12,21,22,1,2]);
    for(const key of['tests','scores','metrics','interventions'])assert.deepEqual(after[key],before[key]);
    assert.equal(await page.evaluate(()=>activeStudents().length),4);assert.equal(await page.evaluate(()=>ui.ovClass),'all');assert.equal(await page.locator('#rosterTableWrap tbody tr').count(),4);assert.equal(await page.evaluate(()=>document.activeElement.id),'rosterCount');
    await page.locator('[data-rtab="graduates"]').click();assert.equal(await page.locator('#graduateTableWrap tbody tr').count(),2);
    await page.evaluate(()=>{ui.trendSearch='該当しない架空検索';$('trendSearch').value=ui.trendSearch;});await page.locator('[data-graduate-sid="p31"]').click();assert.equal(await page.locator('#studentList li[data-sid="p31"]').isVisible(),true);assert.equal(await page.evaluate(()=>ui.tab),'trend');
    assert.equal(await page.locator('#trendIncludeGraduated').isChecked(),true);assert.match(await page.locator('#trendSupportSummary').textContent(),/卒業生・閲覧のみ/);
    assert.equal(await page.locator('#trendAddSupport').isDisabled(),true);assert.equal(await page.locator('#trendSupportRecords button').count(),0);assert.match(await page.locator('#trendSupportRecords').textContent(),/架空の支援記録/);
    await page.locator('#trendCompareTest').selectOption('after');await page.locator('#trendCompareFrom').selectOption('before');
    assert.match(await page.locator('#trendComparisonResult').textContent(),/卒業生/);assert.equal(await page.locator('#trendGroupReference').isVisible(),false);
    assert.match(await page.locator('#trendChart').locator('..').locator('h3').textContent(),/卒業生/);
    const rollback=await page.evaluate(value=>{const render=renderAll;renderAll=()=>{throw new Error('fictional repaint failure');};try{applyJsonText(JSON.stringify(value),'fictional-rejected.json',null);}finally{renderAll=render;}return{flag:ui.trendIncludeGraduated,checked:$('trendIncludeGraduated').checked,selected:[...ui.trendSelected]};},fixture);assert.deepEqual(rollback,{flag:true,checked:true,selected:['p31']});const oldIv=await page.evaluate(()=>data.interventions.length);
    await page.evaluate(()=>{openIvDialog('p31');});assert.equal(await page.locator('#ivDialog').isVisible(),false);assert.equal(await page.evaluate(()=>data.interventions.length),oldIv);await page.evaluate(()=>{$('ivForm').dataset.sid='p31';$('ivForm').dataset.dataToken=String(activeDataToken);submitIvDialog({preventDefault(){}});});assert.equal(await page.evaluate(()=>data.interventions.length),oldIv);
    await page.locator('#trendIncludeGraduated').uncheck();assert.equal(await page.locator('#studentList li').count(),4);assert.equal(await page.evaluate(()=>ui.trendSelected.size),0);
    await page.evaluate(()=>{data.scores[0].total=79;data.interventions[0].note='架空の追記';markDirty();});const latest=await page.evaluate(()=>({scores:data.scores,interventions:data.interventions}));
    await open();await page.locator('#reassignUndoBtn').click();assert.deepEqual(await page.evaluate(()=>data.students),before.students);assert.deepEqual(await page.evaluate(()=>({scores:data.scores,interventions:data.interventions})),latest);
    await page.locator('[data-rtab="reassign"]').click();await upload(wb);await backup();await page.locator('#reassignApplyBtn').click();await page.locator('#rosterCloseBtn').click();
    const saved=await saveJson(page);await load(saved);assert.equal(await page.evaluate(()=>activeStudents().length),4);assert.equal(await page.evaluate(()=>data.students.length),6);
    await open();assert.equal(await page.locator('#reassignUndoBtn').isDisabled(),true);await upload(wb);assert.match(await page.locator('#reassignPreview').textContent(),/進級履歴/);assert.deepEqual(await page.evaluate(()=>data),saved);
    // Empty active rosters must render normally while retaining the graduated pupils' records.
    const last=JSON.parse(JSON.stringify(fixture));last.students=last.students.filter(s=>s.id.startsWith('p3'));last.scores=last.scores.filter(r=>r.studentId.startsWith('p3'));for(const m of last.metrics)m.values=Object.fromEntries(Object.entries(m.values).filter(([id])=>id.startsWith('p3')));
    await load(last);await open();await configure();const finalBook=await issue();await upload(finalBook);await backup();await page.locator('#reassignApplyBtn').click();assert.equal(await page.evaluate(()=>activeStudents().length),0);assert.equal(await page.locator('#rosterTableWrap tbody tr').count(),0);await page.locator('#rosterCloseBtn').click();
    for(const tab of['overview','input','trend','analysis','metrics','rti','list']){await page.locator(`[data-tab="${tab}"]`).click();assert.equal(await page.locator('#panel-'+tab).isVisible(),true);}
  } finally { await load(original); }
};
