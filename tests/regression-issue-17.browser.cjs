'use strict';
const assert = require('node:assert/strict');

module.exports = async function checkExpandableTestExcel(page, fixture) {
  const result = await page.evaluate(async fixture => {
    applyJsonText(JSON.stringify(fixture), 'fictional-expandable-excel.json', null);
    const roster = JSON.stringify(data.students);
    const originalWrite = window.GD_EXCEL.download;
    let wb;
    try {
      window.GD_EXCEL.download = async value => { wb = value; };
      await issueNewTestTemplate();
    } finally {
      window.GD_EXCEL.download = originalWrite;
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['② 点数入力'], { header: 1, defval: '' });
    const identityHeader = rows[8].slice(0, 5);
    const firstId = rows[9][0], secondId = rows[10][0], blankId = rows[11][0];
    const settings=wb.Sheets['① テスト設定'];
    for(const [key,value] of Object.entries({B8:'英語',B10:'架空の4分野Excel',B16:1,B14:'2026-05-22'})) settings[key]={t:typeof value==='number'?'n':'s',v:value};
    // Simulate inserting an entire G column, including row 1, then enter four domains.
    rows.forEach(row => { while (row.length < 6) row.push(''); row.splice(6, 0, ''); });
    for (const r of rows.slice(6)) for (let c=5;c<r.length;c++) r[c]='';
    ['リスニング', '読解', 'ライティング', '文法'].forEach((domain, i) => {
      rows[6][5 + i] = domain; rows[7][5 + i] = 25; rows[8][5 + i] = '問' + (i + 1);
      rows[9][5 + i] = [0, 25, 20, 15][i];
    });
    rows[10][5] = '欠';
    const importRows = async input => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, settings, '① テスト設定');
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(input), '② 点数入力');
      await importTestTemplate(new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' })], 'fictional-expandable-excel.xlsx'));
    };
    await importRows(rows);
    const test = data.tests.find(t => t.name === '架空の4分野Excel');
    const score = test && getScore(firstId, test.id);
    const absent = test && getScore(secondId, test.id);
    const blank = test && getScore(blankId, test.id);
    const saved = JSON.stringify(data);
    applyJsonText(saved, 'fictional-expandable-reopened.json', null);
    const reopened = test && getScore(firstId, test.id);
    const invalid = rows.map(r => r.slice());
    invalid[9][0] = 'fictional-unknown-id';
    dirty = true;
    const before = JSON.stringify(data);
    await importRows(invalid);
    const output = {
      identityHeader, metadata: [settings.B10.v,settings.B8.v,settings.B16.v,settings.B14.v],
      test, score, absent: absent?.absent, blankMissing: !blank,
      rosterUnchanged: JSON.stringify(data.students) === roster,
      reopenedTotal: reopened?.total, valid: validateDataset(data).length === 0,
      invalidUnchanged: before === JSON.stringify(data), dirty,
    };
    applyJsonText(JSON.stringify(fixture), 'fictional-expandable-excel.json', null);
    return output;
  }, fixture);
  assert.deepEqual(result.identityHeader, ['生徒ID', '学年', 'クラス', '出席番号', '氏名']);
  assert.deepEqual(result.metadata, ['架空の4分野Excel','英語',1,'2026-05-22']);
  assert.equal(result.test.questions.length, 4);
  assert.equal(result.test.domains.length, 4);
  assert.equal(result.test.maxScore, 100);
  assert.equal(result.test.gradeYear, 1);
  assert.equal(result.test.date, '2026-05-22');
  assert.equal(result.score.total, 60);
  assert.equal(result.score.questions.q1, 0);
  assert.equal(result.absent, true);
  assert.equal(result.blankMissing, true);
  assert.equal(result.rosterUnchanged, true);
  assert.equal(result.reopenedTotal, 60);
  assert.equal(result.valid, true);
  assert.equal(result.invalidUnchanged, true);
  assert.equal(result.dirty, true);
};
