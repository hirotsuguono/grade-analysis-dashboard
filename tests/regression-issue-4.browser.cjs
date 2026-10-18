'use strict';

const assert = require('node:assert/strict');
const progressDataset = require('./issue-4-fixtures.cjs');

module.exports = async function checkRtiTermAlignment(page, fixture) {
  try {
    for (const subject of ['英語', 'all']) {
      for (const emptyIndex of [0, 1, 2]) {
        const classRates = [[60, 80], [50, 50], [40, 20]];
        classRates.forEach(rates => rates.splice(emptyIndex, 0, null));
        const dataset = progressDataset(classRates, subject);
        await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-rti-terms.json', null), dataset);
        await page.locator('[data-tab="rti"]').click();
        await page.locator('#rtiLogWrap [data-iv="iv"]').first().click();
        assert.equal(await page.locator('#rtiEsNote').isVisible(), true);
        assert.match(await page.locator('#rtiEsNote').textContent(), /直近 80%.*\+0\.67/);
        const option = await page.evaluate(() => {
          const chart = echarts.getInstanceByDom(document.getElementById('rtiProgressChart')).getOption();
          return { labels: chart.xAxis[0].data, student: chart.series[0].data, average: chart.series[1].data };
        });
        assert.deepEqual(option, {
          labels: dataset.tests.filter((_, i) => i !== emptyIndex).map(t => t.name),
          student: [60, 80], average: [50, 50],
        });
      }
    }
  } finally {
    await page.evaluate(value => applyJsonText(JSON.stringify(value), 'fictional-rti-restored.json', null), fixture);
  }
};
