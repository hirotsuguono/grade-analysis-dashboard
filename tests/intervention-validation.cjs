'use strict';

const assert = require('node:assert/strict');

module.exports = async function checkInterventionValidation(page, fixture) {
  const value = structuredClone(fixture);
  const base = {
    studentId: value.students[0].id, title: '架空の支援', subject: '英語',
    createdAt: '2026-05-01', note: '架空のメモ', baseline: 50,
  };
  value.interventions = [
    { ...base, id: 'done', status: 'done', startDate: '2026-08-01', endDate: '2026-08-10' },
    { ...base, id: 'older', status: 'active', startDate: '2026-05-20' },
    { ...base, id: 'undated', status: 'active', startDate: '' },
    { ...base, id: 'newer', status: 'active', startDate: '2026-06-20' },
  ];
  const upload = async (value, name) => {
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  };
  const rows = () => page.locator('#rtiLogWrap tbody tr').evaluateAll(els => els.map(el => el.dataset.iv));
  for (const version of [1, 2, 3]) {
    const name = `fictional-interventions-v${version}.json`;
    await upload({ ...value, version }, name);
    await page.waitForFunction(name => fileName === name, name);
    await page.locator('[data-tab="rti"]').click();
    assert.deepEqual(await rows(), ['newer', 'older', 'undated', 'done']);
    assert.equal(await page.evaluate(() => data.version), 3);
    assert.deepEqual(await page.evaluate(() => data.interventions), value.interventions);
  }

  await page.locator('#rtiLogWrap [data-iv="newer"]').first().click();
  await page.evaluate(() => {
    data.students[0].name = '架空の未保存編集';
    markDirty();
  });
  const snapshot = () => page.evaluate(() => ({ text: JSON.stringify(data), fileName, dirty, lastDiskText, selected: ui.rtiSelectedIv }));
  const before = await snapshot();
  assert.equal(before.dirty, true);
  const cases = [
    ['startDate', 42, /startDate/], ['startDate', {}, /startDate/],
    ['startDate', false, /startDate/], ['startDate', '2026-02-30', /startDate/],
    ['startDate', '2026/05/20', /startDate/], ['endDate', 43, /endDate/],
    ['createdAt', [], /createdAt/], ['status', 'pending', /状態/],
    ['status', {}, /状態/], ['note', {}, /メモ/],
  ];
  for (const [field, invalidValue, pattern] of cases) {
    const invalid = structuredClone(value);
    invalid.interventions[0][field] = invalidValue;
    if (field === 'startDate' && invalidValue === 42) {
      // Exact Issue #6 reproduction: two active records with numeric dates.
      invalid.interventions[0].status = 'active';
      invalid.interventions[1].startDate = 43;
    }
    const dialog = page.waitForEvent('dialog');
    await upload(invalid, 'fictional-invalid-intervention.json');
    assert.match((await dialog).message(), pattern);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await rows(), ['newer', 'older', 'undated', 'done']);
  }

  const downloadEvent = page.waitForEvent('download');
  await page.locator('#saveBtn').click();
  await page.locator('#saveDownloadBtn').click();
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  await page.locator('#downloadConfirmBtn').click();
  const saved = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.deepEqual(saved.interventions, value.interventions);
  await upload(saved, 'fictional-interventions-roundtrip.json');
  await page.waitForFunction(() => fileName === 'fictional-interventions-roundtrip.json');
  assert.equal(await page.evaluate(() => JSON.stringify(data)), JSON.stringify(saved));
  assert.equal(await page.evaluate(() => dirty), false);
  assert.deepEqual(await rows(), ['newer', 'older', 'undated', 'done']);

  await upload(fixture, 'fictional-interventions-restored.json');
  await page.waitForFunction(() => fileName === 'fictional-interventions-restored.json');
};
