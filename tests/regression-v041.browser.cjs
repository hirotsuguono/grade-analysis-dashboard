'use strict';
const assert = require('node:assert/strict');
module.exports = async (parent, fixture) => {
  const page = await parent.context().newPage();
  try {
    await page.goto(parent.url());
    await page.evaluate(d => applyJsonText(JSON.stringify(d), 'synthetic-original.json', null), fixture);
    assert.equal(await page.evaluate(() => echarts.version), '6.1.0');
    // Failed replacements must preserve live object identity, unsaved edits and the actual save handle.
    for (const kind of ['parse', 'number', 'grade', 'settings', 'render']) {
      const result = await page.evaluate(({d, kind}) => {
        data.name = '架空・未保存'; dirty = true;
        fileHandle = { name: 'synthetic-original.json' }; fileName = 'synthetic-original.json'; lastDiskText = 'original disk';
        pendingDownload = { synthetic: true }; isAdmin = true; ui.ovClass = 'all';
        const before = { data, fileHandle, fileName, dirty, lastDiskText, pendingDownload, isAdmin, activeDataToken, scoreIndex };
        if (kind === 'number') d.students[0].number = { formula: '1+1', result: 2 };
        if (kind === 'grade') d.tests[0].gradeYear = [];
        if (kind === 'settings') d.settings.rti = [];
        const render = renderAll;
        if (kind === 'render') { let first = true; renderAll = () => { if (first) { first = false; throw new Error('synthetic'); } render(); }; }
        try { applyJsonText(kind === 'parse' ? '{' : JSON.stringify(d), 'replacement.json', { name: 'replacement.json' }); }
        finally { renderAll = render; }
        return Object.entries(before).every(([key, value]) => eval(key) === value);
      }, { d: structuredClone(fixture), kind });
      assert.equal(result, true, kind);
      assert.match(await page.locator('#datasetName').textContent(), /synthetic-original/);
    }
    await page.evaluate(d => applyJsonText(JSON.stringify(d), 'synthetic.json', null), fixture);
    const injected = '\"><img src=x onerror="window.syntheticExecuted=true">&分野';
    await page.evaluate(value => {
      addDomainRow(value, 10); addQuestionRow('架空問題', 10); refreshQuestionDomainSelects();
    }, injected);
    assert.equal(await page.locator('.bq-domain option').last().getAttribute('value'), injected);
    assert.equal(await page.locator('.bq-domain option').last().textContent(), injected);
    assert.equal(await page.locator('#tfQuestions img').count(), 0);
    assert.equal(await page.evaluate(() => !!window.syntheticExecuted), false);
    const hints = await page.locator('input, textarea').evaluateAll(fields => fields.every(field =>
      field.getAttribute('autocomplete') === 'off' && field.getAttribute('spellcheck') === 'false' &&
      field.getAttribute('autocorrect') === 'off' && field.getAttribute('translate') === 'no'));
    assert.equal(hints, true);
    // Actual ECharts series produced by every panel retain their data and safe tooltip mode.
    for (const tab of ['overview', 'input', 'trend', 'analysis', 'metrics', 'rti', 'list']) {
      await page.locator(`[data-tab="${tab}"]`).click();
      if (tab === 'trend') await page.locator('#studentList li').first().click();
    }
    const chartState = await page.evaluate(() => chartIds.flatMap(id => {
      const inst = echarts.getInstanceByDom(document.getElementById(id));
      if (!inst || !inst.getOption().series?.length) return [];
      const option = inst.getOption();
      const finite = value => typeof value === 'number' ? Number.isFinite(value) :
        Array.isArray(value) ? value.every(finite) : value && typeof value === 'object' ? Object.values(value).every(finite) : true;
      return [{ id, types: option.series.map(s => s.type), safe: option.tooltip.every(t => t.renderMode === 'richText'), finite: option.series.every(s => finite(s.data)) }];
    }));
    assert.ok(chartState.length >= 7);
    for (const type of ['bar', 'line', 'boxplot', 'scatter']) assert.ok(chartState.some(c => c.types.includes(type)), type);
    assert.ok(chartState.every(c => c.safe && c.finite));
    const before = await page.evaluate(() => JSON.stringify(data));
    await page.evaluate(async () => {
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['架空']]), '指標');
      const container = XLSX.CFB.read(new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' })), { type: 'array' });
      const sheet = XLSX.CFB.find(container, '/xl/worksheets/sheet1.xml');
      sheet.content = new TextEncoder().encode(new TextDecoder().decode(sheet.content).replace('ref="A1"', 'ref="A1:XFD1048576"'));
      sheet.size = sheet.content.length;
      const bytes = XLSX.CFB.write(container, { type: 'array', fileType: 'zip', compression: true });
      try { await importMetricTemplate(new File([bytes], 'synthetic-wide.xlsx')); }
      catch (error) { window.syntheticLimitMessage = error.message; }
    });
    assert.match(await page.evaluate(() => window.syntheticLimitMessage), /上限/);
    assert.equal(await page.evaluate(() => JSON.stringify(data)), before);
    console.log('PASS v0.4.1: JSON transaction / safe options / privacy hints / ECharts 6.1 series / wide Excel rejection');
  } finally { await page.close(); }
};
