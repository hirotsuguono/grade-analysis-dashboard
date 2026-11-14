'use strict';

const assert = require('node:assert/strict');
const ExcelJS = require('../src/files/vendor/exceljs.min.js');
const fixtures = require('./survey-fixtures.cjs');
const { download: saveJson } = require('./issues-24-28-browser-helpers.cjs');

module.exports = async (page, original) => {
  const load = async value => {
    assert.equal(await page.evaluate(v => {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      return applyJsonText(JSON.stringify(v), 'fictional-survey.json', null);
    }, value), true);
    await page.locator('[data-tab="survey"]').click();
  };
  const text = () => page.evaluate(() => JSON.stringify(data));
  const latest = waveId => page.evaluate(id => window.GD_SURVEY_STATE.getLatest(data.surveys, id), waveId);
  const readDownload = async event => {
    const download = await event, chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const issue = async () => {
    await page.locator('#surveyPreparation').evaluate(el => { el.open = true; });
    const event = page.waitForEvent('download');
    await page.locator('#surveyTemplateBtn').click();
    return readDownload(event);
  };
  const edit = async (buffer, change) => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer); change(book);
    return Buffer.from(await book.xlsx.writeBuffer());
  };
  const upload = buffer => page.locator('#surveySchoolInput').setInputFiles({
    name: 'fictional-school-survey.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer,
  });
  const ready = async () => {
    await page.locator('#surveySchoolApplyBtn').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('surveySchoolApplyBtn').disabled);
  };
  const newWave = async (referenceIds, label, mode = 'count', scope = null) => {
    await page.locator('#surveyPreparation').evaluate(el => { el.open = true; });
    await page.locator('#surveyWaveBuilder').evaluate(el => { el.open = true; });
    if (await page.locator('#surveyClearSelectionBtn').isEnabled()) await page.locator('#surveyClearSelectionBtn').click();
    for (const id of referenceIds) await page.locator(`#surveyWaveItems input[value="${id}"]`).check();
    await page.locator('#surveyWaveLabel').fill(label);
    await page.locator('#surveyWaveDate').fill('2026-05-20');
    await page.locator('#surveyAdministration').selectOption('official');
    await page.locator('#surveyInputMode').selectOption(mode);
    await page.locator('#surveyWaveOwnership').selectOption('public');
    if (scope) await page.locator('#surveyParticipantScope').selectOption(scope);
    const count = await page.evaluate(() => data.surveys.waves.length);
    await page.locator('#surveyCreateWaveBtn').click();
    await page.waitForFunction(n => data.surveys.waves.length === n + 1, count);
    return page.locator('#surveyWaveSelect').inputValue();
  };
  const compareFields = async expected => {
    const actual = await page.evaluate(() => { const { surveys, ...rest } = data; return rest; });
    assert.deepEqual(actual, expected);
  };
  const addOfficial = async (files, sourceCount) => {
    await page.locator('#surveyPreparation').evaluate(el => { el.open = true; });
    const before = await text();
    await page.locator('#surveyOfficialInput').setInputFiles(files);
    await page.locator('#surveyOfficialApplyBtn').waitFor({ state: 'visible', timeout: 60000 });
    assert.equal(await text(), before, 'official preview must not mutate the dataset');
    await page.locator('#surveyOfficialApplyBtn').click();
    await page.waitForFunction(n => data.surveys?.sources.length === n, sourceCount);
    assert.match(await page.locator('#surveyStatus').textContent(), /公式資料を追加しました/);
    assert.equal(await page.locator('#surveyOfficialApplyBtn').isVisible(), false);
  };

  try {
    await load(original);
    assert.equal(await page.evaluate(() => Object.hasOwn(data, 'surveys')), false);
    const untouched = await text();
    await page.locator('#surveyOfficialInput').setInputFiles({ name: 'fictional-invalid.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('invalid') });
    await page.waitForFunction(() => document.getElementById('surveyStatus').textContent.includes('追加できません'));
    assert.equal(await text(), untouched);
    assert.equal(await page.locator('#surveyOfficialApplyBtn').isVisible(), false);

    const files = [402, 424, 427].map(kind => ({ name: `fictional-${kind}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(fixtures.officialBuffer(kind)) }));
    await addOfficial([files[0]], 1);
    const codesOnlySnapshot = JSON.parse(await text());
    const unresolved = await page.evaluate(() => {
      const ref = data.surveys.references.find(r => data.surveys.instruments.find(i => i.id === r.instrumentId)?.code === '1');
      const item = data.surveys.instruments.find(i => i.id === ref.instrumentId);
      return { refId: ref.id, instrumentId: item.id, ref: JSON.stringify(ref), item: JSON.stringify(item), status: item.definitionStatus };
    });
    assert.equal(unresolved.status, 'codesOnly');
    await page.locator(`#surveyWaveItems input[value="${unresolved.refId}"]`).check();
    assert.equal(await page.locator('#surveySelectedCount').textContent(), '1件選択');
    await addOfficial([files[1]], 2);
    assert.match(await page.locator('#surveyStatus').textContent(), /版|補完|選択肢/);
    assert.equal(await page.locator(`#surveyWaveItems input[value="${unresolved.refId}"]`).count(), 0);
    assert.equal(await page.locator('#surveySelectedCount').textContent(), '0件選択');
    assert.equal(await page.evaluate(id => JSON.stringify(data.surveys.references.find(r => r.id === id)), unresolved.refId), unresolved.ref);
    assert.equal(await page.evaluate(id => JSON.stringify(data.surveys.instruments.find(i => i.id === id)), unresolved.instrumentId), unresolved.item);
    await addOfficial([files[2]], 3);
    const beforeDuplicate = await text();
    await addOfficial(files, 3);
    assert.equal(await text(), beforeDuplicate, 'reimporting the bundle must reuse the definition upgrade');
    await compareFields(original);
    const refs = await page.evaluate(() => window.GD_SURVEY_STATE.getAvailableReferences(data.surveys).map(ref => ({ id: ref.id, type: ref.type, ownership: ref.ownership,
      code: data.surveys.instruments.find(i => i.id === ref.instrumentId).code,
      unit: ref.observationUnit, subject: data.surveys.instruments.find(i => i.id === ref.subjectInstrumentId)?.subject })));
    const ref = refs.find(r => r.type === 'distribution' && r.ownership === 'public' && r.code === '1');
    assert.ok(ref);
    assert.ok(refs.some(r => r.type === 'conditionalMean' && r.unit === 'unknown'));
    const waveId = await newWave([ref.id], '架空の人数調査');
    const blank = await issue();
    const filled = await edit(blank, book => {
      const sheet = book.getWorksheet('集計入力');
      for (let row = 2; row <= sheet.rowCount; row++) assert.ok(sheet.getCell(row, 6).value == null || sheet.getCell(row, 6).value === '');
      [10, 0, 8, 1, 1].forEach((value, i) => { sheet.getCell(i + 2, 6).value = value; });
    });
    const beforeSchool = await text();
    await upload(filled); await ready();
    assert.equal(await text(), beforeSchool, 'school preview must not mutate the dataset');
    await page.locator('#surveySchoolApplyBtn').click();
    await page.waitForFunction(id => window.GD_SURVEY_STATE.getLatest(data.surveys, id).length === 1, waveId);
    let result = (await latest(waveId))[0];
    assert.deepEqual(result.values.map(v => v.value.value), [0, 8, 1, 1]);
    assert.equal(result.denominator.count.value, 10);
    assert.equal(await page.locator('#surveyChart').isVisible(), true);
    assert.match(await page.locator('#surveyTable').textContent(), /0%/);
    assert.match(await page.locator('#surveyTable').textContent(), /80%/);
    assert.match(await page.locator('#surveyTable').textContent(), /-30/);
    await compareFields(original);
    const saved = await saveJson(page);
    assert.deepEqual(saved.surveys.waves[0].results[0].values.map(v => v.value.value), [0, 8, 1, 1]);

    const state = await page.evaluate(() => { markDirty(); return { text: JSON.stringify(data), name: fileName, dirty, token: activeDataToken }; });
    await page.evaluate(() => { const bad = JSON.parse(JSON.stringify(data)); bad.surveys.schemaVersion = 99; applyJsonText(JSON.stringify(bad), 'fictional-invalid-survey.json', null); });
    assert.deepEqual(await page.evaluate(() => ({ text: JSON.stringify(data), name: fileName, dirty, token: activeDataToken })), state);
    await page.locator('#surveyUndoBtn').click();
    assert.equal((await latest(waveId)).length, 0);
    await compareFields(original);
    await load(saved);
    assert.deepEqual((await latest(waveId))[0].values.map(v => v.value.value), [0, 8, 1, 1]);

    const beforeStale = await text();
    await page.locator('#surveyPreparation').evaluate(el => { el.open = true; });
    await upload(filled);
    await page.waitForFunction(() => { const el = document.getElementById('surveySchoolPreview'); return !el.hidden && el.classList.contains('is-error'); });
    assert.equal(await text(), beforeStale);
    assert.equal(await page.locator('#surveySchoolApplyBtn').isVisible(), false);
    const clear = await issue();
    await upload(clear); await ready();
    assert.match(await page.locator('#surveySchoolPreview').textContent(), /空欄|未入力/);
    await page.locator('#surveySchoolApplyBtn').click();
    await page.waitForFunction(id => window.GD_SURVEY_STATE.getLatest(data.surveys, id)[0].revision === 2, waveId);
    result = (await latest(waveId))[0];
    assert.ok(result.values.every(v => v.value.status === 'unentered' && v.value.value === null));
    await page.locator('#surveyUndoBtn').click();
    assert.deepEqual((await latest(waveId))[0].values.map(v => v.value.value), [0, 8, 1, 1]);
    await compareFields(original);

    const mixed = structuredClone(saved);
    mixed.students[0].className = '3A'; mixed.students[1].className = '3B';
    await load(mixed);
    const personal = await newWave([ref.id], '架空の固定対象', 'individual', 'class:3A');
    const participants = await page.evaluate(id => data.surveys.waves.find(w => w.id === id).participants, personal);
    assert.deepEqual(participants.map(p => p.id), [mixed.students[0].id]);
    assert.equal(participants[0].grade, 3);
    const individual = await edit(await issue(), book => { const sheet = book.getWorksheet('個人入力'); assert.equal(sheet.rowCount, 2); sheet.getCell('I2').value = '1'; });
    await page.evaluate(id => { data.students.find(s => s.id === id).className = '1A'; markDirty(); renderAll(); }, mixed.students[0].id);
    await page.locator('#surveyPreparation').evaluate(el => { el.open = true; });
    await upload(individual); await ready();
    await page.locator('#surveySchoolApplyBtn').click();
    await page.waitForFunction(id => window.GD_SURVEY_STATE.getLatest(data.surveys, id).length === 1, personal);
    result = (await latest(personal))[0];
    assert.equal(result.denominator.count.value, 1);
    assert.equal(result.values[0].value.value, 1);
    assert.equal(await page.evaluate(id => data.surveys.waves.find(w => w.id === id).participants[0].className, personal), '3A');
    assert.deepEqual((await latest(waveId))[0].values.map(v => v.value.value), [0, 8, 1, 1]);

    // A saved wave must keep its original definition even after adding the missing source.
    const pinned = await page.evaluate(({ snapshot, refId }) => {
      snapshot.surveys = window.GD_SURVEY_STATE.createWave(snapshot.surveys, {
        id: 'fictional-old-definition', label: '架空の旧版固定調査', administeredOn: '2026-05-20',
        administration: 'official', referenceIds: [refId], ownership: 'public', schoolLabel: '架空校',
      }).surveys;
      return snapshot;
    }, { snapshot: codesOnlySnapshot, refId: unresolved.refId });
    await load(pinned);
    await page.locator('#surveyWaveSelect').selectOption('fictional-old-definition');
    const beforePinned = JSON.stringify(pinned.surveys.waves[0]);
    await addOfficial([files[1]], 2);
    assert.equal(await page.locator('#surveyWaveSelect').inputValue(), 'fictional-old-definition');
    assert.equal(await page.locator(`#surveyReferenceSelect option[value="${unresolved.refId}"]`).count(), 1);
    assert.equal(await page.evaluate(() => JSON.stringify(data.surveys.waves[0])), beforePinned);
    await page.locator('#surveyPreparation').evaluate(el => { el.open = true; });
    await page.locator('#surveyTemplateBtn').click();
    assert.match(await page.locator('#surveyStatus').textContent(), /元の版|確認する前の版/);

    const empty = await page.context().newPage();
    try {
      await empty.goto(page.url());
      await empty.locator('#surveyStartBtn').click();
      assert.equal(await empty.locator('#panel-survey').isVisible(), true);
      assert.deepEqual(await empty.evaluate(() => [data.students.length, data.tests.length, data.scores.length]), [0, 0, 0]);
      assert.equal(await empty.evaluate(() => dirty && data.surveys.schemaVersion === 1), true);
    } finally { await empty.close(); }
  } finally { await load(original); await page.locator('[data-tab="overview"]').click(); }
};
