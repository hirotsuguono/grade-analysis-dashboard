'use strict';
const assert = require('node:assert/strict');
const endpoint = 'https://api.github.com/repos/hirotsuguono/grade-analysis-dashboard/releases/latest';
const preference = 'grade-dashboard-auto-update-check';
const release = tag => ({ tag_name: tag, draft: false, prerelease: false, assets: [{ name: 'grade-analysis-dashboard.zip', state: 'uploaded', size: 100, browser_download_url: `https://github.com/hirotsuguono/grade-analysis-dashboard/releases/download/${tag}/grade-analysis-dashboard.zip` }] });

module.exports = async (parent, fixture) => {
  // A separate context mocks every online response; real student data and real API calls are never used.
  const context = await parent.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const calls = [], unexpected = [], errors = [];
  let response = release('v0.4.1'), status = 200, delay = 0;
  await context.addInitScript(() => { delete window.showOpenFilePicker; });
  await context.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url === endpoint) {
      calls.push({ url, method: request.method(), body: request.postData(), headers: await request.allHeaders() });
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(response) }).catch(() => {});
    } else if (/^(file:|data:|blob:|http:\/\/127\.0\.0\.1:\d+\/)/.test(url)) await route.continue();
    else { unexpected.push(url); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const state = async expected => page.waitForFunction(value => document.getElementById('updateStatus').dataset.state === value, expected);
  const check = async expected => { await page.locator('#checkUpdateBtn').click(); await state(expected); };
  try {
    await page.goto(parent.url());
    await state('current');
    assert.equal(calls.length, 1, 'one automatic startup request');
    assert.match(await page.locator('#updateStatus').textContent(), /最新の正式リリースと同じ/);
    await page.evaluate(d => { applyJsonText(JSON.stringify(d), 'fictional-update-check.json', null); dirty = true; }, fixture);
    const saved = await page.evaluate(() => ({ json: JSON.stringify(data), dirty, fileName, hasHandle: !!fileHandle }));
    response = release('v0.4.2'); await check('available');
    response = release('v0.4.0'); await check('ahead');
    assert.doesNotMatch(await page.locator('#updateStatus').textContent(), /最新版です/);
    response = release('v0.4.1'); await check('current');
    delay = 100;
    await page.locator('#checkUpdateBtn').focus(); await page.keyboard.press('Enter');
    await state('checking');
    assert.equal(await page.locator('#checkUpdateBtn').getAttribute('aria-disabled'), 'true');
    await state('current');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'checkUpdateBtn');
    delay = 0;
    status = 403; await check('unconfirmed');
    assert.doesNotMatch(await page.locator('#updateStatus').textContent(), /同じ版です/);
    status = 200; response = release('v0.4.2'); response.assets = []; await check('unconfirmed');
    response = release('v0.4.2'); response.tag_name = '<img src=x onerror=alert(1)>'; await check('unconfirmed');
    assert.equal(await page.locator('.update-card img, .update-card script').count(), 0);
    response = release('v0.4.2'); delay = 250;
    const count = calls.length;
    await page.locator('#checkUpdateBtn').evaluate(el => { el.click(); el.dispatchEvent(new Event('click')); });
    await state('checking');
    await page.locator('#autoUpdateCheck').uncheck();
    await state('disabled');
    await page.waitForTimeout(300);
    assert.equal(calls.length, count + 1, 'duplicate checks coalesce');
    assert.equal(await page.locator('#updateStatus').getAttribute('data-state'), 'disabled', 'late result cannot overwrite opt out');
    delay = 0;
    await check('available'); // Manual check works while automatic checks are disabled.
    assert.deepEqual(await page.evaluate(() => ({ json: JSON.stringify(data), dirty, fileName, hasHandle: !!fileHandle })), saved);
    for (const call of calls) {
      assert.equal(call.url, endpoint); assert.equal(call.method, 'GET'); assert.equal(call.body, null);
      for (const name of ['cookie', 'authorization', 'referer']) assert.equal(call.headers[name], undefined);
      assert.doesNotMatch(JSON.stringify(call), /fictional-update-check|架空生徒|studentId/);
    }
    await page.evaluate(() => { dirty = false; });
    await page.reload(); await state('disabled');
    const disabledCount = calls.length;
    await page.waitForTimeout(100); assert.equal(calls.length, disabledCount);
    await page.locator('#autoUpdateCheck').check();
    await state('unconfirmed');
    assert.match(await page.locator('#updateStatus').textContent(), /自動確認はオン/);
    assert.equal(calls.length, disabledCount, 'enabling applies to startup without an extra request');
    await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }));
    await page.reload(); await state('unconfirmed');
    assert.match(await page.locator('#updateStatus').textContent(), /オフライン/);
    assert.equal(calls.length, disabledCount);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('.app-footer').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const box = await page.locator('#checkUpdateBtn').boundingBox(); assert.ok(box.width >= 44 && box.height >= 44);
    }
    // Storage denial must not prevent the app or the current session's opt out.
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage unavailable'); } });
    });
    await page.reload(); await state('available');
    await page.locator('#autoUpdateCheck').uncheck(); await state('disabled');
    assert.equal(await page.locator('#emptyState').isVisible(), true);
    await check('available');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  } finally { await context.close(); }
};
