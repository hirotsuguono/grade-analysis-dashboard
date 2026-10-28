'use strict';
const assert = require('node:assert/strict');
module.exports = async (parent, fixture) => {
  const context = parent.context();
  let legacySaved;
  for (const mode of ['available', 'unavailable', 'failed']) {
    const page = await context.newPage();
    try {
      await page.addInitScript(mode => {
        if (mode === 'unavailable') Object.defineProperty(window, 'crypto', { configurable: true, value: undefined });
        if (mode === 'failed') Object.defineProperty(window.crypto, 'subtle', { configurable: true,
          value: { async digest() { throw new Error('synthetic digest failure'); } } });
      }, mode);
      await page.goto(parent.url());
      assert.equal(await page.evaluate(d => applyJsonText(JSON.stringify(d), 'synthetic-pin.json', null), fixture), true);
      await page.locator('#roleBtn').click();
      await page.locator('#adminPinInput').fill('1234');
      await page.locator('#adminSubmit').click();
      await page.waitForFunction(() => isAdmin);
      const hash = await page.evaluate(() => data.settings.adminPinHash);
      assert.equal(hash.length, mode === 'available' ? 64 : 16);
      const expected = await page.evaluate(() => JSON.stringify(data));
      const pending = page.waitForEvent('download');
      await page.locator('#saveBtn').click();
      await page.locator('#saveDownloadBtn').click();
      const stream = await (await pending).createReadStream(), chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      assert.equal(JSON.stringify(JSON.parse(bytes)), expected);
      if (mode === 'unavailable') legacySaved = JSON.parse(bytes);
      await page.locator('#downloadConfirmBtn').click();
      assert.equal(await page.evaluate(() => dirty), false);
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#openBtn').click();
      await (await chooser).setFiles({ name: 'synthetic-pin-reopened.json', mimeType: 'application/json', buffer: bytes });
      await page.waitForFunction(() => fileName === 'synthetic-pin-reopened.json');
      assert.equal(await page.evaluate(() => JSON.stringify(data)), expected);
      assert.equal(await page.evaluate(() => isAdmin), false);
      await page.locator('#roleBtn').click();
      await page.locator('#adminPinInput').fill('9999');
      await page.locator('#adminSubmit').click();
      assert.equal(await page.evaluate(() => isAdmin), false);
      await page.locator('#adminPinInput').fill('1234');
      await page.locator('#adminSubmit').click();
      await page.waitForFunction(() => isAdmin);
    } finally { await page.close(); }
  }
  const page = await context.newPage();
  try {
    await page.goto(parent.url());
    assert.equal(await page.evaluate(() => !!crypto?.subtle), true);
    assert.equal(await page.evaluate(d => applyJsonText(JSON.stringify(d), 'synthetic-legacy-pin.json', null), legacySaved), true);
    await page.locator('#roleBtn').click();
    await page.locator('#adminPinInput').fill('1234');
    await page.locator('#adminSubmit').click();
    await page.waitForFunction(() => isAdmin);
    assert.equal(await page.evaluate(() => data.settings.adminPinHash.length), 16);
    console.log('PASS PIN compatibility: SHA-256 / unavailable Web Crypto / digest failure / legacy PIN in Web Crypto');
  } finally { await page.close(); }
};
