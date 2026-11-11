'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, original) => {
  const d = { version: 3, name: '架空の個人比較', students: [
    { id: 'one', name: '架空同名', number: 1, className: '2年A組' },
    { id: 'two', name: '架空同名', number: 2, className: '2年A組' },
    { id: 'absent', name: '架空欠席', number: 3, className: '2年A組' },
    { id: 'blank', name: '架空未入力', number: 4, className: '2年A組' }
  ], tests: [
    { id: 'before', name: '架空の比較元', gradeYear: 2, subject: '数学', kind: 'final', maxScore: 50, date: '2026-05-01' },
    { id: 'unit', name: '架空の単元', gradeYear: 2, subject: '数学', kind: 'unit', maxScore: 10, date: '2026-06-01' },
    { id: 'after', name: '架空の今回', gradeYear: 2, subject: '数学', kind: 'final', maxScore: 100, date: '2026-07-01' },
    { id: 'other', name: '架空の別教科', subject: '理科', kind: 'final', maxScore: 100, date: '2026-08-01' }
  ], scores: [], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null } };
  for (const [studentId, b, a] of [['one', 37, 82], ['two', 0, 0], ['absent', 45, 50], ['blank', null, 30]]) {
    d.scores.push({ studentId, testId: 'before', total: b, absent: studentId === 'absent' }, { studentId, testId: 'after', total: a });
  }
  const card = page.locator('#trendComparisonCard');
  const rate = position => card.locator(`[data-position="${position}"] [data-stat="rate"]`);
  const change = card.locator('[data-stat="change"]');
  const selectStudent = async id => { await page.locator('#trendClearBtn').click(); await page.locator(`#studentList li[data-sid="${id}"]`).click(); };
  try {
    await page.locator('[data-tab="overview"]').click();
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-individual.json', null), d);
    const saved = await page.evaluate(() => JSON.stringify(data));
    await page.locator('[data-tab="overview"]').click();
    await page.locator('#ovSubject').selectOption('数学');
    await page.locator('#ovTest').selectOption('after');
    await page.locator('[data-tab="trend"]').click();
    assert.match(await card.textContent(), /生徒を1人選んで/);
    assert.equal(await page.locator('#trendComparisonControls').isVisible(), false);
    await selectStudent('one');
    assert.equal(await page.locator('#trendCompareTest').inputValue(), 'after');
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), 'before');
    await page.locator('#trendCompareFrom').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'trendCompareTest');
    assert.equal(await rate('before').textContent(), '74%');
    assert.equal(await rate('after').textContent(), '82%');
    assert.equal(await change.textContent(), '+8ポイント');
    assert.match(await card.locator('[data-position="before"]').textContent(), /架空の比較元.*2026-05-01.*37 \/ 50点/s);
    assert.match(await card.locator('[data-position="after"]').textContent(), /架空の今回.*2026-07-01.*82 \/ 100点/s);
    assert.match(await card.locator('.individual-reading').textContent(), /本人の得点率が上がって/);
    assert.equal(await page.locator('#trendComparisonHelp').evaluate(e => e.open), false);
    assert.equal(await card.locator('[data-stat="p"], [data-stat="dz"], [data-stat="ci"]').count(), 0);
    await page.locator('#trendComparisonHelp > summary').focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('#trendComparisonHelp').textContent(), /1人の前後1組だけではt検定はできない/);
    await page.locator('#trendComparisonHelp > summary').click();
    // Same-name students are identified by ID, not by name. Zero is a real score.
    await selectStudent('two');
    assert.equal(await rate('before').textContent(), '0%'); assert.equal(await change.textContent(), '0ポイント');
    assert.match(await card.locator('.individual-reading').textContent(), /同じです/);
    await selectStudent('absent');
    assert.equal(await rate('before').textContent(), '—'); assert.equal(await rate('after').textContent(), '50%');
    assert.equal(await change.textContent(), '—ポイント'); assert.match(await card.locator('.individual-reading').textContent(), /比較元は欠席/);
    await selectStudent('blank'); assert.match(await card.locator('.individual-reading').textContent(), /未入力・入力途中/);
    // Local pair changes never overwrite the global comparison configuration.
    await selectStudent('one');
    await page.locator('#trendCompareFrom').selectOption('unit');
    assert.match(await card.locator('.individual-type-note').textContent(), /種類・シリーズが異なります/);
    assert.equal(await rate('before').textContent(), '—');
    await page.locator('#trendCompareTest').selectOption('before');
    assert.equal(await page.locator('#trendCompareFrom option').count(), 1);
    assert.match(await page.locator('#trendComparisonResult').textContent(), /過去のテストがない/);
    await page.locator('#trendCompareTest').selectOption('unit');
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), ''); // unit has no automatic comparison
    await page.locator('#trendCompareFrom').selectOption('before');
    assert.match(await card.textContent(), /架空の単元/);
    await page.locator('#trendKind').selectOption('final');
    assert.deepEqual(await page.locator('#trendCompareTest option').evaluateAll(es => es.map(e => e.value)), ['before', 'after']);
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), 'before');
    await page.locator('#trendSubject').selectOption('理科');
    assert.equal(await page.locator('#trendCompareTest').inputValue(), 'other');
    assert.match(await page.locator('#trendComparisonResult').textContent(), /過去のテストがない/);
    await page.locator('#trendSubject').selectOption('__sum__');
    assert.equal(await page.locator('#trendComparisonControls').isVisible(), false);
    assert.match(await page.locator('#trendComparisonResult').textContent(), /教科を選ぶと表示/);
    await page.locator('#trendSubject').selectOption('数学');
    await page.locator('#studentList li[data-sid="two"]').click();
    assert.match(await card.textContent(), /選択を1人に/); assert.equal(await page.locator('#trendComparisonControls').isVisible(), false);
    await selectStudent('one');
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await card.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `card should fit ${width}px`);
    }
    assert.equal(await page.evaluate(() => JSON.stringify(data)), saved);
    // Reopening JSON resets temporary pairs and does not keep stale student/test choices.
    await page.locator('#trendCompareFrom').selectOption('unit');
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-reopened.json', null), d);
    await page.locator('#trendSubject').selectOption('数学');
    await selectStudent('one');
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), 'before');
    // Explicit overview choices are respected, including an intentional lack of comparison.
    await page.evaluate(() => { ui.ovTest = 'after'; ui.ovSubject = '数学'; data.tests.find(t => t.id === 'after').compareTo = null; ui.trendCompareFrom = null; renderTrend(); });
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), '');
    assert.equal(await change.count(), 0);
    await page.evaluate(() => { data.tests.find(t => t.id === 'after').compareTo = 'unit'; renderTrend(); });
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), ''); // keep the local pair until explicitly synced
    await page.locator('#trendUseOverview').click();
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), 'unit');
    assert.match(await card.textContent(), /種類・シリーズが異なります/);
    await page.locator('#trendCompareFrom').selectOption('before');
    // Compute the change from unrounded rates. Negative changes must keep their sign.
    await page.evaluate(() => {
      data.tests.find(t => t.id === 'before').maxScore = 3;
      data.tests.find(t => t.id === 'after').maxScore = 6;
      data.scores.find(r => r.studentId === 'one' && r.testId === 'before').total = 1;
      data.scores.find(r => r.studentId === 'one' && r.testId === 'after').total = 1;
      renderTrend();
    });
    assert.equal(await rate('before').textContent(), '33.33%');
    assert.equal(await rate('after').textContent(), '16.67%');
    assert.equal(await change.textContent(), '-16.67ポイント');
    assert.match(await card.locator('.individual-reading').textContent(), /下がって/);
    // A partial question entry must not display a legacy cached partial total.
    await page.evaluate(() => {
      data.tests.find(t => t.id === 'before').questions = [{ key: 'q1', max: 1 }, { key: 'q2', max: 2 }];
      data.scores.find(r => r.studentId === 'one' && r.testId === 'before').questions = { q1: 1 };
      renderTrend();
    });
    assert.equal(await rate('before').textContent(), '—');
    assert.equal(await change.textContent(), '—ポイント');
    await page.locator('#trendKind').selectOption('proficiency');
    assert.match(await page.locator('#trendComparisonResult').textContent(), /テストがありません/);
    assert.equal(await page.locator('#trendComparisonControls').isVisible(), false);
    await page.locator('#trendKind').selectOption('final');
    // All user-provided names and labels remain text in controls and result markup.
    await page.evaluate(() => { data.tests.find(t => t.id === 'before').name = '架空<img src=x onerror=alert(1)>'; data.students[0].name = '架空<script>bad()</script>'; renderTrend(); });
    assert.equal(await card.locator('img, script').count(), 0);
    assert.match(await card.textContent(), /架空<img/);
  } finally {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-restored.json', null), original);
  }
};
