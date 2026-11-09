'use strict';
const assert=require('node:assert/strict');
const {download,upload}=require('./issues-24-28-browser-helpers.cjs');
module.exports=async(page,original)=>{
  const rates=[[60,50],[70,90],[80,85],[40,80],[50,60],[59.99,30],[0,10],[20,35],[39.99,60],[55,null],[null,80],[null,null],[90,95],[90,95],[90,95],[0,10]];
  const d={version:3,name:'架空の層別比較',students:rates.map((_,i)=>({id:'group-'+i,name:'架空生徒'+i,number:i+1,className:i<12?'2年A組':i<15?'2年B組':'2年C組'})),
    tests:[{id:'before',name:'架空の事前テスト',subject:'数学',kind:'final',gradeYear:2,date:'2026-05-01',maxScore:50},
      {id:'after',name:'架空の事後テスト',subject:'数学',kind:'final',gradeYear:2,date:'2026-07-01',maxScore:100,compareTo:'before'}],
    scores:[],metrics:[],interventions:[],settings:{rti:{tier2:60,tier3:40},adminPinHash:null}};
  for(let i=0;i<rates.length;i++)for(let j=0;j<2;j++)d.scores.push({studentId:d.students[i].id,testId:d.tests[j].id,total:rates[i][j]===null?50:rates[i][j]/100*d.tests[j].maxScore,absent:rates[i][j]===null});
  const reset=async()=>{await page.evaluate(v=>applyJsonText(JSON.stringify(v),'fictional-groups.json',null),d);await page.locator('[data-tab="overview"]').click();await page.locator('#ovSubject').selectOption('数学');await page.locator('#ovTest').selectOption('after');await page.locator('#ovClass').selectOption('all');};
  const cell=(key,stat)=>page.locator(`#ovComparison tr[data-group="${key}"] td[data-stat="${stat}"]`);
  const n=async(key,value)=>assert.match(await cell(key,'n').textContent(),new RegExp('^'+value+'名'));
  try{
    await reset();const before=await page.evaluate(()=>JSON.stringify(data));
    assert.equal(await page.locator('#ovComparison tr[data-group]').count(),4);
    await n('all',13);await n('tier1',6);await n('tier2',3);await n('tier3',4);
    assert.match(await cell('all','before').textContent(),/53\.08%/);
    assert.match(await cell('all','after').textContent(),/61\.15%/);
    assert.match(await page.locator('.group-comparison-note').first().textContent(),/点数なし2名.*のみ点数あり1名/);
    assert.match(await page.locator('.group-comparison').textContent(),/Holm補正/);
    const options=await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')).getOption());
    assert.equal(options.yAxis[0].min,0);assert.equal(options.yAxis[0].max,100);
    assert.ok(Math.abs(options.series[0].data[3]-14.9975)<1e-9);assert.equal(options.series[1].data[3],28.75);
    assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);
    await page.locator('#ovClass').selectOption('2年A組');
    await n('all',9);await n('tier1',3);await n('tier2',3);await n('tier3',3);
    assert.equal(await cell('tier1','before').textContent(),'70%');assert.equal(await cell('tier1','after').textContent(),'75%');
    assert.ok(!(await cell('tier2','p').textContent()).includes('—'));
    await page.locator('#ovClass').selectOption('2年B組');await n('all',3);
    assert.equal(await cell('all','ci').textContent(),'—');assert.match(await cell('all','p').textContent(),/ばらつきなし/);
    const emptyBars=await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')).getOption().series.map(s=>s.data.slice(2)));
    assert.deepEqual(emptyBars,[[null,null],[null,null]]);
    await page.locator('#ovClass').selectOption('2年C組');await n('all',1);
    assert.equal(await cell('all','before').textContent(),'0%');assert.equal(await cell('all','change').textContent(),'+10');
    assert.match(await cell('all','p').textContent(),/比較1名/);
    await page.locator('#ovClass').selectOption('all');
    await page.evaluate(()=>{ui.rtiBasis='avg';ui.rtiSubject='数学';renderOverview();});await n('tier1',6);
    await page.evaluate(()=>{data.settings.rti={tier3:40.5,tier2:60.5};renderOverview();});
    await n('tier1',5);await n('tier2',3);await n('tier3',5);
    assert.match(await page.locator('tr[data-group="tier2"] th').textContent(),/40\.5%以上60\.5%未満/);
    await page.locator('#ovClass').selectOption('2年B組');
    await page.evaluate(()=>{for(let i=12;i<15;i++)data.scores.find(r=>r.studentId==='group-'+i&&r.testId==='after').total=90+[0.005,0.006,0.007][i-12];renderOverview();});
    const smallInterval=(await cell('all','ci').textContent()).split('～').map(Number);
    assert.ok(smallInterval[0]>0&&smallInterval[1]>smallInterval[0]);
    assert.ok(Number(await cell('all','p').textContent())<0.05);
    await reset();
    const view=page.viewportSize();
    for(const width of [320,768,1280]){
      await page.setViewportSize({width,height:1000});
      await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      assert.ok(await page.locator('#ovComparison').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    }
    await page.setViewportSize(view);
    await page.locator('.group-comparison-details > summary').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('.group-comparison-details').evaluate(e=>e.open),true);
    const popup=page.waitForEvent('popup');await page.locator('.group-comparison-details a').click();
    const guide=await popup;await guide.waitForLoadState();assert.ok(guide.url().endsWith('/files/manual.html#group-comparison'));assert.equal(await guide.locator('#group-comparison').count(),1);await guide.close();
    const saved=await download(page);assert.deepEqual(saved.scores,d.scores);assert.deepEqual(saved.students,d.students);assert.deepEqual(saved.tests,d.tests);
    await upload(page,saved,'fictional-groups-reopen.json');await page.locator('[data-tab="overview"]').click();await page.locator('#ovTest').selectOption('after');await page.locator('#ovClass').selectOption('all');await n('all',13);
    await page.locator('#ovComparisonBtn').click();await page.locator('#cfCompare').selectOption('none');await page.locator('#comparisonForm button[type="submit"]').click();
    assert.equal(await page.locator('#ovComparison').isVisible(),false);assert.equal(await page.locator('#ovGroupComparisonChart').count(),0);
  }finally{await page.evaluate(v=>applyJsonText(JSON.stringify(v),'fictional-groups-restored.json',null),original);}
};
