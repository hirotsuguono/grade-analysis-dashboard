'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, original) => {
  const rates = [[50, 50], [50, 60], [50, 70], [70, 80], [0, 0]];
  const d = { version: 3, name: '架空の変化の位置',
    students: rates.map((_, i) => ({ id: 'p' + i, name: '架空生徒' + i, className: i === 4 ? '架空B組' : '架空A組', number: i + 1 })),
    tests: [
      { id: 'before', name: '架空の比較元', subject: '数学', kind: 'final', maxScore: 50, date: '2026-05-01' },
      { id: 'after', name: '架空の今回', subject: '数学', kind: 'final', maxScore: 100, date: '2026-07-01', compareTo: 'before' }
    ], scores: [], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null } };
  for (const [i, ratesForStudent] of rates.entries()) for (const [j, rate] of ratesForStudent.entries()) {
    d.scores.push({ studentId: 'p' + i, testId: d.tests[j].id, total: rate / 100 * d.tests[j].maxScore });
  }
  const result = page.locator('#trendComparisonResult');
  const stat = name => result.locator(`[data-stat="${name}"]`);
  const select = async id => { await page.locator('#trendClearBtn').click(); await page.locator(`#studentList li[data-sid="${id}"]`).click(); };
  try {
    await page.locator('[data-tab="overview"]').click();
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-position.json', null), d);
    await page.locator('[data-tab="trend"]').click();
    const saved = await page.evaluate(() => ({ data: JSON.stringify(data), dirty }));
    await select('p2');
    assert.equal(await result.locator('.individual-values > section').count(), 3);
    assert.equal(await result.locator('.individual-test-context > section').count(), 2);
    assert.equal(await stat('change').textContent(), '+20ポイント');
    assert.equal(await stat('gap').textContent(), '+10ポイント');
    assert.equal(await stat('position').textContent(), '+1SD');
    assert.match(await result.locator('.individual-metrics-scope').textContent(), /Tier 2.*3名.*本人を含む/);
    assert.match(await result.locator('.individual-reading').textContent(), /上がっています.*平均を上回って/s);
    assert.equal(await result.locator('[data-stat="p"], [data-stat="t"], [data-stat="dz"], [data-stat="ci"]').count(), 0);
    assert.equal(await page.locator('#trendComparisonHelp').evaluate(e => e.open), false);
    await page.locator('#trendComparisonHelp > summary').focus(); await page.keyboard.press('Enter');
    assert.match(await page.locator('#trendComparisonHelp').textContent(), /SDは標準偏差.*本人の得点率が下がっていても.*有意差の判定基準にはしません/s);
    await page.locator('#trendComparisonHelp > summary').click();
    await select('p0');
    assert.equal(await stat('change').textContent(), '0ポイント');
    assert.equal(await stat('gap').textContent(), '-10ポイント');
    assert.equal(await stat('position').textContent(), '-1SD');
    await select('p1');
    assert.equal(await stat('gap').textContent(), '0ポイント');
    assert.equal(await stat('position').textContent(), '0SD');
    assert.equal(await page.locator('#trendGroupReference [data-stat="group-change"]').textContent(), '+10');
    // One paired member is not a meaningful self-versus-self comparison.
    await select('p3');
    assert.equal(await stat('gap').textContent(), '—ポイント'); assert.equal(await stat('position').textContent(), '—');
    assert.match(await result.locator('.individual-metrics-note').textContent(), /本人だけ/);
    await select('p2');
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.locator('#trendComparisonCard').evaluate(e => e.scrollWidth <= e.clientWidth + 1), `position fits ${width}px`);
    }
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(data), dirty })), saved);
    // Signed relative position is different from the direction of the person's change.
    await page.evaluate(() => { [36, 42, 48].forEach((v, i) => { getScore('p' + i, 'after').total = v; }); renderTrendComparison(); });
    assert.equal(await stat('change').textContent(), '-2ポイント');
    assert.equal(await stat('gap').textContent(), '+6ポイント'); assert.equal(await stat('position').textContent(), '+1SD');
    assert.match(await result.locator('.individual-reading').textContent(), /下がっています.*平均を上回って/s);
    await page.evaluate(() => { getScore('p0', 'after').absent = true; renderTrendComparison(); });
    assert.equal(await stat('gap').textContent(), '+3ポイント'); assert.equal(await stat('position').textContent(), '—');
    assert.match(await result.locator('.individual-metrics-note').textContent(), /2名.*3名/);
    await page.evaluate(() => { getScore('p0', 'after').absent = false; [0, 1, 2].forEach(i => { getScore('p' + i, 'after').total = 60; }); renderTrendComparison(); });
    assert.equal(await stat('gap').textContent(), '0ポイント'); assert.equal(await stat('position').textContent(), '—');
    assert.match(await result.locator('.individual-metrics-note').textContent(), /ばらつきがない/);
    await page.evaluate(() => { getScore('p2', 'after').absent = true; renderTrendComparison(); });
    assert.equal(await stat('change').textContent(), '—ポイント'); assert.equal(await stat('gap').textContent(), '—ポイント');
    assert.match(await result.locator('.individual-metrics-note').textContent(), /本人の今回/);
    await page.locator('#trendClass').selectOption('架空B組');
    assert.equal(await stat('position').textContent(), '—');
    assert.match(await result.locator('.individual-metrics-note').textContent(), /本人が含まれていません/);
  } finally {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-restored.json', null), original);
  }
};
