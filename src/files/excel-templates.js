/* Styled, local-only Excel templates. SheetJS imports remain independent of the writer. */
(function (root) {
  'use strict';
  const color = { navy: 'FF18334F', blue: 'FF245B86', ink: 'FF21384F', muted: 'FF5D6F80',
    yellow: 'FFFFF5D6', gray: 'FFF1F4F8', line: 'FFCFD8E3', pale: 'FFECF3F9', white: 'FFFFFFFF' };
  function format(fill, options = {}) {
    const { bold = false, size = 11, center = false, border = true, textColor = color.ink, indent = 0, numFmt } = options;
    return { font: { name: 'Noto Sans CJK JP', size, bold, color: { argb: textColor } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } },
      alignment: { vertical: 'middle', horizontal: center ? 'center' : 'left', wrapText: true, indent },
      ...(border ? { border: Object.fromEntries(['top', 'bottom', 'left', 'right'].map(k => [k, { style: 'thin', color: { argb: color.line } }])) } : {}),
      ...(numFmt ? { numFmt } : {}) };
  }
  const style = {
    title: format(color.navy, { size: 22, bold: true, textColor: color.white, border: false, indent: 1 }),
    subtitle: format(color.white, { textColor: color.muted, border: false }),
    steps: format(color.pale, { bold: true, border: false }),
    legend: format(color.yellow, { size: 10, border: false }),
    note: format(color.white, { size: 10, textColor: color.muted, border: false }),
    section: format(color.blue, { bold: true, textColor: color.white, border: false, indent: 1 }),
    header: format(color.blue, { bold: true, center: true, textColor: color.white }),
    hint: format(color.pale, { size: 10, center: true, textColor: color.muted }),
    label: format(color.pale, { bold: true }),
    input: format(color.yellow), inputCenter: format(color.yellow, { center: true }),
    date: format(color.yellow, { center: true, numFmt: 'yyyy/mm/dd' }),
    auto: format(color.gray), autoCenter: format(color.gray, { center: true }),
    autoSmall: format(color.gray, { size: 9 }), autoBig: format(color.gray, { size: 18, center: true, bold: true }),
  };
  const hints = ['1〜3', '組だけ（例：1、A）', '1〜99', '姓名を入力'];
  function cell(X, ws, row, col, value, s = style.input) {
    const key = X.utils.encode_cell({ r: row, c: col });
    ws[key] = { t: typeof value === 'number' ? 'n' : 's', v: value == null ? '' : value, s };
    if (s.numFmt) ws[key].z = s.numFmt;
  }
  function band(X, ws, row, first, last, value, s, height) {
    for (let c = first; c <= last; c++) cell(X, ws, row, c, c === first ? value : '', s);
    ws['!merges'].push({ s: { r: row, c: first }, e: { r: row, c: last } });
    ws['!rows'][row] = { hpt: height };
  }
  function makeSheet(X, wb, name, widths, lastRow, landscape = false) {
    const ws = { '!ref': X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: widths.length - 1 } }),
      '!cols': widths.map(wch => ({ wch })), '!rows': Array.from({ length: lastRow + 1 }, () => ({ hpt: 24 })),
      '!merges': [], '!validations': [], '!landscape': landscape,
      '!printArea': `A1:${X.utils.encode_cell({ r: lastRow, c: widths.length - 1 })}` };
    X.utils.book_append_sheet(wb, ws, name);
    return ws;
  }
  function header(X, ws, lastCol, title, subtitle, steps, note = '') {
    band(X, ws, 0, 0, lastCol, title, style.title, 44);
    band(X, ws, 1, 0, lastCol, subtitle, style.subtitle, 28);
    band(X, ws, 2, 0, lastCol, steps, style.steps, 30);
    band(X, ws, 3, 0, lastCol, '薄い黄色＝入力・選択する欄　／　灰色＝自動表示（編集不要）', style.legend, 28);
    band(X, ws, 4, 0, lastCol, note, style.note, 25);
  }
  function validation(ws, range, config) {
    ws['!validations'].push({ range, rule: { allowBlank: true, showInputMessage: true, showErrorMessage: true, errorStyle: 'stop', ...config } });
  }
  function rosterTemplate(X) {
    const wb = X.utils.book_new();
    for (const example of [false, true]) {
      const ws = makeSheet(X, wb, example ? '記入例' : '名簿入力', [13, 16, 17, 32], example ? 20 : 113);
      header(X, ws, 3, '名簿登録' + (example ? ' ／ 記入例' : ''),
        '名簿だけを登録。生徒IDは自動発行し、テストは別ファイルで登録します。',
        '1 名簿を貼り付ける　→　2 Excelを保存する　→　3 アプリで読み込む',
        example ? '記入例はすべて架空です。「名簿入力」シートにご自身の名簿を入力してください。' : '10行目から入力します。行が足りない場合は下へ追加できます。');
      band(X, ws, 5, 0, 3, '入力する名簿　｜　学年・クラス・出席番号・氏名', style.section, 28);
      ws['!rows'][6] = { hpt: 10 };
      ['学年', 'クラス', '出席番号', '氏名'].forEach((v, c) => cell(X, ws, 7, c, v, style.header));
      hints.forEach((v, c) => cell(X, ws, 8, c, v, style.hint));
      const last = example ? 18 : 113;
      for (let r = 9; r <= last; r++) for (let c = 0; c < 4; c++) cell(X, ws, r, c, '', c === 3 ? style.input : style.inputCenter);
      if (example) {
        [[1, '1', 1, '架空生徒 あおい'], [1, '1', 2, '架空生徒 はると'], [1, '2', 1, '架空生徒 そら'], [1, '3', 1, '架空生徒 しろ']]
          .forEach((row, i) => row.forEach((v, c) => cell(X, ws, 9 + i, c, v, c === 3 ? style.input : style.inputCenter)));
      }
      validation(ws, `A10:A${last+1}`, { type: 'list', formulae: ['"1,2,3"'], promptTitle: '学年', prompt: '1〜3から選択します。', error: '1〜3の整数を入力してください。' });
      validation(ws, `C10:C${last+1}`, { type: 'whole', operator: 'greaterThan', formulae: [0], promptTitle: '出席番号', prompt: '正の整数を入力します。', error: '出席番号は正の整数です。' });
      ws['!freeze'] = { rows: 9, cols: 0 }; ws['!repeatRows'] = '8:9';
    }
    return wb;
  }
  function testTemplate(X, students) {
    const wb = X.utils.book_new();
    const settings = makeSheet(X, wb, '① テスト設定', [23, 12, 12, 12, 14, 24], 23);
    header(X, settings, 5, 'テスト設定', '最初にこのシートを記入し、次に「② 点数入力」へ進みます。',
      '1 テストを設定する　→　2 次のシートに点数を入力する　→　3 保存して取り込む');
    band(X, settings, 5, 0, 5, 'テストの基本情報　｜　＊は必須項目', style.section, 28);
    settings['!rows'][6] = { hpt: 10 };
    const fields = [[7, '教科 ＊', 'プルダウンから選択します。'], [9, 'テスト名 ＊', '例：1学期期末テスト'],
      [11, '満点（自動）', '「② 点数入力」の配点合計です。'], [13, '実施日 ＊', '例：2026/06/24'],
      [15, '実施学年', '1〜3。必要な場合に指定します。'], [17, 'テストの種類', '単元・中間・期末・実力など。'],
      [19, '単元名・試験シリーズ', '同じ単元やシリーズを比較する場合。']];
    for (const [r, label, note] of fields) {
      cell(X, settings, r, 0, label, style.label);
      band(X, settings, r, 1, 3, r === 17 ? '未分類' : '', r === 11 ? style.autoBig : r === 13 ? style.date : style.input, 36);
      band(X, settings, r, 4, 5, note, style.note, 36);
      settings['!rows'][r+1] = { hpt: 12 };
    }
    settings.B12 = { t: 'n', f: "SUM('② 点数入力'!8:8)", v: 100, s: style.autoBig };
    validation(settings, 'B8', { type: 'list', formulae: ['"国語,数学,英語,理科,社会,その他"'], promptTitle: '教科', prompt: '教科を選択します。' });
    validation(settings, 'B14', { type: 'date', operator: 'between', formulae: [new Date(Date.UTC(1900, 0, 1)), new Date(Date.UTC(9999, 11, 31))], promptTitle: '実施日', prompt: '2026/06/24のように入力します。', error: '実在する日付を入力してください。' });
    validation(settings, 'B16', { type: 'list', formulae: ['"1,2,3"'] });
    validation(settings, 'B18', { type: 'list', formulae: ['"未分類,単元テスト,中間テスト,期末テスト,実力テスト,その他"'] });
    band(X, settings, 21, 0, 5, '＊の項目を記入し、次のシートで分野・配点・点数を入力します。', style.note, 28);
    band(X, settings, 23, 0, 5, '次のシート：② 点数入力', style.steps, 30);
    function scoreSheet(name, roster, example = false) {
      const lastRow = Math.max(9, roster.length + 8);
      const ws = makeSheet(X, wb, name, [17, 7, 9, 11, 22, 16, 16, 16, 16, 16], lastRow, true);
      header(X, ws, 9, '点数入力' + (example ? ' ／ 記入例' : ''),
        example ? '記入例：英語 ／ 1学期期末テスト ／ 2026/06/24 ／ 100点（すべて架空）' : '教科未設定 ／ テスト名未設定 ／ 満点 100点',
        '1 分野名・配点・問題名を記入する　→　2 生徒ごとの点数を入力する　→　3 保存して取り込む',
        '列の追加はJ列以降へ（直前の列全体をコピーし、7〜9行目も記入）。空欄＝未入力 ／ 0＝0点 ／ 欠＝欠席。');
      if (!example) ws.A2 = { t: 's', f: 'IF(\'① テスト設定\'!B8="","教科未設定",\'① テスト設定\'!B8)&" ／ "&IF(\'① テスト設定\'!B10="","テスト名未設定",\'① テスト設定\'!B10)&" ／ 満点 "&\'① テスト設定\'!B12&"点"', v: '教科未設定 ／ テスト名未設定 ／ 満点 100点', s: style.subtitle };
      band(X, ws, 5, 0, 4, '自動入力の名簿　｜　編集不要', style.section, 28);
      band(X, ws, 5, 5, 8, '入力する欄　｜　ここから右側が得点用です', style.section, 28);
      cell(X, ws, 5, 9, '追加欄 →', style.section);
      band(X, ws, 6, 0, 4, '1 分野名 →', style.label, 28);
      band(X, ws, 7, 0, 4, '2 配点（この列の満点） →', style.label, 28);
      ['生徒ID', '学年', 'クラス', '出席番号', '氏名'].forEach((v, c) => cell(X, ws, 8, c, v, style.header));
      for (let c = 5; c < 10; c++) {
        cell(X, ws, 6, c, ['リスニング', '読解', 'ライティング', '文法'][c-5] || '', style.inputCenter);
        cell(X, ws, 7, c, c < 9 ? 25 : '', style.inputCenter);
        cell(X, ws, 8, c, c < 9 ? `問${c-4}` : '', style.inputCenter);
        const letter = X.utils.encode_col(c);
        validation(ws, `${letter}8`, { type: 'decimal', operator: 'greaterThan', formulae: [0], promptTitle: '配点', prompt: 'この列の満点を入力します。' });
        validation(ws, `${letter}10:${letter}${lastRow+1}`, { type: 'custom', formulae: [`OR(${letter}10="",${letter}10="欠",AND(ISNUMBER(${letter}10),ISNUMBER(${letter}$8),${letter}$8>0,${letter}10>=0,${letter}10<=${letter}$8))`],
          promptTitle: '点数を入力', prompt: '0〜配点の数値、欠、または空欄です。', error: '0〜配点の数値、欠、または空欄で入力してください。' });
      }
      const values = [[20, 18, 22, 19], [0, 0, 0, 0], ['欠', '', '', ''], [25, '', '', '']];
      roster.forEach((s, i) => {
        const parts = root.GD_IMPORT.splitClassName(s.className);
        [s.id, parts.grade, parts.className, s.number ?? '', s.name].forEach((v, c) => cell(X, ws, 9+i, c, v, c === 0 ? style.autoSmall : c === 4 ? style.auto : style.autoCenter));
        for (let c = 5; c < 10; c++) cell(X, ws, 9+i, c, example && c < 9 ? values[i]?.[c-5] ?? '' : '', style.inputCenter);
      });
      ws['!freeze'] = { rows: 9, cols: 5 }; ws['!repeatRows'] = '6:9';
    }
    scoreSheet('② 点数入力', students);
    scoreSheet('記入例', Array.from({ length: 4 }, (_, i) => ({ id: `架空ID${i+1}`, name: `架空生徒${i+1}`, className: '1年1組', number: i+1 })), true);
    return wb;
  }
  function metricTemplate(X, students) {
    const wb = X.utils.book_new();
    function inputSheet(name, roster, example = false) {
      const lastRow = Math.max(9, roster.length + 8);
      const ws = makeSheet(X, wb, name, [17, 7, 9, 11, 22, 29, 29, 29], lastRow, true);
      header(X, ws, 7, '指標・アンケート入力' + (example ? ' ／ 記入例' : ''),
        example ? '記入例はすべて架空です。実際の入力は「指標」シートに記入します。' : '登録済みの名簿は入力済みです。黄色の指標名と回答欄だけを記入します。',
        '1 指標名を記入する　→　2 生徒ごとの回答を入力する　→　3 保存して取り込む',
        '項目を増やすときは直前の列全体をコピーして右へ追加します。使わない指標列はそのままで構いません。');
      band(X, ws, 5, 0, 4, '自動入力の名簿　｜　編集不要', style.section, 28);
      band(X, ws, 5, 5, 7, '入力する欄　｜　指標名と回答', style.section, 28);
      band(X, ws, 6, 0, 4, '9行目：指標名を記入 →', style.label, 28);
      band(X, ws, 6, 5, 7, '例：家庭学習時間（分/日）、計画的に学習する（1〜5）', style.hint, 28);
      band(X, ws, 7, 0, 4, '10行目以降：回答を記入 →', style.label, 28);
      band(X, ws, 7, 5, 7, '未回答＝空欄 ／ 0＝実際の数値0 ／ 5段階の回答＝1〜5', style.hint, 28);
      ['生徒ID', '学年', 'クラス', '出席番号', '氏名'].forEach((v, c) => cell(X, ws, 8, c, v, style.header));
      const labels = ['家庭学習時間（分/日）', '計画的に学習する（1〜5）', '読書量（冊/月）'];
      for (let c = 5; c < 8; c++) {
        cell(X, ws, 8, c, example ? labels[c-5] : `指標名${['①', '②', '③'][c-5]}（ここを書き換え）`, style.inputCenter);
        const letter = X.utils.encode_col(c);
        validation(ws, `${letter}10:${letter}${lastRow+1}`, { type: 'custom',
          formulae: [`OR(${letter}10="",ISNUMBER(${letter}10))`], promptTitle: '回答を入力',
          prompt: '数値を入力します。未回答は空欄、5段階の回答は1〜5です。', error: '数字で入力してください。未回答は空欄にします。' });
      }
      ws['!rows'][8] = { hpt: 46 };
      const answers = [[30, 4, 2], [0, '', 0], [45, 5, ''], ['', 3, 1]];
      roster.forEach((s, i) => {
        const parts = root.GD_IMPORT.splitClassName(s.className);
        [s.id, parts.grade, parts.className, s.number ?? '', s.name].forEach((v, c) => cell(X, ws, 9+i, c, v, c === 0 ? style.autoSmall : c === 4 ? style.auto : style.autoCenter));
        for (let c = 5; c < 8; c++) cell(X, ws, 9+i, c, example ? answers[i]?.[c-5] ?? '' : '', style.inputCenter);
      });
      ws['!freeze'] = { rows: 9, cols: 5 }; ws['!repeatRows'] = '6:9';
    }
    inputSheet('指標', students);
    inputSheet('記入例', Array.from({ length: 4 }, (_, i) => ({ id: `架空ID${i+1}`, name: `架空生徒${i+1}`, className: '1年1組', number: i+1 })), true);
    const help = makeSheet(X, wb, '書き方', [30, 30, 35], 20);
    header(X, help, 2, '指標・アンケートの書き方', '「指標」シートの黄色の欄に記入します。「記入例」「書き方」は取り込みません。',
      '1 指標名を記入する　→　2 回答を入力する　→　3 保存して取り込む');
    const instructions = [
      [5, '記入する場所', style.section],
      [6, '9行目のF列以降：仮の指標名を、実際の項目名に変更します。例：家庭学習時間（分/日）。', style.note],
      [7, '10行目以降の黄色の欄：各生徒の数値や回答を入力します。灰色のA〜E列は変更しません。', style.note],
      [8, '項目の追加：直前の列全体をコピーして右へ追加し、9行目の指標名も記入します。', style.note],
      [9, '未回答は空欄です。0を入れると実際の数値0として取り込みます。', style.note],
      [10, '保存後、アプリの「② 記入後に取込」でこのExcelを選び、内容を確認します。', style.note],
      [12, '指標の種類は自動で判定します', style.section],
      [13, '新しい指標の回答がすべて1〜5の整数なら「5段階アンケート」です。未回答は空欄にします。', style.note],
      [14, 'それ以外（0・小数・6以上・負の数など）は「数値」です。単位は指標名に記入します。', style.note],
      [15, '同じ名前の指標は種類を保って更新します。既存値は空欄では消えません。', style.note],
      [17, '取り込み後もJSONを保存してください', style.section],
      [18, '取り込み後は、アプリの「保存」でJSONを保存します。次回はそのJSONから再開します。', style.note],
      [19, '名簿が変わったら最新のテンプレートを発行します。生徒ID・学年・クラス・番号・氏名は変更しません。', style.note],
      [20, 'このファイルには氏名が入ります。保存・共有は学校のルールに従ってください。', style.note],
    ];
    for (const [row, text, s] of instructions) band(X, help, row, 0, 2, text, s, s === style.section ? 28 : 34);
    return wb;
  }
  async function writeBuffer(wb) {
    if (!root.ExcelJS) throw new Error('Excel出力用のファイルが不足しています。配布ZIPを展開し直してください。');
    const book = new root.ExcelJS.Workbook();
    book.creator = 'Grade Analysis Dashboard'; book.calcProperties.fullCalcOnLoad = true;
    for (const name of wb.SheetNames) {
      const source = wb.Sheets[name];
      const freeze = source['!freeze'];
      const ws = book.addWorksheet(name, { views: [{ showGridLines: false, zoomScale: 100, ...(freeze ? { state: 'frozen', xSplit: freeze.cols, ySplit: freeze.rows } : {}) }],
        properties: { defaultRowHeight: 24, tabColor: { argb: /記入例/.test(name) ? 'FFA8B9C8' : color.blue } },
        pageSetup: { paperSize: 9, orientation: source['!landscape'] ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
          printArea: source['!printArea'], ...(source['!repeatRows'] ? { printTitlesRow: source['!repeatRows'] } : {}),
          margins: { left: .25, right: .25, top: .28, bottom: .28, header: .1, footer: .1 } } });
      (source['!cols'] || []).forEach((c, i) => { ws.getColumn(i+1).width = c.wch; });
      (source['!rows'] || []).forEach((r, i) => { if (r?.hpt) ws.getRow(i+1).height = r.hpt; });
      for (const [address, value] of Object.entries(source)) {
        if (address.startsWith('!')) continue;
        const target = ws.getCell(address);
        target.value = value.f ? { formula: value.f, result: value.v } : value.t === 'z' ? null : value.v;
        if (value.s) target.style = JSON.parse(JSON.stringify(value.s));
        if (value.z) target.numFmt = value.z;
      }
      for (const range of source['!merges'] || []) ws.mergeCells(range.s.r+1, range.s.c+1, range.e.r+1, range.e.c+1);
      for (const { range, rule } of source['!validations'] || []) ws.dataValidations.add(range, rule);
    }
    return book.xlsx.writeBuffer();
  }
  async function download(wb, name) {
    const bytes = await writeBuffer(wb);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  root.GD_EXCEL = { rosterTemplate, testTemplate, metricTemplate, writeBuffer, download };
})(typeof window !== 'undefined' ? window : globalThis);
