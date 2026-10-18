'use strict';

const assert = require('node:assert/strict');

module.exports = async function checkCompleteTermTotals(page, original) {
  const fixture = {
    version: 3, name: '架空の全教科合計テスト', metrics: [], interventions: [],
    students: [
      { id: 'a', name: '架空生徒A', className: '1A', number: 1 },
      { id: 'b', name: '架空生徒B', className: '1A', number: 2 },
    ],
    tests: [
      { id: 'math', name: '前期中間', gradeYear: 1, subject: '数学', maxScore: 100 },
      { id: 'english', name: '前期中間', gradeYear: 1, subject: '英語', maxScore: 100 },
    ],
    scores: [
      { studentId: 'a', testId: 'math', total: 80 },
      { studentId: 'b', testId: 'math', total: 80 },
      { studentId: 'b', testId: 'english', total: 80 },
    ],
  };
  const tab = name => page.locator(`[data-tab="${name}"]`).click();
  const series = () => page.evaluate(() => echarts.getInstanceByDom(document.getElementById('trendChart')).getOption().series.map(s => s.data));
  const totals = () => page.locator('#listTableWrap table').evaluate(table => {
    const index = [...table.querySelectorAll('thead th')].findIndex(th => th.dataset.key === 'termTotal');
    return [...table.querySelectorAll('tbody tr')].map(row => row.cells[index].textContent);
  });
  try {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-term-totals.json', null), fixture);
    await tab('trend');
    await page.locator('#trendSubject').selectOption('__sum__');
    await page.locator('#studentList li[data-sid="a"]').click();
    await page.locator('#studentList li[data-sid="b"]').click();
    assert.deepEqual(await series(), [[null], [160], [160]]);
    await tab('list');
    await page.locator('#listTerm').selectOption('1年・前期中間');
    assert.deepEqual(await totals(), ['', '160']);

    // 0点の入力でAも完成者になる。平均は(80+160)/2。
    await tab('input');
    await page.locator('#inTest').selectOption('english');
    await page.locator('#scoreTableWrap tr[data-sid="a"] input.cell-input').fill('0');
    await tab('trend');
    assert.deepEqual(await series(), [[80], [160], [120]]);
    await tab('list');
    assert.deepEqual(await totals(), ['80', '160']);

    // 1教科が欠席になると、完成者だけの合計・平均へ戻る。
    await tab('input');
    await page.locator('#scoreTableWrap tr[data-sid="a"] .absent-check').check();
    await tab('trend');
    assert.deepEqual(await series(), [[null], [160], [160]]);
    await tab('list');
    assert.deepEqual(await totals(), ['', '160']);
  } finally {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'synthetic-test.json', null), original);
  }
};
