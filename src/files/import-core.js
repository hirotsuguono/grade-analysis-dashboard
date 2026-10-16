/* Pure, offline-safe Excel import validation. No dataset is changed here. */
(function (root) {
  'use strict';
  const text = (v) => v == null ? '' : String(v).trim();
  const nameKey = (v) => text(v).replace(/\s+/g, '');
  const numberKey = (v) => /^\d+$/.test(text(v)) ? String(Number(text(v))) : text(v);
  const isIdHeader = (v) => /^(生徒ID|student[ _-]?id)$/i.test(text(v));
  const idColumn = (header) => header.findIndex(isIdHeader);
  const findHeader = (rows) => rows.findIndex((r) => text(r[0]) === '出席番号' && text(r[1]) === '氏名' && text(r[2]) === 'クラス');
  const isPlaceholder = (v) => /^(（ここに指標名|指標名[①-⑳]?)/.test(text(v));
  const inputHelp = '「指標」シートの D2 を実際の指標名（例：家庭学習時間（分/日））に書き換え、D3 以降の生徒行に数字を入力してください。E列も使う場合は E2 と E3 以降を記入します。未回答は空欄のままにします。「記入例」「書き方」は取り込みません。';

  function createMatcher(students) {
    const byId = new Map();
    for (const s of students) {
      const key = text(s.id);
      if (!byId.has(key)) byId.set(key, []);
      byId.get(key).push(s);
    }
    function pairMatches(s, klass, num) {
      const identities = [s].concat(Array.isArray(s.classHistory) ? s.classHistory : []);
      return identities.some((h) => (!klass || text(h.className) === klass) && (!num || numberKey(h.number) === num));
    }
    return function (row) {
      const id = text(row.id), name = nameKey(row.name), klass = text(row.className), num = numberKey(row.number);
      if (id) {
        const candidates = byId.get(id) || [];
        if (candidates.length !== 1) return { error: '生徒IDが名簿に存在しない、または重複しています。最新の名簿入りテンプレートを発行してください。' };
        const student = candidates[0];
        if (name && nameKey(student.name) !== name) return { error: '生徒IDと氏名が一致しません。別の生徒には振り替えません。' };
        if ((klass || num) && !pairMatches(student, klass, num)) return { error: '生徒IDと組・番号が現在の名簿／クラス履歴に一致しません。' };
        return { student };
      }
      if (!name) return { error: '氏名または生徒IDを入力してください。' };
      let candidates = students.filter((s) => nameKey(s.name) === name);
      if (klass || num) candidates = candidates.filter((s) => pairMatches(s, klass, num));
      if (candidates.length !== 1) return { error: candidates.length > 1 ? '同姓同名などで照合が曖昧です。生徒ID入りの最新テンプレートを使ってください。' : '氏名と組・番号が名簿に一致しません。名簿を確認してください。' };
      return { student: candidates[0] };
    };
  }

  function selectSheet(wb, XLSX, preferredNames) {
    for (const name of preferredNames) {
      if (wb.SheetNames.includes(name)) return { name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) };
    }
    const candidates = wb.SheetNames.filter((n) => !/(記入例|書き方|説明|使い方)/.test(n)).map((name) => ({ name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }) })).filter((s) => findHeader(s.rows) >= 0);
    if (candidates.length !== 1) throw new Error(candidates.length ? '取込対象のシートが複数あります。対象シート名を「' + preferredNames[0] + '」にしてください。' : '取込用シートが見つかりません。アプリが発行したテンプレートを使ってください。');
    return candidates[0];
  }

  function numeric(value) {
    const raw = text(value);
    if (!raw) return { value: null };
    if (typeof value === 'boolean' || !Number.isFinite(Number(raw))) return { error: '数字で入力してください（未回答は空欄）。' };
    return { value: Number(raw) };
  }

  function matchedRows(rows, headerIdx, students, valueCols) {
    const match = createMatcher(students), seen = new Set(), matched = [], errors = [];
    const idCol = idColumn(rows[headerIdx]);
    if (rows[headerIdx].filter(isIdHeader).length > 1) return { matched, errors: ['生徒ID列が複数あります。ID列は1列だけにしてください。'] };
    for (let r = headerIdx + 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some((v) => text(v))) continue;
      const identity = { id: idCol < 0 ? '' : row[idCol], name: row[1], className: row[2], number: row[0] };
      // Completely empty identity lines are harmless only when their value cells are empty.
      if (!text(identity.id) && !text(identity.name) && !text(identity.className) && !text(identity.number) && !valueCols.some((c) => text(row[c]))) continue;
      const result = match(identity);
      if (result.error) { errors.push((r + 1) + '行目：' + result.error); continue; }
      if (seen.has(result.student.id)) { errors.push((r + 1) + '行目：同じ生徒の行が重複しています。1名1行にしてください。'); continue; }
      seen.add(result.student.id);
      matched.push({ row, student: result.student, rowNumber: r + 1 });
    }
    return { matched, errors };
  }

  function parseMetricRows(rows, students, metrics) {
    const hi = findHeader(rows);
    if (hi < 0) return { errors: ['「出席番号・氏名・クラス」の見出し行が見つかりません。' + inputHelp] };
    const header = rows[hi], cols = [];
    for (let c = 3; c < header.length; c++) {
      const label = text(header[c]);
      if (label && !isIdHeader(label) && !isPlaceholder(label)) cols.push({ c, label });
    }
    if (!cols.length) return { errors: ['指標名がまだ入力されていません。' + inputHelp] };
    const width = Math.max(header.length, ...rows.slice(hi + 1).map((r) => r.length));
    for (let c = 3; c < width; c++) {
      if ((!text(header[c]) || isPlaceholder(header[c])) && rows.slice(hi + 1).some((r) => text(r[c]))) return { errors: ['指標名が未入力の列に値があります。' + inputHelp] };
    }
    if (new Set(cols.map((c) => c.label)).size !== cols.length) return { errors: ['指標名が重複しています。同じ指標は1列にしてください。'] };
    const { matched, errors } = matchedRows(rows, hi, students, cols.map((c) => c.c));
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
    if (!plans.length && !errors.length) errors.push('指標の数値がまだ入力されていません。' + inputHelp);
    return { errors, plans };
  }
  root.GD_IMPORT = { createMatcher, selectSheet, findHeader, idColumn, isIdHeader, isPlaceholder, numeric, matchedRows, parseMetricRows, inputHelp };
})(typeof window !== 'undefined' ? window : globalThis);
