'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('../src/files/vendor/exceljs.min.js');
const { download: downloadJson } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  async function workbookDownload(button) {
    const event = page.waitForEvent('download');
    await page.locator(button).click();
    const download = await event, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);
    fs.writeFileSync(path.join(process.env.QA_OUTPUT || path.join(__dirname, '..', 'test-results'), 'issue-30-' + download.suggestedFilename()), bytes);
    return wb;
  }
  async function upload(selector, wb, filename) {
    await page.locator(selector).setInputFiles({ name: filename, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
  }
  try {
    await page.locator('#startFirstHeader').click();
    const roster = await workbookDownload('#initialTemplateBtn');
    assert.deepEqual(roster.worksheets.map(s => s.name), ['名簿入力', '記入例']);
    const rs = roster.getWorksheet('名簿入力');
    assert.equal(rs.columnCount, 4);
    assert.equal(rs.getCell('A1').fill.fgColor.argb, 'FF18334F');
    assert.equal(rs.getCell('A8').fill.fgColor.argb, 'FF245B86');
    assert.equal(rs.getCell('A10').fill.fgColor.argb, 'FFFFF5D6');
    assert.equal(rs.getCell('A10').border.bottom.style, 'thin');
    assert.equal(rs.getCell('A10').dataValidation.type, 'list');
    assert.equal(rs.views[0].topLeftCell, 'A10');
    [[1, '1', 1, '架空の新名簿A'], [1, '1', 2, '架空の新名簿B'], [1, '2', 1, '架空の新名簿C']]
      .forEach((row, r) => row.forEach((v, c) => { rs.getCell(10+r, 1+c).value = v; }));
    await upload('#initialXlsxInput', roster, 'fictional-styled-roster.xlsx');
    await page.waitForFunction(() => !document.getElementById('initialApplyBtn').hidden && !document.getElementById('initialApplyBtn').disabled);
    assert.match(await page.locator('#initialPreview').textContent(), /名簿だけを登録/);
    await page.locator('#initialApplyBtn').click();
    assert.equal(await page.evaluate(() => data.students.length), 3);
    assert.equal(await page.evaluate(() => data.tests.length), 0);
    const ids = await page.evaluate(() => data.students.map(s => s.id));
    const test = await workbookDownload('#prepareTestTemplateBtn');
    const settings = test.getWorksheet('① テスト設定'), scores = test.getWorksheet('② 点数入力');
    assert.equal(settings.getCell('B12').value.formula, "SUM('② 点数入力'!8:8)");
    assert.equal(scores.getCell('A10').fill.fgColor.argb, 'FFF1F4F8');
    assert.equal(scores.getCell('F10').fill.fgColor.argb, 'FFFFF5D6');
    assert.equal(scores.getCell('F10').dataValidation.type, 'custom');
    assert.equal(scores.views[0].topLeftCell, 'F10');
    assert.equal(scores.columnCount, 55);
    for (const column of ['J', 'K', 'BC']) {
      assert.equal(scores.getColumn(column).width, scores.getColumn('F').width);
      for (const row of [7, 8, 9, 10, 12]) {
        assert.deepEqual(scores.getCell(column + row).style, scores.getCell('F' + row).style);
        assert.equal(scores.getCell(column + row).value, '');
      }
      assert.equal(scores.getCell(column + '10').dataValidation.type, 'custom');
    }
    for (const [key, value] of Object.entries({ B8: '英語', B10: '架空の書式付きテスト', B14: new Date(Date.UTC(2026, 5, 24)), B16: 1, B18: '期末テスト', B20: '架空シリーズ' })) settings.getCell(key).value = value;
    settings.getCell('B12').value = { formula: "SUM('② 点数入力'!8:8)", result: 1 };
    scores.getCell('K7').value = '文法'; scores.getCell('K8').value = 10; scores.getCell('K9').value = '追加設問';
    scores.getCell('BC7').value = '架空の追加分野'; scores.getCell('BC8').value = 5; scores.getCell('BC9').value = '問50';
    ['F', 'G', 'H', 'I'].forEach(c => { scores.getCell(c + '10').value = 20; scores.getCell(c + '11').value = 0; });
    scores.getCell('K10').value = 0; scores.getCell('K11').value = 0; scores.getCell('F12').value = '欠';
    scores.getCell('BC10').value = 5; scores.getCell('BC11').value = 0;
    await upload('#testXlsxInput', test, 'fictional-styled-test.xlsx');
    await page.waitForFunction(() => data.tests.some(t => t.name === '架空の書式付きテスト'));
    const actual = await page.evaluate(() => ({ test: data.tests[0], scores: data.scores, valid: validateDataset(data).length === 0 }));
    assert.equal(actual.test.maxScore, 115); assert.equal(actual.test.questions.length, 6);
    assert.equal(actual.test.questions.at(-1).label, '問50');
    assert.equal(actual.test.date, '2026-06-24'); assert.equal(actual.test.kind, 'final'); assert.equal(actual.test.series, '架空シリーズ');
    assert.deepEqual(actual.scores.map(r => [r.studentId, r.total, !!r.absent]), [[ids[0], 85, false], [ids[1], 0, false], [ids[2], null, true]]);
    assert.equal(actual.scores[0].questions.q5, 0);
    assert.ok(actual.valid);
    const saved = await downloadJson(page);
    await page.locator('#fileInput').setInputFiles({ name: 'fictional-styled-reopened.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => fileName === 'fictional-styled-reopened.json');
    assert.deepEqual(await page.evaluate(() => data), saved);
  } finally {
    await page.evaluate(value => {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      applyJsonText(JSON.stringify(value), 'fictional-30-restored.json', null);
    }, original);
  }
};
