'use strict';
const assert = require('node:assert/strict');
const { dataset, upload, download, paste, screenshot } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const d = dataset();
  d.metrics = [{ id: 'scale', label: '架空の5段階', type: 'scale', values: { a: 2 } }, { id: 'number', label: '架空の数値', type: 'number', values: { a: 2 } }];
  try {
    await upload(page, d, 'fictional-28-input.json');
    await page.locator('[data-tab="metrics"]').click();
    await page.locator('#metricSel').selectOption('scale');
    const first = page.locator('#metricTableWrap input[data-sid="a"]');
    await first.fill('2.5');
    assert.equal(await first.getAttribute('aria-invalid'), 'true');
    assert.equal(await page.evaluate(() => data.metrics[0].values.a), 2);
    await first.fill('');
    assert.equal(await first.getAttribute('aria-invalid'), 'false');
    await first.fill('2');
    await paste(first, '2.5\n5');
    assert.deepEqual(await page.evaluate(() => data.metrics[0].values), { a: 2, b: 5 });
    const saved = await download(page);
    const invalid = structuredClone(saved); invalid.metrics[0].values.a = 2.5;
    const rejected = page.waitForEvent('dialog', d => d.type() === 'alert' && d.message().includes('成績データに問題'));
    await page.locator('#fileInput').setInputFiles({ name: 'fictional-28-invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) });
    await rejected;
    assert.equal(await page.evaluate(() => fileName), 'fictional-28-input.json');
    assert.equal(await page.evaluate(() => data.metrics[0].values.a), 2);
    await page.locator('#metricSel').selectOption('number');
    await first.fill('3.5'); await paste(first, '4.5\n2.5');
    assert.deepEqual(await page.evaluate(() => data.metrics[1].values), { a: 4.5, b: 2.5 });
    await upload(page, await download(page), 'fictional-28-reopened.json');
    assert.equal(await page.evaluate(() => validateDataset(data).length), 0);
    await page.locator('[data-tab="metrics"]').click(); await page.locator('#metricSel').selectOption('scale');
    await screenshot(page, 28);
  } finally { await upload(page, original, 'fictional-28-restored.json'); }
};
