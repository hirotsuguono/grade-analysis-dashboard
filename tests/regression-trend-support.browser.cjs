'use strict';
const assert = require('node:assert/strict');
const { download } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const d = { version: 3, name: '架空の個人支援', students: [
    { id: 'a', name: '架空同名', className: '架空A組', number: 1 }, { id: 'b', name: '架空同名', className: '架空B組', number: 1 },
    { id: 'c', name: '架空未受験', className: '架空A組', number: 2 }
  ], tests: [
    { id: 'f1', name: '架空期末1', subject: '数学', kind: 'final', maxScore: 100, date: '2026-04-01' },
    { id: 'u', name: '架空単元', subject: '数学', kind: 'unit', maxScore: 100, date: '2026-05-01' },
    { id: 'f2', name: '架空期末2', subject: '数学', kind: 'final', maxScore: 100, date: '2026-06-01' },
    { id: 'f3', name: '架空期末3', subject: '数学', kind: 'final', maxScore: 100, date: '2026-07-01' },
    { id: 's', name: '架空理科', subject: '理科', kind: 'final', maxScore: 50, date: '2026-06-01' }
  ], scores: [['f1', 40], ['u', 90], ['f2', 70], ['f3', 100], ['s', 25]].map(([testId, total]) => ({ studentId: 'a', testId, total, absent: testId === 'f3' })),
    interventions: [
      { id: 'active', studentId: 'a', title: '架空の数学支援', subject: '数学', kind: 'final', startDate: '2026-05-01', status: 'active', baseline: 40, note: '架空のメモ\n<img src=x onerror=alert(1)>' },
      { id: 'done', studentId: 'a', title: '架空の理科支援', subject: '理科', kind: 'all', startDate: '2026-05-02', endDate: '2026-06-04', status: 'done' },
      { id: 'legacy', studentId: 'a', title: '架空の旧記録', subject: 'all', startDate: '' },
      { id: 'other', studentId: 'b', title: '別IDの支援', subject: '数学', startDate: '2026-05-01', status: 'active' }
    ], metrics: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null } };
  const card = page.locator('#trendSupportCard'), records = page.locator('#trendSupportRecords');
  const select = async id => { await page.locator('#trendClearBtn').click(); await page.locator(`#studentList li[data-sid="${id}"]`).click(); };
  const rtiFilters = () => page.evaluate(() => [ui.rtiSubject, ui.rtiKind, ui.rtiClass, ui.rtiBasis]);
  try {
    await page.locator('[data-tab="overview"]').click();
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-support.json', null), d);
    await page.locator('#ovSubject').selectOption('数学'); await page.locator('#ovTest').selectOption('f2');
    await page.locator('[data-tab="rti"]').click();
    await page.locator('#rtiSubject').selectOption('理科'); await page.locator('#rtiKind').selectOption('unit');
    await page.locator('#rtiClass').selectOption('架空B組'); await page.locator('#rtiBasis').selectOption('avg');
    const filters = await rtiFilters();
    await page.locator('[data-tab="trend"]').click();
    assert.equal(await page.locator('#trendAddSupport').isDisabled(), true);
    await select('a');
    await page.locator('#trendKind').selectOption('final');
    const saved = await page.evaluate(() => ({ data: JSON.stringify(data), dirty }));
    const pair = await page.evaluate(() => [ui.trendCompareTest, ui.trendCompareFrom]);
    assert.match(await card.textContent(), /実施中 1件・完了 2件/);
    assert.match(await page.locator('#trendSupportSummary').textContent(), /架空同名.*架空A組.*1番/);
    assert.equal(await records.locator('article').count(), 3);
    assert.equal(await records.locator('[data-iv="other"]').count(), 0);
    assert.equal(await records.locator('img, script').count(), 0);
    assert.match(await records.textContent(), /<img src=x/);
    assert.equal(await records.locator('details').evaluate(e => e.open), false);
    await records.locator('details > summary').focus(); await page.keyboard.press('Enter');
    assert.equal(await records.locator('article[data-iv="done"]').isVisible(), true);
    assert.equal(await records.locator('article[data-iv="legacy"]').isVisible(), true);
    // A shared form captures the current panel's scope, independent of RTI's filters.
    await page.locator('#trendAddSupport').click();
    assert.equal(await page.locator('#ivSubject').inputValue(), '数学'); assert.equal(await page.locator('#ivKind').inputValue(), 'final');
    assert.match(await page.locator('#ivStudentSummary').textContent(), /架空A組・1番/);
    assert.match(await page.locator('#ivStudentSummary').textContent(), /70%/);
    await page.locator('#ivKind').selectOption('unit'); assert.match(await page.locator('#ivStudentSummary').textContent(), /90%/);
    await page.locator('#ivSubject').selectOption('理科'); assert.match(await page.locator('#ivStudentSummary').textContent(), /データなし/);
    await page.locator('#ivKind').selectOption('final'); assert.match(await page.locator('#ivStudentSummary').textContent(), /50%/);
    await page.locator('#ivCancel').click();
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(data), dirty })), saved);
    assert.deepEqual(await rtiFilters(), filters);
    await page.locator('#trendAddSupport').click(); await page.locator('#ivTitle').fill('  ');
    await page.locator('#ivForm button[type="submit"]').click();
    assert.equal(await page.locator('#ivDialog').isVisible(), true);
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(data), dirty })), saved);
    await page.locator('#ivTitle').fill('架空の新しい支援'); await page.locator('#ivNote').fill('架空の声かけを続ける');
    await page.locator('#ivStart').fill('2026-05-01'); await page.locator('#ivForm button[type="submit"]').click();
    const created = await page.evaluate(() => data.interventions.find(iv => iv.title === '架空の新しい支援'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trendAddSupport');
    assert.equal(created.studentId, 'a'); assert.equal(created.subject, '数学'); assert.equal(created.kind, 'final'); assert.equal(created.baseline, 70);
    assert.equal(await page.evaluate(() => dirty), true);
    assert.deepEqual(await rtiFilters(), filters);
    assert.deepEqual(await page.evaluate(() => [ui.trendCompareTest, ui.trendCompareFrom]), pair);
    assert.deepEqual(await page.evaluate(() => [...ui.trendSelected]), ['a']);
    assert.match(await card.textContent(), /実施中 2件/);
    // One shared record, completed from the personal panel and reopened from RTI.
    await records.locator(`[data-iv="${created.id}"] .iv-done-btn`).click();
    assert.equal(await page.evaluate(id => data.interventions.find(iv => iv.id === id).status, created.id), 'done');
    await page.locator('[data-tab="rti"]').click();
    const row = page.locator(`#rtiLogWrap .iv-row[data-iv="${created.id}"]`);
    assert.match(await row.textContent(), /架空の新しい支援.*架空の声かけ/s);
    await row.locator('.iv-reopen-btn').click();
    await page.locator('[data-tab="trend"]').click();
    assert.equal(await records.locator(`[data-iv="${created.id}"] .iv-done-btn`).isVisible(), true);
    assert.equal(await page.evaluate(id => Object.hasOwn(data.interventions.find(iv => iv.id === id), 'endDate'), created.id), false);
    assert.equal(await page.evaluate(id => data.interventions.find(iv => iv.id === id).baseline, created.id), 70);
    await records.locator(`[data-iv="${created.id}"] .iv-progress-btn`).click();
    assert.equal(await page.locator('#panel-rti').isVisible(), true);
    assert.equal(await page.evaluate(() => ui.rtiSelectedIv), created.id);
    assert.deepEqual(await rtiFilters(), filters);
    assert.match(await page.locator('#rtiProgressTitle').textContent(), /架空の新しい支援/);
    await page.locator('[data-tab="trend"]').click();
    // Record history is visible across subjects/kinds and student selection is ID-based.
    await page.locator('#trendSubject').selectOption('理科'); await page.locator('#trendKind').selectOption('unit');
    assert.equal(await records.locator('article').count(), 4);
    await select('b'); assert.equal(await records.locator('article').count(), 1); assert.match(await records.textContent(), /別IDの支援/);
    await select('a'); await page.locator('#studentList li[data-sid="b"]').click();
    assert.equal(await page.locator('#trendAddSupport').isDisabled(), true); assert.equal(await page.locator('#trendSupportBody').isVisible(), false);
    await select('c'); await page.locator('#trendSubject').selectOption('__sum__');
    await page.locator('#trendAddSupport').click(); assert.equal(await page.locator('#ivSubject').inputValue(), 'all');
    assert.match(await page.locator('#ivStudentSummary').textContent(), /データなし/);
    await page.locator('#ivTitle').fill('架空の未受験支援'); await page.locator('#ivForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => data.interventions.find(iv => iv.studentId === 'c').baseline), null);
    // Saving and reopening preserves both panels' records and existing scores.
    const savedData = await download(page);
    assert.deepEqual(savedData.scores, d.scores);
    assert.equal(new Set(savedData.interventions.map(iv => iv.id)).size, savedData.interventions.length);
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-support-reopened.json', null), savedData);
    await select('a'); assert.equal(await records.locator('article').count(), 4);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await card.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `support fits ${width}px`);
    }
    await page.evaluate(() => { data.students.push({ id: 'same-class', name: '架空同名', className: '架空A組', number: 9 }); renderTrend(); });
    await select('same-class');
    assert.match(await page.locator('#trendSupportSummary').textContent(), /架空A組.*9番/);
    await page.locator('#trendAddSupport').click();
    assert.match(await page.locator('#ivStudentSummary').textContent(), /架空A組・9番/);
    await page.locator('#ivCancel').click(); await select('a');
    // RTI-created records use the same model; avg display still records the explicit latest baseline.
    await page.locator('[data-tab="rti"]').click();
    await page.locator('#rtiSubject').selectOption('数学'); await page.locator('#rtiKind').selectOption('final');
    await page.locator('#rtiClass').selectOption('all'); await page.locator('#rtiBasis').selectOption('avg');
    await page.locator('.rti-card[data-sid="a"]').click();
    assert.match(await page.locator('#ivStudentSummary').textContent(), /70%/);
    await page.locator('#ivTitle').fill('架空のRTIからの追加');
    // Force the ID timestamp to collide without changing the host clock or leaving a patched Date behind.
    await page.evaluate(id => {
      const originalNow = Date.now;
      Date.now = () => Number(id.slice(2));
      try { document.getElementById('ivForm').requestSubmit(); } finally { Date.now = originalNow; }
    }, created.id);
    const rtiAdded = await page.evaluate(() => data.interventions.find(iv => iv.title === '架空のRTIからの追加'));
    assert.equal(rtiAdded.baseline, 70); assert.equal(rtiAdded.kind, 'final'); assert.notEqual(rtiAdded.id, created.id);
    await page.locator('[data-tab="trend"]').click();
    assert.equal(await records.locator('article').count(), 5);
    assert.equal(await records.locator(`article[data-iv="${rtiAdded.id}"]`).isVisible(), true);
    // A dialog from the previous dataset cannot append to a newly opened file, even for reused IDs.
    await page.locator('#trendAddSupport').click(); await page.locator('#ivTitle').fill('古い画面の架空入力');
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-different-file.json', null), d);
    await page.locator('#ivForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => data.interventions.length), d.interventions.length);
    assert.equal(await page.locator('#ivDialog').isVisible(), false);
  } finally {
    await page.evaluate(() => document.getElementById('ivDialog').close());
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-restored.json', null), original);
  }
};
