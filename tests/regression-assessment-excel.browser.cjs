'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, fixture) => {
  try {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-excel-classifications.json', null), fixture);
    const result = await page.evaluate(async () => {
      const wb = GD_EXCEL.testTemplate(XLSX, data.students);
      const set = (sheet, address, value) => XLSX.utils.sheet_add_aoa(wb.Sheets[sheet], [[value]], { origin: address });
      for (const [key, value] of Object.entries({ B8:'英語', B10:'架空の観点別内訳', B14:'2026-06-24' })) set('① テスト設定',key,value);
      for (const [key,value] of Object.entries({F7:'リスニング',G7:'リスニング',H7:'読解',I7:'読解',F8:'知識・技能',G8:'思考・判断・表現',H8:'知識・技能',I8:'未設定',F9:2,G9:3,H9:4,I9:5,F10:'大問1-(1)',G10:'大問1-(2)',H10:'大問2・知識技能分',I10:'内訳不明',F11:2,G11:1,H11:4,I11:0,F12:0,G12:0,H12:0,I12:0,F13:'欠'})) set('② 点数入力',key,value);
      const firstId=data.students[0].id, secondId=data.students[1].id, thirdId=data.students[2].id;
      const roster=JSON.stringify(data.students), beforeCount=data.tests.length;
      await importTestTemplate(new File([await GD_EXCEL.writeBuffer(wb)],'fictional-observation-items.xlsx'));
      const test=data.tests.at(-1);
      const record=getScore(firstId,test.id);
      ui.anTest=test.id;ui.anAxis='perspective';
      dirty=true;
      const before={data:JSON.stringify(data),fileName,fileHandle,dirty,activeDataToken};
      const failures=[];
      for(const [cell,value] of [['F8','未知の観点'],['BD8','知識・技能']]) {
        set('② 点数入力','F8','知識・技能');set('② 点数入力','BD8','');
        set('② 点数入力',cell,value);
        await importTestTemplate(new File([await GD_EXCEL.writeBuffer(wb)],'fictional-rejected-classifications.xlsx'));
        failures.push(JSON.stringify(data)===before.data && fileName===before.fileName && fileHandle===before.fileHandle && dirty===before.dirty && activeDataToken===before.activeDataToken);
      }
      const errorCells=[];
      for(const address of ['F8','BD8']) {
        set('② 点数入力','F8','知識・技能');set('② 点数入力','BD8','');
        wb.Sheets['② 点数入力'][address]={t:'e',v:15};
        const bytes=XLSX.write(wb,{type:'array',bookType:'xlsx'});
        const reread=XLSX.read(bytes,{type:'array'});
        let message='';
        try {await importTestTemplate(new File([bytes],'fictional-excel-error.xlsx'));} catch(error) {message=error.message;}
        errorCells.push(reread.Sheets['② 点数入力'][address].t==='e' && message.includes(address) && message.includes('Excelのエラー値') && JSON.stringify(data)===before.data && fileName===before.fileName && fileHandle===before.fileHandle && dirty===before.dirty && activeDataToken===before.activeDataToken);
      }
      return {beforeCount,afterCount:data.tests.length,test,total:record.total,questions:record.questions,zero:getScore(secondId,test.id).total,absent:getScore(thirdId,test.id).absent,rosterSame:JSON.stringify(data.students)===roster,failures,errorCells,valid:validateDataset(data).length};
    });
    assert.equal(result.afterCount,result.beforeCount+1);assert.equal(result.test.maxScore,14);
    assert.deepEqual(result.test.questions.map(q=>q.perspective||''),['knowledge','thinking','knowledge','']);
    assert.equal(result.total,7);assert.equal(result.zero,0);assert.equal(result.absent,true);
    assert.deepEqual(Object.values(result.questions),[2,1,4,0]);assert.equal(result.rosterSame,true);assert.deepEqual(result.failures,[true,true]);assert.equal(result.valid,0);
    assert.deepEqual(result.errorCells,[true,true]);
    await page.locator('[data-tab="analysis"]').click();
    await page.locator('#anClassificationAxis').selectOption('perspective');
    assert.match(await page.locator('#anClassificationTable').textContent(),/知識・技能.*6点.*2名.*50%/s);
    assert.match(await page.locator('#anClassificationSummary').textContent(),/観点未設定 1項目・5点分/);
    const serialized=await page.evaluate(()=>JSON.stringify(data));
    await page.evaluate(value=>applyJsonText(value,'fictional-excel-reopened.json',null),serialized);
    assert.equal(await page.evaluate(()=>data.tests.at(-1).questions[1].perspective),'thinking');
  } finally {
    await page.evaluate(value=>applyJsonText(JSON.stringify(value),'fictional-excel-restored.json',null),fixture);
  }
};
