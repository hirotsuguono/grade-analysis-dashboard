'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');

module.exports = async (parent, fixture) => {
  const context = parent.context();
  const page = await context.newPage();
  let updated;
  try {
    await page.goto(parent.url());
    const version = require('../package.json').version;
    assert.equal(await page.locator('#appVersion').getAttribute('data-version'), version);
    assert.equal(await page.locator('#appVersion').textContent(), `v${version}${version.includes('-') ? '（開発版）' : ''}`);
    for (const [id, url] of [
      ['latestReleaseLink', 'https://github.com/hirotsuguono/grade-analysis-dashboard/releases/latest'],
      ['repositoryLink', 'https://github.com/hirotsuguono/grade-analysis-dashboard'],
    ]) {
      const link = page.locator('#' + id);
      assert.equal(await link.getAttribute('href'), url);
      assert.equal(await link.getAttribute('target'), '_blank');
      assert.match(await link.getAttribute('rel'), /noopener/);
      assert.match(await link.getAttribute('rel'), /noreferrer/);
    }
    const guide = page.locator('#updateGuide');
    const summary = guide.locator('summary');
    assert.equal(await guide.evaluate(el => el.open), false);
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await guide.evaluate(el => el.open), true);
    assert.equal(await guide.locator('li').count(), 4);
    assert.match(await guide.textContent(), /JSON.*保存/);
    assert.match(await guide.textContent(), /すべて展開/);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('.app-footer').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      for (const id of ['latestReleaseLink', 'repositoryLink']) {
        const link = page.locator('#' + id);
        const box = await link.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, `${width}px ${id} needs a usable touch target`);
        assert.ok(await link.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      }
    }

    const initialChooser = page.waitForEvent('filechooser');
    await page.locator('#openBtnEmpty').click();
    await (await initialChooser).setFiles({
      name: 'fictional-before-update.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.waitForFunction(() => !!data);
    await page.locator('[data-tab="input"]').click();
    await page.locator('#scoreTableWrap input.cell-input:not(:disabled)').first().fill('7');
    const before = await page.evaluate(() => ({ data: JSON.stringify(data), dirty }));
    assert.equal(before.dirty, true);
    await summary.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('Space');
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(data), dirty })), before);

    await page.locator('#saveBtn').click();
    await page.locator('#saveDownloadName').fill('fictional-update-transfer.json');
    const pending = page.waitForEvent('download');
    await page.locator('#saveDownloadBtn').click();
    const downloaded = await pending, chunks = [];
    for await (const chunk of await downloaded.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.deepEqual(JSON.parse(bytes), JSON.parse(before.data));
    await page.locator('#downloadConfirmBtn').click();
    assert.equal(await page.evaluate(() => dirty), false);

    const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '..', 'test-results'));
    const copy = path.join(output, 'issue-32-new-app');
    fs.cpSync(path.dirname(fileURLToPath(parent.url())), copy, { recursive: true });
    updated = await context.newPage();
    await updated.goto(pathToFileURL(path.join(copy, 'Index.html')).href);
    assert.ok(await updated.locator('#emptyState').isVisible());
    const chooser = updated.waitForEvent('filechooser');
    await updated.locator('#openBtnEmpty').click();
    await (await chooser).setFiles({ name: 'fictional-update-transfer.json', mimeType: 'application/json', buffer: bytes });
    await updated.waitForFunction(() => !!data);
    assert.deepEqual(await updated.evaluate(() => JSON.parse(JSON.stringify(data))), JSON.parse(before.data));
    assert.equal(await updated.evaluate(() => dirty), false);
    assert.equal(await page.evaluate(() => JSON.stringify(data)), before.data);
    await updated.setViewportSize({ width: 1280, height: 900 });
    await updated.locator('#updateCardTitle').click();
    await updated.locator('.app-footer').screenshot({ path: path.join(output, 'issue-32-footer-collapsed.png') });
    await updated.locator('#updateGuide summary').click();
    await updated.emulateMedia({ media: 'print' });
    assert.equal(await updated.locator('.app-footer').isVisible(), false);
    await updated.emulateMedia({ media: 'screen' });
    await updated.setViewportSize({ width: 1280, height: 900 });
    await updated.locator('.app-footer').screenshot({ path: path.join(output, 'issue-32-footer.png') });
    await updated.setViewportSize({ width: 320, height: 900 });
    await updated.locator('#updateCardTitle').click();
    await updated.locator('.app-footer').screenshot({ path: path.join(output, 'issue-32-footer-mobile.png') });
  } finally {
    if (updated) await updated.close();
    await page.close();
  }
};
