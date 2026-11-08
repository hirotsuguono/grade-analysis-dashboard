'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {download,upload} = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const klassA='2年A組',klassB='2年B組';
  const payload='<img src=x onerror="window.teachingInjected=true">\n架空の観察 ' + 'X'.repeat(600);
  const reset=async d => {await page.evaluate(v=>applyJsonText(JSON.stringify(v),'fictional-teaching.json',null),d);await page.locator('[data-tab="overview"]').click();};
  const open=async()=>{if(!await page.locator('#teachingNotesCard').evaluate(el=>el.open)) await page.locator('#teachingNotesCard > summary').click();};
  try {
    await reset(original); await open();
    assert.equal(await page.evaluate(()=>data.teachingNotes),undefined);
    await page.locator('#ovClass').selectOption(klassA);
    await page.locator('#teachingPlan').fill('架空A組の次の指導');
    const firstId=await page.evaluate(()=>data.teachingNotes[0].id);
    assert.equal(await page.evaluate(()=>dirty),true);
    await page.locator('#ovClass').selectOption(klassB);
    assert.equal(await page.locator('#teachingPlan').inputValue(),'');
    await page.locator('#teachingReflection').fill('架空B組の書きかけ');
    await page.locator('#ovClass').selectOption(klassA);
    assert.equal(await page.locator('#teachingPlan').inputValue(),'架空A組の次の指導');
    await page.locator('#teachingDate').fill('2026-06-24');
    await page.locator('#teachingObservation').fill(payload);
    await page.locator('#teachingRecord').click();
    assert.equal(await page.evaluate(()=>data.teachingNotes[0].status),'recorded');
    assert.equal(await page.locator('#teachingHistory img').count(),0);
    assert.equal(await page.evaluate(()=>window.teachingInjected),undefined);
    assert.ok((await page.locator('#teachingHistory').textContent()).includes('<img src=x'));
    await page.locator('#teachingReflection').fill('架空の破棄する編集');
    assert.equal(await page.evaluate(()=>data.teachingNotes[0].reflection),'');
    await page.locator('#teachingDiscard').click();
    assert.equal(await page.locator('#teachingReflection').inputValue(),'');
    await page.locator('#teachingReflection').fill('架空の追記を保存して再開');
    const saved=await download(page);
    assert.equal(saved.teachingNotes[0].editing.reflection,'架空の追記を保存して再開');
    assert.equal(saved.teachingNotes[1].reflection,'架空B組の書きかけ');
    await upload(page,saved,'fictional-teaching-reopen.json');
    await page.locator('[data-tab="overview"]').click();
    await page.locator(`#teachingHistory article[data-note-id="${firstId}"] button`).first().click();
    assert.equal(await page.locator('#teachingReflection').inputValue(),'架空の追記を保存して再開');
    const before=await page.evaluate(()=>({text:JSON.stringify(data),name:fileName,dirty}));
    const bad=structuredClone(saved);bad.teachingNotes[0].plan={formula:'1'};
    await page.evaluate(v=>applyJsonText(JSON.stringify(v),'invalid-teaching.json',null),bad);
    assert.deepEqual(await page.evaluate(()=>({text:JSON.stringify(data),name:fileName,dirty})),before);
    assert.equal(await page.locator('#teachingReflection').inputValue(),'架空の追記を保存して再開');
    await page.evaluate(v=>{
      const old=renderAll;renderAll=()=>{old();throw new Error('synthetic teaching repaint failure');};
      try{applyJsonText(JSON.stringify(v),'fictional-render-failure.json',null);}finally{renderAll=old;}
    },original);
    assert.deepEqual(await page.evaluate(()=>({text:JSON.stringify(data),name:fileName,dirty})),before);
    assert.equal(await page.locator('#teachingReflection').inputValue(),'架空の追記を保存して再開');
    await page.locator('#teachingRecord').click();
    const snap=await page.evaluate(()=>JSON.parse(JSON.stringify(data.teachingNotes[0].target)));
    await page.evaluate(()=>{for(const s of data.students)if(s.className==='2年A組')s.className='3年A組';renderAll();});
    assert.deepEqual(await page.evaluate(()=>JSON.parse(JSON.stringify(data.teachingNotes[0].target))),snap);
    assert.ok((await page.locator('#teachingHistory').textContent()).includes('2年A組'));
    const unchanged=await page.evaluate(()=>({scores:data.scores,tests:data.tests,metrics:data.metrics,interventions:data.interventions}));
    for(const key of Object.keys(unchanged)) assert.deepEqual(unchanged[key],original[key]);
    const viewport=page.viewportSize();
    for(const width of [320,768,1280]){
      await page.setViewportSize({width,height:950});
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.ok(await page.locator('#teachingNotesCard').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    }
    await page.locator('#teachingNotesCard').screenshot({path:path.join(process.env.QA_OUTPUT||path.join(__dirname,'../test-results'),'teaching-notes.png')});
    await page.setViewportSize(viewport);
    await page.evaluate(()=>{
      for(let i=0;i<25;i++){
        const note=window.GD_TEACHING.create(data,window.GD_TEACHING.target(data,null,null,null),
          {date:'2026-06-24',observation:'架空の履歴'+i,plan:'',reflection:''},new Date().toISOString(),'fictional-page-'+i);
        window.GD_TEACHING.record(data,note.id,new Date().toISOString());
      }renderOverview();
    });
    assert.equal(await page.locator('#teachingHistory article').count(),20);
    await page.locator('#teachingNext').click();assert.ok(await page.locator('#teachingHistory article').count()>0);
    assert.match(await page.locator('#teachingPage').textContent(),/^2 \/ 2/);
    const empty=structuredClone(original);empty.tests=[];empty.scores=[];
    await reset(empty);await open();
    await page.locator('#teachingSubject').selectOption('');await page.locator('#teachingClass').selectOption('');
    assert.equal(await page.locator('#teachingTest option').count(),1);
    await page.locator('#teachingPlan').fill('架空のテスト前の共通方針');await page.locator('#teachingRecord').click();
    assert.equal(await page.evaluate(()=>data.teachingNotes[0].target.testId),null);
    await page.locator('#teachingHistory article button').last().click();
    assert.equal(await page.evaluate(()=>data.teachingNotes.length),0);
  } finally {await reset(original);await page.locator('#teachingNotesCard').evaluate(el=>el.open=false);}
};
