'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('../src/files/vendor/exceljs.min.js');
const { download: downloadJson } = require('./issues-24-28-browser-helpers.cjs');
module.exports = async (page, original) => {
  async function bytes(download) {
    const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  async function template() {
    const event = page.waitForEvent('download'); await page.locator('#reassignTemplateBtn').click();
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await bytes(await event)); return wb;
  }
  async function upload(wb) {
    await page.locator('#reassignXlsxInput').setInputFiles({ name: 'fictional-roster-reassign.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await wb.xlsx.writeBuffer()) });
    await page.locator('#reassignPreview').waitFor({ state: 'visible' });
  }
  async function backup() {
    const event = page.waitForEvent('download'); await page.locator('#reassignBackupBtn').click();
    const saved = JSON.parse((await bytes(await event)).toString('utf8'));
    await page.locator('#reassignBackupConfirmed').check(); return saved;
  }
  async function open() { await page.locator('#rosterBtn').click(); await page.locator('[data-rtab="reassign"]').click(); }
  const fixture = JSON.parse(JSON.stringify(original));
  fixture.students = fixture.students.slice(0, 3);
  fixture.students[0].name = '架空<svg/onload=globalThis.rosterUnsafe=1>';
  fixture.students[1].name = fixture.students[2].name = '架空の同名';
  const ids = new Set(fixture.students.map(s => s.id));
  fixture.scores = fixture.scores.filter(s => ids.has(s.studentId));
  for (const metric of fixture.metrics) for (const id of Object.keys(metric.values)) if (!ids.has(id)) delete metric.values[id];
  fixture.interventions = (fixture.interventions || []).filter(iv => ids.has(iv.studentId));
  try {
    await page.evaluate(value => { applyJsonText(JSON.stringify(value), 'fictional-roster.json', null); isAdmin = true; updateRoleUI(); }, fixture);
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(data)));
    await open();
    await page.locator('#reassignGrade').selectOption('3'); await page.locator('#reassignNaming').selectOption('letters');
    await page.locator('#reassignCount').fill('2'); await page.locator('#reassignDate').fill('2026-06-24');
    const wb = await template(), input = wb.getWorksheet('クラス替え');
    assert.equal(input.getCell('A10').value, before.students[0].id);
    assert.equal(input.getCell('E10').dataValidation.type, 'list');
    assert.equal(input.getCell('F10').dataValidation.type, 'whole');
    await upload(wb);
    assert.match(await page.locator('#reassignPreview').textContent(), /10行目・E列/);
    assert.deepEqual(await page.evaluate(() => data), before);
    [['3年A組', 1], ['3年B組', 1], ['3年B組', 2]].forEach(([klass, num], i) => { input.getCell(10 + i, 5).value = klass; input.getCell(10 + i, 6).value = num; });
    await upload(wb);
    assert.match(await page.locator('#reassignPreview').textContent(), /変更 3名/);
    assert.equal(await page.evaluate(() => globalThis.rosterUnsafe), undefined);
    assert.equal(await page.locator('#reassignApplyBtn').isDisabled(), true);
    const viewport = page.viewportSize();
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 950 });
      const bounds = await page.locator('#rosterDialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert.equal(await page.locator('.roster-dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true);
    }
    await page.screenshot({ path: path.join(process.env.QA_OUTPUT || path.join(__dirname, '../test-results'), 'roster-reassignment-preview.png'), fullPage: true });
    await page.setViewportSize(viewport);
    assert.deepEqual(await backup(), before);
    await page.locator('#reassignApplyBtn').click();
    const after = await page.evaluate(() => data);
    assert.deepEqual(after.students.map(s => s.id), before.students.map(s => s.id));
    assert.deepEqual(after.students.map(s => s.className), ['3年A組', '3年B組', '3年B組']);
    for (let i = 0; i < 3; i++) assert.deepEqual(after.students[i].classHistory.at(-1), { className: before.students[i].className, number: before.students[i].number, at: '2026-06-24' });
    for (const key of ['scores', 'tests', 'metrics', 'interventions']) assert.deepEqual(after[key], before[key]);
    await page.locator('#rosterCloseBtn').click();
    await page.evaluate(() => { const rec = data.scores.find(s => !s.absent), t = testById(rec.testId); rec.questions[t.questions[0].key] = 0; recalcScore(rec, t); markDirty(); });
    const laterScores = await page.evaluate(() => data.scores);
    await open(); await page.locator('#reassignUndoBtn').click();
    assert.deepEqual(await page.evaluate(() => data.students), before.students);
    assert.deepEqual(await page.evaluate(() => data.scores), laterScores);
    await page.locator('#reassignGrade').selectOption('2'); await page.locator('#reassignMode').selectOption('partial');
    await page.locator('#reassignKind').selectOption('correction');
    const correction = await template(), correctionInput = correction.getWorksheet('クラス替え');
    correctionInput.getCell('E10').value = '2年B組'; correctionInput.getCell('F10').value = 3;
    await upload(correction); assert.match(await page.locator('#reassignPreview').textContent(), /変更 1名/);
    await backup(); await page.locator('#reassignApplyBtn').click();
    assert.deepEqual(await page.evaluate(() => data.students[0].classHistory), before.students[0].classHistory);
    await page.locator('#rosterTableWrap input[data-field="name"]').first().fill('架空訂正後');
    await page.locator('[data-rtab="reassign"]').click();
    assert.equal(await page.locator('#reassignUndoBtn').isDisabled(), true);
    const edited = await page.evaluate(() => data);
    await upload(correction); assert.match(await page.locator('#reassignPreview').textContent(), /現在の名簿と一致しません/);
    assert.deepEqual(await page.evaluate(() => data), edited);
    await page.locator('#rosterCloseBtn').click();
    const saved = await downloadJson(page);
    await page.locator('#fileInput').setInputFiles({ name: 'fictional-reassigned.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => fileName === 'fictional-reassigned.json');
    assert.deepEqual(await page.evaluate(() => data), saved);
    await page.evaluate(() => { isAdmin = true; updateRoleUI(); }); await open();
    assert.equal(await page.locator('#reassignUndoBtn').isDisabled(), true);
  } finally {
    await page.evaluate(value => { document.querySelectorAll('dialog[open]').forEach(d => d.close()); applyJsonText(JSON.stringify(value), 'fictional-roster-restored.json', null); }, original);
  }
};
