'use strict';

const assert = require('node:assert/strict');

// Shared by the offline browser suite and targeted local HTTP diagnostics.
// All inputs derive from the explicitly fictional sample.
module.exports = async function checkHtmlSafety(page, fixture) {
  const payload = '<img src="data:," onerror="window.__htmlInjectionExecuted=true">';
  const tagged = structuredClone(fixture);
  for (const student of tagged.students) student.className += ` & "' ${payload}`;
  await page.evaluate(value => {
    window.__htmlInjectionExecuted = false;
    applyJsonText(JSON.stringify(value), 'fictional-tagged-classes.json', null);
  }, tagged);
  const gap = page.locator('#kpiGrid .kpi').filter({ has: page.locator('.kpi-label', { hasText: 'クラス間の差' }) });
  assert.equal(await gap.count(), 1);
  assert.ok((await gap.locator('small').textContent()).includes(payload));
  assert.equal(await gap.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.__htmlInjectionExecuted), false);

  // Valid baselines, including legacy missing values, still load and render.
  for (const baseline of [0, 100, 62.5, null, undefined]) {
    const value = structuredClone(fixture);
    value.interventions = [{
      id: 'fictional-iv', studentId: value.students[0].id, title: '架空の支援',
      subject: '英語', startDate: '2026-05-20', status: 'active', baseline,
    }];
    await page.evaluate(value => {
      applyJsonText(JSON.stringify(value), 'fictional-valid-baseline.json', null);
      ui.rtiSelectedIv = 'fictional-iv';
      renderRti();
    }, value);
    const row = page.locator('#rtiLogWrap tbody tr');
    assert.equal(await row.locator('td').nth(6).textContent(), baseline == null ? '—' : baseline + '%');
    if (baseline != null) assert.ok((await page.locator('#rtiEsNote').textContent()).includes(`開始時 ${baseline}%`));
  }

  // Rejection must leave data, active filename and unsaved-state unchanged.
  await page.evaluate(() => {
    data.students[0].name = '架空の未保存編集';
    markDirty();
  });
  const before = await page.evaluate(() => ({ data: JSON.stringify(data), fileName, dirty }));
  assert.equal(before.dirty, true);
  for (const baseline of [payload, '50', false, [], {}, -1, 101]) {
    const invalid = structuredClone(fixture);
    invalid.interventions = [{ id: 'invalid-iv', studentId: invalid.students[0].id, title: '架空の不正入力', subject: '英語', baseline }];
    const dialog = page.waitForEvent('dialog');
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-invalid-baseline.json', null), invalid);
    assert.match((await dialog).message(), /開始時.*0〜100/);
    assert.deepEqual(await page.evaluate(() => ({ data: JSON.stringify(data), fileName, dirty })), before);
    assert.equal(await page.locator('#rtiLogWrap img, #rtiEsNote img').count(), 0);
    assert.equal(await page.evaluate(() => window.__htmlInjectionExecuted), false);
  }
  await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-restored.json', null), fixture);
};
