/* School survey workbooks. Local files only; parsing never changes application state. */
(function (root, factory) {
  'use strict';
  const api = factory(root, typeof require === 'function' ? require : null);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_SURVEY_TEMPLATES = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root, requireLocal) {
  'use strict';
  const version = 1;
  // These budgets belong to school templates, independently of official and ordinary imports.
  const limits = Object.freeze({ fileBytes: 5 * 1024 * 1024, expandedBytes: 24 * 1024 * 1024,
    entryBytes: 12 * 1024 * 1024, entries: 256, sheets: 8, rows: 50000, columns: 32, cells: 500000 });
  const modes = Object.freeze(['aggregateCount', 'aggregatePercent', 'individual']);
  const names = Object.freeze({ help: '書き方', manifest: '発行情報', definitions: '設問定義', aggregate: '集計入力', individual: '個人入力' });
  const missingLabels = Object.freeze({ 未入力: 'unentered', 無回答: 'noResponse', 対象外: 'notApplicable',
    未出題: 'notAssigned', 無効回答: 'invalid', 調査不参加: 'notParticipating', 未提供: 'notProvided', 秘匿: 'suppressed', 不明: 'unknown' });
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const clone = value => JSON.parse(JSON.stringify(value));
  const blank = value => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
  const missing = (status = 'unentered') => ({ value: null, status, decimals: null });
  const keyOf = s => [s.instrumentId, s.type, s.subjectInstrumentId || ''].join('|');
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function stable(value) {
    if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
    return JSON.stringify(value);
  }
  function dependencies(options = {}) {
    const get = (name, path) => options[name] || root[name] || (requireLocal && requireLocal(path));
    return { core: get('GD_SURVEY', './survey-core.js'), state: get('GD_SURVEY_STATE', './survey-state.js'),
      safety: get('GD_SURVEY_IMPORT', './survey-import.js'), X: get('XLSX', './vendor/xlsx.full.min.js'),
      ExcelJS: get('ExcelJS', './vendor/exceljs.min.js') };
  }
  async function digest(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    const crypto = root.crypto || globalThis.crypto;
    if (!crypto?.subtle) throw new Error('このブラウザではテンプレートの整合性を検査できません。最新のChromeまたはEdgeを使用してください。');
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  }
  function uniqueId(prefix) {
    const crypto = root.crypto || globalThis.crypto;
    if (!crypto?.randomUUID) throw new Error('テンプレート取込に必要な識別子を生成できません。最新のChromeまたはEdgeを使用してください。');
    return prefix + '-' + crypto.randomUUID();
  }
  function schoolOptions(value, wave) {
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('自校の集計対象を指定してください。');
    const school = { label: value?.label ?? wave?.schoolLabel ?? '自校', ownership: value?.ownership ?? wave?.ownership ?? 'unknown', code: value?.code ?? null };
    if (typeof school.label !== 'string' || !school.label.trim() || school.label.length > 1000 ||
        !['public', 'national', 'private', 'unknown'].includes(school.ownership) ||
        (school.code !== null && (typeof school.code !== 'string' || !school.code.trim() || school.code.length > 1000))) throw new Error('自校名と設置者区分を確認してください。');
    if (wave?.ownership && wave.ownership !== 'unknown' && wave.ownership !== school.ownership) throw new Error('学校の設置者区分がこの調査回と一致しません。調査回の設定を確認してください。');
    return school;
  }
  function context(surveys, waveId, options, core) {
    const errors = core.validate(surveys);
    if (errors.length) throw new Error('調査データを確認してください。' + errors.slice(0, 3).join(' '));
    const wave = surveys.waves.find(w => w.id === waveId);
    if (!wave) throw new Error('対象の調査回がありません。');
    if (!modes.includes(options.mode)) throw new Error('人数・割合・個人別の入力方式を選んでください。');
    const selected = options.scope?.referenceIds ?? wave.referenceIds;
    if (!Array.isArray(selected) || !selected.length || selected.length > 1000 ||
        selected.some(id => typeof id !== 'string' || !wave.referenceIds.includes(id)) || new Set(selected).size !== selected.length) throw new Error('この調査回で固定した比較対象を1つ以上選んでください。');
    const references = selected.map(id => surveys.references.find(r => r.id === id));
    const ids = [...new Set(references.flatMap(r => [r.instrumentId, r.subjectInstrumentId].filter(Boolean)))];
    const instruments = ids.map(id => surveys.instruments.find(i => i.id === id));
    if (instruments.some(i => !i || !wave.instrumentIds.includes(i.id))) throw new Error('この調査回の設問・教科の定義が一致しません。');
    if (instruments.some(i => i.definitionStatus === 'codesOnly')) throw new Error('選択肢の原文が不足しています。対応するクロス集計または選択肢別平均の公式Excelを追加してから発行してください。');
    if (options.mode === 'individual') {
      if (!Array.isArray(wave.participants) || !wave.participants.length) throw new Error('個人別入力には、調査時点の対象者を固定した調査回が必要です。');
      if (references.some(r => r.type === 'crossTab')) throw new Error('四分位クロス集計は個人別テンプレートの対象から外してください。質問の回答分布・教科平均・選択肢別平均を選べます。学校の四分位を全国の群へ割り当てることはできません。');
      for (const instrument of instruments) {
        const kind = instrument.scale.kind;
        if (kind !== 'response' && kind !== 'rawScore' && !(kind === 'percentCorrect' && Number.isSafeInteger(instrument.rawScoreMaximum))) {
          throw new Error(instrument.text + '：個人別の入力には対応していません。IRTは公式に返却された平均を集計値用Excelへ転記してください。');
        }
      }
      if (wave.participants.length * instruments.length + 7 > limits.rows) throw new Error('個人別テンプレートの行数上限を超えます。発行する質問・教科を減らしてください。');
    }
    const statistics = [...new Map(references.map(r => [keyOf(r), r])).values()];
    return { wave, references, instruments, statistics, school: schoolOptions(options.school, wave),
      scope: { referenceIds: [...selected], instrumentIds: ids } };
  }
  async function signatures(surveys, ctx, mode) {
    const { wave, references, instruments, statistics } = ctx;
    const sourceIds = new Set(references.map(r => r.sourceId));
    const definition = { schemaVersion: surveys.schemaVersion, wave: { id: wave.id, label: wave.label,
      administeredOn: wave.administeredOn, administration: wave.administration, ownership: wave.ownership ?? null, schoolLabel: wave.schoolLabel ?? null }, instruments,
      references, sources: surveys.sources.filter(s => sourceIds.has(s.id)) };
    const replaced = new Set(wave.results.map(r => r.supersedes).filter(Boolean));
    const keys = new Set(statistics.map(keyOf));
    const latest = wave.results.filter(r => !replaced.has(r.id) && keys.has(keyOf(r))).sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
    const responseIds = new Set(latest.map(r => r.responseSetId).filter(Boolean));
    return { datasetSignature: await digest(stable(definition)),
      resultSignature: await digest(stable({ results: latest, responseSets: (wave.responseSets || []).filter(s => responseIds.has(s.id)) })),
      participantSignature: await digest(stable(mode === 'individual' ? wave.participants : null)) };
  }
  function unit(instrument) {
    return ({ percent: '%', points: '点', correctCount: '問', category: '回答コード', irtScore: 'IRTスコア' })[instrument.scale.unit] || instrument.scale.unit;
  }
  function inputUnit(instrument) {
    return instrument.scale.kind === 'percentCorrect' ? '正答数（0〜' + instrument.rawScoreMaximum + '問）' :
      instrument.scale.kind === 'response' ? '選択肢コード' : '素点（' + instrument.scale.minimum + '〜' + instrument.scale.maximum + '）';
  }
  function categoryLabel(instrument, code) {
    return (instrument.options.length ? instrument.options : instrument.scale.bands).find(o => o.code === code)?.label || code;
  }
  function resultBase(reference, school, mode) {
    const result = clone(reference);
    delete result.version; delete result.publishedPercent; delete result.responseSetId;
    result.id = uniqueId('school-result'); result.sourceId = ''; result.revision = 1; result.supersedes = null;
    result.geography = { level: 'school', code: school.code, label: school.label }; result.ownership = school.ownership;
    result.denominator.count = missing();
    result.notes = ['学校用Excelの' + (mode === 'aggregateCount' ? '人数方式' : mode === 'aggregatePercent' ? '割合方式' : '個人別方式') + 'から入力。空欄は未入力。'];
    if (result.type === 'distribution') { result.basis = mode === 'aggregatePercent' ? 'percent' : 'count'; result.values.forEach(v => { v.value = missing(); delete v.publishedPercent; }); }
    else if (result.type === 'summary') { result.mean = missing(); result.standardDeviation = missing(); }
    else if (result.type === 'conditionalMean') {
      result.values.forEach(v => { v.count = missing(); v.mean = missing(); v.standardDeviation = missing(); });
      if (result.total) for (const key of ['count', 'mean', 'standardDeviation']) result.total[key] = missing();
    } else if (result.type === 'crossTab') {
      result.basis = mode === 'aggregatePercent' ? 'percent' : 'count';
      result.groups.forEach(g => { g.count = missing(); delete g.publishedPercent; });
      result.rows.forEach(row => { row.count = missing(); delete row.publishedPercent; row.values.forEach(v => { v.value = missing(); delete v.publishedPercent; }); });
    } else throw new Error('この統計型のテンプレートには対応していません。');
    return result;
  }
  function aggregateFields(ctx, mode) {
    const instruments = new Map(ctx.instruments.map(i => [i.id, i])), fields = [], results = [];
    ctx.statistics.forEach(reference => {
      const instrument = instruments.get(reference.instrumentId), subject = instruments.get(reference.subjectInstrumentId) || instrument;
      const resultIndex = results.length, result = resultBase(reference, ctx.school, mode); results.push(result);
      const title = (instrument.code + ' ' + instrument.text + (reference.subjectInstrumentId ? ' × ' + subject.text : '')).slice(0, 1800);
      const add = (path, label, category, kind, note = '', scale = null) => fields.push({ resultIndex, referenceId: reference.id, path, kind, scale,
        fixed: [reference.id, title, label, category, kind === 'count' ? '人' : kind === 'percent' ? '%' : unit(subject)],
        note: (instrument.schoolAvailability === 'notReturned' && ctx.wave.administration === 'official' ?
          '学校別には返却されない設問です。値を必須とせず「未提供」を選べます。独自に再実施した回答は別の調査回へ入力します。 ' : '') + note });
      add(['denominator', 'count'], '対象人数', '', 'count', reference.denominator.definition || '分母の定義が不明なため参考表示になります。');
      if (reference.type === 'distribution') reference.values.forEach((v, i) => add(['values', i, 'value'], '回答分布', v.code + '：' + categoryLabel(instrument, v.code),
        result.basis, result.basis === 'percent' ? '0〜100の割合。人数への逆算はしません。' : 'この質問の対象人数を入力してください。'));
      else if (reference.type === 'summary') {
        const note = subject.scale.kind === 'irtScore' ? '選択した年度・教科・技能範囲の公式返却平均を転記。個人のバンドや別技能範囲の平均は入力しません。' : '選択した試験・単位の平均を入力します。';
        add(['mean'], '平均', '', subject.scale.kind === 'percentCorrect' ? 'percent' : 'mean', note, subject.scale);
        add(['standardDeviation'], '標準偏差（任意）', '', 'deviation', '返却されていない場合は空欄または「未提供」。');
      } else if (reference.type === 'conditionalMean') {
        reference.values.forEach((v, i) => {
          const category = v.code + '：' + categoryLabel(instrument, v.code);
          add(['values', i, 'count'], '選択肢別対象人数', category, 'count', '質問と教科の両方に対応付いた人数。');
          add(['values', i, 'mean'], '選択肢別平均', category, subject.scale.kind === 'percentCorrect' ? 'percent' : 'mean',
            subject.scale.kind === 'irtScore' ? '公式に返却された同じ技能範囲のIRT平均のみ。バンドから計算しません。' : '同じ試験・単位の平均。', subject.scale);
          add(['values', i, 'standardDeviation'], '標準偏差（任意）', category, 'deviation');
        });
        if (reference.total) {
          add(['total', 'count'], '全体対象人数（任意）', '', 'count');
          add(['total', 'mean'], '全体平均（任意）', '', subject.scale.kind === 'percentCorrect' ? 'percent' : 'mean', '', subject.scale);
          add(['total', 'standardDeviation'], '全体標準偏差（任意）', '', 'deviation');
        }
      } else if (reference.type === 'crossTab') {
        reference.groups.forEach((g, i) => add(['groups', i, 'count'], '教科群別対象人数', g.code + '：' + g.label, 'count', '全国群の境界が未公表の場合、学校内の四分位を同じ群として入力できません。'));
        reference.rows.forEach((row, i) => {
          const label = row.code + '：' + categoryLabel(instrument, row.code);
          add(['rows', i, 'count'], '回答別対象人数', label, 'count');
          row.values.forEach((v, j) => add(['rows', i, 'values', j, 'value'], 'クロス集計', label + ' × ' + v.code,
            result.basis, result.basis === 'percent' ? '割合の分母：' + reference.normalization + '。' : '実際に対応付いた人数のみ。'));
        });
      }
    });
    return { fields, results };
  }
  function layout(ctx, manifest) {
    const sheets = [], make = (name, widths) => { const s = { name, widths, cells: [], inputs: [] }; sheets.push(s); return s; };
    const put = (s, row, col, value, input = false) => { s.cells.push({ row, col, value, input }); if (input) s.inputs.push({ row, col }); };
    const row = (s, r, values) => values.forEach((value, c) => put(s, r, c + 1, value));
    const individual = manifest.mode === 'individual';
    const oldHeading = '学校値';
    const oldGuide = '黄色い欄だけに学校値を入力します。灰色の定義・ID・対象者・入力方式は変更しません。';
    let valueHeading = oldHeading;
    if (individual) {
      if (ctx.instruments.every(item => item.scale.kind === 'response')) valueHeading = '回答番号';
      else if (ctx.instruments.some(item => item.scale.kind === 'response')) valueHeading = '回答番号・得点等';
      else valueHeading = '得点・正答数';
    }
    const entryGuide = individual
      ? '「個人入力」シートで、生徒ごとの行の黄色い「' + valueHeading + '」欄に記入します。灰色の欄は変更しません。'
      : oldGuide;
    const legacyText = individual ? { [names.individual]: { I1: oldHeading }, [names.help]: { B3: oldGuide } } : {};
    const help = make(names.help, [29, 110]);
    [
      ['学校調査入力', ctx.wave.label], ['入力方式', { aggregateCount: '集計値・人数', aggregatePercent: '集計値・割合', individual: '個人別' }[manifest.mode]],
      ['記入する場所', entryGuide],
      ['空欄', '未入力として扱います。再取込では発行した範囲内の以前の値を空欄へ戻します。発行範囲外の値は保持します。'],
      ['無回答', '実際に無回答だった場合は、その選択肢コードを入力します。空欄を無回答へ置き換えません。'],
      ['欠測状態', '値を入力できない理由は欠測状態欄で選べます。数値と欠測状態を同時に入力できません。'],
      ['対象人数', '質問・統計ごとの人数を記入します。全問へ名簿人数を一律に記入しません。不明な人数は空欄または「未提供」。'],
      ['割合と単位', '割合は0〜100（例：25.5）で入力します。25.5%のExcel形式や0〜1への変更はしません。'],
      ['個人別の正答数', '対応する教科では正答数を入力します。固定した満点を使って正答率に変換し、元の正答数も保存します。'],
      ['IRT', '個人のIRTバンドからIRT平均を作りません。英語3技能と4技能は別の尺度です。'],
      ['A〜D群', '全国の境界が未公表の群へ自校の四分位を割り当てません。学校内の群を全国群と同じものとして比較できません。'],
      ['再発行が必要な場合', '発行した設問・尺度・対象者・同じ統計の学校結果が変更された場合は、画面から発行し直してください。'],
      ['反映', '保存したExcelをアプリで読み込み、追加・修正・空欄に戻る値を確認してから一括反映します。'],
    ].forEach((values, i) => row(help, i + 1, values));
    const info = make(names.manifest, [26, 110]);
    const encoded = stable(manifest), chunks = encoded.match(/[\s\S]{1,20000}/g) || [];
    [['形式', 'GD_SURVEY_TEMPLATE'], ['テンプレート版', version], ['調査回ID', ctx.wave.id], ['調査回', ctx.wave.label],
      ['実施日', ctx.wave.administeredOn], ['メタデータ行数', chunks.length]].forEach((values, i) => row(info, i + 1, values));
    chunks.forEach((chunk, i) => row(info, i + 7, ['固定情報' + (i + 1), chunk]));
    const definitions = make(names.definitions, [25, 15, 74, 12, 19, 18, 18, 58, 17, 55, 28]);
    row(definitions, 1, ['設問・教科ID', '設問コード', '設問・教科の原文', '調査年度', '尺度', '単位', '選択肢コード', '選択肢の原文', '回答の扱い', '試験・技能範囲', '学校への提供']);
    let dr = 2;
    for (const instrument of ctx.instruments) {
      const options = instrument.options.length ? instrument.options : instrument.scale.bands.length ? instrument.scale.bands : [null];
      for (const option of options) row(definitions, dr++, [instrument.id, instrument.code, instrument.text, instrument.year ?? '', instrument.scale.kind,
        unit(instrument), option?.code || '', option?.label || '', option?.responseStatus || '',
        (instrument.formId || '試験フォーム未確認') + ' ／ ' + (instrument.skills || []).join('・') + (instrument.rawScoreMaximum ? ' ／ 満点' + instrument.rawScoreMaximum + '問' : ''),
        instrument.schoolAvailability === 'notReturned' ? '学校別には未提供' : instrument.schoolAvailability === 'returned' ? '学校へ提供' : '提供状況は出典を確認']);
    }
    let fields, results;
    if (individual) {
      const sheet = make(names.individual, [25, 22, 10, 17, 14, 25, 70, 30, 20, 18]);
      row(sheet, 1, ['対象者ID', '氏名（任意）', '学年', 'クラス', '出席番号', '設問・教科ID', '設問・教科', '入力単位', valueHeading, '欠測状態']);
      fields = [];
      for (const participant of ctx.wave.participants) for (const instrument of ctx.instruments) {
        const r = fields.length + 2;
        row(sheet, r, [participant.id, participant.name ?? '', participant.grade ?? '', participant.className ?? '', participant.number ?? '',
          instrument.id, (instrument.code + ' ' + instrument.text).slice(0, 1800), inputUnit(instrument)]);
        put(sheet, r, 9, '', true); put(sheet, r, 10, '', true);
        fields.push({ row: r, participantId: participant.id, instrumentId: instrument.id, valueCol: 9, statusCol: 10 });
      }
    } else {
      const sheet = make(names.aggregate, [25, 78, 27, 44, 18, 20, 18, 80]);
      row(sheet, 1, ['比較対象ID', '設問・教科', '統計・項目', '選択肢・区分', '入力単位', '学校値', '欠測状態', '入力上の注意']);
      ({ fields, results } = aggregateFields(ctx, manifest.mode));
      fields.forEach((field, i) => {
        field.row = i + 2; field.valueCol = 6; field.statusCol = 7;
        row(sheet, field.row, field.fixed); put(sheet, field.row, 6, '', true); put(sheet, field.row, 7, '', true); put(sheet, field.row, 8, field.note);
      });
    }
    const cells = sheets.reduce((n, s) => n + s.cells.length, 0);
    if (cells > limits.cells || sheets.some(s => s.cells.some(c => c.row > limits.rows || c.col > limits.columns))) throw new Error('学校用テンプレートの範囲が上限を超えます。質問・教科の選択を減らしてください。');
    return { sheets, fields, results, valueHeading, legacyText };
  }
  async function buildTemplate(surveys, waveId, options = {}) {
    const { core, ExcelJS } = dependencies(options), ctx = context(surveys, waveId, options, core);
    const manifest = { templateVersion: version, schemaVersion: surveys.schemaVersion, waveId, mode: options.mode,
      scope: ctx.scope, school: ctx.school, ...await signatures(surveys, ctx, options.mode) };
    manifest.integrity = await digest(stable(manifest));
    const specification = layout(ctx, manifest), book = new ExcelJS.Workbook(), instruments = new Map(ctx.instruments.map(i => [i.id, i]));
    book.creator = 'Grade Analysis Dashboard'; book.created = new Date(0); book.modified = new Date(0);
    const inputName = options.mode === 'individual' ? names.individual : names.aggregate;
    const inputSheet = specification.sheets.find(spec => spec.name === inputName);
    for (const spec of [inputSheet, ...specification.sheets.filter(spec => spec !== inputSheet)]) {
      const sheet = book.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
      sheet.columns = spec.widths.map(width => ({ width }));
      for (const descriptor of spec.cells) {
        const cell = sheet.getCell(descriptor.row, descriptor.col);
        if (typeof descriptor.value !== 'string' && (typeof descriptor.value !== 'number' || !Number.isFinite(descriptor.value))) throw new Error('Excelの定義には文字列・数値だけを使用してください。');
        cell.value = descriptor.value;
        cell.font = { name: 'Noto Sans CJK JP', size: descriptor.row === 1 ? 11 : 10, bold: descriptor.row === 1, color: { argb: 'FF21384F' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: descriptor.input ? 'FFFFF5D6' : 'FFF1F4F8' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFCFD8E3' } } };
        cell.protection = { locked: !descriptor.input };
        if (descriptor.input) cell.numFmt = 'General';
        sheet.getRow(descriptor.row).height = descriptor.row === 1 ? 30 : spec.name === names.manifest ? 24 : 48;
      }
      if (spec.name === names.aggregate || spec.name === names.individual) for (const field of specification.fields) {
        sheet.getCell(field.row, field.statusCol).dataValidation = { type: 'list', allowBlank: true,
          formulae: ['"' + Object.keys(missingLabels).join(',') + '"'], showErrorMessage: true, errorStyle: 'stop', errorTitle: '欠測状態', error: '候補から選ぶか空欄にしてください。' };
        const instrument = instruments.get(field.instrumentId);
        let rule = null;
        if (instrument?.scale.kind === 'response') {
          const codes = instrument.options.map(o => o.code);
          if (codes.every(c => !/[",\r\n]/.test(c)) && codes.join(',').length <= 253) {
            const choices = instrument.options.filter(option => option.responseStatus === 'answered').map(o => o.code + '：' + o.label).join('\n');
            rule = { type: 'list', formulae: ['"' + codes.join(',') + '"'], showInputMessage: true, promptTitle: '回答番号を選ぶ',
              prompt: choices && choices.length <= 240 ? choices : '「設問定義」シートで、番号に対応する選択肢を確認してください。' };
          }
        } else if (instrument?.rawScoreMaximum) rule = { type: 'whole', operator: 'between', formulae: [0, instrument.rawScoreMaximum] };
        else if (field.kind === 'count') rule = { type: 'whole', operator: 'between', formulae: [0, 1000000000] };
        else if (field.kind === 'percent') rule = { type: 'decimal', operator: 'between', formulae: [0, 100] };
        else if (field.kind === 'deviation') rule = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0] };
        else {
          const scale = instrument?.scale || field.scale;
          if (Number.isFinite(scale?.minimum) && Number.isFinite(scale?.maximum)) rule = { type: scale.step === 1 ? 'whole' : 'decimal', operator: 'between', formulae: [scale.minimum, scale.maximum] };
        }
        if (rule) sheet.getCell(field.row, field.valueCol).dataValidation = { ...rule, allowBlank: true, showErrorMessage: true,
          errorStyle: 'stop', errorTitle: specification.valueHeading, error: '表示した選択肢・単位・範囲に合わせて入力してください。' };
      }
      await sheet.protect(undefined, { selectLockedCells: true, selectUnlockedCells: true, formatColumns: true, formatRows: true });
    }
    const buffer = await book.xlsx.writeBuffer();
    if (buffer.byteLength > limits.fileBytes) throw new Error('学校用テンプレートが5MBを超えます。質問・教科の選択を減らしてください。');
    const label = ctx.wave.label.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 80);
    return { buffer, fileName: label + '_学校調査_' + { aggregateCount: '人数', aggregatePercent: '割合', individual: '個人別' }[options.mode] + '.xlsx', manifest: freeze(clone(manifest)) };
  }
  function issue(sheet, row, field, message) { return { sheet, row, field, message }; }
  function failed(issues) {
    return freeze({ ok: false, issues, errors: issues.map(e => (e.sheet ? '「' + e.sheet + '」' : '') + (e.row ? e.row + '行・' : '') + e.field + '：' + e.message) });
  }
  function cellValue(sheet, row, col, X) { return sheet[X.utils.encode_cell({ r: row - 1, c: col - 1 })]?.v; }
  function inspectCells(book, X) {
    const issues = [];
    for (const name of book.SheetNames) for (const [address, cell] of Object.entries(book.Sheets[name])) {
      if (address[0] === '!') continue;
      const at = X.utils.decode_cell(address), value = cell?.v;
      if (!cell || typeof cell !== 'object' || cell.f !== undefined || cell.F !== undefined || cell.l !== undefined ||
          (!blank(value) && typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) ||
          (cell.t && !['s', 'str', 'n', 'z'].includes(cell.t)) || (typeof value === 'number' && typeof cell.z === 'string' && X.SSF.is_date(cell.z))) {
        issues.push(issue(name, at.r + 1, address, '数式・リンク・日付・真偽値・オブジェクトは使用できません。文字列または有限の数値を入力してください。'));
      }
      if (issues.length >= 100) return issues;
    }
    return issues;
  }
  function readManifest(book, X) {
    const sheet = book.Sheets[names.manifest];
    if (!sheet || cellValue(sheet, 1, 2, X) !== 'GD_SURVEY_TEMPLATE' || cellValue(sheet, 2, 2, X) !== version) throw new Error('対応する学校用テンプレートではありません。画面から発行してください。');
    const count = cellValue(sheet, 6, 2, X);
    if (!Number.isSafeInteger(count) || count < 1 || count > 8) throw new Error('テンプレートの固定情報が不正です。再発行してください。');
    let encoded = '';
    for (let i = 0; i < count; i++) {
      const chunk = cellValue(sheet, i + 7, 2, X);
      if (typeof chunk !== 'string' || chunk.length > 20000) throw new Error('テンプレートの固定情報が不正です。再発行してください。');
      encoded += chunk;
    }
    const manifest = JSON.parse(encoded);
    const keys = ['templateVersion', 'schemaVersion', 'waveId', 'mode', 'scope', 'school', 'datasetSignature', 'resultSignature', 'participantSignature', 'integrity'];
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) || Object.keys(manifest).length !== keys.length || keys.some(k => !own(manifest, k)) ||
        manifest.templateVersion !== version || manifest.schemaVersion !== 1 || !modes.includes(manifest.mode) ||
        !manifest.scope || typeof manifest.scope !== 'object' || Object.keys(manifest.scope).sort().join(',') !== 'instrumentIds,referenceIds' ||
        !Array.isArray(manifest.scope.instrumentIds) || !Array.isArray(manifest.scope.referenceIds) ||
        ['datasetSignature', 'resultSignature', 'participantSignature', 'integrity'].some(k => typeof manifest[k] !== 'string' || !/^[a-f0-9]{64}$/.test(manifest[k]))) throw new Error('テンプレートの固定情報が不正です。再発行してください。');
    return manifest;
  }
  function checkLayout(book, spec, X) {
    const issues = [], expectedNames = spec.sheets.map(s => s.name);
    if (book.SheetNames.length !== expectedNames.length || book.SheetNames.some(name => !expectedNames.includes(name))) return [issue(null, null, 'シート', '発行時のシート名とシート数を保持してください。')];
    for (const expected of spec.sheets) {
      const actual = book.Sheets[expected.name], addresses = new Set();
      if (actual['!merges']?.length) issues.push(issue(expected.name, 1, 'セルの結合', '発行時のセルを結合しないでください。'));
      for (const cell of expected.cells) {
        const address = X.utils.encode_cell({ r: cell.row - 1, c: cell.col - 1 }); addresses.add(address);
        const found = cellValue(actual, cell.row, cell.col, X);
        const legacy = spec.legacyText[expected.name]?.[address];
        const matches = cell.value === '' ? blank(found) : found === cell.value || (legacy !== undefined && found === legacy);
        if (!cell.input && !matches) issues.push(issue(expected.name, cell.row, address, '発行時の定義・対象者・項目が変更されています。画面から再発行してください。'));
      }
      for (const address of Object.keys(actual)) if (address[0] !== '!' && !addresses.has(address) && !blank(actual[address]?.v)) issues.push(issue(expected.name, X.utils.decode_cell(address).r + 1, address, '発行範囲外に値があります。'));
    }
    return issues;
  }
  function readStatus(value) {
    if (blank(value)) return null;
    if (typeof value !== 'string') throw new Error('欠測状態は候補の文字列を選んでください。');
    const status = missingLabels[value.trim()] || (Object.values(missingLabels).includes(value.trim()) ? value.trim() : null);
    if (!status) throw new Error('欠測状態は候補から選んでください。');
    return status;
  }
  function number(value, kind, scale) {
    let n = value;
    if (typeof n === 'string') { if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(n.trim())) throw new Error('数字をそのまま入力してください。%記号や桁区切りは使用できません。'); n = Number(n.trim()); }
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error('有限の数値を入力してください。');
    if (kind === 'count' && (!Number.isSafeInteger(n) || n < 0 || n > 1000000000)) throw new Error('人数は0〜10億の整数で入力してください。');
    if (kind === 'percent' && (n < 0 || n > 100)) throw new Error('割合は0〜100で入力してください。');
    if (kind === 'deviation' && n < 0) throw new Error('標準偏差は0以上で入力してください。');
    if (scale && ((scale.minimum !== null && n < scale.minimum) || (scale.maximum !== null && n > scale.maximum))) throw new Error('値がこの尺度の範囲外です。');
    const match = /(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
    const decimals = kind === 'count' ? 0 : Math.min(10, Math.max(0, (match?.[1]?.length || 0) - Number(match?.[2] || 0)));
    return { value: n, status: 'observed', decimals };
  }
  function numericCell(value, statusValue, field) {
    const status = readStatus(statusValue);
    if (status && !blank(value)) throw new Error('学校値と欠測状態を同時に入力できません。');
    return status ? missing(status) : blank(value) ? missing() : number(value, field.kind, field.scale);
  }
  function assign(target, path, value) { const last = path[path.length - 1]; for (const key of path.slice(0, -1)) target = target[key]; target[last] = value; }
  function aggregateIssues(surveys, ctx, payload, spec, core) {
    // Validate a private, normalized candidate so schema paths can be mapped to
    // issued Excel rows even when the transaction later skips unchanged results.
    const candidate = clone(surveys), wave = candidate.waves.find(w => w.id === ctx.wave.id);
    candidate.sources.push(clone(payload.source));
    wave.results = payload.results.map(raw => ({ ...clone(raw), sourceId: payload.source.id, revision: 1, supersedes: null }));
    return core.validate(candidate).slice(0, 100).map(message => {
      const match = /\.results\[(\d+)\]([^:：]*)(?:[:：])(.*)$/.exec(message);
      if (!match) return issue(names.aggregate, 1, '集計の整合性', message);
      const resultIndex = Number(match[1]), path = match[2].replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');
      const fields = spec.fields.filter(f => f.resultIndex === resultIndex);
      const exact = fields.find(f => path === f.path.join('.') || path.startsWith(f.path.join('.') + '.'));
      const broad = fields.find(f => f.path.join('.').startsWith(path + '.'));
      const field = exact || broad || fields[0];
      return issue(names.aggregate, field?.row || 1, field?.fixed[2] || '集計の整合性', match[3].trim());
    });
  }
  function responseCell(value, statusValue, instrument) {
    const status = readStatus(statusValue), base = { instrumentId: instrument.id, value: null, status: status || 'unentered' };
    if (status && !blank(value)) throw new Error('回答・得点と欠測状態を同時に入力できません。');
    if (status || blank(value)) return base;
    if (instrument.scale.kind === 'response') {
      if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('回答は選択肢コードで入力してください。');
      const code = String(value).trim();
      if (!instrument.options.some(o => o.code === code)) throw new Error('定義されている選択肢コードを入力してください。');
      return { ...base, value: code, status: 'observed' };
    }
    if (instrument.scale.kind === 'percentCorrect') {
      const rawScore = number(value, 'count').value;
      if (rawScore > instrument.rawScoreMaximum) throw new Error('正答数は0〜' + instrument.rawScoreMaximum + '問の整数で入力してください。');
      return { ...base, value: 100 * rawScore / instrument.rawScoreMaximum, status: 'observed', rawScore };
    }
    const score = number(value, 'mean', instrument.scale).value, step = instrument.scale.step;
    if (step && Math.abs((score - (instrument.scale.minimum || 0)) / step - Math.round((score - (instrument.scale.minimum || 0)) / step)) > 1e-9) throw new Error('素点は尺度の刻み幅に合わせて入力してください。');
    return { ...base, value: score, status: 'observed' };
  }
  async function parseTemplate(input, surveys, waveId, options = {}) {
    let sheetName = null;
    try {
      const { core, state, safety, X } = dependencies(options);
      const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
      if (!bytes || !bytes.length || bytes.byteLength > limits.fileBytes || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return failed([issue(null, null, 'ファイル', '画面から発行した5MB以内の.xlsxファイルを使用してください。')]);
      await safety.inspectZip(bytes, limits);
      const book = X.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellStyles: false, cellDates: false, cellNF: true, sheetRows: limits.rows + 1 });
      try { safety.validateWorkbook(book, X, limits); }
      catch (error) {
        const location = /「([^」]+)」([A-Z]+[1-9]\d*)/.exec(error.message || '');
        if (location) return failed([issue(location[1], X.utils.decode_cell(location[2]).r + 1, location[2],
          '数式・エラー・オブジェクトは使用できません。文字列または有限の数値を入力してください。')]);
        throw error;
      }
      const inputIssues = inspectCells(book, X); if (inputIssues.length) return failed(inputIssues);
      const manifest = readManifest(book, X); sheetName = names.manifest;
      if (manifest.waveId !== waveId) return failed([issue(names.manifest, 3, '調査回ID', '別の調査回のテンプレートです。対象の調査回から発行してください。')]);
      const integrity = manifest.integrity, unsigned = { ...manifest }; delete unsigned.integrity;
      if (await digest(stable(unsigned)) !== integrity) return failed([issue(names.manifest, 7, '固定情報', '発行情報が変更されています。画面から再発行してください。')]);
      const ctx = context(surveys, waveId, manifest, core), current = await signatures(surveys, ctx, manifest.mode);
      if (stable(ctx.scope) !== stable(manifest.scope) || current.datasetSignature !== manifest.datasetSignature || current.participantSignature !== manifest.participantSignature) return failed([issue(names.manifest, 7, '固定情報', '設問・尺度・対象者または調査データが発行時から変更されています。画面から再発行してください。')]);
      if (current.resultSignature !== manifest.resultSignature) return failed([issue(names.manifest, 7, '学校結果の版', '発行範囲の学校結果が更新されています。最新の状態から発行し直してください。')]);
      const spec = layout(ctx, manifest), layoutIssues = checkLayout(book, spec, X); if (layoutIssues.length) return failed(layoutIssues);
      sheetName = manifest.mode === 'individual' ? names.individual : names.aggregate;
      const sheet = book.Sheets[sheetName], issues = [], preview = { mode: manifest.mode, fieldCount: spec.fields.length,
        observedCount: 0, blankCount: 0, missingCount: 0, scope: clone(ctx.scope), warnings: [] };
      const source = { id: uniqueId('school-source'), kind: manifest.mode === 'individual' ? 'schoolIndividual' : 'schoolAggregate',
        title: ctx.wave.label + ' 学校用Excel', publisher: ctx.school.label, url: null,
        fileName: typeof options.fileName === 'string' ? options.fileName : null, importedAt: new Date().toISOString(),
        fingerprint: { algorithm: 'sha256', value: await digest(bytes) }, reader: { id: 'school-survey-template', version: String(version) },
        locations: [{ sheet: sheetName, range: 'A1:' + X.utils.encode_cell({ r: spec.fields.length, c: manifest.mode === 'individual' ? 9 : 7 }) }],
        notes: ['学校用Excel。発行した入力範囲内の空欄は未入力として差し替えます。'] };
      const payload = { waveId, source, results: [] }, byParticipant = new Map(), instrumentById = new Map(ctx.instruments.map(i => [i.id, i]));
      if (manifest.mode === 'individual') ctx.wave.participants.forEach(p => byParticipant.set(p.id, { participantId: p.id, values: [] }));
      for (const field of spec.fields) {
        try {
          const value = cellValue(sheet, field.row, field.valueCol, X), status = cellValue(sheet, field.row, field.statusCol, X);
          const originalCell = sheet[X.utils.encode_cell({ r: field.row - 1, c: field.valueCol - 1 })];
          if (!blank(value) && typeof originalCell?.z === 'string' && /%/.test(originalCell.z)) throw new Error('Excelのパーセント表示は使用せず、0〜100の数値を通常の数値形式で入力してください。');
          const cell = manifest.mode === 'individual' ? responseCell(value, status, instrumentById.get(field.instrumentId)) : numericCell(value, status, field);
          preview[cell.status === 'observed' ? 'observedCount' : cell.status === 'unentered' ? 'blankCount' : 'missingCount']++;
          if (manifest.mode === 'individual') byParticipant.get(field.participantId).values.push(cell);
          else assign(spec.results[field.resultIndex], field.path, cell);
        } catch (error) { issues.push(issue(sheetName, field.row, spec.valueHeading + '・欠測状態', error.message)); }
      }
      if (issues.length) return failed(issues);
      if (manifest.mode === 'individual') {
        payload.responseSet = { id: uniqueId('school-responses'), sourceId: source.id, instrumentIds: clone(ctx.scope.instrumentIds), records: [...byParticipant.values()] };
        const aggregated = state.aggregateResponses(surveys, waveId, payload.responseSet, { referenceIds: ctx.scope.referenceIds,
          source, ownership: ctx.school.ownership, schoolLabel: ctx.school.label });
        payload.results = aggregated.results; preview.warnings.push(...(aggregated.warnings || []));
      } else {
        payload.results = spec.results;
        for (const result of payload.results) {
          result.sourceId = source.id;
          if (result.type === 'distribution' && result.basis === 'count' && result.values.some(v => v.value.status === 'observed') && result.denominator.count.status !== 'observed') {
            const field = spec.fields.find(f => f.resultIndex === payload.results.indexOf(result) && f.path.join('.') === 'denominator.count');
            issues.push(issue(sheetName, field.row, '対象人数', '人数方式で回答人数を入力した質問には、その質問の対象人数も入力してください。'));
          }
          const index = payload.results.indexOf(result), countField = spec.fields.find(f => f.resultIndex === index && f.path.join('.') === 'denominator.count');
          const count = result.denominator.count.status === 'observed' ? result.denominator.count.value : null;
          const counted = result.type === 'distribution' && result.basis === 'count' ? result.values.map(v => v.value) : result.type === 'conditionalMean' ? result.values.map(v => v.count) : null;
          if (counted && count !== null) {
            const observed = counted.filter(v => v.status === 'observed'), sum = observed.reduce((n, v) => n + v.value, 0);
            if (sum > count || (observed.length === counted.length && sum !== count)) issues.push(issue(sheetName, countField.row, '対象人数・選択肢別人数', '人数合計とこの質問・統計の対象人数が一致しません。'));
          }
          if (result.type === 'crossTab' && !result.grouping?.bands) preview.warnings.push('全国の群境界が未公表のクロス集計は参考表示です。学校内の四分位を全国群へ割り当てません。');
        }
      }
      if (issues.length) return failed(issues);
      if (manifest.mode !== 'individual') {
        const validationIssues = aggregateIssues(surveys, ctx, payload, spec, core);
        if (validationIssues.length) return failed(validationIssues);
      }
      let plan;
      try { plan = state.prepareSchool(surveys, payload); }
      catch (error) { return failed([issue(sheetName, 1, '集計の整合性', error.message)]); }
      return freeze({ ok: true, errors: [], issues: [], manifest, payload, plan, preview });
    } catch (error) {
      const message = typeof error?.message === 'string' ? error.message.replace(/^全国調査Excel：/, '').replace(/ 取込は反映していません。公式の未加工の原本を選び直してください。$/, ' 学校用テンプレートを画面から発行し直してください。') : '学校用テンプレートを読み込めませんでした。';
      return failed([issue(sheetName, null, sheetName ? '固定情報・集計' : 'ファイル', message)]);
    }
  }
  return Object.freeze({ version, limits, modes, names, buildTemplate, parseTemplate });
});
