'use strict';
const assert = require('node:assert/strict');
const { dataset, upload, download, screenshot } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const d = dataset();
  d.scores = [80, 0, null].map((total, i) => ({ studentId: d.students[i].id, testId: 't', total, questions: {}, domains: {} }));
  try {
    await upload(page, d, 'fictional-24-before.json');
    await page.locator('[data-tab="input"]').click();
    for (const student of d.students) await page.locator(`#scoreTableWrap tr[data-sid="${student.id}"] .absent-check`).check();
    assert.deepEqual(await page.evaluate(() => data.scores.map(r => r.total)), [80, 0, null]);
    const saved = await download(page);
    await upload(page, saved, 'fictional-24-reopened.json');
    await page.locator('[data-tab="overview"]').click();
    assert.match(await page.locator('#kpiGrid').textContent(), /受験者数\s*0/);
    await page.locator('[data-tab="input"]').click();
    for (const [i, student] of d.students.entries()) {
      const row = page.locator(`#scoreTableWrap tr[data-sid="${student.id}"]`);
      await row.locator('.absent-check').uncheck();
      assert.equal(await row.locator('.cell-input').inputValue(), ['80', '0', ''][i]);
    }
    const restored = await download(page);
    assert.deepEqual(restored.scores.map(r => r.total), [80, 0, null]);
    await page.locator('[data-tab="overview"]').click();
    assert.match(await page.locator('#kpiGrid').textContent(), /受験者数\s*2/);
    await screenshot(page, 24);
  } finally { await upload(page, original, 'fictional-24-restored.json'); }
};
