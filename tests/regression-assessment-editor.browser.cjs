'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, original) => {
  const d = { version: 3, name: '架空の分類編集', students: Array.from({ length: 4 }, (_, i) => ({ id: 's' + i, name: '架空生徒' + i, className: '2年A組', number: i + 1 })),
    tests: [{ id: 't', name: '架空の取込テスト', subject: '英語', maxScore: 10, domains: [{ key: 'listen', label: 'リスニング', max: 5 }, { key: 'read', label: '読解', max: 5 }], questions: [
      { key: 'a', label: '架空小問1', max: 2, domain: 'listen', perspective: 'knowledge' }, { key: 'b', label: '架空小問2', max: 3, domain: 'listen', perspective: 'thinking' }, { key: 'c', label: '架空内訳', max: 5, domain: 'read' },
    ] }, { id: 'other', name: '架空の別テスト', subject: '英語', maxScore: 10 }],
    scores: [{ studentId: 's0', testId: 't', total: 7, questions: { a: 2, b: 1, c: 4 }, domains: { listen: 3, read: 4 } }, { studentId: 's1', testId: 't', total: 0, questions: { a: 0, b: 0, c: 0 } }, { studentId: 's2', testId: 't', total: 10, absent: true, questions: { a: 2, b: 3, c: 5 } }, { studentId: 's3', testId: 't', total: null, questions: { a: 1 } }, { studentId: 's0', testId: 'other', total: 8 }], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null } };
  const launch = page.locator('#editClassificationBtn'), dialog = page.locator('#classificationDialog');
  const open = async () => { await page.locator('[data-tab="input"]').click(); await page.locator('#inTest').selectOption('t'); await launch.click(); };
  const load = async () => page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-edit.json', null), d);
  const change = async () => {
    await page.locator('#ceDomains input').first().fill('音声理解<img src=x>');
    await page.locator('#ceQuestions > [data-key="c"] .ce-domain').selectOption('listen');
    await page.locator('#ceQuestions > [data-key="c"] .ce-perspective').selectOption('thinking');
  };
  try {
    await load(); await open();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.locator('#ceDomains button').first().click();
    assert.match(await page.locator('#ceDomainStatus').textContent(), /この分野に属する問題/);
    const domainStatus = await page.locator('#ceDomainStatus').boundingBox(); assert.ok(domainStatus.y >= 0 && domainStatus.y + domainStatus.height <= 640);
    const before = await page.evaluate(() => JSON.stringify(data));
    await change(); await page.locator('#cePreview').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'cePreviewHeading');
    const heading = await page.locator('#cePreviewHeading').boundingBox(); assert.ok(heading.y >= 0 && heading.y + heading.height <= 640);
    assert.match(await page.locator('#ceChanges').textContent(), /リスニング → 音声理解<img src=x>/);
    assert.equal(await dialog.locator('img, script').count(), 0);
    assert.equal(await page.evaluate(() => JSON.stringify(data)), before);
    await page.locator('#ceBack').click();
    assert.equal(await page.locator('#ceDomains input').first().inputValue(), '音声理解<img src=x>');
    await page.locator('#ceClose').click(); assert.equal(await page.evaluate(() => JSON.stringify(data)), before);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'editClassificationBtn');
    await open(); await change(); await page.locator('#cePreview').click(); await page.locator('#ceApply').click();
    assert.equal(await dialog.isVisible(), false);
    const result = await page.evaluate(() => JSON.parse(JSON.stringify(data)));
    const raw = r => r.map(({ domains, ...rest }) => rest);
    assert.deepEqual(raw(result.scores), raw(d.scores)); assert.deepEqual(result.tests[1], d.tests[1]);
    assert.deepEqual(result.tests[0].domains, [{ key: 'listen', label: '音声理解<img src=x>', max: 10 }]);
    assert.deepEqual(result.scores.slice(0, 4).map(r => r.domains), [{ listen: 7 }, { listen: 0 }, { listen: 10 }, {}]);
    assert.equal(await page.evaluate(() => dirty), true);
    await page.locator('[data-tab="analysis"]').click(); await page.locator('#anTest').selectOption('t'); await page.locator('#anClassificationAxis').selectOption('perspective');
    assert.match(await page.locator('#anClassificationTable').textContent(), /思考・判断・表現/);
    await page.locator('#saveBtn').click(); await page.locator('#saveDownloadName').fill('fictional-classifications.json');
    const pending = page.waitForEvent('download'); await page.locator('#saveDownloadBtn').click();
    const chunks = []; for await (const chunk of await (await pending).createReadStream()) chunks.push(chunk);
    const saved = Buffer.concat(chunks).toString('utf8'); assert.deepEqual(JSON.parse(saved), result);
    await page.locator('#downloadConfirmBtn').click();
    await page.evaluate(v => applyJsonText(v, 'fictional-reopened.json', null), saved);
    assert.equal(await page.evaluate(() => data.tests[0].questions[2].perspective), 'thinking');
    // Focus, mobile layout and bulk changes are checked before cancelling.
    await open();
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    await page.locator('#ceBulk summary').click(); await page.locator('#ceSelectAll').check();
    await page.locator('#ceQuestions .ce-select').first().uncheck();
    assert.equal(await page.locator('#ceSelectAll').isChecked(), false);
    assert.equal(await page.locator('#ceSelectAll').evaluate(el => el.indeterminate), true);
    await page.locator('#ceQuestions .ce-select').first().check();
    assert.equal(await page.locator('#ceSelectAll').isChecked(), true);
    await page.locator('#ceBulkPerspective').selectOption('knowledge'); await page.locator('#ceBulkApply').click();
    assert.match(await page.locator('#ceBulkStatus').textContent(), /3項目/);
    assert.deepEqual(await page.locator('.ce-perspective').evaluateAll(fields => fields.map(f => f.value)), ['knowledge', 'knowledge', 'knowledge']);
    await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), false);
    // A cancelled render must restore the exact model and save state.
    await load(); await open(); await change(); await page.locator('#cePreview').click();
    await page.evaluate(() => {
      window.ceBefore = { data, scoreIndex, dirty, fileHandle, fileName };
      const render = renderAll; let once = true; renderAll = () => { if (once) { once = false; throw new Error('Fictional render failure'); } return render(); };
    });
    await page.locator('#ceApply').click(); assert.match(await page.locator('#ceStatus').textContent(), /反映していません/);
    assert.equal(await page.evaluate(() => Object.entries(window.ceBefore).every(([key, value]) => eval(key) === value)), true);
    await page.locator('#ceClose').click();
    // Replacing the dataset while previewing prevents stale application.
    await open(); await change(); await page.locator('#cePreview').click();
    await page.evaluate(v => applyJsonText(JSON.stringify({ ...v, name: '架空の別データ' }), 'fictional-new.json', null), d);
    const replaced = await page.evaluate(() => JSON.stringify(data));
    await page.locator('#ceApply').click(); assert.match(await page.locator('#ceStatus').textContent(), /変わっています/);
    assert.equal(await page.evaluate(() => JSON.stringify(data)), replaced); await page.locator('#ceClose').click();
    await load(); await open(); await change(); await page.locator('#cePreview').click();
    await page.evaluate(() => data.tests.push({ id: 'async-domain', name: '架空の非同期追加', subject: '英語', maxScore: 10, domains: [{ key: 'async', label: '架空分野', max: 10 }] }));
    const reclassifiedElsewhere = await page.evaluate(() => JSON.stringify(data));
    await page.locator('#ceApply').click(); assert.match(await page.locator('#ceStatus').textContent(), /変わっています/);
    assert.equal(await page.evaluate(() => JSON.stringify(data)), reclassifiedElsewhere); await page.locator('#ceClose').click();
    // Changes to scores use the latest values rather than restoring preview-time values.
    await load(); await open(); await change(); await page.locator('#cePreview').click();
    await page.evaluate(() => { data.scores[0].questions.a = 1; data.scores[0].total = 6; });
    await page.locator('#ceApply').click();
    assert.equal(await page.evaluate(() => data.scores[0].domains.listen), 6);
    assert.equal(await page.evaluate(() => data.scores[0].total), 6);
    await page.locator('#inTest').selectOption('other'); await launch.click(); assert.equal(await dialog.isVisible(), false);
    await load();
    await page.evaluate(() => { data.scores[0].questions = {}; data.scores[0].domains = { listen: 3, read: 4 }; });
    const aggregateOnly = await page.evaluate(() => JSON.stringify(data));
    await page.locator('#inTest').selectOption('t'); await launch.click();
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await page.evaluate(() => JSON.stringify(data)), aggregateOnly);
    await require('./domain-identity.browser.cjs')(page);
  } finally {
    if (await dialog.evaluate(el => el.open)) await dialog.evaluate(el => el.close());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-restored.json', null), original);
  }
};
