'use strict';
const assert = require('node:assert/strict');
const { dataset, upload, download, rows, workbook, paste, screenshot } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  try {
    await upload(page, dataset(true), 'fictional-26-input.json');
    await page.locator('[data-tab="input"]').click();
    const row = page.locator('#scoreTableWrap tr[data-sid="a"]');
    await row.locator('[data-q="q1"]').fill('50');
    assert.match(await row.locator('.cell-total').textContent(), /50.*入力途中.*1\/2問/);
    assert.equal(await row.locator('.cell-rate').textContent(), '');
    assert.match(await page.locator('#inputStatus').textContent(), /入力済 0名.*入力途中 1名/);
    await page.locator('[data-tab="overview"]').click();
    assert.match(await page.locator('#kpiGrid').textContent(), /受験者数\s*0/);
    assert.equal(await page.evaluate(() => rtiRateFor('a', '英語').rate), null);
    await page.locator('[data-tab="input"]').click();
    await row.locator('[data-q="q2"]').fill('0');
    assert.equal(await row.locator('.cell-rate').textContent(), '50%');
    await row.locator('[data-q="q2"]').fill('');
    assert.equal(await row.locator('.cell-rate').textContent(), '');
    await paste(row.locator('[data-q="q1"]'), '50\t\n50\t0');
    assert.equal(await page.evaluate(() => getScore('a', 't').total), null);
    assert.equal(await page.evaluate(() => getScore('b', 't').total), 50);
    const saved = await download(page);
    await upload(page, saved, 'fictional-26-reopened.json');
    await page.locator('#testXlsxInput').setInputFiles(workbook(rows('架空の途中入力Excel'), 'fictional-26.xlsx'));
    await page.waitForFunction(() => data.tests.length === 2);
    assert.deepEqual(await page.evaluate(() => {
      const id = data.tests.at(-1).id;
      return [getScore('a', id).total, getScore('b', id).total, getScore('c', id).absent, rtiRateFor('a', '英語').rate];
    }), [null, 50, true, null]);
    await page.locator('[data-tab="analysis"]').click();
    await page.locator('#anTest').selectOption(await page.evaluate(() => data.tests.at(-1).id));
    assert.deepEqual(await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('anDomainChart')).getOption().series[0].data.map(d => d.value)), [50]);
    await page.locator('[data-tab="input"]').click();
    await page.setViewportSize({ width: 320, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await screenshot(page, 26);
    await page.setViewportSize({ width: 1280, height: 900 });
  } finally { await upload(page, original, 'fictional-26-restored.json'); }
};
