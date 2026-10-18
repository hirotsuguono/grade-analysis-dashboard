'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

module.exports = async function checkStartupRecovery(page) {
  const app = path.resolve(process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grade-startup-recovery-'));
  const contexts = [];
  const open = async (folder, options = {}) => {
    // Missing assets are intentional here. Keep their errors out of the healthy-app context.
    const context = await page.context().browser().newContext({ offline: true, ...options });
    contexts.push(context);
    const target = await context.newPage();
    await target.goto(pathToFileURL(path.join(folder, 'Index.html')).href);
    return target;
  };
  try {
    const original = path.join(root, 'unpacked-app');
    const moved = path.join(root, 'moved-app');
    fs.cpSync(app, original, { recursive: true });
    fs.renameSync(original, moved);
    const healthy = await open(moved);
    assert.ok(await healthy.locator('#startupHelp').isHidden());
    await healthy.locator('#demoBtn').click();
    assert.equal(await healthy.evaluate(() => data.students.length), 60);
    for (const name of ['input', 'trend', 'analysis', 'metrics', 'rti', 'list', 'overview']) {
      await healthy.locator(`[data-tab="${name}"]`).click();
      assert.ok(await healthy.locator('#panel-' + name).isVisible());
    }

    const detached = path.join(root, 'index-only');
    fs.mkdirSync(detached);
    fs.copyFileSync(path.join(moved, 'Index.html'), path.join(detached, 'Index.html'));
    const standalone = await open(detached);
    assert.ok(await standalone.locator('#startupHelp').isVisible());
    const instructions = await standalone.locator('#startupHelp').textContent();
    assert.match(instructions, /Index\.html だけでは動きません/);
    assert.match(instructions, /すべて展開/);
    assert.match(instructions, /files フォルダと同じ場所/);
    assert.match(instructions, /フォルダを中身ごと/);
    assert.match(instructions, /成績JSON.*別のファイル/);

    const stylesheet = path.join(moved, 'files', 'style.css');
    const savedStyle = fs.readFileSync(stylesheet);
    fs.unlinkSync(stylesheet);
    const missingStyle = await open(moved);
    assert.ok(await missingStyle.locator('#startupHelp').isVisible());
    fs.writeFileSync(stylesheet, savedStyle);

    fs.unlinkSync(path.join(moved, 'files', 'script.js'));
    const missingScript = await open(moved);
    assert.ok(await missingScript.locator('#startupHelp').isVisible());

    const noScript = await open(detached, { javaScriptEnabled: false });
    assert.ok(await noScript.locator('#startupHelp').isVisible());
    assert.match(await noScript.locator('noscript').textContent(), /JavaScriptを有効/);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    fs.rmSync(root, { recursive: true, force: true });
  }
};
