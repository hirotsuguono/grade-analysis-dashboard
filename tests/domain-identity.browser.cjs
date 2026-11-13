'use strict';
const assert = require('node:assert/strict');
module.exports = async page => {
  const d = { version: 3, name: '架空の分野識別', students: [{ id: 's', name: '架空生徒', number: 1, className: '2年A組' }],
    tests: [{ id: 'before', name: '架空の1回目', subject: '英語', date: '2026-05-01', maxScore: 100, questions: [{ key: 'q1', label: '架空問題', max: 100 }] }, { id: 'after', name: '架空の2回目', subject: '英語', date: '2026-06-01', maxScore: 100, questions: [{ key: 'q1', label: '架空問題', max: 100 }] }],
    scores: [{ studentId: 's', testId: 'before', total: 100, questions: { q1: 100 } }, { studentId: 's', testId: 'after', total: 0, questions: { q1: 0 } }], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null } };
  await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-domain-identities.json', null), d);
  await page.locator('[data-tab="input"]').click();
  for (const [id, label] of [['before', 'リスニング'], ['after', '読解']]) {
    await page.locator('#inTest').selectOption(id); await page.locator('#editClassificationBtn').click();
    await page.locator('#ceAddDomain').click(); await page.locator('#ceDomains input').last().fill(label);
    const key = await page.locator('#ceDomains > div').last().getAttribute('data-key');
    await page.locator('#ceQuestions .ce-domain').selectOption(key);
    await page.locator('#cePreview').click(); await page.locator('#ceApply').click();
  }
  const identities = await page.evaluate(() => data.tests.map(t => t.domains[0].key));
  assert.notEqual(identities[0], identities[1]);
  const separated = await page.evaluate(() => {
    ui.trendSubject = '英語'; ui.trendSelected = new Set(['s']); renderTrend();
    return echarts.getInstanceByDom(document.getElementById('trendDomainChart')).getOption().series.map(s => ({ name: s.name, data: s.data }));
  });
  assert.deepEqual(separated, [{ name: 'リスニング', data: [100, null] }, { name: '読解', data: [null, 0] }]);
  await page.locator('#inTest').selectOption('after'); await page.locator('#editClassificationBtn').click();
  await page.locator('#ceDomains input').first().fill('文章理解');
  await page.locator('#cePreview').click(); await page.locator('#ceApply').click();
  assert.equal(await page.evaluate(() => data.tests[1].domains[0].key), identities[1]);
  await page.locator('#addTestBtn').click(); await page.locator('#tfSubject').fill('英語'); await page.locator('#tfCopyPrev').click();
  assert.equal(await page.locator('#tfDomains .builder-row').first().getAttribute('data-domain-key'), identities[1]);
  assert.equal(await page.locator('#tfDomains input.bd-label').first().inputValue(), '文章理解');
  assert.equal(await page.locator('#tfQuestions .bq-domain').first().inputValue(), identities[1]);
  await page.locator('#tfName').fill('架空の構成コピー'); await page.locator('#tfDate').fill('2026-07-01');
  await page.evaluate(() => document.getElementById('testForm').requestSubmit());
  assert.equal(await page.evaluate(() => data.tests.at(-1).domains[0].key), identities[1]);
  assert.equal(await page.evaluate(() => data.tests.at(-1).questions[0].domain), identities[1]);
  // A fresh manually entered name and an actual XLSX use the same renamed classification.
  await page.locator('#addTestBtn').click(); await page.locator('#tfName').fill('架空の手入力'); await page.locator('#tfSubject').fill('英語');
  await page.evaluate(() => { addDomainRow('文章理解', 100); addQuestionRow('架空内訳', 100); });
  await page.locator('#tfQuestions .bq-domain').selectOption(identities[1]);
  await page.evaluate(() => document.getElementById('testForm').requestSubmit());
  assert.equal(await page.evaluate(() => data.tests.at(-1).domains[0].key), identities[1]);
  const imported = await page.evaluate(async () => {
    const wb = GD_EXCEL.testTemplate(XLSX, data.students);
    const set = (sheet, cell, value) => XLSX.utils.sheet_add_aoa(wb.Sheets[sheet], [[value]], { origin: cell });
    for (const [cell, value] of Object.entries({ B8: '英語', B10: '架空のExcel後続', B14: '2026-08-01' })) set('① テスト設定', cell, value);
    for (const col of ['G', 'H', 'I']) for (const row of [7, 8, 9, 10]) set('② 点数入力', col + row, '');
    for (const [cell, value] of Object.entries({ F7: '文章理解', F8: '知識・技能', F9: 100, F10: '架空小問', F11: 25 })) set('② 点数入力', cell, value);
    const bytes = await GD_EXCEL.writeBuffer(wb);
    await importTestTemplate(new File([bytes], 'fictional-domain-continuity.xlsx'));
    window.identityWorkbook = wb;
    return data.tests.at(-1);
  });
  assert.equal(imported.domains[0].key, identities[1]); assert.equal(imported.questions[0].domain, identities[1]);
  // Another classification with the same label cannot be guessed when creating a test.
  await page.evaluate(() => data.tests.push({ id: 'ambiguous', name: '架空の同名別分野', subject: '英語', maxScore: 100, domains: [{ key: 'different', label: '文章理解', max: 100 }], questions: [{ key: 'q1', label: '架空問題', max: 100, domain: 'different' }] }));
  const before = await page.evaluate(() => JSON.stringify(data));
  await page.locator('#addTestBtn').click(); await page.locator('#tfName').fill('拒否される架空テスト'); await page.locator('#tfSubject').fill('英語');
  await page.evaluate(() => { addDomainRow('文章理解', 100); addQuestionRow('架空内訳', 100); document.getElementById('testForm').requestSubmit(); });
  assert.equal(await page.locator('#testDialog').isVisible(), true); assert.equal(await page.evaluate(() => JSON.stringify(data)), before);
  await page.locator('#testDialog').evaluate(el => el.close());
  await page.evaluate(async () => { await importTestTemplate(new File([await GD_EXCEL.writeBuffer(window.identityWorkbook)], 'fictional-domain-ambiguous.xlsx')); });
  assert.equal(await page.evaluate(() => JSON.stringify(data)), before);
};
