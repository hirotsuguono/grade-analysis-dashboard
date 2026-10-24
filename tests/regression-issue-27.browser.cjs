'use strict';
const assert = require('node:assert/strict');
const { dataset, upload, download, screenshot } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const d = dataset(true);
  d.scores = d.students.map(s => ({ studentId: s.id, testId: 't', total: 50, questions: { q1: 50, q2: 0 }, domains: { 読解: 50 } }));
  try {
    for (const selected of [['a'], ['a', 'b']]) {
      await upload(page, d, `fictional-27-${selected.length}.json`);
      await page.locator('[data-tab="trend"]').click();
      for (const id of selected) await page.locator(`#studentList li[data-sid="${id}"]`).click();
      await page.locator('#roleBtn').click(); await page.locator('#adminPinInput').fill('1357');
      await page.locator('#adminSubmit').click(); await page.waitForFunction(() => isAdmin);
      await page.locator('#rosterBtn').click();
      await page.locator('#rosterTableWrap tr[data-sid="a"] .row-del').click();
      await page.locator('#rosterCloseBtn').click();
      assert.equal(await page.evaluate(() => ui.trendSelected.has('a')), false);
      assert.equal(await page.evaluate(() => ui.trendSelected.size), selected.length - 1);
      if (selected.length === 1) await page.locator('#studentList li[data-sid="b"]').click();
      assert.ok(await page.locator('#trendDomainCard').isVisible());
      await page.locator('#printKarteBtn').click();
      assert.match(await page.locator('#kartePreview').textContent(), /架空生徒2/);
      await page.locator('#karteCloseBtn').click();
      const saved = await download(page);
      assert.equal(saved.students.length, 2);
      assert.ok(saved.scores.every(r => r.studentId !== 'a'));
      await page.locator('#rosterBtn').click();
      for (const id of ['b', 'c']) await page.locator(`#rosterTableWrap tr[data-sid="${id}"] .row-del`).click();
      await page.locator('#rosterCloseBtn').click();
      assert.equal(await page.evaluate(() => ui.trendSelected.size), 0);
      assert.equal(await page.locator('#printKarteBtn').isDisabled(), true);
      assert.equal(await page.locator('#trendDomainCard').isVisible(), false);
      assert.equal(await page.evaluate(() => validateDataset(data).length), 0);
    }
    await screenshot(page, 27);
    assert.equal((await download(page)).students.length, 0);
  } finally { await upload(page, original, 'fictional-27-restored.json'); }
};
