'use strict';
const assert = require('node:assert/strict');
module.exports = async (page, original) => {
  const d = JSON.parse(JSON.stringify(original));
  const before = d.tests[8], after = d.tests[9], sid = d.students[0].id;
  after.compareTo = before.id;
  d.settings.rti = { tier2: 60, tier3: 40 };
  const reference = page.locator('#trendGroupReference');
  const refStat = key => reference.locator(`[data-stat="group-${key}"]`);
  const overviewStat = key => page.locator(`.group-summary-card[data-group="tier1"] [data-stat="${key}"]`);
  const selectStudent = async id => {
    await page.locator('#trendClearBtn').click();
    await page.locator(`#studentList li[data-sid="${id}"]`).click();
  };
  try {
    await page.locator('[data-tab="overview"]').click();
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-reference.json', null), d);
    const saved = await page.evaluate(() => ({ data: JSON.stringify(data), dirty }));
    await page.locator('[data-tab="overview"]').click();
    await page.locator('#ovSubject').selectOption(after.subject);
    await page.locator('#ovTest').selectOption(after.id);
    const expected = {};
    for (const key of ['change', 'p', 'dz']) expected[key] = await overviewStat(key).textContent();
    assert.equal(expected.change, '+5.25');
    assert.equal(expected.p, '<0.001');
    assert.equal(expected.dz, '+0.78');
    await page.locator('[data-tab="trend"]').click();
    await selectStudent(sid);
    assert.equal(await page.locator('#trendCompareTest').inputValue(), after.id);
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), before.id);
    assert.equal(await page.locator('#trendSubject').inputValue(), after.subject);
    assert.equal(await page.locator('#trendClass').inputValue(), 'all');
    assert.match(await reference.textContent(), /本人の検定結果ではありません/);
    assert.match(await reference.locator('.individual-reference-scope').textContent(), /全クラス.*Tier 1.*両方受験 28名/);
    for (const key of ['change', 'p', 'dz']) assert.equal(await refStat(key).textContent(), expected[key]);
    assert.equal(await page.locator('#trendComparisonResult [data-stat="change"]').textContent(), '+19ポイント');
    assert.equal(await reference.locator('details').evaluate(e => e.open), false);
    await reference.locator('summary').focus(); await page.keyboard.press('Enter');
    assert.match(await reference.locator('details').textContent(), /0\.05未満.*0\.001より小さい.*調整は計算済み/s);
    await reference.locator('summary').click();
    // The reference follows the exact local pair without changing overview or saved records.
    await page.locator('#trendCompareFrom').selectOption(d.tests[7].id);
    assert.match(await reference.locator('.individual-reference-tests').textContent(), new RegExp(d.tests[7].name));
    assert.equal(await page.evaluate(() => data.tests.find(t => t.id === ui.ovTest).compareTo), before.id);
    await page.locator('#trendKind').selectOption('final'); // hides this unclassified test locally
    await page.locator('#trendUseOverview').click();
    assert.equal(await page.locator('#trendKind').inputValue(), 'all');
    assert.equal(await page.locator('#trendCompareTest').inputValue(), after.id);
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), before.id);
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(data), dirty })), saved);
    // Settings saved while this panel is visible must refresh the baseline Tier and reference immediately.
    await page.locator('#roleBtn').click(); await page.locator('#adminPinInput').fill('2468'); await page.locator('#adminSubmit').click();
    await page.waitForFunction(() => isAdmin);
    const settings = async tier2 => {
      await page.locator('#settingsBtn').click(); await page.locator('#setTier3').fill('40'); await page.locator('#setTier2').fill(tier2);
      await page.locator('#settingsForm button[type="submit"]').click();
    };
    await settings('70');
    assert.match(await reference.locator('.individual-reference-scope').textContent(), /Tier 2.*40%以上70%未満/);
    assert.equal(await page.locator('#trendCompareFrom').inputValue(), before.id);
    await settings('60');
    for (const key of ['change', 'p', 'dz']) assert.equal(await refStat(key).textContent(), expected[key]);
    // A changed class scope cannot be presented as this student's own group.
    const otherClass = d.students.find(s => s.className !== d.students[0].className).className;
    await page.locator('#trendClass').selectOption(otherClass);
    assert.match(await reference.textContent(), /本人が含まれていません/);
    assert.equal(await refStat('p').count(), 0);
    await page.locator('#trendClass').selectOption('all');
    // Baseline determines group membership even if the current score is missing.
    await page.evaluate(({ sid, id }) => { getScore(sid, id).absent = true; renderTrendComparison(); }, { sid, id: after.id });
    assert.match(await reference.textContent(), /比較人数には含まれていません/);
    assert.match(await reference.locator('.individual-reference-scope').textContent(), /Tier 1.*両方受験 27名/);
    assert.equal(await refStat('p').count(), 1);
    await page.evaluate(({ sid, id }) => { getScore(sid, id).absent = true; renderTrendComparison(); }, { sid, id: before.id });
    assert.match(await reference.textContent(), /所属グループを決められません/);
    assert.equal(await refStat('p').count(), 0);
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-reference-reopened.json', null), d);
    await selectStudent(sid);
    await page.locator('#trendUseOverview').click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await reference.evaluate(e => e.scrollWidth <= e.clientWidth + 1), `reference fits ${width}px`);
      assert.ok(await page.locator('#trendComparisonCard').evaluate(e => e.scrollWidth <= e.clientWidth + 1));
    }
    // A one-person class keeps the descriptive change and withholds inference.
    await page.evaluate(sid => { data.students = data.students.filter(s => s.id === sid); renderTrend(); }, sid);
    assert.match(await reference.textContent(), /両方受験 1名.*比較が1名/s);
    assert.equal(await refStat('p').textContent(), '—');
    assert.equal(await refStat('dz').textContent(), '—');
    // No pair is not a zero change.
    await page.evaluate(({ sid, id }) => { getScore(sid, id).absent = true; renderTrendComparison(); }, { sid, id: after.id });
    assert.match(await reference.textContent(), /両方受験 0名/);
    assert.equal(await refStat('change').textContent(), '—');
    // Equal changes across multiple people cannot produce a t-test or dz.
    await page.evaluate(({ sid, beforeId, afterId }) => {
      const student = data.students[0];
      data.students.push({ ...student, id: 'fictional-clone', name: '架空の同じ変化', number: 99 });
      for (const id of [beforeId, afterId]) {
        const rec = getScore(sid, id); rec.absent = false;
        data.scores.push({ ...rec, studentId: 'fictional-clone' });
      }
      rebuildIndex(); renderTrend();
    }, { sid, beforeId: before.id, afterId: after.id });
    assert.match(await reference.textContent(), /両方受験 2名.*全員の変化量が同じ/s);
    assert.equal(await refStat('change').textContent(), '+19');
    assert.equal(await refStat('p').textContent(), '—');
    assert.equal(await refStat('dz').textContent(), '—');
  } finally {
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-restored.json', null), original);
  }
};
