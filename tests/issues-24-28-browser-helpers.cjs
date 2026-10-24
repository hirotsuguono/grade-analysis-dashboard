'use strict';
const path = require('node:path');
const XLSX = require('../src/files/vendor/xlsx.full.min.js');
function dataset(withQuestions = false) {
  const d = {
    version: 3, name: '架空のブラウザ動作確認',
    students: ['a', 'b', 'c'].map((id, i) => ({ id, name: `架空生徒${i + 1}`, number: i + 1, className: '1年1組' })),
    tests: [{ id: 't', name: '架空テスト', subject: '英語', maxScore: 100, questions: [], domains: [] }],
    scores: [], metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
  };
  if (withQuestions) {
    d.tests[0].questions = [1, 2].map(i => ({ key: 'q' + i, label: '問' + i, max: 50, domain: '読解' }));
    d.tests[0].domains = [{ key: '読解', label: '読解', max: 100 }];
  }
  return d;
}
async function upload(page, d, name) {
  await page.locator('#fileInput').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(d)) });
  await page.waitForFunction(name => fileName === name, name);
}
async function download(page) {
  await page.locator('#saveBtn').click();
  const event = page.waitForEvent('download');
  await page.locator('#saveDownloadBtn').click();
  const file = await event, chunks = [];
  for await (const chunk of await file.createReadStream()) chunks.push(chunk);
  await page.locator('#downloadConfirmBtn').click();
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function workbook(rows, name) {
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '新規テスト');
  return { name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })) };
}
function rows(name, date = '2026-05-01', secondQuestion = true) {
  return [
    ['テスト名', name, '', 'テスト種類', '期末テスト'], ['教科', '英語'], ['満点', 100], ['実施学年', 1], ['実施日', date], [],
    ['分野', '', '', '', '', '読解', ...(secondQuestion ? ['読解'] : [])],
    ['配点', '', '', '', '', secondQuestion ? 50 : 100, ...(secondQuestion ? [50] : [])],
    ['生徒ID', '学年', 'クラス', '出席番号', '氏名', '問1', ...(secondQuestion ? ['問2'] : [])],
    ['a', 1, '1', 1, '架空生徒1', 50, ...(secondQuestion ? [''] : [])],
    ['b', 1, '1', 2, '架空生徒2', 50, ...(secondQuestion ? [0] : [])],
    ['c', 1, '1', 3, '架空生徒3', '欠', ...(secondQuestion ? [''] : [])],
  ];
}
async function paste(locator, text) {
  await locator.evaluate((el, text) => {
    const clipboardData = new DataTransfer(); clipboardData.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}
async function screenshot(page, issue) {
  await page.screenshot({ path: path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '..', 'test-results'), `issue-${issue}.png`), fullPage: true });
}
module.exports = { dataset, upload, download, workbook, rows, paste, screenshot };
