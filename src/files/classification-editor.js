(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const dialog = byId('classificationDialog');
  const launch = byId('editClassificationBtn');
  const core = window.GD_CLASSIFICATION_EDITOR, classifications = window.GD_CLASSIFICATION;
  if (!dialog || !launch || !core || !classifications) return;
  let session = null, prepared = null;
  const element = (tag, text, className) => { const el = document.createElement(tag); if (text != null) el.textContent = text; if (className) el.className = className; return el; };
  function input(value) { const el = element('input'); el.type = 'text'; el.value = value; el.maxLength = 200; return el; }
  function labeled(label, control) { const el = element('label', label); el.append(control); return el; }
  function status(message) { byId('ceStatus').textContent = message; }
  function domains() { return [...byId('ceDomains').children].map(row => ({ key: row.dataset.key, label: row.querySelector('input').value })); }
  function assignments() { return [...byId('ceQuestions').children].map(row => ({ key: row.dataset.key, domain: row.querySelector('.ce-domain').value, perspective: row.querySelector('.ce-perspective').value })); }
  function domainOptions(select, value, includeKeep) {
    select.replaceChildren(...(includeKeep ? [new Option('変更しない', '__keep__')] : []), new Option('未設定', ''),
      ...domains().map(d => new Option(d.label.trim() || '名前を入力してください', d.key)));
    if ([...select.options].some(o => o.value === value)) select.value = value;
  }
  function refreshDomains() {
    for (const select of byId('ceQuestions').querySelectorAll('.ce-domain')) domainOptions(select, select.value, false);
    domainOptions(byId('ceBulkDomain'), byId('ceBulkDomain').value, true);
    prepared = null;
  }
  function addDomain(key, label) {
    const row = element('div', null, 'ce-domain-row'); row.dataset.key = key;
    const field = input(label); field.setAttribute('aria-label', 'このテストの分野名'); field.addEventListener('input', refreshDomains);
    const remove = element('button', '削除', 'btn btn-ghost btn-sm'); remove.type = 'button';
    remove.addEventListener('click', () => {
      if ([...byId('ceQuestions').querySelectorAll('.ce-domain')].some(select => select.value === key)) { status('この分野に属する問題があります。先に問題の分野を選び直してください。'); return; }
      row.remove(); refreshDomains(); byId('ceAddDomain').focus();
    });
    row.append(field, remove); byId('ceDomains').append(row);
  }
  function questionRow(q) {
    const row = element('div', null, 'ce-question'); row.dataset.key = q.key;
    const select = element('input'); select.type = 'checkbox'; select.className = 'ce-select'; select.setAttribute('aria-label', `${q.label || q.key}をまとめて変更する対象に選ぶ`);
    const heading = element('div', null, 'ce-question-title'); heading.append(select, element('strong', q.label || q.key), element('span', `${q.max}点`));
    const domain = element('select', null, 'ce-domain'); domainOptions(domain, q.domain || '', false);
    const perspective = element('select', null, 'ce-perspective'); perspective.replaceChildren(...classifications.perspectives.map(p => new Option(p.label, p.key))); perspective.value = q.perspective || '';
    row.append(heading, labeled('分野', domain), labeled('評価の観点', perspective));
    return row;
  }
  function open() {
    status(''); prepared = null;
    const test = data && testById(ui.inTest);
    if (!test) { alert('先にテストを選択してください。'); return; }
    if (!test.questions?.length) { alert('問題ごとの点数がないため分類を編集できません。小問または採点する内訳を設定したテストで利用してください。'); return; }
    session = { dataset: data, token: activeDataToken, testId: test.id, original: core.fingerprint(test) };
    byId('ceTestName').textContent = `${test.name} ／ ${test.subject}`;
    byId('ceDomains').replaceChildren(); byId('ceQuestions').replaceChildren();
    const known = new Set();
    for (const d of test.domains || []) { addDomain(d.key, d.label); known.add(d.key); }
    for (const q of test.questions) if (q.domain && !known.has(q.domain)) { addDomain(q.domain, q.domain); known.add(q.domain); }
    for (const q of test.questions) byId('ceQuestions').append(questionRow(q));
    refreshDomains(); byId('ceBulkDomain').value = '__keep__'; byId('ceBulkPerspective').value = '__keep__';
    byId('ceSelectAll').checked = false; byId('ceBulk').open = false;
    byId('ceEditPane').hidden = false; byId('cePreviewPane').hidden = true;
    dialog.showModal(); (byId('ceDomains').querySelector('input') || byId('ceAddDomain')).focus();
  }
  function isCurrent() {
    const current = data && testById(session?.testId);
    return session && data === session.dataset && activeDataToken === session.token && ui.inTest === session.testId && current && core.fingerprint(current) === session.original;
  }
  function preview(event) {
    event.preventDefault(); status('');
    if (!isCurrent()) { status('対象のデータかテストが変わっています。閉じて、編集画面を開き直してください。'); return; }
    try {
      prepared = core.plan(testById(session.testId), domains(), assignments());
      if (!prepared.changes.length) { status('分類の変更はありません。'); return; }
      byId('ceChanges').replaceChildren(...prepared.changes.map(change => {
        if (change.type === 'rename') return element('li', `分野名：${change.before} → ${change.after}（${change.count}項目）`);
        return element('li', `${change.label}（${change.max}点）：分野 ${change.beforeDomain} → ${change.afterDomain} ／ 観点 ${classifications.perspectiveLabel(change.beforePerspective)} → ${classifications.perspectiveLabel(change.afterPerspective)}`);
      }));
      byId('cePreviewSummary').textContent = `${prepared.changes.length}件の変更を反映します。生徒の点数・欠席状態・問題の配点は保持します。`;
      byId('ceEditPane').hidden = true; byId('cePreviewPane').hidden = false; byId('ceApply').focus();
    } catch (error) { prepared = null; status(error.message); }
  }
  function apply() {
    if (!prepared || !isCurrent()) { status('対象のデータかテストが変わっています。閉じて、編集画面を開き直してください。'); return; }
    const previous = { data, scoreIndex, dirty, pendingDownload, ui: { ...ui }, teachingUi: window.GD_TEACHING_UI?.snapshot() };
    try {
      const next = core.candidate(data, session.testId, prepared);
      const errors = validateDataset(next);
      if (errors.length) throw new Error(errors.join('\n'));
      data = next; rebuildIndex(); renderAll(); markDirty();
      dialog.close(); alert('分類を変更しました。右上の「保存」でJSONへ保存してください。');
    } catch (error) {
      ({ data, scoreIndex, dirty, pendingDownload } = previous); Object.assign(ui, previous.ui); window.GD_TEACHING_UI?.restore(previous.teachingUi);
      try { renderAll(); updateSaveStatus(); } catch (_) { /* The restored model is retained even if rendering fails again. */ }
      status('分類は反映していません。' + error.message);
    }
  }
  launch.addEventListener('click', open);
  byId('classificationForm').addEventListener('submit', preview);
  byId('ceAddDomain').addEventListener('click', () => {
    const used = new Set(domains().map(d => d.key)); let i = 1; while (used.has('classification-domain-' + i)) i++;
    addDomain('classification-domain-' + i, ''); refreshDomains(); byId('ceDomains').lastElementChild.querySelector('input').focus();
  });
  byId('ceSelectAll').addEventListener('change', event => { for (const box of byId('ceQuestions').querySelectorAll('.ce-select')) box.checked = event.target.checked; });
  byId('ceBulkApply').addEventListener('click', () => {
    const rows = [...byId('ceQuestions').children].filter(row => row.querySelector('.ce-select').checked);
    if (!rows.length) { status('まとめて変更する問題を選んでください。'); return; }
    for (const row of rows) {
      if (byId('ceBulkDomain').value !== '__keep__') row.querySelector('.ce-domain').value = byId('ceBulkDomain').value;
      if (byId('ceBulkPerspective').value !== '__keep__') row.querySelector('.ce-perspective').value = byId('ceBulkPerspective').value;
    }
    prepared = null; status(`${rows.length}項目の編集欄を更新しました。「変更を確認」で内容を確認してください。`);
  });
  byId('ceBack').addEventListener('click', () => { prepared = null; status(''); byId('ceEditPane').hidden = false; byId('cePreviewPane').hidden = true; byId('cePreview').focus(); });
  byId('ceApply').addEventListener('click', apply);
  byId('ceClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { session = null; prepared = null; launch.focus(); });
  document.documentElement.dataset.classificationEditorInitialized = 'true';
})();
