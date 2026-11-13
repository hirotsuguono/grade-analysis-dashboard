'use strict';
const assert = require('node:assert/strict');
const ExcelJS = require('../src/files/vendor/exceljs.min.js');
const { download: saveJson } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  const fixture = {
    version: 3, name: '架空の分類と進級の併用',
    students: [{ id: 'p', name: '架空の進級生', className: '2年A組', number: 1 },
      { id: 'g', name: '架空の卒業生', className: '3年A組', number: 1 },
      { id: 'o', name: '架空の卒業済生徒', className: '3年A組', number: 2, enrollmentStatus: 'graduated', graduatedAt: '2025-03-31', lastPromotionYear: 2025 }],
    tests: [{ id: 't', name: '架空の観点別テスト', subject: '英語', date: '2026-06-01', maxScore: 10,
      domains: [{ key: 'listen', label: 'リスニング', max: 4 }, { key: 'read', label: '読解', max: 6 }],
      questions: [{ key: 'a', label: '架空小問1', max: 4, domain: 'listen', perspective: 'knowledge' },
        { key: 'b', label: '架空小問2', max: 6, domain: 'read', perspective: 'thinking' }] }],
    scores: [['p', 2, 4], ['g', 3, 5], ['o', 4, 6]].map(([studentId, a, b]) => ({ studentId, testId: 't', total: a + b, questions: { a, b }, domains: { listen: a, read: b } })),
    metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
  };
  const read = async event => { const download = await event, chunks = []; for await (const part of await download.createReadStream()) chunks.push(part); return Buffer.concat(chunks); };
  const load = value => page.evaluate(v => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); applyJsonText(JSON.stringify(v), 'fictional-combined.json', null); isAdmin = true; updateRoleUI(); }, value);
  try {
    await load(fixture);
    const before = await page.evaluate(() => data);
    await page.locator('#rosterBtn').click(); await page.locator('[data-rtab="reassign"]').click();
    await page.locator('#reassignOperation').selectOption('whole'); await page.locator('#reassignSchoolYear').fill('2026');
    for (const grade of [2, 3]) { await page.locator('#reassignNaming' + grade).selectOption('letters'); await page.locator('#reassignCount' + grade).fill('1'); }
    await page.locator('#reassignDate').fill('2026-06-24');
    const issued = page.waitForEvent('download'); await page.locator('#reassignTemplateBtn').click();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await read(issued));
    const sheet = workbook.getWorksheet('クラス替え');
    assert.equal(sheet.getCell('F10').value, ''); assert.equal(sheet.getCell('G10').value, '');
    sheet.getCell('F10').value = '3年A組'; sheet.getCell('G10').value = 7;
    await page.locator('#reassignXlsxInput').setInputFiles({ name: 'fictional-combined.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
    await page.locator('#reassignCommit').waitFor({ state: 'visible' });
    const backup = page.waitForEvent('download'); await page.locator('#reassignBackupBtn').click();
    assert.deepEqual(JSON.parse((await read(backup)).toString('utf8')), before);
    await page.locator('#reassignBackupConfirmed').check(); await page.locator('#reassignApplyBtn').click();
    assert.deepEqual(await page.evaluate(() => data.scores), before.scores);
    assert.deepEqual(await page.evaluate(() => activeStudents().map(s => s.id)), ['p']);
    await page.locator('#rosterCloseBtn').click(); await page.locator('[data-tab="input"]').click();
    assert.equal(await page.locator('#scoreTableWrap tr[data-sid]').count(), 1);
    await page.locator('#editClassificationBtn').click();
    await page.locator('#ceDomains input').first().fill('聞き取り');
    await page.locator('#ceQuestions > [data-key="b"] .ce-domain').selectOption('listen');
    await page.locator('#cePreview').click(); await page.locator('#ceApply').click();
    const edited = await page.evaluate(() => data);
    assert.deepEqual(edited.scores.map(({ domains, ...raw }) => raw), before.scores.map(({ domains, ...raw }) => raw));
    assert.deepEqual(edited.scores.map(s => s.domains), [{ listen: 6 }, { listen: 8 }, { listen: 10 }]);
    await page.locator('[data-tab="analysis"]').click(); await page.locator('#anClassificationAxis').selectOption('domain');
    const row = page.locator('#anClassificationTable tbody tr');
    assert.equal(await row.count(), 1); assert.match(await row.textContent(), /聞き取り/);
    assert.equal(await row.locator('td').nth(2).textContent(), '1名'); assert.equal(await row.locator('td').nth(3).textContent(), '60%');
    await page.locator('#anClassificationAxis').selectOption('perspective');
    assert.equal(await row.count(), 2); assert.deepEqual(await row.locator('td:nth-of-type(3)').allTextContents(), ['1名', '1名']);
    const saved = await saveJson(page); assert.deepEqual(saved, edited);
    await page.locator('#rosterBtn').click(); await page.locator('[data-rtab="reassign"]').click(); await page.locator('#reassignUndoBtn').click();
    assert.deepEqual(await page.evaluate(() => data.students), before.students);
    assert.deepEqual(await page.evaluate(() => data.tests), edited.tests); assert.deepEqual(await page.evaluate(() => data.scores), edited.scores);
    await load(saved);
    assert.deepEqual(await page.evaluate(() => activeStudents().map(s => s.id)), ['p']);
    assert.equal(await page.evaluate(() => data.tests[0].domains[0].label), '聞き取り');
    assert.equal(await page.evaluate(() => data.students.find(s => s.id === 'g').enrollmentStatus), 'graduated');
  } finally { await load(original); }
};
