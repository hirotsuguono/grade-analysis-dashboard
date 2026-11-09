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
  const card=key=>page.locator(`#ovComparison .group-summary-card[data-group="${key}"]`);
  const cell=(key,stat)=>stat==='decision'
    ?page.locator(`#ovComparison tr[data-group-calculation="${key}"] td[data-stat="decision"]`)
    :['before','after','ci'].includes(stat)
    ?page.locator(`#ovComparison tr[data-group-detail="${key}"] td[data-stat="${stat}"]`)
    :card(key).locator(`[data-stat="${stat}"]`);
  const n=async(key,value)=>assert.match(await cell(key,'n').textContent(),new RegExp('^'+value+'名'));
  try{
    await reset();const before=await page.evaluate(()=>JSON.stringify(data));
    assert.equal(await page.locator('#ovComparison .group-summary-card').count(),4);
    assert.equal(await page.locator('.group-comparison-details').evaluate(e=>e.open),false);
    assert.equal(await cell('all','ci').isVisible(),false);
    assert.equal(await page.locator('#ovGroupComparisonChart').isVisible(),false);
    assert.equal(await page.evaluate(()=>!!echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart'))),false);
    assert.equal(await card('all').locator('dd').count(),3);
    for(const stat of ['change','p','dz'])assert.equal(await cell('all',stat).isVisible(),true);
    assert.equal(await page.locator('.group-test-criteria').isVisible(),false);
    assert.equal(await page.locator('.group-reading-help').evaluate(e=>e.open),false);
    assert.doesNotMatch(await page.locator('.group-summary-grid').textContent(),/帰無仮説|棄却|Holm|信頼区間|自由度|\bdz\b/);
    assert.match(await cell('all','reading').textContent(),/上がっています。前後差は確認しきれていません/);
    assert.match(await cell('tier3','reading').textContent(),/上がっています。統計上も前後差が認められました/);
    await page.locator('.group-reading-help > summary').click();
    assert.equal(await page.locator('.group-reading-help p').first().isVisible(),true);
    assert.match(await page.locator('.group-reading-help').textContent(),/0\.05未満.*0\.001より小さい/s);
    await page.locator('.group-reading-help > summary').click();
    assert.match(await page.locator('.group-test-criteria').textContent(),/5％水準.*前後の得点率の平均変化は0.*0\.05未満.*0\.05以上/s);
    for(const key of ['all','tier1','tier2'])assert.equal(await cell(key,'decision').textContent(),'棄却できず');
    assert.equal(await cell('tier3','decision').textContent(),'帰無仮説を棄却');
    await page.locator('.group-comparison-details > summary').click();
    await page.waitForFunction(()=>!!echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')));
    assert.equal(await cell('all','ci').isVisible(),true);
    assert.equal(await page.locator('.group-calculation-details').evaluate(e=>e.open),false);
    assert.equal(await cell('all','decision').isVisible(),false);
    assert.equal(await page.locator('.group-interval-help p').first().isVisible(),false);
    await page.locator('.group-interval-help > summary').click();
    assert.equal(await page.locator('.group-interval-help p').first().isVisible(),true);
    assert.match(await page.locator('.group-interval-help').textContent(),/生徒一人ひとりの変化の範囲ではありません/);
    await page.locator('.group-p-help > summary').click();
    assert.match(await page.locator('.group-p-help').textContent(),/計4回.*調整済み/s);
    assert.doesNotMatch(await page.locator('.group-comparison-table').first().locator('thead').textContent(),/Holm|信頼区間|両側/);
    assert.match(await page.locator('.group-comparison-table').first().locator('thead').textContent(),/平均変化の推定範囲.*判定に使うp値/s);
    await page.locator('.group-calculation-details > summary').focus();await page.keyboard.press('Enter');
    assert.equal(await cell('all','decision').isVisible(),true);
    await n('all',13);await n('tier1',6);await n('tier2',3);await n('tier3',4);
    assert.match(await cell('all','before').textContent(),/53\.08%/);
    assert.match(await cell('all','after').textContent(),/61\.15%/);
    assert.match(await page.locator('.group-comparison-note').first().textContent(),/点数なし2名.*のみ点数あり1名/);
    assert.match(await page.locator('.group-comparison').textContent(),/Holm補正/);
    const options=await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')).getOption());
    assert.equal(options.yAxis[0].min,0);assert.equal(options.yAxis[0].max,100);
    assert.ok(options.tooltip.every(t=>t.renderMode==='richText'));
    assert.ok(Math.abs(options.series[0].data[3]-14.9975)<1e-9);assert.equal(options.series[1].data[3],28.75);
    assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);
    // Saving thresholds through Settings must refresh the comparison without switching tabs or filters.
    await page.locator('#roleBtn').click();await page.locator('#adminPinInput').fill('2468');await page.locator('#adminSubmit').click();
    await page.waitForFunction(()=>isAdmin);
    const settings=async tier2=>{
      await page.locator('#settingsBtn').click();await page.locator('#setTier3').fill('40');await page.locator('#setTier2').fill(tier2);
      await page.locator('#settingsForm button[type="submit"]').click();
    };
    await settings('70');await n('tier1',5);await n('tier2',4);await n('tier3',4);
    assert.equal(await cell('tier1','before').textContent(),'84%');assert.equal(await cell('tier1','after').textContent(),'92%');
    assert.equal(await cell('tier1','change').textContent(),'+8');
    assert.match(await page.locator('tr[data-group-detail="tier1"] th').textContent(),/70%以上/);
    assert.deepEqual(await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')).getOption().series.map(s=>s.data[1])),[84,92]);
    assert.equal(await page.locator('#ovTest').inputValue(),'after');assert.equal(await page.locator('#ovClass').inputValue(),'all');
    assert.deepEqual(await page.evaluate(()=>data.scores),d.scores);
    await settings('60');await n('tier1',6);await n('tier2',3);await n('tier3',4);
    await page.locator('#ovClass').selectOption('2年A組');
    await n('all',9);await n('tier1',3);await n('tier2',3);await n('tier3',3);
    assert.equal(await cell('tier1','before').textContent(),'70%');assert.equal(await cell('tier1','after').textContent(),'75%');
    assert.ok(!(await cell('tier2','p').textContent()).includes('—'));
    // Tier 3 has raw p≈0.035 but Holm p≈0.141; the label must follow the adjusted value.
    assert.ok(Number(await page.locator('.group-detail-table tbody tr').nth(3).locator('td').nth(2).textContent())<0.05);
    assert.ok(Number(await cell('tier3','p').textContent())>0.05);
    assert.equal(await cell('tier3','decision').textContent(),'棄却できず');
    await page.locator('#ovClass').selectOption('2年B組');await n('all',3);
    assert.equal(await cell('all','ci').textContent(),'—');assert.equal(await cell('all','p').textContent(),'—');assert.match(await cell('all','reading').textContent(),/全員の変化量が同じ.*差を検定できません/);
    assert.equal(await cell('all','decision').textContent(),'判定不可');
    assert.equal(await cell('tier3','decision').textContent(),'判定不可');
    const emptyBars=await page.evaluate(()=>echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')).getOption().series.map(s=>s.data.slice(2)));
    assert.deepEqual(emptyBars,[[null,null],[null,null]]);
    await page.locator('#ovClass').selectOption('2年C組');await n('all',1);
    assert.equal(await cell('all','before').textContent(),'0%');assert.equal(await cell('all','change').textContent(),'+10');
    assert.equal(await cell('all','p').textContent(),'—');assert.match(await cell('all','reading').textContent(),/比較が1名/);
    assert.equal(await cell('all','decision').textContent(),'判定不可');
    await page.locator('#ovClass').selectOption('all');
    await page.evaluate(()=>{ui.rtiBasis='avg';ui.rtiSubject='数学';renderOverview();});await n('tier1',6);
    await page.evaluate(()=>{data.settings.rti={tier3:40.5,tier2:60.5};renderOverview();});
    await n('tier1',5);await n('tier2',3);await n('tier3',5);
    assert.match(await page.locator('tr[data-group-detail="tier2"] th').textContent(),/40\.5%以上60\.5%未満/);
    await page.locator('#ovClass').selectOption('2年B組');
    await page.evaluate(()=>{for(let i=12;i<15;i++)data.scores.find(r=>r.studentId==='group-'+i&&r.testId==='after').total=90+[0.005,0.006,0.007][i-12];renderOverview();});
    const smallInterval=(await cell('all','ci').textContent()).split('～').map(Number);
    assert.ok(smallInterval[0]>0&&smallInterval[1]>smallInterval[0]);
    assert.ok(Number(await cell('all','p').textContent())<0.05);
    await reset();
    await page.locator('.group-comparison-details > summary').click();
    assert.equal(await page.locator('.group-comparison-details').evaluate(e=>e.open),false);
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
    await page.waitForFunction(()=>!!echarts.getInstanceByDom(document.getElementById('ovGroupComparisonChart')));
    const popup=page.waitForEvent('popup');await page.locator('.group-comparison-details a').click();
    const guide=await popup;await guide.waitForLoadState();assert.ok(guide.url().endsWith('/files/manual.html#group-comparison'));assert.equal(await guide.locator('#group-comparison').count(),1);await guide.close();
    const saved=await download(page);assert.deepEqual(saved.scores,d.scores);assert.deepEqual(saved.students,d.students);assert.deepEqual(saved.tests,d.tests);
    await upload(page,saved,'fictional-groups-reopen.json');await page.locator('[data-tab="overview"]').click();await page.locator('#ovTest').selectOption('after');await page.locator('#ovClass').selectOption('all');await n('all',13);
    await page.locator('#ovComparisonBtn').click();await page.locator('#cfCompare').selectOption('none');await page.locator('#comparisonForm button[type="submit"]').click();
    assert.equal(await page.locator('#ovComparison').isVisible(),false);assert.equal(await page.locator('#ovGroupComparisonChart').count(),0);
  }finally{await page.evaluate(v=>applyJsonText(JSON.stringify(v),'fictional-groups-restored.json',null),original);}
};
