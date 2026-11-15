/* Survey workspace. All file reads and charts stay in this browser. */
(function (root) {
  'use strict';
  const byId = id => document.getElementById(id);
  const names = {
    distribution: '回答・得点の分布', summary: '教科の平均', conditionalMean: '回答別の教科平均', crossTab: '回答と教科のクロス表',
    public: '公立', national: '国立', private: '私立', all: '国公私立合計', unknown: '未確認',
    elementary: '小学校', lowerSecondary: '中学校', upperSecondary: '高等学校',
    student: '生徒', school: '学校', percent: '%', points: '点', irtScore: 'IRTスコア', percentagePoint: 'ポイント',
    observed: '', unentered: '未入力', noResponse: '無回答', notApplicable: '対象外', notAssigned: '未出題',
    invalid: '無効回答', notParticipating: '調査不参加', notProvided: '未提供', suppressed: '秘匿',
    count: '人数', aggregateCount: '人数で入力', aggregatePercent: '割合で入力', individual: '個人別に入力',
  };
  const colors = ['#2458a6', '#278471', '#bd8a33', '#8661a7', '#a94e70', '#647d35', '#548390', '#8f6b52'];
  let host = null, knownToken = null, knownRole = null, knownData = null, request = 0;
  let officialPending = null, schoolPending = null, undoToken = null, waveId = '', groupKey = '', referenceId = '';
  let selectedReferences = new Set(), waveModes = new Map(), instance = null, ready = false;
  let workflowStep = 'official', participantGrade = null;
  let issuedWaves = new Set();

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function paragraph(parent, text, className) { parent.append(element('p', text, className)); }
  function notify(text, error) {
    byId('surveyStatus').textContent = text || '';
    byId('surveyStatus').classList.toggle('is-error', !!error);
  }
  const surveys = () => host?.getData()?.surveys || root.GD_SURVEY?.empty?.() || { schemaVersion: 1, sources: [], instruments: [], references: [], waves: [] };
  const currentWave = () => surveys().waves.find(wave => wave.id === waveId) || null;
  const display = value => names[value] || value || '未確認';
  const stamp = () => new Date().toISOString();
  const freshId = prefix => prefix + '-' + (root.crypto?.randomUUID?.() || Date.now() + '-' + Math.random().toString(16).slice(2));
  const usable = (data, ref) => instrument(data, ref.instrumentId)?.definitionStatus !== 'codesOnly';
  const benchmarkKey = (data, ref) => {
    const item = instrument(data, ref.instrumentId);
    return JSON.stringify([item.year, item.schoolLevel, item.grade, item.respondent, ref.geography.level, ref.geography.code, ref.geography.label, ref.ownership]);
  };
  function canVisit(step, available) {
    const data = surveys();
    if (step === 'official') return true;
    if (step === 'school') return !!currentWave() || (available || root.GD_SURVEY_STATE.getAvailableReferences(data)).some(ref => usable(data, ref));
    return step === 'compare' && !!data.references.length;
  }
  function showStep(step, focus = true) {
    if (!ready || !canVisit(step)) return;
    clearPreviews(); workflowStep = step; notify(''); render();
    if (step === 'school' && !currentWave()) byId('surveyWaveBuilder').open = true;
    if (focus) byId({ official: 'surveyOfficialTitle', school: 'surveyWaveTitle', compare: 'surveyImportTitle' }[step]).focus();
  }
  function renderWorkflow(available) {
    const data = surveys(), wave = currentWave(), complete = available.some(ref => usable(data, ref));
    if (!canVisit(workflowStep, available)) workflowStep = 'official';
    document.querySelectorAll('[data-survey-panel]').forEach(panel => { panel.hidden = panel.dataset.surveyPanel !== workflowStep; });
    document.querySelectorAll('[data-survey-go]').forEach(button => {
      button.disabled = !ready || !canVisit(button.dataset.surveyGo, available);
      if (button.closest('.survey-workflow')) {
        if (button.dataset.surveyGo === workflowStep) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      }
    });
    byId('surveyToCompareBtn').disabled = !wave;
    byId('surveyProgressOfficial').textContent = complete ? '公式データ取込済み' : data.references.length ? '選択肢の資料を追加' : '公式Excelを取り込む';
    byId('surveyProgressSchool').textContent = issuedWaves.has(waveId) ? 'Excel発行済み・記入する' : wave ? '発行・再発行できます' : '質問を選び、発行する';
    byId('surveyProgressCompare').textContent = wave?.results.length ? '自校の結果を表示' : '記入済みExcelを取り込む';
    byId('surveyOfficialSummary').textContent = complete ? '公式データを取り込みました。②で比較したい質問を選び、自校用Excelを準備できます。'
      : data.references.length ? '選択肢の文言を確認する資料が必要です。上の「生徒質問と教科のクロス集計」も取り込んでください。' : '';
    byId('surveySavedContext').hidden = !data.waves.length && !undoToken;
    byId('surveyImportHelp').textContent = wave ? '対象：' + wave.label + '。②で発行・記入したExcelを選び、変更内容を確認して反映します。'
      : '全国の数値だけを表示しています。自校の結果も比べる場合は、②で自校用Excelを準備してください。';
  }
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  function number(value, signed) {
    if (!numeric(value)) return '—';
    const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
    return (signed && rounded > 0 ? '+' : '') + (Object.is(rounded, -0) ? 0 : rounded).toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }
  function cellText(cell, suffix) {
    return cell?.status === 'observed' && numeric(cell.value) ? number(cell.value) + (suffix || '') : display(cell?.status || 'notProvided');
  }
  const observed = cell => cell?.status === 'observed' && numeric(cell.value) ? cell.value : null;
  const instrument = (data, id) => data.instruments.find(item => item.id === id);
  const source = (data, id) => data.sources.find(item => item.id === id);
  const categories = item => item?.scale?.kind === 'irtBand' ? item.scale.bands : item?.options || [];
  const categoryLabel = (item, code) => categories(item).find(option => option.code === code)?.label || code;
  function labelForReference(data, ref) {
    const item = instrument(data, ref.instrumentId), subject = instrument(data, ref.subjectInstrumentId);
    return [item?.code, item?.text, subject ? subject.text : null, display(ref.type), ref.geography.label, display(ref.ownership)].filter(Boolean).join(' ／ ');
  }
  function shortContext(data, ref) {
    const item = instrument(data, ref.instrumentId);
    return [(item?.year ? item.year + '年度' : '年度未確認'), display(item?.schoolLevel), ref.geography.label, display(ref.ownership), display(ref.type)].join(' ／ ');
  }
  function dataTable(parent, headers, rows, caption) {
    const table = element('table');
    if (caption) table.append(element('caption', caption));
    const head = table.createTHead().insertRow();
    headers.forEach(text => { const th = element('th', text); th.scope = 'col'; head.append(th); });
    const body = table.createTBody();
    rows.forEach(cells => {
      const row = body.insertRow();
      cells.forEach((text, index) => {
        const cell = element(index === 0 ? 'th' : 'td', text);
        if (!index) cell.scope = 'row';
        if (headers[index]?.startsWith('差')) cell.className = 'survey-difference';
        row.append(cell);
      });
    });
    parent.append(table);
    return table;
  }
  function messages(parent, values) {
    if (!values?.length) return;
    const list = element('ul');
    values.forEach(value => list.append(element('li', typeof value === 'string' ? value : value.message)));
    parent.append(list);
  }
  function definitionList(parent, rows) {
    const dl = element('dl');
    rows.forEach(([label, value]) => { dl.append(element('dt', label), element('dd', value)); });
    parent.append(dl);
  }
  function clearChart() {
    if (instance) instance.clear();
    byId('surveyChart').hidden = true;
  }
  function clearPreviews() {
    request++;
    officialPending = null; schoolPending = null;
    for (const prefix of ['Official', 'School']) {
      byId('survey' + prefix + 'Preview').replaceChildren();
      byId('survey' + prefix + 'Preview').hidden = true;
      byId('survey' + prefix + 'ApplyBtn').hidden = true;
      byId('survey' + prefix + 'ApplyBtn').disabled = true;
    }
    byId('surveyModeSwitchLabel').hidden = true;
    byId('surveyModeSwitch').checked = false;
    byId('surveyOfficialOpenBtn').disabled = !ready;
    byId('surveyTemplateBtn').disabled = !ready || !currentWave();
    byId('surveySchoolOpenBtn').disabled = !ready || !currentWave();
  }
  function contextChanged() {
    if (!host) return;
    const token = host.getDataToken(), role = host.getRole(), data = host.getData();
    if (token === knownToken && role === knownRole && data === knownData) return;
    const switched = token !== knownToken || data !== knownData;
    knownToken = token; knownRole = role; knownData = data;
    clearPreviews();
    if (switched) {
      undoToken = null; selectedReferences = new Set(); waveModes = new Map(); issuedWaves = new Set(); groupKey = ''; referenceId = ''; participantGrade = null;
      waveId = data?.surveys?.waves?.at(-1)?.id || '';
      const wave = data?.surveys?.waves?.at(-1);
      workflowStep = wave?.results?.length ? 'compare' : wave || ready && canVisit('school') ? 'school' : 'official';
      byId('surveyWaveLabel').value = ''; byId('surveyWaveDate').value = '';
      byId('surveyWaveSchoolLabel').value = '自校'; byId('surveyWaveOwnership').value = 'public';
      byId('surveyParticipantScope').replaceChildren();
      byId('surveyWaveSearch').value = ''; byId('surveyQuestionSearch').value = '';
      byId('surveyTypeFilter').value = 'all'; byId('surveySchoolLabel').value = '自校';
      byId('surveySchoolOwnership').value = 'public'; byId('surveyInputMode').value = 'count'; byId('surveyTemplateMode').value = 'count';
      byId('surveyTemplateScope').value = 'all';
      byId('surveyBenchmarkGroup').replaceChildren(); byId('surveyWavePurpose').value = 'distribution';
      byId('surveyWaveBuilder').open = !data?.surveys?.waves?.length;
      notify(''); clearChart();
    }
  }
  function capture() { return { request: ++request, data: host.getData(), token: host.getDataToken(), role: host.getRole(), waveId }; }
  function stillCurrent(ticket, checkWave) {
    return ticket.request === request && ticket.data === host.getData() && ticket.token === host.getDataToken() && ticket.role === host.getRole() && (!checkWave || ticket.waveId === waveId);
  }
  function commit(next, undo) {
    const errors = root.GD_SURVEY.validate(next);
    if (errors.length) throw new Error(errors.join('\n'));
    const previousUndo = undoToken;
    undoToken = undo || null;
    clearPreviews();
    try { host.commitSurveys(next); }
    catch (error) { undoToken = previousUndo; throw error; }
  }
  function previewError(target, error) {
    target.replaceChildren(element('h4', 'まだ反映していません'));
    target.classList.add('is-error'); target.hidden = false;
    messages(target, Array.isArray(error) ? error : [error?.message || 'ファイルを読み込めませんでした。']);
  }
  function summaryText(summary) {
    return '追加 ' + (summary.added || 0) + '件 ／ 更新 ' + (summary.updated || 0) + '件 ／ 変更なし ' + (summary.unchanged || 0) + '件';
  }
  async function readOfficial(files) {
    if (!ready || workflowStep !== 'official' || !host.getData() || !files.length) return;
    clearPreviews(); const ticket = capture();
    byId('surveyOfficialOpenBtn').disabled = true; notify('公式Excelを読み取り、年度・対象・表の内容を確認しています…');
    try {
      const parsed = await root.GD_SURVEY_IMPORT.parseOfficialFiles(files, { XLSX: root.XLSX, importedAt: stamp() });
      if (!stillCurrent(ticket)) return;
      const plan = root.GD_SURVEY_STATE.prepareReferences(surveys(), parsed.candidate);
      const preview = byId('surveyOfficialPreview'); preview.replaceChildren(); preview.hidden = false; preview.classList.remove('is-error');
      preview.append(element('h4', '読み取った資料を確認してください'));
      paragraph(preview, summaryText(plan.summary));
      if (plan.summary.promoted) paragraph(preview, '追加分のうち' + plan.summary.promoted + '件は、選択肢の文言を確認した新しい版です。作成済みの調査回は、元の版を使い続けます。');
      const wrap = element('div', undefined, 'table-wrap');
      dataTable(wrap, ['ファイル・資料', '年度・学校段階', '地域・設置者', '読み取った表'], parsed.candidate.sources.map(item => {
        const refs = parsed.candidate.references.filter(ref => ref.sourceId === item.id);
        return [item.fileName || item.title,
          [...new Set(refs.map(ref => { const def = instrument(parsed.candidate, ref.instrumentId); return (def?.year || '未確認') + '年度・' + display(def?.schoolLevel); }))].join('、'),
          [...new Set(refs.map(ref => ref.geography.label + '・' + display(ref.ownership)))].join('、'),
          [...new Set(refs.map(ref => display(ref.type)))].join('、') + '（' + refs.length + '件）'];
      }));
      preview.append(wrap); messages(preview, parsed.warnings.map(warning => warning.code === 'codesOnly'
        ? { ...warning, message: '回答結果集計のExcelには、選択肢の文言が掲載されていません。取込済みの対応資料も含めて定義を確認します。文言を確認できない質問が残る場合は、同年度のクロス集計または選択肢別平均の公式Excelを追加してください。' }
        : warning));
      const details = element('details'); details.append(element('summary', '利用できる質問・教科を確認（' + parsed.candidate.references.length + '件）'));
      const items = element('div', undefined, 'table-wrap');
      dataTable(items, ['質問・教科', '表の種類', '対象'], parsed.candidate.references.map(ref => [instrument(parsed.candidate, ref.instrumentId)?.text || ref.instrumentId, display(ref.type), ref.geography.label + '・' + display(ref.ownership)]));
      details.append(items); preview.append(details);
      officialPending = { ticket, plan };
      byId('surveyOfficialApplyBtn').hidden = false; byId('surveyOfficialApplyBtn').disabled = false;
      notify('資料はまだ追加していません。対象と注意事項を確認してから反映してください。');
    } catch (error) {
      if (!stillCurrent(ticket)) return;
      previewError(byId('surveyOfficialPreview'), error); notify('公式Excelを追加できませんでした。作業中のデータは保持しています。', true);
    } finally { if (stillCurrent(ticket)) byId('surveyOfficialOpenBtn').disabled = false; }
  }
  function applyOfficial() {
    if (!officialPending || !stillCurrent(officialPending.ticket)) { clearPreviews(); notify('表示が切り替わったため、公式Excelを選び直してください。', true); return; }
    try {
      const result = root.GD_SURVEY_STATE.apply(surveys(), officialPending.plan);
      const promoted = result.summary.promoted || 0;
      commit(result.surveys, result.undo);
      if (canVisit('school')) showStep('school');
      byId('surveyWaveBuilder').open = !currentWave();
      notify('公式資料を追加しました。' + (promoted ? '選択肢を確認した新しい版' + promoted + '件を、新しい調査回の候補に表示しています。' : '') + '学校用Excelを作る場合は、使う質問・教科と実施日を選んでください。');
    } catch (error) { notify(error.message, true); }
  }
  function renderWaveGroups(available) {
    const data = surveys(), select = byId('surveyBenchmarkGroup'), previous = select.value, grouped = new Map();
    for (const ref of available) if (!grouped.has(benchmarkKey(data, ref))) grouped.set(benchmarkKey(data, ref), ref);
    select.replaceChildren();
    for (const [key, ref] of grouped) {
      const item = instrument(data, ref.instrumentId), option = element('option', [item.year ? item.year + '年度' : '年度未確認', display(item.schoolLevel), item.grade ? item.grade + '年' : '学年未確認', ref.geography.label, display(ref.ownership)].join(' ／ '));
      option.value = key; select.append(option);
    }
    if (grouped.has(previous)) select.value = previous;
    else select.value = [...grouped].find(([, ref]) => ref.ownership === 'public')?.[0] || grouped.keys().next().value || '';
    const types = new Set(available.filter(ref => benchmarkKey(data, ref) === select.value).map(ref => ref.type)), purpose = byId('surveyWavePurpose');
    for (const option of purpose.options) option.disabled = option.value !== 'all' && !types.has(option.value);
    if (purpose.selectedOptions[0]?.disabled) purpose.value = [...purpose.options].find(option => !option.disabled)?.value || 'all';
  }
  function filteredWaveReferences(available) {
    const data = surveys(), query = byId('surveyWaveSearch').value.trim().toLocaleLowerCase('ja-JP');
    const group = byId('surveyBenchmarkGroup').value, purpose = byId('surveyWavePurpose').value;
    return (available || root.GD_SURVEY_STATE.getAvailableReferences(data)).filter(ref => benchmarkKey(data, ref) === group && (purpose === 'all' || ref.type === purpose) &&
      (!query || labelForReference(data, ref).toLocaleLowerCase('ja-JP').includes(query)));
  }
  function renderWaveItems(available) {
    const data = surveys(), list = byId('surveyWaveItems'); list.replaceChildren();
    available ||= root.GD_SURVEY_STATE.getAvailableReferences(data);
    renderWaveGroups(available);
    const availableIds = new Set(available.filter(ref => usable(data, ref)).map(ref => ref.id));
    selectedReferences = new Set([...selectedReferences].filter(id => availableIds.has(id)));
    const refs = filteredWaveReferences(available);
    refs.forEach(ref => {
      const item = instrument(data, ref.instrumentId), label = element('label'), check = element('input'); check.type = 'checkbox';
      check.value = ref.id; check.checked = selectedReferences.has(ref.id);
      check.disabled = !usable(data, ref);
      for (const [key, value] of [['autocomplete', 'off'], ['spellcheck', 'false'], ['translate', 'no']]) check.setAttribute(key, value);
      const text = element('span', (item?.code ? item.code + '　' : '') + (item?.text || '質問・教科'));
      text.append(element('small', shortContext(data, ref) + (ref.subjectInstrumentId ? ' ／ ' + instrument(data, ref.subjectInstrumentId)?.text : '')));
      if (item?.schoolAvailability === 'notReturned') text.append(element('small', '学校への返却対象外。公式実施の学校値は「未提供」で扱います。'));
      if (check.disabled) text.append(element('small', '選択肢を未確認です。①で対応する公式資料を追加してください。'));
      label.append(check, text); list.append(label);
      check.addEventListener('change', () => { if (check.checked) selectedReferences.add(ref.id); else selectedReferences.delete(ref.id); updateSelectionCount(); });
    });
    if (!refs.length) paragraph(list, data.references.length ? '条件に合う質問・教科はありません。' : '公式資料を追加すると、ここから選べます。', 'survey-small');
    byId('surveySelectVisibleBtn').disabled = !refs.some(ref => usable(data, ref));
    byId('surveyWaveAvailability').textContent = 'この一覧から比較したい質問を選びます。' + (available.some(ref => !usable(data, ref)) ? '選択肢が未確認の質問は、①で対応する資料を追加すると選べます。' : '');
    updateSelectionCount();
  }
  function updateSelectionCount() {
    byId('surveySelectedCount').textContent = selectedReferences.size + '件選択';
    byId('surveyCreateWaveBtn').disabled = !ready || !selectedReferences.size;
    byId('surveyClearSelectionBtn').disabled = !selectedReferences.size;
    updateModeNote();
  }
  function rosterParticipants() {
    return (host.getData()?.students || []).filter(student => student.enrollmentStatus !== 'graduated').map(student => {
      const parts = root.GD_IMPORT?.splitClassName(student.className || ''), explicit = /^(\d{1,2})年/.exec(student.className || '');
      const grade = parts?.grade ? Number(parts.grade) : explicit ? Number(explicit[1]) : null;
      return { id: student.id, name: student.name || null, grade: Number.isInteger(grade) && grade >= 1 && grade <= 12 ? grade : null,
        className: student.className || null, number: student.number === '' || student.number == null ? null : String(student.number) };
    });
  }
  function selectedGrade() {
    const data = surveys(), definitions = [...selectedReferences].map(id => data.references.find(ref => ref.id === id))
      .filter(Boolean).map(ref => instrument(data, ref.instrumentId));
    if (!definitions.length || definitions.some(item => !item?.grade || item.schoolLevel === 'unknown')) return null;
    const groups = new Set(definitions.map(item => item.schoolLevel + ':' + item.grade));
    return groups.size === 1 ? definitions[0].grade : null;
  }
  function participantSnapshot() {
    const values = rosterParticipants(), scope = byId('surveyParticipantScope').value;
    if (scope === 'matching') return values.filter(person => person.grade === selectedGrade());
    if (scope === 'all') return values;
    if (scope.startsWith('class:')) return values.filter(person => (person.className || '') === scope.slice(6));
    return [];
  }
  function updateModeNote() {
    const individual = byId('surveyInputMode').value === 'individual';
    byId('surveyParticipantControls').hidden = !individual;
    byId('surveyParticipantsNote').textContent = individual
      ? '対象の人数・所属を確認してください。選択した在籍者のIDと所属を調査回に固定し、その後の名簿変更では変えません。'
      : '集計値だけの入力では、生徒名簿は不要です。空欄は0人・0%として扱いません。';
    if (!individual) return;
    const values = rosterParticipants(), grade = selectedGrade(), select = byId('surveyParticipantScope'), previous = select.value;
    select.replaceChildren();
    const choice = (value, label) => { const option = element('option', label); option.value = value; select.append(option); };
    choice('', '人数・所属を確認して対象を選択してください');
    if (grade !== null) choice('matching', '資料と同じ学年：' + grade + '年（' + values.filter(person => person.grade === grade).length + '名）');
    choice('all', '全在籍者（' + values.length + '名）');
    const classes = [...new Set(values.map(person => person.className || ''))].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }));
    classes.forEach(klass => choice('class:' + klass, (klass || '所属未設定') + '（' + values.filter(person => (person.className || '') === klass).length + '名）'));
    if ([...select.options].some(option => option.value === previous) && !(previous === 'matching' && participantGrade !== grade)) select.value = previous;
    else select.value = '';
    participantGrade = grade;
    renderParticipantPreview();
  }
  function renderParticipantPreview() {
    const target = byId('surveyParticipantPreview'), participants = participantSnapshot(), grade = selectedGrade(); target.replaceChildren();
    if (!byId('surveyParticipantScope').value) { paragraph(target, '対象を明示的に選択してから調査回を作成してください。'); return; }
    paragraph(target, 'この調査回に固定する対象：' + participants.length + '名');
    if (!participants.length) { paragraph(target, '該当する在籍者がいません。対象を選び直すか、学校の集計値を入力する方式を選んでください。'); return; }
    const counts = new Map();
    participants.forEach(person => { const label = person.className || '所属未設定'; counts.set(label, (counts.get(label) || 0) + 1); });
    const wrap = element('div', undefined, 'table-wrap'); dataTable(wrap, ['対象の所属', '人数'], [...counts].map(([label, count]) => [label, count + '名'])); target.append(wrap);
    if (grade === null || participants.some(person => person.grade !== grade)) paragraph(target, '資料と異なる学年、または学年未確認の対象を含みます。結果は参考表示となり、差を計算できない場合があります。');
  }
  function createWave(event) {
    event.preventDefault();
    if (!ready || !host.getData() || !selectedReferences.size) return;
    const previous = { waveId, groupKey, referenceId, templateMode: byId('surveyTemplateMode').value };
    try {
      const incomplete = [...selectedReferences].map(id => surveys().references.find(ref => ref.id === id))
        .some(ref => instrument(surveys(), ref.instrumentId)?.definitionStatus === 'codesOnly');
      if (incomplete) throw new Error('選択肢の文言が未確認の質問が含まれています。同年度のクロス集計または選択肢別平均の公式Excelを追加してください。定義を確認できた質問は、新しい版を選んで調査回を作成できます。');
      const mode = byId('surveyInputMode').value;
      const selected = surveys().references.find(ref => selectedReferences.has(ref.id)), year = instrument(surveys(), selected.instrumentId)?.year;
      const input = { id: freshId('survey-wave'), label: byId('surveyWaveLabel').value.trim() || [year && year + '年度', '全国学力・学習状況調査', byId('surveyWaveDate').value].filter(Boolean).join(' '), administeredOn: byId('surveyWaveDate').value,
        administration: byId('surveyAdministration').value, referenceIds: [...selectedReferences],
        schoolLabel: byId('surveyWaveSchoolLabel').value.trim(), ownership: byId('surveyWaveOwnership').value };
      if (mode === 'individual') {
        if (!byId('surveyParticipantScope').value) throw new Error('個人別入力の対象を選択し、人数と所属を確認してください。');
        input.participants = participantSnapshot();
        if (!input.participants.length) throw new Error('選択した対象に該当する在籍者がいません。対象を選び直すか、学校の集計値を入力する場合は「人数」または「割合」を選んでください。');
      }
      const result = root.GD_SURVEY_STATE.createWave(surveys(), input);
      waveId = result.waveId; waveModes.set(waveId, mode); byId('surveyTemplateMode').value = mode; groupKey = ''; referenceId = '';
      commit(result.surveys, undoToken);
      byId('surveyWaveBuilder').open = false;
      notify('自校用Excelの準備ができました。下の「自校用Excelをダウンロード」を押し、黄色の欄に自校の結果を記入してください。');
      byId('surveyTemplateBtn').focus();
    } catch (error) {
      if (!surveys().waves.some(wave => wave.id === waveId)) {
        waveModes.delete(waveId); waveId = previous.waveId; groupKey = previous.groupKey; referenceId = previous.referenceId;
        byId('surveyTemplateMode').value = previous.templateMode;
      }
      notify(error.message, true);
    }
  }
  function templateMode() { return { count: 'aggregateCount', percent: 'aggregatePercent', individual: 'individual' }[byId('surveyTemplateMode').value]; }
  async function issueTemplate() {
    const wave = currentWave(); if (!wave || !ready) return;
    clearPreviews(); const ticket = capture();
    byId('surveyTemplateBtn').disabled = true; notify('選択中の調査回に合う学校用Excelを作っています…');
    try {
      const scope = byId('surveyTemplateScope').value === 'selected' ? [byId('surveyTemplateReference').value].filter(id => wave.referenceIds.includes(id)) : wave.referenceIds.slice();
      if (!scope.length) throw new Error('Excelへ入れる質問・教科を下の一覧から選択してください。');
      if (scope.some(id => {
        const ref = surveys().references.find(item => item.id === id);
        return instrument(surveys(), ref.instrumentId)?.definitionStatus === 'codesOnly';
      })) throw new Error('この調査回は、選択肢の文言を確認する前の版に固定されています。対応する公式資料を追加し、確認済みの版を選んだ新しい調査回を作成してください。');
      const result = await root.GD_SURVEY_TEMPLATES.buildTemplate(surveys(), wave.id, { mode: templateMode(), scope: { referenceIds: scope },
        school: { label: byId('surveySchoolLabel').value.trim() || '自校', ownership: byId('surveySchoolOwnership').value }, ExcelJS: root.ExcelJS, XLSX: root.XLSX });
      if (!stillCurrent(ticket, true)) return;
      const blob = new Blob([result.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob), link = element('a'); link.href = url; link.download = result.fileName;
      document.body.append(link); link.click(); link.remove(); root.setTimeout(() => URL.revokeObjectURL(url), 60000);
      waveModes.set(waveId, byId('surveyTemplateMode').value);
      issuedWaves.add(waveId); showStep('compare');
      notify('自校用Excelをダウンロードしました。黄色の欄に結果を記入して保存し、この③の「記入済みの自校用Excelを選ぶ」から読み込んでください。');
    } catch (error) { if (stillCurrent(ticket, true)) notify(error.message, true); }
    finally { if (stillCurrent(ticket, true)) byId('surveyTemplateBtn').disabled = false; }
  }
  async function readSchool(file) {
    const wave = currentWave(); if (!ready || workflowStep !== 'compare' || !wave) return;
    clearPreviews(); const ticket = capture();
    byId('surveySchoolOpenBtn').disabled = true; notify('学校用Excelの対象範囲と変更内容を確認しています…');
    try {
      if (!Number.isFinite(file.size) || file.size <= 0 || file.size > root.GD_SURVEY_TEMPLATES.limits.fileBytes) throw new Error('学校用Excelの容量が上限を超えているか、ファイルが空です。発行した学校用Excelを選んでください。');
      const bytes = await file.arrayBuffer();
      if (!stillCurrent(ticket, true)) return;
      const parsed = await root.GD_SURVEY_TEMPLATES.parseTemplate(bytes, surveys(), wave.id, { fileName: file.name, XLSX: root.XLSX });
      if (!stillCurrent(ticket, true)) return;
      if (!parsed.ok) { previewError(byId('surveySchoolPreview'), parsed.errors); notify('学校結果は反映していません。Excelの案内した箇所を確認してください。', true); return; }
      const plan = parsed.plan;
      if (!plan) throw new Error('学校結果の変更範囲を確認できませんでした。学校用Excelを選び直してください。');
      const preview = byId('surveySchoolPreview'); preview.replaceChildren(); preview.hidden = false; preview.classList.remove('is-error');
      preview.append(element('h4', '学校結果の変更を確認してください'));
      paragraph(preview, '調査回：' + wave.label + ' ／ ' + file.name);
      paragraph(preview, summaryText(plan.summary));
      paragraph(preview, '入力された数値 ' + (parsed.preview?.observedCount || 0) + '項目 ／ 空欄 ' + (parsed.preview?.blankCount || 0) + '項目 ／ 欠測状態 ' + (parsed.preview?.missingCount || 0) + '項目');
      paragraph(preview, 'このExcelの入力対象範囲を反映します。対象範囲内で空欄にした学校値は未入力に戻ります。対象外の質問・教科は保持します。');
      const before = root.GD_SURVEY_STATE.getLatest(surveys(), wave.id), changes = [];
      for (const value of parsed.payload.results || []) {
        const prior = before.find(item => item.instrumentId === value.instrumentId && item.type === value.type && item.subjectInstrumentId === value.subjectInstrumentId);
        const oldFields = rawFields(prior), fields = rawFields(value);
        for (const [key, cell] of fields) {
          const old = oldFields.get(key);
          if (JSON.stringify(old) === JSON.stringify(cell)) continue;
          changes.push([(instrument(surveys(), value.instrumentId)?.code || '') + ' ' + key, old ? cellText(old) : '未登録', cellText(cell)]);
        }
      }
      const wrap = element('div', undefined, 'table-wrap');
      dataTable(wrap, ['対象・項目', '反映前', '反映後'], changes.length ? changes : [['変更する数値はありません', '—', '—']], '入力対象範囲の変更（' + changes.length + '項目）'); preview.append(wrap);
      messages(preview, parsed.preview?.warnings);
      const switches = plan.summary.modeChanges || [];
      if (switches.length) {
        paragraph(preview, '以下の統計の採用元が変わります。個人別と集計値は同じ対象について加算しません。');
        messages(preview, switches.map(change => (change.key || '学校結果') + '：' + display(change.from) + ' → ' + display(change.to)));
      }
      byId('surveyModeSwitchLabel').hidden = !switches.length;
      schoolPending = { ticket, plan, requiresSwitch: !!switches.length };
      byId('surveySchoolApplyBtn').hidden = false; byId('surveySchoolApplyBtn').disabled = !!switches.length;
      notify('学校結果はまだ反映していません。変更する値と空欄に戻る項目を確認してください。');
    } catch (error) {
      if (!stillCurrent(ticket, true)) return;
      previewError(byId('surveySchoolPreview'), error); notify('学校結果を反映できませんでした。作業中のデータは保持しています。', true);
    } finally { if (stillCurrent(ticket, true)) byId('surveySchoolOpenBtn').disabled = false; }
  }
  function applySchool() {
    if (!schoolPending || !stillCurrent(schoolPending.ticket, true)) { clearPreviews(); notify('表示が切り替わったため、学校用Excelを選び直してください。', true); return; }
    if (schoolPending.requiresSwitch && !byId('surveyModeSwitch').checked) return;
    try {
      const result = root.GD_SURVEY_STATE.apply(surveys(), schoolPending.plan, { allowModeSwitch: byId('surveyModeSwitch').checked });
      commit(result.surveys, result.undo);
      notify('学校結果を反映しました。図と表で確認し、右上の「保存」でJSONを保存してください。');
      byId('surveyResultTitle').focus();
    } catch (error) { notify(error.message, true); }
  }
  function rawFields(stat) {
    const fields = new Map(); if (!stat) return fields;
    fields.set('対象人数', stat.denominator.count);
    if (stat.type === 'summary') { fields.set('平均', stat.mean); fields.set('標準偏差', stat.standardDeviation); }
    else if (stat.type === 'distribution') stat.values.forEach(row => { fields.set(row.code, row.value); if (row.publishedPercent) fields.set(row.code + '・掲載割合', row.publishedPercent); });
    else if (stat.type === 'conditionalMean') {
      stat.values.forEach(row => { fields.set(row.code + '・人数', row.count); fields.set(row.code + '・平均', row.mean); fields.set(row.code + '・標準偏差', row.standardDeviation); });
      if (stat.total) { fields.set('合計・人数', stat.total.count); fields.set('合計・平均', stat.total.mean); fields.set('合計・標準偏差', stat.total.standardDeviation); }
    } else if (stat.type === 'crossTab') {
      stat.groups.forEach(group => { fields.set('群' + group.code + '・人数', group.count); if (group.publishedPercent) fields.set('群' + group.code + '・掲載割合', group.publishedPercent); });
      stat.rows.forEach(row => {
        fields.set(row.code + '・人数', row.count); if (row.publishedPercent) fields.set(row.code + '・掲載割合', row.publishedPercent);
        row.values.forEach(value => { fields.set(row.code + ' × ' + value.code, value.value); if (value.publishedPercent) fields.set(row.code + ' × ' + value.code + '・掲載割合', value.publishedPercent); });
      });
    }
    return fields;
  }
  function availableReferences() {
    const data = surveys(), wave = currentWave();
    return wave ? data.references.filter(ref => wave.referenceIds.includes(ref.id)) : root.GD_SURVEY_STATE.getAvailableReferences(data);
  }
  const keyFor = ref => [ref.instrumentId, ref.type, ref.subjectInstrumentId || ''].join('|');
  function groups() {
    const data = surveys(), query = byId('surveyQuestionSearch').value.trim().toLocaleLowerCase('ja-JP'), type = byId('surveyTypeFilter').value;
    const grouped = new Map();
    for (const ref of availableReferences()) {
      if (type !== 'all' && ref.type !== type || query && !labelForReference(data, ref).toLocaleLowerCase('ja-JP').includes(query)) continue;
      const key = keyFor(ref); if (!grouped.has(key)) grouped.set(key, []); grouped.get(key).push(ref);
    }
    return grouped;
  }
  function renderQuestions() {
    const data = surveys(), grouped = groups(), list = byId('surveyQuestionList'); list.replaceChildren();
    if (!grouped.has(groupKey)) { groupKey = grouped.keys().next().value || ''; referenceId = ''; }
    byId('surveyQuestionCount').textContent = grouped.size + '項目';
    for (const [key, refs] of grouped) {
      const ref = refs[0], item = instrument(data, ref.instrumentId), subject = instrument(data, ref.subjectInstrumentId);
      const button = element('button', undefined, 'survey-question-item'); button.type = 'button'; button.setAttribute('aria-pressed', String(key === groupKey));
      button.append(element('strong', (item?.code || '') + '　' + display(ref.type)), element('span', item?.text || ref.instrumentId));
      button.append(element('small', subject?.text || (item?.year || '未確認') + '年度・' + display(item?.schoolLevel)));
      button.addEventListener('click', () => { groupKey = key; referenceId = ''; renderQuestions(); renderResult(); }); list.append(button);
    }
    const refs = grouped.get(groupKey) || [], select = byId('surveyReferenceSelect'); select.replaceChildren();
    if (!refs.some(ref => ref.id === referenceId)) referenceId = refs[0]?.id || '';
    refs.forEach(ref => { const option = element('option', ref.geography.label + ' ／ ' + display(ref.ownership) + ' ／ ' + (source(data, ref.sourceId)?.fileName || '資料') + '・第' + ref.version + '版'); option.value = ref.id; select.append(option); });
    select.value = referenceId;
  }
  function render() {
    if (!host || !host.getData()) return;
    contextChanged(); if (!ready) return;
    const data = surveys(), wave = currentWave(), select = byId('surveyWaveSelect'); select.replaceChildren();
    const available = root.GD_SURVEY_STATE.getAvailableReferences(data);
    const referenceOnly = element('option', '全国のデータだけを見る'); referenceOnly.value = ''; select.append(referenceOnly);
    data.waves.forEach(item => { const option = element('option', item.label + '（' + item.administeredOn + '）'); option.value = item.id; select.append(option); }); select.value = waveId;
    byId('surveyPreparationSummary').textContent = '公式資料 ' + data.sources.filter(item => item.kind === 'official').length + '件 ／ 学校データ ' + data.waves.length + '回';
    byId('surveyNoReferences').hidden = !!data.references.length;
    byId('surveyComparisonWorkspace').hidden = !data.references.length;
    byId('surveyUndoBtn').hidden = !undoToken;
    byId('surveyWaveContext').textContent = wave ? wave.administeredOn + '実施 ／ ' + (wave.administration === 'official' ? '公式実施' : '自校で独自に実施') + (wave.participants ? ' ／ 対象者 ' + wave.participants.length + '名を固定' : ' ／ 集計値を入力') : '全国のデータを表示します。';
    byId('surveyTemplateBtn').disabled = !wave;
    byId('surveySchoolOpenBtn').disabled = !wave;
    byId('surveyTemplateMode').disabled = !wave;
    byId('surveyTemplateScope').disabled = !wave;
    byId('surveySchoolOwnership').disabled = !!wave && !!wave.ownership && wave.ownership !== 'unknown';
    byId('surveySchoolLabel').readOnly = !!wave?.schoolLabel;
    if (wave?.ownership) byId('surveySchoolOwnership').value = wave.ownership;
    if (wave?.schoolLabel) byId('surveySchoolLabel').value = wave.schoolLabel;
    byId('surveyTemplateMode').querySelector('option[value="individual"]').disabled = !wave?.participants?.length;
    byId('surveyTemplateNote').textContent = wave ? '発行対象：' + wave.label + '。' + (wave.participants?.length ? '個人別入力では、ここで固定した対象者を使います。' : '質問・選択肢は記入済みで、自校の入力欄は空欄です。') : '比較する質問と実施日を設定してください。';
    byId('surveyTemplateCard').hidden = !wave;
    byId('surveyWaveBuilderLabel').textContent = wave ? '別の学校データを準備する' : '比較する質問と実施日を設定';
    const referenceSelect = byId('surveyTemplateReference'), previousReference = referenceSelect.value;
    referenceSelect.replaceChildren();
    (wave?.referenceIds || []).forEach(id => {
      const ref = data.references.find(item => item.id === id), option = element('option', labelForReference(data, ref)); option.value = id; referenceSelect.append(option);
    });
    referenceSelect.value = wave?.referenceIds.includes(previousReference) ? previousReference : wave?.referenceIds.includes(referenceId) ? referenceId : wave?.referenceIds[0] || '';
    byId('surveyTemplateReferenceLabel').hidden = byId('surveyTemplateScope').value !== 'selected';
    renderWorkflow(available);
    if (workflowStep === 'school') renderWaveItems(available);
    if (workflowStep === 'compare') { renderQuestions(); renderResult(); }
    else clearChart();
  }
  function percent(stat, code) {
    const row = stat?.values?.find(row => row.code === code), cell = row?.value, value = observed(cell);
    if (stat?.basis === 'count' && observed(row?.publishedPercent) !== null) return observed(row.publishedPercent);
    if (value === null) return null;
    if (stat.basis === 'percent') return value;
    const count = observed(stat.denominator.count);
    return count !== null && count > 0 ? 100 * value / count : null;
  }
  function formatPercent(stat, code) {
    if (!stat) return '未入力';
    const value = percent(stat, code), cell = stat.values.find(row => row.code === code)?.value;
    return value === null ? (cell?.status === 'observed' ? '割合を算出できません' : cellText(cell)) : number(value) + '%';
  }
  function setChart(option, height) {
    const node = byId('surveyChart'); node.hidden = false; node.style.height = (height || 290) + 'px';
    if (!root.echarts) { node.hidden = true; return; }
    instance ||= root.echarts.init(node, 'gd');
    option.animation = false; option.aria = { enabled: true, decal: { show: true } };
    option.tooltip = { trigger: 'axis', renderMode: 'richText', ...option.tooltip };
    option.textStyle = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Yu Gothic UI', sans-serif", color: '#536276' };
    instance.setOption(option, true); instance.resize();
  }
  function meanUnit(item) { return display(item?.scale?.unit); }
  function resultStatus(result, reference) {
    if (result) return root.GD_SURVEY.compare(surveys(), { waveId, resultId: result.id, referenceId: reference.id });
    const reasons = [{ message: 'この表の学校結果はまだありません。学校用Excelを読み込むと、自校の値を並べて確認できます。' }];
    if (reference.observationUnit === 'unknown') reasons.push({ message: '元資料の観測単位（生徒・学校）を確認できていないため、差は計算しません。' });
    return { status: 'referenceOnly', reasons, notices: [], differences: null };
  }
  function renderResult() {
    clearChart();
    if (workflowStep !== 'compare') return;
    const data = surveys(), ref = data.references.find(item => item.id === referenceId), wave = currentWave();
    byId('surveyResultEmpty').hidden = !!ref; byId('surveyResultContent').hidden = !ref;
    if (!ref) return;
    const item = instrument(data, ref.instrumentId), subject = instrument(data, ref.subjectInstrumentId);
    const school = wave ? root.GD_SURVEY_STATE.getLatest(data, wave.id, { instrumentId: ref.instrumentId, type: ref.type, ...(ref.subjectInstrumentId ? { subjectInstrumentId: ref.subjectInstrumentId } : {}) }) : null;
    const comparison = resultStatus(school, ref), decision = byId('surveyComparisonDecision'); decision.replaceChildren(); decision.dataset.status = comparison.status;
    paragraph(decision, comparison.status === 'comparable' ? '同じ定義で比較できます。差は「自校 − 比較先」です。' : comparison.status === 'blocked' ? 'この組み合わせは比較できません。' : '参考として表示しています。差は計算しません。');
    messages(decision, comparison.reasons); messages(decision, comparison.notices);
    if (item?.schoolAvailability === 'notReturned' && (!wave || wave.administration === 'official')) paragraph(decision, 'この質問は学校への返却対象外です。学校値は「未提供」のままで利用できます。自校で独自に実施した回答は、別の調査回へ記録してください。');
    byId('surveyResultType').textContent = display(ref.type) + (subject ? ' ／ ' + subject.text : '');
    byId('surveyResultTitle').textContent = (item?.code ? item.code + '　' : '') + (item?.text || '質問・教科');
    const context = byId('surveyChartContext'); context.replaceChildren();
    const entries = [
      ['資料の年度・対象', (item?.year ? item.year + '年度' : '年度未確認') + ' ／ ' + display(item?.schoolLevel) + (item?.grade ? ' ' + item.grade + '年' : '') + ' ／ ' + display(ref.observationUnit)],
      ['比較先', ref.geography.label + ' ／ ' + display(ref.ownership)],
      ['自校', school ? school.geography.label + ' ／ ' + display(school.ownership) + ' ／ ' + school.population.definition : wave ? (wave.schoolLabel || '自校') + ' ／ ' + display(wave.ownership) + ' ／ 学校結果は未入力' : '調査回は未選択'],
      ['実施日・範囲', wave ? wave.administeredOn + ' ／ ' + (wave.administration === 'official' ? '公式実施' : '独自実施') + ' ／ この調査回に固定した質問・教科' : '比較先の公開値を表示'],
    ];
    entries.forEach(([label, value]) => context.append(element('dt', label), element('dd', value)));
    const table = byId('surveyTable'); table.replaceChildren(); byId('surveyChartNote').textContent = '';
    if (ref.type === 'distribution') renderDistribution(table, item, school, ref, comparison);
    else if (ref.type === 'summary') renderSummary(table, item, school, ref, comparison);
    else if (ref.type === 'conditionalMean') renderConditional(table, item, subject, school, ref, comparison);
    else if (ref.type === 'crossTab') renderCross(table, item, subject, school, ref, comparison);
    renderDetails(data, school, ref, wave);
  }
  function renderDistribution(table, item, school, ref, comparison) {
    const options = categories(item), diffs = comparison.status === 'comparable' ? comparison.differences?.values : null;
    const singleSchool = school?.observationUnit === 'school' && school.geography.level === 'school';
    const schoolValue = code => {
      if (!singleSchool) return formatPercent(school, code);
      const cell = school.values.find(row => row.code === code)?.value;
      return observed(cell) === null ? cellText(cell) : cell.value > 0 ? '自校の回答' : '—';
    };
    dataTable(table, ['選択肢', '自校', ref.geography.label, '差（ポイント）'], options.map(option => [option.label, schoolValue(option.code), formatPercent(ref, option.code), number(diffs?.find(row => row.code === option.code)?.difference, true)]), singleSchool ? '自校の回答と、比較先で同じ回答をした学校の割合。' : '回答・得点の割合。差は割合の差（ポイント）です。');
    byId('surveyChartNote').textContent = singleSchool ? '学校質問では、自校の回答を表に示し、グラフには比較先の学校割合を表示します。' : '公表値の丸めは補正していません。人数から割合を求めるときは、この表の対象人数を使います。';
    if (comparison.status === 'blocked') return;
    const seriesRows = [[singleSchool ? null : school, school?.geography.label || '自校'], [ref, ref.geography.label]].filter(([stat]) => stat && options.every(option => percent(stat, option.code) !== null));
    if (!seriesRows.length) { byId('surveyChartNote').textContent += ' 欠測を含むため、グラフは表示せず表で確認できます。'; return; }
    if (seriesRows.length < (school && !singleSchool ? 2 : 1)) byId('surveyChartNote').textContent += ' 一部が欠測の系列はグラフに表示していません。';
    if (!ref.partition || school && !school.partition) {
      setChart({ color: colors, legend: { bottom: 0 }, grid: { left: 10, right: 30, top: 25, bottom: 65, containLabel: true },
        xAxis: { type: 'value', min: 0, max: 100, name: '%' }, yAxis: { type: 'category', data: options.map(option => option.label), axisLabel: { width: 200, overflow: 'truncate' } },
        series: seriesRows.map(([stat, label]) => ({ name: label, type: 'bar', data: options.map(option => percent(stat, option.code)), barMaxWidth: 24 })) }, Math.max(280, options.length * 52));
    } else {
      setChart({ color: colors, legend: { bottom: 0, type: 'scroll', data: options.map(option => option.label) },
        grid: { left: 12, right: 28, top: 25, bottom: 90, containLabel: true },
        xAxis: { type: 'value', min: 0, max: 100, name: '%' }, yAxis: { type: 'category', data: seriesRows.map(row => row[1]), inverse: true },
        series: options.map((option, index) => ({ name: option.label, type: 'bar', stack: 'response', barMaxWidth: 42, itemStyle: { color: colors[index % colors.length] },
          label: { show: true, position: 'inside', formatter: params => params.value >= 7 ? number(params.value) + '%' : '', color: '#fff', fontSize: 11 },
          data: seriesRows.map(([stat]) => percent(stat, option.code)) })) }, 260);
    }
  }
  function renderSummary(table, item, school, ref, comparison) {
    const unit = meanUnit(item), difference = comparison.status === 'comparable' ? comparison.differences?.difference : null;
    dataTable(table, ['項目', '自校', ref.geography.label, '差（' + (comparison.differences ? display(comparison.differences.unit) : unit) + '）'],
      [['平均', school ? cellText(school.mean, ' ' + unit) : '未入力', cellText(ref.mean, ' ' + unit), number(difference, true)]], '同じ尺度の学校平均と公開平均');
    byId('surveyChartNote').textContent = '平均は掲載された尺度で表示しています。IRTスコアと平均正答率は別の尺度です。';
    if (comparison.status === 'blocked') return;
    const rows = [[school, school?.geography.label || '自校'], [ref, ref.geography.label]].filter(([stat]) => observed(stat?.mean) !== null);
    if (rows.length) setChart({ color: colors, grid: { left: 12, right: 35, top: 40, bottom: 20, containLabel: true },
      xAxis: { type: 'category', data: rows.map(row => row[1]) }, yAxis: { type: 'value', name: unit, min: item.scale.minimum ?? undefined, max: item.scale.kind === 'percentCorrect' ? 100 : undefined },
      series: [{ name: '平均', type: 'bar', barMaxWidth: 70, data: rows.map(([stat], index) => ({ value: observed(stat.mean), itemStyle: { color: colors[index] } })), label: { show: true, position: 'top', formatter: params => number(params.value) } }] });
  }
  function renderConditional(table, item, subject, school, ref, comparison) {
    const unit = meanUnit(subject), diffs = comparison.status === 'comparable' ? comparison.differences?.values : null;
    const rows = ref.values.map(value => { const ownRow = school?.values.find(row => row.code === value.code); return [categoryLabel(item, value.code), ownRow ? cellText(ownRow.mean) : '未入力', cellText(value.mean), number(diffs?.find(row => row.code === value.code)?.difference, true), ownRow ? cellText(ownRow.count, '人') : '未入力', cellText(value.count, '人')]; });
    dataTable(table, ['回答', '自校平均', ref.geography.label + '平均', '差（' + (comparison.differences ? display(comparison.differences.unit) : unit) + '）', '自校人数', '比較先人数'], rows, '回答ごとの教科平均（' + unit + '）。人数が未掲載の場合は「未提供」と表示します。');
    byId('surveyChartNote').textContent = '回答した群ごとの平均です。回答と教科結果の関連を示すもので、因果関係を示しません。';
    if (comparison.status === 'blocked') return;
    if (!subject || subject.scale.unit === 'unknown' || subject.scale.kind === 'unknown') { byId('surveyChartNote').textContent += ' 尺度の単位を確認できないためグラフは表示しません。'; return; }
    const values = [[school, school?.geography.label || '自校'], [ref, ref.geography.label]].filter(([stat]) => stat && stat.values.some(value => observed(value.mean) !== null));
    if (values.length) setChart({ color: colors, legend: { bottom: 0 }, grid: { left: 12, right: 35, top: 40, bottom: 80, containLabel: true },
      xAxis: { type: 'category', data: ref.values.map(value => categoryLabel(item, value.code)), axisLabel: { width: 100, overflow: 'break', interval: 0 } },
      yAxis: { type: 'value', name: unit, min: subject.scale.minimum ?? undefined, max: subject.scale.kind === 'percentCorrect' ? 100 : undefined },
      series: values.map(([stat, label]) => ({ name: label, type: 'bar', barMaxWidth: 35, data: ref.values.map(value => observed(stat.values.find(row => row.code === value.code)?.mean)) })) }, 340);
  }
  function crossPercent(stat, rowCode, groupCode) {
    if (!stat) return null;
    const row = stat.rows.find(value => value.code === rowCode), cell = row?.values.find(value => value.code === groupCode);
    if (observed(cell?.publishedPercent) !== null) return observed(cell.publishedPercent);
    const value = observed(cell?.value); if (value === null) return null;
    if (stat.basis === 'percent') return value;
    const denominator = stat.normalization === 'column' ? observed(stat.groups.find(value => value.code === groupCode)?.count) : stat.normalization === 'row' ? observed(row?.count) : observed(stat.denominator.count);
    return denominator !== null && denominator > 0 ? 100 * value / denominator : null;
  }
  function renderCross(table, item, subject, school, ref, comparison) {
    const normalization = { column: '教科の各群内における回答の割合', row: '各回答内における教科の群の割合', total: '表全体の対象者に対する割合' }[ref.normalization] || '割合の分母は未確認';
    const rows = [];
    ref.rows.forEach(row => ref.groups.forEach(group => {
      const left = crossPercent(school, row.code, group.code), right = crossPercent(ref, row.code, group.code);
      const raw = row.values.find(value => value.code === group.code);
      const delta = comparison.status === 'comparable' ? comparison.differences?.rows?.find(value => value.code === row.code)?.values?.find(value => value.code === group.code)?.difference : null;
      rows.push([categoryLabel(item, row.code), group.label, left === null ? (school ? '未提供' : '未入力') : number(left) + '%', right === null ? cellText(raw?.value) : number(right) + '%', number(delta, true)]);
    }));
    dataTable(table, ['回答', '教科の群', '自校', ref.geography.label, '差（ポイント）'], rows, (subject?.text || '教科') + ' ／ ' + normalization);
    byId('surveyChartNote').textContent = normalization + '。実際に対応付けられた公開クロス表を表示しています。学校の回答分布だけからクロス表は作成しません。';
    if (comparison.status === 'blocked' || ref.normalization !== 'column') return;
    const options = ref.rows.filter(row => ref.groups.every(group => crossPercent(ref, row.code, group.code) !== null));
    if (options.length !== ref.rows.length) return;
    setChart({ color: colors, legend: { bottom: 0, type: 'scroll' }, grid: { left: 10, right: 30, top: 25, bottom: 85, containLabel: true },
      xAxis: { type: 'value', min: 0, max: 100, name: '%' }, yAxis: { type: 'category', data: ref.groups.map(group => ref.geography.label + ' ' + group.label), inverse: true },
      series: options.map(row => ({ name: categoryLabel(item, row.code), type: 'bar', stack: 'cross', barMaxWidth: 30, data: ref.groups.map(group => crossPercent(ref, row.code, group.code)) })) }, Math.max(280, ref.groups.length * 45 + 120));
  }
  function renderDetails(data, school, ref, wave) {
    const details = byId('surveySourceDetails'); details.replaceChildren();
    for (const [label, stat] of [['比較先', ref], ['自校', school]]) {
      if (!stat) continue;
      const origin = source(data, stat.sourceId);
      details.append(element('h4', label + '：' + stat.geography.label + ' ／ ' + display(stat.ownership)));
      definitionList(details, [
        ['観測単位', display(stat.observationUnit)], ['対象条件', stat.population.definition || '未確認'],
        ['分母の定義', stat.denominator.definition || '未確認'], ['対象人数', cellText(stat.denominator.count, stat.observationUnit === 'school' ? '校' : '人')],
        ['資料・学校結果', origin?.title || '未確認'], ['発行元', origin?.publisher || '未確認'], ['ファイル', origin?.fileName || '未記録'],
        ['取込日時', origin?.importedAt || '未記録'], ['結果の版', String(stat.version || stat.revision || 1)],
      ]);
      if (origin?.url && /^https?:\/\//i.test(origin.url)) {
        const link = element('a', '公式の出典を開く（オンライン・別タブ）'); link.href = origin.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; details.append(link);
      }
      const definition = instrument(data, stat.instrumentId);
      if (definition?.locations?.length) paragraph(details, '質問・選択肢の掲載箇所：' + definition.locations.map(location => (source(data, location.sourceId)?.fileName || '') + ' ／ ' + location.sheet + ' ' + location.range).join(' ／ '));
      if (origin?.locations?.length) {
        const allLocations = element('details'); allLocations.append(element('summary', '資料全体のシート範囲'));
        paragraph(allLocations, origin.locations.map(location => location.sheet + ' ' + location.range).join(' ／ ')); details.append(allLocations);
      }
      if (origin?.fingerprint) paragraph(details, 'ファイル指紋：' + (typeof origin.fingerprint === 'string' ? origin.fingerprint : JSON.stringify(origin.fingerprint)) + '（内容の識別用です）');
      messages(details, [...(origin?.notes || []), ...stat.notes]);
      const wrap = element('div', undefined, 'table-wrap');
      dataTable(wrap, ['項目', '元の値', '欠測状態', '掲載箇所'], [...rawFields(stat)].map(([key, cell]) => [key,
        cell?.provenance?.raw !== undefined && cell.provenance.raw !== null ? String(cell.provenance.raw) : cell?.status === 'observed' ? String(cell.value) : '—',
        cell?.status === 'observed' ? '掲載・入力あり' : display(cell?.status || 'notProvided'),
        cell?.provenance ? cell.provenance.sheet + ' ' + cell.provenance.range + (cell.provenance.derivation === 'sum' ? '（掲載人数の合計）' : '') : '—']), label + 'の元の掲載値・入力値'); details.append(wrap);
    }
    if (wave) paragraph(details, 'この調査回の質問・比較先は作成時の版に固定しています。通常の名簿の進級・卒業・削除では、保存済みの学校結果は変わりません。');
  }
  function attach(api) {
    if (host) return;
    host = api;
    ready = !!(root.GD_SURVEY && root.GD_SURVEY_STATE && typeof root.GD_SURVEY_STATE.getAvailableReferences === 'function' && root.GD_SURVEY_IMPORT && root.GD_SURVEY_TEMPLATES && root.XLSX);
    byId('surveyUnavailable').hidden = ready;
    byId('surveyStartBtn').disabled = !ready;
    byId('surveyOfficialOpenBtn').disabled = !ready;
    byId('surveyStartBtn').onclick = () => { if (ready) host.startAggregate(); };
    byId('surveyOfficialOpenBtn').onclick = () => byId('surveyOfficialInput').click();
    byId('surveyOfficialInput').onchange = event => { const files = [...event.target.files]; event.target.value = ''; if (files.length) readOfficial(files); };
    byId('surveyOfficialApplyBtn').onclick = applyOfficial;
    byId('surveyWaveForm').onsubmit = createWave;
    document.querySelectorAll('[data-survey-go]').forEach(button => { button.onclick = () => showStep(button.dataset.surveyGo); });
    byId('surveyViewOfficialBtn').onclick = () => {
      waveId = ''; groupKey = ''; referenceId = ''; showStep('compare');
    };
    byId('surveyWaveSearch').oninput = () => renderWaveItems();
    for (const id of ['surveyBenchmarkGroup', 'surveyWavePurpose']) byId(id).onchange = () => { clearPreviews(); selectedReferences.clear(); renderWaveItems(); };
    byId('surveySelectVisibleBtn').onclick = () => { filteredWaveReferences().filter(ref => usable(surveys(), ref)).forEach(ref => selectedReferences.add(ref.id)); renderWaveItems(); };
    byId('surveyClearSelectionBtn').onclick = () => { selectedReferences.clear(); renderWaveItems(); };
    byId('surveyInputMode').onchange = () => { clearPreviews(); updateModeNote(); };
    byId('surveyParticipantScope').onchange = renderParticipantPreview;
    byId('surveyTemplateMode').onchange = () => { clearPreviews(); if (waveId) waveModes.set(waveId, byId('surveyTemplateMode').value); };
    byId('surveyTemplateScope').onchange = () => { clearPreviews(); byId('surveyTemplateReferenceLabel').hidden = byId('surveyTemplateScope').value !== 'selected'; };
    byId('surveyTemplateReference').onchange = clearPreviews;
    byId('surveyTemplateBtn').onclick = issueTemplate;
    byId('surveySchoolOpenBtn').onclick = () => byId('surveySchoolInput').click();
    byId('surveySchoolInput').onchange = event => { const file = event.target.files[0]; event.target.value = ''; if (file) readSchool(file); };
    byId('surveySchoolApplyBtn').onclick = applySchool;
    byId('surveyModeSwitch').onchange = () => { byId('surveySchoolApplyBtn').disabled = !schoolPending || schoolPending.requiresSwitch && !byId('surveyModeSwitch').checked; };
    for (const id of ['surveySchoolLabel', 'surveySchoolOwnership']) byId(id).addEventListener('input', clearPreviews);
    byId('surveyWaveSelect').onchange = event => {
      clearPreviews(); waveId = event.target.value; groupKey = ''; referenceId = '';
      if (!currentWave()) byId('surveyWaveBuilder').open = true;
      byId('surveyTemplateMode').value = waveModes.get(waveId) || (currentWave()?.participants?.length ? 'individual' : 'count'); render();
    };
    byId('surveyQuestionSearch').oninput = () => { renderQuestions(); renderResult(); };
    byId('surveyTypeFilter').onchange = () => { renderQuestions(); renderResult(); };
    byId('surveyReferenceSelect').onchange = event => { referenceId = event.target.value; renderResult(); };
    byId('surveyUndoBtn').onclick = () => {
      if (!undoToken) return;
      try { const result = root.GD_SURVEY_STATE.undo(surveys(), undoToken); commit(result.surveys); notify('直前の調査の取り込みを取り消しました。通常テストや指導メモは変更していません。'); }
      catch (error) { notify(error.message, true); }
    };
    root.addEventListener('resize', () => { if (!byId('surveyChart').hidden) instance?.resize(); });
    contextChanged(); document.documentElement.dataset.surveyInitialized = ready ? 'true' : 'false';
  }
  root.GD_SURVEY_UI = Object.freeze({ attach, render, contextChanged });
})(window);
