'use strict';
const assert = require('node:assert/strict');

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
  } finally {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'synthetic-test.json', null), fixture);
  }
};
