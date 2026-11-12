'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, original) => {
  const d = { version: 3, name: '架空の分類確認', students: Array.from({ length: 4 }, (_, i) => ({ id: 's' + i, name: '架空生徒' + i, className: i === 1 ? '2年B組' : '2年A組', number: i + 1 })),
    tests: [{ id: 'test', name: '架空分類テスト', subject: '英語', maxScore: 12, domains: [{ key: 'listen', label: 'リスニング', max: 5 }, { key: 'read', label: '読解', max: 5 }], questions: [
      { key: 'a', label: '大問1-(1)', max: 2, domain: 'listen', perspective: 'knowledge' },
      { key: 'b', label: '大問1-(2)', max: 3, domain: 'listen', perspective: 'thinking' },
      { key: 'c', label: '大問2・知識技能分', max: 5, domain: 'read', perspective: 'knowledge' },
      { key: 'd', label: '分類前の内訳', max: 2 },
    ] }], scores: [{ studentId: 's0', testId: 'test', questions: { a: 2, b: 1, c: 3, d: 0 } }, { studentId: 's1', testId: 'test', questions: { a: 0, b: 0, c: 0, d: 0 } }, { studentId: 's2', testId: 'test', absent: true, questions: { a: 2, b: 3, c: 5, d: 2 } }, { studentId: 's3', testId: 'test', questions: { a: 1, b: 3 } }], metrics: [], interventions: [], settings: { adminPinHash: null, rti: { tier2: 60, tier3: 40 } } };
  try {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-classifications.json', null), d);
    await page.locator('[data-tab="analysis"]').click();
    const saved = await page.evaluate(() => JSON.stringify(data));
    await page.locator('#anClassificationAxis').selectOption('perspective');
    assert.match(await page.locator('#anClassificationTitle').textContent(), /評価の観点別/);
    assert.match(await page.locator('#anClassificationSummary').textContent(), /未設定 1項目・2点分/);
    const rows = await page.locator('#anClassificationTable tbody tr').allTextContents();
    assert.equal(rows.length, 2); assert.match(rows[0], /知識・技能.*7点.*2名.*35.7%/); assert.match(rows[1], /思考・判断・表現.*3点.*3名.*44.4%/);
    await page.locator('#anClass').selectOption('2年B組');
    assert.match(await page.locator('#anClassificationTable').textContent(), /0%/);
    await page.locator('#anClass').selectOption('all');
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.equal(await page.evaluate(() => JSON.stringify(data)), saved);
    await page.evaluate(() => { data.tests[0].questions[0].perspective = { formula: '1+1' }; });
    assert.match(await page.evaluate(() => validateDataset(data).join('\n')), /評価の観点/);
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-classifications.json', null), d);
    await page.locator('[data-tab="input"]').click(); await page.locator('#addTestBtn').click();
    await page.locator('#tfName').fill('架空の手入力'); await page.locator('#tfSubject').fill('英語');
    await page.locator('#tfMax').fill('2');
    await page.evaluate(() => { addDomainRow('架空分野', 2); addQuestionRow('架空小問', 2); });
    await page.locator('#tfQuestions .bq-domain').selectOption('架空分野');
    await page.locator('#tfQuestions .bq-perspective').selectOption('thinking');
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('#testDialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), String(width) + 'px test dialog');
    }
    await page.evaluate(() => document.getElementById('testForm').requestSubmit());
    assert.equal(await page.evaluate(() => data.tests.at(-1).questions[0].perspective), 'thinking');
    assert.equal(await page.evaluate(() => data.tests.at(-1).questions[0].domain), '架空分野');
    const serialized = await page.evaluate(() => JSON.stringify(data));
    await page.evaluate(value => applyJsonText(value, 'fictional-saved.json', null), serialized);
    assert.equal(await page.evaluate(() => data.tests.at(-1).questions[0].perspective), 'thinking');
  } finally {
    if (await page.locator('#testDialog').evaluate(el => el.open)) await page.locator('#testDialog').evaluate(el => el.close());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-restored.json', null), original);
  }
};
