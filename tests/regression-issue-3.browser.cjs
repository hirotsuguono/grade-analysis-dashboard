'use strict';
const assert = require('node:assert/strict');
const retainedAbsenceDataset = require('./issue-3-fixtures.cjs');

module.exports = async function absenceStatisticsRegression(page, fixture) {
  const dataset = {
    version: 3, name: '架空の欠席集計テスト',
    students: [
      { id: 'absence-a', name: '架空生徒A', className: '架空組', number: 1 },
      { id: 'absence-b', name: '架空生徒B', className: '架空組', number: 2 },
    ],
    tests: [{
      id: 'absence-test', name: '架空中間', subject: '英語', date: '2026-05-20', gradeYear: 1, maxScore: 100,
      domains: [{ key: 'd1', label: '架空分野', max: 100 }],
      questions: [{ key: 'q1', label: '架空設問', domain: 'd1', max: 100 }],
    }],
    scores: [
      { studentId: 'absence-a', testId: 'absence-test', total: 100, domains: { d1: 100 }, questions: { q1: 100 } },
      { studentId: 'absence-b', testId: 'absence-test', total: 0, domains: { d1: 0 }, questions: { q1: 0 } },
    ], metrics: [], interventions: [],
  };
  const analysisRates = async () => {
    await page.locator('[data-tab="analysis"]').click();
    return page.evaluate(() => ['anDomainChart', 'anQuestionChart'].map(id =>
      echarts.getInstanceByDom(document.getElementById(id)).getOption().series[0].data[0].value
    ));
  };
  try {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-absence.json', null), dataset);
    assert.deepEqual(await analysisRates(), [50, 50]);
    await page.locator('[data-tab="input"]').click();
    await page.locator('tr[data-sid="absence-a"] .absent-check').check();
    assert.deepEqual(await analysisRates(), [0, 0]);
    assert.deepEqual(await page.evaluate(() => {
      const r = getScore('absence-a', 'absence-test');
      return { total: r.total, absent: r.absent, question: r.questions.q1, domain: r.domains.d1 };
    }), { total: null, absent: true, question: 100, domain: 100 });
    await page.locator('[data-tab="input"]').click();
    await page.locator('tr[data-sid="absence-a"] .absent-check').uncheck();
    assert.equal(await page.locator('tr[data-sid="absence-a"] .cell-input').inputValue(), '100');
    assert.deepEqual(await analysisRates(), [50, 50]);
    await retainedJsonRoundtrip(page);
  } finally {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'synthetic-test.json', null), fixture);
  }
};

async function retainedJsonRoundtrip(page) {
  const retained = retainedAbsenceDataset();
  const excluded = [[null], [0], [120], [60]];
  const restored = [[160], [0], [120], [93.3]];
  const upload = async (value, name) => {
    await page.locator('#fileInput').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await page.waitForFunction(name => fileName === name, name);
  };
  const combined = async () => {
    await page.locator('[data-tab="trend"]').click();
    await page.locator('#trendSubject').selectOption({ label: '全教科合計' });
    for (const student of retained.students) {
      const item = page.locator(`#studentList li[data-sid="${student.id}"]`);
      if (!await item.locator('input').isChecked()) await item.click();
    }
    return page.evaluate(() => echarts.getInstanceByDom(document.getElementById('trendChart')).getOption().series.map(series => series.data));
  };
  const saveAndReopen = async (name, expectedTotals, expectedQuestions = [100, 60]) => {
    const event = page.waitForEvent('download');
    await page.locator('#saveBtn').click();
    await page.locator('#saveDownloadBtn').click();
    const download = await event;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    await page.locator('#downloadConfirmBtn').click();
    const saved = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const absent = saved.scores.filter(record => record.studentId === 'retained-a');
    assert.deepEqual(absent.map(record => record.total), expectedTotals);
    assert.deepEqual(absent.map(record => record.questions.q1), expectedQuestions);
    assert.ok(absent.every(record => record.absent));
    assert.deepEqual(saved.scores.filter(record => record.studentId === 'retained-b').map(record => record.total), [0, 0]);
    await upload(saved, name);
    assert.equal(await page.evaluate(() => dirty), false);
    assert.deepEqual(await page.evaluate(() => data.scores), saved.scores);
    assert.deepEqual(await combined(), excluded);
  };
  const toggle = async checked => {
    await page.locator('[data-tab="input"]').click();
    for (const [index, test] of retained.tests.entries()) {
      await page.locator('#inTest').selectOption(test.id);
      await page.locator('tr[data-sid="retained-a"] .absent-check').setChecked(checked);
      const row = page.locator('tr[data-sid="retained-a"]');
      assert.equal(await row.locator('.cell-input').inputValue(), checked ? '' : String([100, 60][index]));
      assert.equal(await page.locator('tr[data-sid="retained-b"] .cell-input').inputValue(), '0');
    }
  };
  for (const version of [1, 2, 3]) {
    await upload({ ...retained, version }, `fictional-retained-v${version}.json`);
    assert.equal(await page.evaluate(() => data.version), 3);
    assert.deepEqual(await combined(), excluded);
    assert.deepEqual(await page.evaluate(() => data.scores), retained.scores, 'loading must preserve retained scores');
  }
  await saveAndReopen('fictional-retained-roundtrip.json', [100, 60]);
  await toggle(false);
  assert.deepEqual(await combined(), restored);
  await toggle(true);
  assert.deepEqual(await combined(), excluded);
  await saveAndReopen('fictional-retained-toggle-roundtrip.json', [null, null]);
  await toggle(false);
  assert.deepEqual(await combined(), restored);

  const totalsOnly = retainedAbsenceDataset();
  totalsOnly.tests.forEach(test => { test.questions = []; test.domains = []; });
  totalsOnly.scores.forEach(record => { record.questions = {}; record.domains = {}; });
  await upload(totalsOnly, 'fictional-retained-total-only.json');
  assert.deepEqual(await combined(), excluded);
  await saveAndReopen('fictional-retained-total-only-roundtrip.json', [100, 60], [undefined, undefined]);
  await toggle(false);
  assert.deepEqual(await combined(), restored);
}
