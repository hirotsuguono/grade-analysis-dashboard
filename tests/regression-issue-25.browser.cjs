'use strict';
const assert = require('node:assert/strict');
const { dataset, upload, download, rows, workbook, screenshot } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const d = dataset(); d.tests = [];
  try {
    await upload(page, d, 'fictional-25-empty.json');
    for (const [i, date] of ['2026-07-01', '2026-05-01'].entries()) {
      await page.locator('#testXlsxInput').setInputFiles(workbook(rows('架空の同名テスト', date, false), `fictional-25-${i}.xlsx`));
      await page.waitForFunction(n => data.tests.length === n, i + 1);
    }
    const ids = await page.evaluate(() => Object.fromEntries(data.tests.map(t => [t.date, t.id])));
    await page.locator('[data-tab="overview"]').click();
    await page.locator('#ovTest').selectOption(ids['2026-05-01']);
    await page.locator('#ovComparisonBtn').click();
    assert.equal(await page.locator(`#cfCompare option[value="${ids['2026-07-01']}"]`).count(), 0);
    assert.match(await page.locator('#cfStatus').textContent(), /比較対象はありません/);
    await page.locator('#cfTest').selectOption(ids['2026-07-01']);
    assert.match(await page.locator('#cfStatus').textContent(), /2026-05-01/);
    await page.locator('#cfCompare').selectOption(ids['2026-05-01']);
    await page.locator('#comparisonForm button[type="submit"]').click();
    await page.locator('#ovTest').selectOption(ids['2026-07-01']);
    assert.match(await page.locator('#kpiGrid').textContent(), /両方受験 2名/);
    const saved = await download(page);
    await upload(page, saved, 'fictional-25-reopened.json');
    assert.equal(await page.evaluate(() => validateDataset(data).length), 0);
    assert.equal(await page.evaluate(id => comparisonTarget(testById(id)).date, ids['2026-07-01']), '2026-05-01');
    await page.locator('#ovTest').selectOption(ids['2026-07-01']);
    await page.locator('#ovComparisonBtn').click();
    await screenshot(page, 25);
    await page.locator('#cfCloseBtn').click();
  } finally { await upload(page, original, 'fictional-25-restored.json'); }
};
