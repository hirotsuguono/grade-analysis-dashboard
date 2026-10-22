'use strict';

const assert = require('node:assert/strict');

module.exports = async function checkExcelDateValidation(page, fixture) {
  const cases = [[0, null], [60, null], [60.5, null], ['1900-02-29', null], [45000.5, '2023-03-15'], [45351.75, '2024-02-29']];
  const results = await page.evaluate(async ({ fixture, cases }) => {
    const results = [];
    const makeWorkbook = (name, rows) => {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
      return wb;
    };
    for (const [value, expected] of cases) {
      applyJsonText(JSON.stringify(fixture), 'fictional-excel-dates.json', null);
      dirty = true;
      const before = JSON.stringify(data);
      const initial = makeWorkbook('初回登録', [
        ['データ名', '架空の日付検証'],
        ['テスト名', '架空初回', '教科', '英語', '満点', 10, '実施日', value],
        ['学年', 'クラス', '出席番号', '氏名', '合計点（任意）'], [2, 'A', 1, '架空生徒001', 0],
      ]);
      const initialPlan = window.GD_INITIAL.planWorkbook(initial, XLSX);
      const student = data.students[0];
      const wb = makeWorkbook('新規テスト', [
        ['テスト名→', '架空の日付テスト', '教科→', '架空教科', '満点→', 10, '実施学年→', 2, '実施日→', value],
        ['分野→', '', '', '語彙'], ['配点→', '', '', 10],
        ['出席番号', '氏名', 'クラス', '問1', '生徒ID'],
        [student.number, student.name, student.className, 0, student.id],
      ]);
      const file = new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], 'fictional-excel-dates.xlsx');
      await importTestTemplate(file);
      const added = data.tests.find(test => test.name === '架空の日付テスト');
      results.push({
        value, expected,
        normalized: normalizeDateValue(value),
        initialDate: initialPlan.dataset?.tests[0]?.date ?? null,
        initialRejected: initialPlan.errors.some(message => message.includes('実施日')),
        newDate: added?.date ?? null,
        unchanged: JSON.stringify(data) === before,
        dirty,
        validSavedData: validateDataset(JSON.parse(JSON.stringify(data))).length === 0,
      });
    }
    applyJsonText(JSON.stringify(fixture), 'fictional-excel-dates.json', null);
    return results;
  }, { fixture, cases });
  for (const result of results) {
    assert.equal(result.normalized, result.expected, String(result.value));
    assert.equal(result.initialDate, result.expected, String(result.value));
    assert.equal(result.initialRejected, result.expected === null, String(result.value));
    assert.equal(result.newDate, result.expected, String(result.value));
    assert.equal(result.unchanged, result.expected === null, String(result.value));
    assert.equal(result.dirty, true, String(result.value));
    assert.equal(result.validSavedData, true, String(result.value));
  }
};
