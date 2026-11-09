'use strict';
const assert=require('node:assert/strict');

module.exports=async(page,fixture)=>{
  const viewport=page.viewportSize();
  try{
    await page.evaluate(d=>applyJsonText(JSON.stringify(d),'fictional-effect-guide.json',null),fixture);
    await page.locator('[data-tab="overview"]').click();await page.locator('#ovClass').selectOption('all');
    const before=await page.evaluate(()=>JSON.stringify(data));
    await page.locator('#kpiGrid .es-link').first().click();
    const dialog=page.locator('#esHelpDialog');
    assert.equal(await dialog.isVisible(),true);
    assert.equal(await dialog.locator('h2').textContent(),'効果量の見方');
    assert.equal(await dialog.locator('details').evaluate(e=>e.open),false);
    assert.equal(await dialog.locator('.es-table').isVisible(),false);
    assert.doesNotMatch(await dialog.locator('.es-help-intro').textContent(),/Cohen|\bdz\b|標準偏差|Hattie/);
    await page.setViewportSize({width:320,height:640});
    assert.ok(await page.locator('#esHelpCloseTop').evaluate(button=>{
      const b=button.getBoundingClientRect(),d=button.closest('dialog').getBoundingClientRect();
      return b.top>=Math.max(0,d.top)&&b.bottom<=Math.min(innerHeight,d.bottom)&&b.left>=0&&b.right<=innerWidth;
    }),'a close button must be fully visible without scrolling on a short screen');
    await page.locator('#esHelpCloseTop').click();assert.equal(await dialog.isVisible(),false);
    assert.equal(await page.locator('#kpiGrid .es-link').first().evaluate(e=>e===document.activeElement),true);
    await page.locator('#kpiGrid .es-link').first().click();
    for(const [width,height] of [[320,640],[320,900],[768,900],[1280,900]]){
      await page.setViewportSize({width,height});
      await dialog.locator('summary').focus();await page.keyboard.press('Enter');
      assert.equal(await dialog.locator('.es-table').isVisible(),true);
      assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'expanded help must fit the dialog');
      await page.keyboard.press('Enter');
      assert.equal(await dialog.locator('.es-table').isVisible(),false);
    }
    await page.setViewportSize(viewport);
    const popup=page.waitForEvent('popup');await dialog.locator('a[href$="#effect-size-guide"]').click();
    const guide=await popup;
    try{
      await guide.waitForLoadState();assert.ok(guide.url().endsWith('/files/manual.html#effect-size-guide'));
      assert.equal(await guide.locator('#effect-size-sources').evaluate(e=>e.open),false);
      assert.equal(await guide.locator('#effect-size-sources a').first().isVisible(),false);
      for(const width of [320,768,1280]){
        await guide.setViewportSize({width,height:900});
        assert.ok(await guide.locator('.effect-location-table').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'the guide table must fit without horizontal scrolling');
      }
      await guide.locator('#effect-size-sources > summary').click();
      assert.match(await guide.locator('#effect-size-sources').textContent(),/本人に点数がある直近回.*現在のクラスのメンバー.*過去の所属クラスは使いません/s);
      const links=guide.locator('#effect-size-sources a');assert.equal(await links.count(),3);
      for(const link of await links.all()){
        assert.equal(await link.isVisible(),true);assert.equal(await link.getAttribute('target'),'_blank');
        assert.ok((await link.getAttribute('rel')).includes('noopener'));
      }
      assert.doesNotMatch(await guide.locator('body').textContent(),/この版の前後比較には、t検定や信頼区間の表示はありません|Hattie|1年間の通常授業以上/);
      assert.equal(await guide.locator('#group-comparison').count(),1);
    }finally{await guide.close();}
    await page.locator('#esHelpClose').click();assert.equal(await dialog.isVisible(),false);
    assert.equal(await page.evaluate(()=>JSON.stringify(data)),before);
  }finally{
    if(await page.locator('#esHelpDialog').isVisible())await page.locator('#esHelpClose').click();
    await page.setViewportSize(viewport);
    await page.evaluate(d=>applyJsonText(JSON.stringify(d),'fictional-effect-restored.json',null),fixture);
  }
};
