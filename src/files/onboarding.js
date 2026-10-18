'use strict';

(() => {
  const byId = id => document.getElementById(id);
  let pending = null;

  function openSetup() {
    pending = null;
    byId('initialPreview').hidden = true;
    byId('initialPreview').replaceChildren();
    byId('initialApplyBtn').hidden = true;
    byId('initialApplyBtn').disabled = true;
    byId('initialXlsxInput').value = '';
    byId('setupDialog').showModal();
  }
  byId('newBtnEmpty').onclick = openSetup;
  byId('startFirstHeader').onclick = openSetup;
  byId('setupCancelBtn').onclick = () => byId('setupDialog').close();
  byId('manualRosterBtn').onclick = () => {
    byId('setupDialog').close();
    byId('newDialog').showModal();
  };
  byId('initialTemplateBtn').onclick = () => {
    const workbook = window.GD_INITIAL.createTemplate(XLSX);
    XLSX.writeFile(workbook, '初回登録テンプレート.xlsx');
    alert('初回登録用Excelをダウンロードしました。\n\n「初回登録」シートの4行目から、A列にクラス・B列に出席番号・C列に氏名を貼り付けます。\n名簿だけならD列の点数は空欄で構いません。\n最初の点数も登録する場合は、2行目のテスト名などとD列の合計点を記入します。\n\n保存したら「② 記入したExcelを読み込む」で選んでください。');
  };
  byId('initialImportBtn').onclick = () => byId('initialXlsxInput').click();

  function paragraph(text, parent) {
    const el = document.createElement('p');
    el.textContent = text;
    parent.append(el);
  }
  function showPlan(plan) {
    const preview = byId('initialPreview');
    preview.replaceChildren();
    preview.hidden = false;
    const errors = plan.errors || [];
    preview.classList.toggle('is-error', errors.length > 0);
    const title = document.createElement('h3');
    title.textContent = errors.length ? 'まだ登録していません。Excelを確認してください' : '登録内容を確認してください';
    preview.append(title);
    if (errors.length) {
      const list = document.createElement('ul');
      errors.slice(0, 12).forEach(message => {
        const li = document.createElement('li');
        li.textContent = message;
        list.append(li);
      });
      preview.append(list);
      if (errors.length > 12) paragraph(`ほか ${errors.length - 12}件あります。`, preview);
    } else {
      const d = plan.dataset;
      paragraph(`データ名：${d.name} ／ 生徒 ${d.students.length}名 ／ ${new Set(d.students.map(s => s.className)).size}クラス`, preview);
      const scores = d.scores.filter(r => !r.absent && r.total != null).length;
      const absent = d.scores.filter(r => r.absent).length;
      if (d.tests.length) {
        paragraph(`初回テスト：${d.tests[0].name}（${d.tests[0].subject}・${d.tests[0].maxScore}点満点）`, preview);
        paragraph(`点数 ${scores}名 ／ 欠席 ${absent}名 ／ 未入力 ${d.students.length - scores - absent}名。空欄は0点にしません。`, preview);
      } else {
        paragraph('名簿だけを登録します。テストや点数は作成しません。登録後に名簿入りExcelを発行して追加できます。', preview);
      }
      (plan.warnings || []).forEach(message => paragraph(message, preview));
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      const table = document.createElement('table');
      const heading = table.createTHead().insertRow();
      for (const label of ['クラス', '出席番号', '氏名']) {
        const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; heading.append(th);
      }
      const body = table.createTBody();
      d.students.slice(0, 10).forEach(student => {
        const row = body.insertRow();
        [student.className, student.number, student.name].forEach(value => { row.insertCell().textContent = String(value); });
      });
      wrap.append(table); preview.append(wrap);
      if (d.students.length > 10) paragraph('名簿の先頭10名を表示しています。', preview);
      paragraph('内容が正しければ「確認した内容で登録」を押してください。まだ現在のデータは変更していません。', preview);
    }
    byId('initialApplyBtn').hidden = errors.length > 0;
    byId('initialApplyBtn').disabled = errors.length > 0;
  }
  byId('initialXlsxInput').onchange = async event => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    pending = null;
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const plan = window.GD_INITIAL.planWorkbook(workbook, XLSX);
      showPlan(plan);
      if (!plan.errors.length) pending = plan;
    } catch {
      showPlan({ errors: ['Excelを読み込めませんでした。初回登録用テンプレートを使い、.xlsx形式で保存してから選び直してください。'] });
    }
  };
  byId('initialApplyBtn').onclick = () => {
    if (!pending?.dataset) return;
    if (data && !confirm('今開いているデータを置き換えて、新しい名簿を登録します。\n必要な変更は先にJSONへ保存してください。\n\n確認した名簿で新しく始めますか？')) return;
    applyJsonText(JSON.stringify(pending.dataset), 'seiseki-data.json', null);
    markDirty();
    pending = null;
    byId('setupDialog').close();
    document.querySelector('[data-tab="overview"]').click();
    updatePrepare();
    byId('prepareTitle').tabIndex = -1;
    byId('prepareTitle').focus();
  };

  function selectTab(name) { document.querySelector(`[data-tab="${name}"]`).click(); }
  byId('prepareTestTemplateBtn').onclick = () => { if (data) { selectTab('input'); issueNewTestTemplate(); } };
  byId('prepareTestImportBtn').onclick = () => { if (data) { selectTab('input'); byId('testXlsxInput').click(); } };
  byId('prepareMetricTemplateBtn').onclick = () => { if (data) { selectTab('metrics'); issueMetricTemplate(); } };
  byId('prepareMetricImportBtn').onclick = () => { if (data) { selectTab('metrics'); byId('metricXlsxInput').click(); } };
  byId('prepareAnalyzeBtn').onclick = () => { if (data) selectTab(data.tests.length ? 'overview' : 'metrics'); };

  function updatePrepare() {
    if (!data) return;
    const count = data.students.length;
    const tests = data.tests.length;
    const metrics = data.metrics.length;
    const text = `登録済み：生徒 ${count}名 ／ テスト ${tests}回 ／ アンケートなど ${metrics}項目`;
    if (byId('prepareStatus').textContent !== text) byId('prepareStatus').textContent = text;
    byId('prepareStep1').classList.toggle('is-complete', count > 0);
    byId('prepareStep2').classList.toggle('is-current', count > 0 && !tests && !metrics);
    byId('prepareStep2').classList.toggle('is-complete', tests + metrics > 0);
    byId('prepareStep3').classList.toggle('is-current', tests + metrics > 0);
    ['prepareTestTemplateBtn', 'prepareTestImportBtn', 'prepareMetricTemplateBtn', 'prepareMetricImportBtn'].forEach(id => { byId(id).disabled = count === 0; });
    byId('prepareAnalyzeBtn').disabled = !tests && !metrics;
  }
  new MutationObserver(updatePrepare).observe(document.body, { childList: true, subtree: true });
  updatePrepare();
  // 起動処理と同梱の主要資産が揃った場合だけ、HTML内の復旧案内を閉じます。
  if (document.documentElement.dataset.dashboardInitialized === 'true'
      && document.documentElement.dataset.accessibilityInitialized === 'true'
      && window.echarts && window.XLSX && window.GD_IMPORT && window.GD_INITIAL
      && window.GRADE_DASHBOARD_SAMPLE
      && getComputedStyle(document.documentElement).getPropertyValue('--dashboard-style-loaded').trim() === '1') {
    byId('startupHelp').hidden = true;
  }
})();
