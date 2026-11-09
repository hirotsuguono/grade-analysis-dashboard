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
    for(const width of [320,768,1280]){
      await page.setViewportSize({width,height:900});
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
      await guide.locator('#effect-size-sources > summary').click();
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
