'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { pathToFileURL } = require('node:url');
const app = path.resolve(process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src'));
const output = path.resolve(process.env.QA_OUTPUT || path.join(__dirname, '..', 'test-results'));
const baseline = false;
const transport = 'file';
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'files', 'sample-data.json'), 'utf8'));
const STUDENTS = fixture.students.length;
const firstClass = fixture.students[0].className;
const scaleMetric = fixture.metrics.find(m => m.type === 'scale');
const checks = [], errors = [], externalRequests = [], dialogs = [], sampleAssociations = [];
function check(name, details = '') { checks.push({ name, status: 'pass', details }); console.log('PASS ' + name); }
(async () => {
  fs.mkdirSync(output, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}) });
    const context = await browser.newContext({ acceptDownloads: true, reducedMotion: 'reduce' });
    await context.addInitScript(() => {
      delete window.showOpenFilePicker;
      window.print = () => { window.printRequested = true; };
    });
    context.on('page', p => {
      p.on('pageerror', err => errors.push(err.message));
      p.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text() + ' ' + msg.location().url); });
      p.on('requestfailed', req => errors.push(req.url() + ': ' + req.failure()?.errorText));
      p.on('request', req => { if (!['file:', 'blob:', 'data:'].some(prefix => req.url().startsWith(prefix))) externalRequests.push(req.url()); });
      p.on('dialog', async dialog => { dialogs.push({ type: dialog.type(), text: dialog.message() }); await dialog.accept(); });
    });
    if (transport === 'file') await context.setOffline(true);
    const page = await context.newPage();
    const url = pathToFileURL(path.join(app, 'Index.html')).href;
    await page.goto(url);
    await page.screenshot({ path: path.join(output, '01-start-desktop.png'), fullPage: true });
    assert.equal(await page.locator('#emptyState').isVisible(), true);
    assert.equal(await page.title(), '成績分析ダッシュボード');
    check('起動画面とローカル資産の読込', 'file://・ネットワークオフライン');
    const load = async value => {
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#openBtnEmpty').click();
      await (await chooser).setFiles({ name: 'synthetic-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
      await page.waitForFunction(() => !!data);
    };
    const tab = async name => { await page.locator(`[data-tab="${name}"]`).click(); };
    const reset = async () => { await page.evaluate(v => applyJsonText(JSON.stringify(v), 'synthetic-test.json', null), fixture); };
    await load(fixture);
    assert.equal(await page.locator('#appMain').isVisible(), true);
    assert.equal(await page.evaluate(() => data.students.length), STUDENTS);
    const average = await page.evaluate(() => mean(studentsOf('all').map(s => getScore(s.id, ui.ovTest)).filter(r => r?.total != null).map(r => r.total)));
    assert.ok(average > 0);
    assert.ok((await page.locator('#kpiGrid').textContent()).includes(String(Math.round(average * 10) / 10)));
    check('JSON読込・概要KPI・グラフ', `60名 / 平均 ${average}`);
    for (const name of ['input', 'trend', 'analysis', 'metrics', 'rti', 'list', 'overview']) {
      await tab(name);
      assert.equal(await page.locator('#panel-' + name).isVisible(), true);
    }
    check('7タブの表示切替');
    await page.locator('#ovClass').selectOption(firstClass);
    assert.equal(await page.evaluate(() => studentsOf(ui.ovClass).length), 20);
    await page.locator('#ovSubject').selectOption('英語');
    assert.equal(await page.locator('#ovTest option').count(), 10);
    check('教科・テスト・クラスの絞り込み');
    await tab('input');
    let cell = page.locator('#scoreTableWrap input.cell-input:not(:disabled)').first();
    const key = await cell.getAttribute('data-q');
    const sid = await cell.getAttribute('data-sid');
    await cell.fill('7');
    assert.equal(await page.evaluate(({sid,key}) => getScore(sid, ui.inTest).questions[key], { sid, key }), 7);
    assert.ok((await page.locator('#saveStatus').textContent()).includes('未保存'));
    const old = await page.evaluate(({sid,key}) => getScore(sid, ui.inTest).questions[key], { sid, key });
    await cell.fill('999');
    assert.equal(await page.evaluate(({sid,key}) => getScore(sid, ui.inTest).questions[key], { sid, key }), old);
    await cell.fill('7');
    check('成績セル入力・再計算・範囲外値拒否・未保存表示');
    const row = page.locator(`#scoreTableWrap tr[data-sid="${sid}"]`);
    await row.locator('.absent-check').check();
    assert.equal(await row.locator('.cell-input').first().isDisabled(), true);
    await row.locator('.absent-check').uncheck();
    assert.equal(await row.locator('.cell-input').first().inputValue(), '7');
    check('欠席切替と得点復元');
    await cell.focus();
    await cell.evaluate(el => el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: (() => { const d = new DataTransfer(); d.setData('text/plain', '3\t4\n5\t6'); return d; })() })));
    assert.equal(await cell.inputValue(), '3');
    check('Excel複数セル貼り付け');
    await page.locator('#roleBtn').click();
    await page.locator('#adminPinInput').fill('1357');
    await page.locator('#adminSubmit').click();
    await page.waitForFunction(() => isAdmin);
    await page.locator('#addTestBtn').click();
    await page.locator('#tfName').fill('架空の追加テスト');
    await page.locator('#tfSubject').fill('理科');
    await page.locator('#testForm button[type=submit]').click();
    assert.equal(await page.evaluate(() => data.tests.some(t => t.name === '架空の追加テスト')), true);
    await page.locator('#deleteTestBtn').click();
    assert.equal(await page.evaluate(() => data.tests.some(t => t.name === '架空の追加テスト')), false);
    check('テスト追加・削除');
    await tab('trend');
    await page.locator('#trendSearch').fill('架空生徒001');
    assert.equal(await page.locator('#studentList li').count(), 1);
    await page.locator('#studentList li').first().click();
    assert.equal(await page.locator('#printKarteBtn').isEnabled(), true);
    await page.locator('#printKarteBtn').click();
    await page.waitForFunction(() => window.printRequested === true);
    const printImages = await page.locator('#printArea img').evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0));
    assert.ok(printImages);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(output, 'karte.pdf'), format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    check('個人検索・推移・面談カルテ印刷', '印刷呼出・画像デコード・PDF出力');
    await page.locator('#trendSubject').selectOption('__sum__');
    check('全教科合計の個人推移');
    await tab('analysis');
    assert.ok(await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('anBoxChart')).getOption().series.length > 0));
    check('分野分析・問題分析・箱ひげ図');
    await tab('metrics');
    assert.ok((await page.locator('#corrBanner').textContent()).length > 0);
    await page.locator('#corrX').selectOption('m:' + scaleMetric.id);
    assert.equal(await page.locator('#corrChiCard').isVisible(), true);
    assert.equal(await page.locator('#sampleAssociationNote').isVisible(), true);
    assert.match(await page.locator('#sampleAssociationNote').textContent(), /実際の教育効果や因果関係を示すものではありません/);
    await page.locator('#corrY').selectOption('t:' + fixture.tests.at(-1).id);
    for (const metric of fixture.metrics.filter(m => m.type === 'scale')) {
      await page.locator('#corrX').selectOption('m:' + metric.id);
      for (const className of ['all', ...new Set(fixture.students.map(s => s.className))]) {
        await page.locator('#metClass').selectOption(className);
        assert.ok(await page.locator('#corrChiCard').isVisible());
        const table = await page.locator('#chiTableWrap tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(c => c.textContent)));
        const result = await page.locator('#chiResult').textContent();
        const observed = table.slice(0, -1).map(row => row.slice(1, -1).map(Number));
        const n = Number(table.at(-1).at(-1));
        let chi = 0, smallExpected = 0;
        for (let i = 0; i < observed.length; i++) for (let j = 0; j < observed[0].length; j++) {
          const rowN = observed[i].reduce((a,b) => a+b, 0), colN = observed.reduce((a,row) => a+row[j], 0);
          const e = rowN * colN / n;
          if (e < 5) smallExpected++;
          chi += (observed[i][j] - e) ** 2 / e;
        }
        const v = Math.sqrt(chi / (n * Math.min(observed.length - 1, observed[0].length - 1)));
        assert.ok(result.includes('χ² = ' + chi.toFixed(2)));
        assert.ok(result.includes('V = ' + v.toFixed(2)));
        assert.ok(smallExpected > observed.length * observed[0].length * 0.2);
        assert.match(result, /人数の少ないマスが多いため、結果は参考程度/);
        if (className === 'all') {
          assert.equal(n, 59);
          assert.match(result, /関連あり（1%水準で有意）/);
          assert.ok(v > 0.45 && v < 0.75);
          await page.locator('#corrChiCard').screenshot({ path: path.join(output, `chi-${metric.id}.png`) });
        }
        sampleAssociations.push({ metric: metric.label, className, n, table, chi: Number(chi.toFixed(2)), v: Number(v.toFixed(2)), smallExpected, result });
      }
    }
    await page.locator('#metClass').selectOption('all');
    check('架空5段階デモ2項目のクロス集計・検定・効果量・全体/3クラスの期待度数警告');
    await page.locator('#addMetricBtn').click();
    await page.locator('#mfLabel').fill('架空の指標');
    await page.locator('#metricForm button[type=submit]').click();
    let metricInput = page.locator('.metric-input').first();
    await metricInput.fill('12');
    assert.equal(await page.evaluate(() => metricById(ui.metricId).values[sortedStudents()[0].id]), 12);
    await page.locator('#deleteMetricBtn').click();
    check('相関・クロス集計・カイ二乗・指標追加入力削除');
    await tab('rti');
    assert.equal(await page.locator('.rti-card').count(), await page.evaluate(() => data.students.filter(s => rtiRateFor(s.id).rate != null).length));
    await page.locator('.rti-card').first().click();
    await page.locator('#ivTitle').fill('架空の操作テスト支援');
    await page.locator('#ivStart').fill('2026-10-15');
    await page.locator('#ivForm button[type=submit]').click();
    const ivRow = page.locator('.iv-row').filter({ hasText: '架空の操作テスト支援' });
    await ivRow.locator('.iv-done-btn').click();
    assert.ok((await ivRow.textContent()).includes('完了'));
    await ivRow.locator('.iv-reopen-btn').click();
    await ivRow.locator('td').nth(3).click();
    assert.equal(await page.locator('#rtiProgressCard').isVisible(), true);
    check('RTI判定・支援追加・完了・再開・効果量と推移');
    await page.locator('#settingsBtn').click();
    await page.locator('#setTier3').fill('35');
    await page.locator('#setTier2').fill('65');
    await page.locator('#settingsForm button[type=submit]').click();
    await page.waitForFunction(() => data.settings.rti.tier3 === 35);
    await ivRow.locator('.iv-del-btn').click();
    assert.equal(await page.evaluate(() => data.interventions.some(iv => iv.title === '架空の操作テスト支援')), false);
    check('管理者PIN・設定変更・支援削除');
    await page.locator('#rosterBtn').click();
    const nameInput = page.locator('#rosterTableWrap input[data-field="name"]').first();
    await nameInput.fill('架空編集001');
    assert.equal(await page.evaluate(() => data.students.find(s => s.id === sortedStudents()[0].id).name), '架空編集001');
    const beforeScores = await page.evaluate(() => data.scores.length);
    await page.locator('[data-rtab="reassign"]').click();
    await page.locator('#reassignText').fill('架空編集001\t2A\t1');
    await page.locator('#reassignCheckBtn').click();
    await page.locator('#reassignApplyBtn').click();
    assert.equal(await page.evaluate(() => data.students.find(s => s.name === '架空編集001').className), '2A');
    assert.equal(await page.evaluate(() => data.scores.length), beforeScores);
    await page.locator('#rosterCloseBtn').click();
    check('名簿編集・クラス替え・既存成績保持');
    await reset();
    await tab('input');
    const downloadWorkbook = async button => {
      const download = page.waitForEvent('download');
      await page.locator(button).click();
      const d = await download;
      const p = path.join(output, d.suggestedFilename());
      await d.saveAs(p);
      assert.ok(fs.statSync(p).size > 500);
      return p;
    };
    await downloadWorkbook('#exportTemplateBtn');
    const tplPath = await downloadWorkbook('#newTestTplBtn');
    const XLSX = require('../src/files/vendor/xlsx.full.min.js');
    let wb = XLSX.read(fs.readFileSync(tplPath), { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    rows[0] = ['テスト名→', '架空Excel取込', '教科→', '国語', '満点→', 30, '実施学年→', 1, '実施日→', '2026-10-15'];
    rows[4][3] = 4; rows[4][4] = 5; rows[4][5] = 6;
    wb.Sheets[wb.SheetNames[0]] = XLSX.utils.aoa_to_sheet(rows);
    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
    await page.locator('#testXlsxInput').setInputFiles({ name: 'synthetic-test.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: buf });
    await page.waitForFunction(() => data.tests.some(t => t.name === '架空Excel取込'));
    assert.equal(await page.evaluate(() => getScore(sortedStudents()[0].id, data.tests.find(t => t.name === '架空Excel取込').id).total), 15);
    check('Excelテストテンプレート発行・記入・取込', '実ファイル往復 / 合計15点');
    await tab('metrics');
    const metricPath = await downloadWorkbook('#metricTplBtn');
    wb = XLSX.read(fs.readFileSync(metricPath), { type: 'buffer' });
    const mr = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    mr[1][3] = '架空Excel指標'; mr[2][3] = 4;
    wb.Sheets[wb.SheetNames[0]] = XLSX.utils.aoa_to_sheet(mr);
    await page.locator('#metricXlsxInput').setInputFiles({ name: 'synthetic-metric.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })) });
    await page.waitForFunction(() => data.metrics.some(m => m.label === '架空Excel指標'));
    assert.equal(await page.evaluate(() => data.metrics.find(m => m.label === '架空Excel指標').type), 'scale');
    check('Excel指標テンプレート発行・記入・取込・種類判定');
    await tab('list');
    await page.locator('#listMode').selectOption('rate');
    await page.locator('.list-table th[data-key="name"]').click();
    assert.equal(await page.evaluate(() => ui.listSort.key), 'name');
    await page.locator('#listHeat').uncheck();
    const listPath = await downloadWorkbook('#listExportBtn');
    assert.ok(XLSX.read(fs.readFileSync(listPath), { type: 'buffer' }).SheetNames.length > 0);
    check('データ一覧・得点率・並べ替え・色付け・Excel書出');
    const backup = await downloadWorkbook('#backupBtn');
    assert.equal(JSON.parse(fs.readFileSync(backup)).version, 3);
    const saved = await downloadWorkbook('#saveBtn');
    const savedData = JSON.parse(fs.readFileSync(saved));
    assert.equal(savedData.students.length, STUDENTS);
    const reopen = page.waitForEvent('filechooser');
    await page.locator('#openBtn').click();
    const roundtrip = path.join(output, 'roundtrip.json');
    fs.copyFileSync(saved, roundtrip);
    await (await reopen).setFiles(roundtrip);
    await page.waitForFunction(() => fileName === 'roundtrip.json');
    assert.equal(await page.evaluate(() => dirty), false);
    check('JSONダウンロード保存・再読込・日付付きバックアップ');
    await reset();
    await tab('trend');
    assert.equal(await page.locator('#studentList li').count(), STUDENTS);
    assert.equal(await page.locator('#trendSubject option').count(), 2);
    await tab('list');
    assert.equal(await page.locator('#listTableWrap tbody tr').count(), STUDENTS);
    assert.equal(await page.evaluate(() => data.tests.length), 10);
    assert.equal(await page.evaluate(() => data.scores.length), 600);
    check('60名・英語10回・600件の推移と一覧');
    for (const version of [1, 2]) {
      const legacy = {
        version, name: '架空の旧形式互換試験',
        students: [{ id: '1', name: '架空互換001', className: '架空1A' }, { id: '2', name: '架空互換002', className: '架空1A' }],
        tests: [{ id: 'legacy-test', name: '架空の旧テスト', subject: '英語', maxScore: 100, domains: [], questions: [] }],
        scores: [{ studentId: '1', testId: 'legacy-test', total: 72, domains: {}, questions: {} }, { studentId: '2', testId: 'legacy-test', total: 0, domains: {}, questions: {} }],
      };
      const legacyName = `fictional-legacy-v${version}.json`;
      const chooser = page.waitForEvent('filechooser');
      await page.locator('#openBtn').click();
      await (await chooser).setFiles({ name: legacyName, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
      await page.waitForFunction(name => fileName === name, legacyName);
      assert.equal(await page.evaluate(() => data.version), 3);
      assert.equal(await page.evaluate(() => getScore('1', 'legacy-test').total), 72);
      assert.equal(await page.evaluate(() => getScore('2', 'legacy-test').total), 0);
      assert.equal(await page.evaluate(() => data.settings.adminPinHash), null);
      const pendingDownload = page.waitForEvent('download');
      await page.locator('#saveBtn').click();
      const download = await pendingDownload, savedPath = path.join(output, legacyName);
      await download.saveAs(savedPath);
      const savedLegacy = JSON.parse(fs.readFileSync(savedPath));
      assert.equal(savedLegacy.version, 3);
      assert.equal(savedLegacy.scores[0].total, 72);
      assert.equal(savedLegacy.scores[1].total, 0);
      await page.evaluate(v => applyJsonText(JSON.stringify(v), 'fictional-reopened.json', null), savedLegacy);
      assert.equal(await page.evaluate(() => getScore('1', 'legacy-test').total), 72);
    }
    await reset();
    check('JSON v1/v2を移行して保存・再開し、生徒IDと72点/0点を保持');
    await require('./html-safety.cjs')(page, fixture);
    check('タグ入りクラス名の安全な表示・開始時基準値の境界値と不正入力拒否・現在データ保持');
    const rejectedBefore = dialogs.length;
    await page.evaluate(() => applyJsonText('{broken', 'bad.json', null));
    assert.ok(dialogs.length > rejectedBefore);
    assert.equal(await page.evaluate(() => data.students.length), STUDENTS);
    check('不正JSONを拒否して現在のデータを保持');
    const newPage = await context.newPage();
    await newPage.goto(url);
    await newPage.locator('#newBtnEmpty').click();
    await newPage.locator('.manual-roster-alternative summary').click();
    await newPage.locator('#manualRosterBtn').click();
    await newPage.locator('#nfName').fill('架空の新規データ');
    await newPage.locator('#nfRoster').fill('架空生徒001\t1A\t1\n架空生徒002\t1A\t2');
    await newPage.locator('#newForm button[type=submit]').click();
    assert.equal(await newPage.evaluate(() => data.students.length), 2);
    assert.equal(await newPage.evaluate(() => data.tests.length), 0);
    assert.equal(await newPage.evaluate(() => data.version), 3);
    assert.equal(await newPage.evaluate(() => dirty), true);
    await newPage.close();
    check('名簿からの新規作成・テスト未登録状態');
    await reset();
    await tab('overview');
    if (!baseline) {
      await page.evaluate(() => applyJsonText('null', 'null.json', null));
      assert.equal(await page.evaluate(() => data.students.length), STUDENTS);
      await page.locator('#tab-overview').focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.locator('#tab-input').getAttribute('aria-selected'), 'true');
      await tab('trend');
      await page.locator('#studentList li').first().focus();
      await page.keyboard.press('Space');
      assert.equal(await page.locator('#studentList li').first().getAttribute('aria-checked'), 'true');
      await tab('list');
      await page.locator('.sort-button').first().focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.list-table th').first().getAttribute('aria-sort'), 'ascending');
      await tab('overview');
      assert.ok(await page.locator('.chart-data tbody tr').count() > 0);
      const unnamed = await page.locator('#appMain input:not([type=hidden]), #appMain select').evaluateAll(els => els.filter(el => el.offsetParent && !el.closest('label') && !el.getAttribute('aria-label') && !document.querySelector(`label[for="${el.id}"]`)).map(el => el.outerHTML));
      assert.deepEqual(unnamed, []);
      check('キーボードタブ・生徒選択・表ソート・グラフ代替表・フォーム名');
    }
    await page.screenshot({ path: path.join(output, '02-overview-desktop.png'), fullPage: true });
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ['overview', 'input', 'trend', 'analysis', 'metrics', 'rti', 'list']) {
        await tab(name);
        if (!baseline) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px ${name} horizontal overflow`);
      }
      await tab('overview');
      await page.screenshot({ path: path.join(output, `03-overview-${width}.png`), fullPage: true });
    }
    check('320/390/768/1280pxで全7画面の表示', baseline ? '元版の比較記録' : 'ページ横はみ出しなし');
    if (!baseline) {
      const demoPage = await context.newPage();
      demoPage.on('pageerror', err => errors.push(err.message));
      await demoPage.setViewportSize({ width: 390, height: 844 });
      await demoPage.goto(url);
      await demoPage.screenshot({ path: path.join(output, '04-start-mobile.png'), fullPage: true });
      await demoPage.locator('#demoBtn').click();
      await demoPage.waitForFunction(() => data?.students?.length === 60);
      assert.ok(await demoPage.locator('#appMain').isVisible());
      await demoPage.locator('.help-link').click();
      assert.ok((await demoPage.title()).includes('使い方'));
      await demoPage.locator('a[href$="Index.html"]').first().click();
      assert.equal(await demoPage.title(), '成績分析ダッシュボード');
      check('初回サンプル導線・モバイル開始画面・使い方ガイド');
      await demoPage.close();
      if (transport === 'file') {
        assert.equal(await page.evaluate(() => supportsFS), false);
        check('file://では直接保存APIを使わずJSONをダウンロード');
      }

    }
    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    check('JavaScript実行エラーなし・外部通信なし');
    await context.close();
    const result = { mode: transport, appEntry: path.basename(app) + '/Index.html', browser: await browser.version(), checks, errors, externalRequests, dialogCount: dialogs.length, sampleAssociations };
    fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(`${checks.length} checks passed.`);
  } catch (error) {
    fs.writeFileSync(path.join(output, 'browser-failure.json'), JSON.stringify({ checks, errors, externalRequests, error: error.stack }, null, 2));
    throw error;
  } finally {
    if (browser) await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
