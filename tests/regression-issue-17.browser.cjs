'use strict';
const assert = require('node:assert/strict');

module.exports = async function checkExpandableTestExcel(page, fixture) {
  const result = await page.evaluate(async fixture => {
    applyJsonText(JSON.stringify(fixture), 'fictional-expandable-excel.json', null);
    const roster = JSON.stringify(data.students);
    const originalWrite = XLSX.writeFile;
    let wb;
    try {
      XLSX.writeFile = value => { wb = value; };
      issueNewTestTemplate();
    } finally {
      XLSX.writeFile = originalWrite;
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['新規テスト'], { header: 1, defval: '' });
    const identityHeader = rows[8].slice(0, 5);
    const firstId = rows[9][0], secondId = rows[10][0], blankId = rows[11][0];
    rows[0][1] = '架空の4分野Excel'; rows[1][1] = '英語'; rows[2][1] = 100;
    rows[3][1] = 1; rows[4][1] = '2026-05-22';
    // Simulate inserting an entire G column, including row 1, then enter four domains.
    rows.forEach(row => { while (row.length < 6) row.push(''); row.splice(6, 0, ''); });
    ['リスニング', '読解', 'ライティング', '文法'].forEach((domain, i) => {
      rows[6][5 + i] = domain; rows[7][5 + i] = 25; rows[8][5 + i] = '問' + (i + 1);
      rows[9][5 + i] = [0, 25, 20, 15][i];
    });
    rows[10][5] = '欠';
    const importRows = async input => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(input), '新規テスト');
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
    invalid[0][1] = '架空の不正ID'; invalid[9][0] = 'fictional-unknown-id';
    dirty = true;
    const before = JSON.stringify(data);
    await importRows(invalid);
    const output = {
      identityHeader, metadata: rows.slice(0, 5).map(r => r.slice(0, 2)),
      test, score, absent: absent?.absent, blankMissing: !blank,
      rosterUnchanged: JSON.stringify(data.students) === roster,
      reopenedTotal: reopened?.total, valid: validateDataset(data).length === 0,
      invalidUnchanged: before === JSON.stringify(data), dirty,
    };
    applyJsonText(JSON.stringify(fixture), 'fictional-expandable-excel.json', null);
    return output;
  }, fixture);
  assert.deepEqual(result.identityHeader, ['生徒ID', '学年', 'クラス', '出席番号', '氏名']);
  assert.deepEqual(result.metadata, [['テスト名', '架空の4分野Excel'], ['教科', '英語'], ['満点', 100], ['実施学年', 1], ['実施日', '2026-05-22']]);
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
