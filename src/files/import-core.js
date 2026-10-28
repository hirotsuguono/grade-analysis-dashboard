/* Pure, offline-safe Excel import validation. No dataset is changed here. */
(function (root) {
  'use strict';
  // Limits apply before SheetJS parsing and before any sheet-to-array conversion.
  const limits = Object.freeze({ fileBytes: 10 * 1024 * 1024, expandedBytes: 40 * 1024 * 1024,
    entryBytes: 16 * 1024 * 1024, entries: 256, sheets: 32, rows: 10000, columns: 256, cells: 1000000 });
  const limitError = () => new Error('Excelの容量または範囲が上限を超えています（10MB、展開40MB、32シート、各10000行・256列、全シート計100万セル）。必要な範囲だけを新しいExcelへコピーしてください。');
  function validateWorkbook(wb, X) {
    if (!wb || !Array.isArray(wb.SheetNames) || !wb.Sheets || wb.SheetNames.length > limits.sheets) throw limitError();
    let cells = 0, actualTotal = 0;
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (!sheet || typeof sheet !== 'object') throw limitError();
      for (const ref of [sheet['!ref'], sheet['!fullref']].filter(Boolean)) {
        if (typeof ref !== 'string' || !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(ref)) throw limitError();
        const range = X.utils.decode_range(ref);
        if (range.s.r > range.e.r || range.s.c > range.e.c || range.e.r >= limits.rows || range.e.c >= limits.columns) throw limitError();
      }
      const range = sheet['!ref'] ? X.utils.decode_range(sheet['!ref']) : null;
      if (range) cells += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (cells > limits.cells) throw limitError();
      let actual = 0;
      for (const key of Object.keys(sheet)) {
        if (key.startsWith('!')) continue;
        if (!/^[A-Z]+[1-9]\d*$/.test(key)) throw limitError();
        const cell = X.utils.decode_cell(key);
        if (cell.r >= limits.rows || cell.c >= limits.columns || ++actual > limits.cells || ++actualTotal > limits.cells) throw limitError();
      }
    }
    return wb;
  }
  async function inspectZip(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = n => view.getUint16(n, true), u32 = n => view.getUint32(n, true);
    let end = -1;
    for (let n = bytes.length - 22; n >= Math.max(0, bytes.length - 65557); n--) {
      if (u32(n) === 0x06054b50 && n + 22 + u16(n + 20) === bytes.length) { end = n; break; }
    }
    if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw limitError();
    const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
    if (!count || count > limits.entries || start + size !== end) throw limitError();
    let cursor = start, declared = 0, expanded = 0;
    const names = new Set(), segments = [];
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw limitError();
      const flags = u16(cursor + 8), method = u16(cursor + 10);
      const compressed = u32(cursor + 20), uncompressed = u32(cursor + 24);
      const nameLength = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32), local = u32(cursor + 42);
      declared += uncompressed;
      if (flags & 1 || ![0, 8].includes(method) || uncompressed > limits.entryBytes || declared > limits.expandedBytes || u16(cursor + 34) || cursor + 46 + nameLength + extra + comment > end) throw limitError();
      const name = Array.from(bytes.subarray(cursor + 46, cursor + 46 + nameLength), c => String.fromCharCode(c)).join('');
      if (!name || names.has(name) || name.startsWith('/') || name.split('/').includes('..')) throw limitError();
      names.add(name);
      if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags) throw limitError();
      const localNameLength = u16(local + 26), localExtra = u16(local + 28), begin = local + 30 + localNameLength + localExtra;
      if (localNameLength !== nameLength || begin + compressed > start || begin < local) throw limitError();
      for (let j = 0; j < nameLength; j++) if (bytes[local + 30 + j] !== bytes[cursor + 46 + j]) throw limitError();
      if (segments.some(([a, b]) => local < b && begin + compressed > a)) throw limitError();
      segments.push([local, begin + compressed]);
      let actual = 0;
      if (method === 0) actual = compressed;
      else {
        if (typeof DecompressionStream === 'undefined') throw new Error('このブラウザではExcelの展開量を検査できません。学校で承認された最新のChromeまたはEdgeを使用してください。');
        const reader = new Blob([bytes.subarray(begin, begin + compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            actual += value.byteLength;
            if (actual > limits.entryBytes || expanded + actual > limits.expandedBytes || actual > uncompressed) { await reader.cancel(); throw limitError(); }
          }
        } finally { reader.releaseLock(); }
      }
      if (actual !== uncompressed) throw limitError();
      expanded += actual;
      if (expanded > limits.expandedBytes) throw limitError();
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end) throw limitError();
  }
  async function readWorkbook(file, X) {
    if (!file || !Number.isFinite(file.size) || file.size <= 0 || file.size > limits.fileBytes) throw limitError();
    const buffer = await file.arrayBuffer(), bytes = new Uint8Array(buffer);
    if (!bytes.length || bytes.length > limits.fileBytes) throw limitError();
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) await inspectZip(bytes);
    else if (![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((v, i) => bytes[i] === v)) throw new Error('.xlsx または .xls 形式のExcelを使用してください。');
    return validateWorkbook(X.read(buffer, { type: 'array', sheetRows: limits.rows + 1, cellHTML: false, cellStyles: false }), X);
  }
  const text = (v) => v == null ? '' : String(v).trim();
  const nameKey = (v) => text(v).replace(/\s+/g, '');
  const numberKey = (v) => /^\d+$/.test(text(v)) ? String(Number(text(v))) : text(v);
  const isIdHeader = (v) => /^(生徒ID|student[ _-]?id)$/i.test(text(v));
  const idColumn = (header) => header.findIndex(isIdHeader);
  const findHeader = (rows) => rows.findIndex((r) => text(r[0]) === '出席番号' && text(r[1]) === '氏名' && text(r[2]) === 'クラス');
  const splitRosterHeader = (r) => isIdHeader(r[0]) && text(r[1]) === '学年' && text(r[2]) === 'クラス' && text(r[3]) === '出席番号' && text(r[4]) === '氏名';
  const isPlaceholder = (v) => /^(（ここに指標名|指標名[①-⑳]?)/.test(text(v));
  const inputHelp = '「指標」シートの F9 以降の黄色の見出しを実際の指標名（例：家庭学習時間（分/日））に書き換え、F10 以降の生徒行に数字を入力してください。灰色のA〜E列は変更せず、未回答は空欄にします。「記入例」「書き方」は取り込みません。';
  const legacyMetricHelp = '「指標」シートの D2 を実際の指標名（例：家庭学習時間（分/日））に書き換え、D3 以降の生徒行に数字を入力してください。E列も使う場合は E2 と E3 以降を記入します。未回答は空欄のままにします。「記入例」「書き方」は取り込みません。';

  // Keep the stored class name intact. Split only recognized grade/class forms for Excel.
  function splitClassName(value) {
    const klass = text(value);
    const match = /^([1-3])年(.+?)(?:組)?$/.exec(klass) || /^([1-3])([A-Za-z]+)$/.exec(klass);
    return match ? { grade: match[1], className: match[2] } : { grade: '', className: klass };
  }

  function parseTestKind(value) {
    const label = text(value).normalize('NFKC');
    const kinds = { unclassified: '未分類', unit: '単元テスト', midterm: '中間テスト', final: '期末テスト', proficiency: '実力テスト', other: 'その他' };
    if (!label) return 'unclassified';
    return Object.keys(kinds).find(key => key === label || kinds[key] === label);
  }

  function testLayout(rows, settingsRows = null) {
    const headers = [];
    rows.forEach((r, i) => {
      if (splitRosterHeader(r) || (text(r[0]) === '出席番号' && text(r[1]) === '氏名' && text(r[2]) === 'クラス')) headers.push(i);
    });
    if (headers.length !== 1) return { errors: ['名簿の見出し行が見つからない、または複数あります。アプリの新規テスト用テンプレートを使ってください。'] };
    const headerIdx = headers[0], splitRoster = splitRosterHeader(rows[headerIdx]);
    if ((splitRoster && headerIdx < 7) || (!splitRoster && headerIdx !== 3) || rows.length <= headerIdx + 1) {
      return { errors: ['テンプレートの形式が違います。分野・配点・問題名と生徒の行を残してください。'] };
    }
    const metadata = {}, errors = [];
    const labels = ['テスト名', '教科', '満点', '実施学年', '実施日', 'テスト種類', '比較系列'];
    const read = (label, value) => {
      const raw = text(label).normalize('NFKC').replace(/\s*\*$/, '').replace(/→$/, '');
      const key = ({ '満点(自動)': '満点', 'テストの種類': 'テスト種類', '単元名・試験シリーズ': '比較系列' })[raw] || raw;
      if (!labels.includes(key)) return;
      if (Object.hasOwn(metadata, key)) errors.push('「' + key + '」の設定が重複しています。');
      metadata[key] = value;
    };
    if (settingsRows) {
      if (!splitRoster) errors.push('新しい点数入力シートはA〜E列の名簿とF列以降の点数欄を残してください。');
      settingsRows.forEach(r => read(r[0], r[1]));
    } else if (splitRoster) rows.slice(0, headerIdx - 2).forEach(r => { read(r[0], r[1]); read(r[3], r[4]); });
    else {
      // Old templates may have had entire question columns inserted into row 1 too.
      const row = rows[0] || [];
      for (let c = 0; c < row.length - 1; c++) {
        if (labels.includes(text(row[c]).replace(/→$/, ''))) { read(row[c], row[c + 1]); c++; }
      }
    }
    return { errors, metadata, automaticMax: !!settingsRows, headerIdx, scoreStart: splitRoster ? 5 : 3,
      domainRow: headerIdx - 2, maxRow: headerIdx - 1,
      identityColumns: splitRoster ? { id: 0, grade: 1, className: 2, number: 3, name: 4 } : null };
  }

  function createMatcher(students) {
    const byId = new Map();
    for (const s of students) {
      const key = text(s.id);
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key).push(s);
    }
    function pairMatches(s, klass, num, grade, separateClass) {
      const identities = [s].concat(Array.isArray(s.classHistory) ? s.classHistory : []);
      return identities.some((h) => {
        const parts = separateClass ? splitClassName(h.className) : { className: text(h.className) };
        return (!klass || parts.className === klass) && (!grade || parts.grade === grade) && (!num || numberKey(h.number) === num);
      });
    }
    return function (row) {
      const id = text(row.id), name = nameKey(row.name), klass = text(row.className), num = numberKey(row.number);
      const grade = text(row.grade);
      if (id) {
        const candidates = byId.get(id) || [];
        if (candidates.length !== 1) return { error: '生徒IDが名簿に存在しない、または重複しています。最新の名簿入りテンプレートを発行してください。' };
        const student = candidates[0];
        if (name && nameKey(student.name) !== name) return { error: '生徒IDと氏名が一致しません。別の生徒には振り替えません。' };
        if ((grade || klass || num) && !pairMatches(student, klass, num, grade, row.separateClass)) return { error: '生徒IDと学年・組・番号が現在の名簿／クラス履歴に一致しません。' };
        return { student };
      }
      if (!name) return { error: '氏名または生徒IDを入力してください。' };
      let candidates = students.filter((s) => nameKey(s.name) === name);
      if (grade || klass || num) candidates = candidates.filter((s) => pairMatches(s, klass, num, grade, row.separateClass));
      if (candidates.length !== 1) return { error: candidates.length > 1 ? '同姓同名などで照合が曖昧です。生徒ID入りの最新テンプレートを使ってください。' : '氏名と組・番号が名簿に一致しません。名簿を確認してください。' };
      return { student: candidates[0] };
    };
  }

  function selectSheet(wb, XLSX, preferredNames) {
    validateWorkbook(wb, XLSX);
    for (const name of preferredNames) {
      if (wb.SheetNames.includes(name)) return { name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) };
    }
    const candidates = wb.SheetNames.filter((n) => !/(記入例|書き方|説明|使い方)/.test(n)).map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) })).filter((s) => findHeader(s.rows) >= 0 || s.rows.some(splitRosterHeader));
    if (candidates.length !== 1) throw new Error(candidates.length ? '取込対象のシートが複数あります。対象シート名を「' + preferredNames[0] + '」にしてください。' : '取込用シートが見つかりません。アプリが発行したテンプレートを使ってください。');
    return candidates[0];
  }

  function numeric(value) {
    const raw = text(value);
    if (!raw) return { value: null };
    if (typeof value === 'boolean' || !Number.isFinite(Number(raw))) return { error: '数字で入力してください（未回答は空欄）。' };
    return { value: Number(raw) };
  }

  function matchedRows(rows, headerIdx, students, valueCols, identityColumns = null) {
    const match = createMatcher(students), seen = new Set(), matched = [], errors = [];
    const idCol = idColumn(rows[headerIdx]);
    if (rows[headerIdx].filter(isIdHeader).length > 1) return { matched, errors: ['生徒ID列が複数あります。ID列は1列だけにしてください。'] };
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some((v) => text(v))) continue;
      const identity = identityColumns
        ? { id: row[identityColumns.id], grade: row[identityColumns.grade], className: row[identityColumns.className], number: row[identityColumns.number], name: row[identityColumns.name], separateClass: true }
        : { id: idCol < 0 ? '' : row[idCol], name: row[1], className: row[2], number: row[0] };
      // Completely empty identity lines are harmless only when their value cells are empty.
      if (!text(identity.id) && !text(identity.grade) && !text(identity.name) && !text(identity.className) && !text(identity.number) && !valueCols.some((c) => text(row[c]))) continue;
      if (identityColumns && (!text(identity.id) || (text(identity.grade) && !/^[123]$/.test(text(identity.grade))))) {
        errors.push((r + 1) + '行目：生徒IDを残し、学年は1〜3または発行時の空欄にしてください。'); continue;
      }
      const result = match(identity);
      if (result.error) { errors.push((r + 1) + '行目：' + result.error); continue; }
      if (seen.has(result.student.id)) { errors.push((r + 1) + '行目：同じ生徒の行が重複しています。1名1行にしてください。'); continue; }
      seen.add(result.student.id);
      matched.push({ row, student: result.student, rowNumber: r + 1 });
    }
    return { matched, errors };
  }

  function parseMetricRows(rows, students, metrics) {
    const headers = [];
    rows.forEach((r, i) => { if (splitRosterHeader(r) || (text(r[0]) === '出席番号' && text(r[1]) === '氏名' && text(r[2]) === 'クラス')) headers.push(i); });
    if (headers.length !== 1) return { errors: ['名簿の見出し行が見つからない、または複数あります。' + inputHelp] };
    const hi = headers[0], splitRoster = splitRosterHeader(rows[hi]);
    const start = splitRoster ? 5 : 3, help = splitRoster ? inputHelp : legacyMetricHelp;
    const header = rows[hi], cols = [];
    for (let c = start; c < header.length; c++) {
      const label = text(header[c]);
      if (label && !isIdHeader(label) && !isPlaceholder(label)) cols.push({ c, label });
    }
    if (!cols.length) return { errors: ['指標名がまだ入力されていません。' + help] };
    const width = Math.max(header.length, ...rows.slice(hi + 1).map((r) => r.length));
    for (let c = start; c < width; c++) {
      if ((!text(header[c]) || isPlaceholder(header[c])) && rows.slice(hi + 1).some((r) => text(r[c]))) return { errors: ['指標名が未入力の列に値があります。' + help] };
    }
    if (new Set(cols.map((c) => c.label)).size !== cols.length) return { errors: ['指標名が重複しています。同じ指標は1列にしてください。'] };
    const identityColumns = splitRoster ? { id: 0, grade: 1, className: 2, number: 3, name: 4 } : null;
    const { matched, errors } = matchedRows(rows, hi, students, cols.map((c) => c.c), identityColumns);
    const plans = cols.map((col) => {
      const values = {};
      for (const { row, student, rowNumber } of matched) {
        const result = numeric(row[col.c]);
        if (result.error) errors.push(rowNumber + '行目・' + col.label + '：' + result.error);
        else if (result.value !== null) values[student.id] = result.value;
      }
      const vals = Object.values(values), existingMatches = metrics.filter((m) => m.label === col.label);
      if (existingMatches.length > 1) errors.push('同名の既存指標「' + col.label + '」が複数あり更新先を決められません。');
      const existing = existingMatches[0];
      const autoScale = vals.length > 0 && vals.every((v) => Number.isInteger(v) && v >= 1 && v <= 5);
      const isScale = existing ? existing.type === 'scale' : autoScale;
      if (isScale && vals.some((v) => !Number.isInteger(v) || v < 1 || v > 5)) errors.push('「' + col.label + '」は5段階です。1〜5の整数に修正してください。');
      return { label: col.label, values, count: vals.length, existing, isScale, zeroBlocked: !existing && !autoScale && vals.some((v) => v === 0) && vals.every((v) => Number.isInteger(v) && v >= 0 && v <= 5) };
    }).filter((p) => p.count > 0);
    if (!plans.length && !errors.length) errors.push('指標の数値がまだ入力されていません。' + help);
    return { errors, plans };
  }
  root.GD_IMPORT = { limits, validateWorkbook, inspectZip, readWorkbook, createMatcher, selectSheet, findHeader, idColumn, isIdHeader, isPlaceholder, numeric, matchedRows, parseMetricRows, inputHelp, splitClassName, testLayout, parseTestKind };
})(typeof window !== 'undefined' ? window : globalThis);
