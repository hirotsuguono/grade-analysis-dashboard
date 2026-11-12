/* Pure planning for existing pupils only. Workbook validation never changes a dataset. */
(function (root) {
  'use strict';
  const text = v => v == null ? '' : String(v).trim();
  const normalized = v => text(v).normalize('NFKC');
  const scalar = v => v == null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));
  const fields = ['形式', 'データ名', '対象区分', '対象値', '移動先学年', '組名方式', 'クラス数', '変更対象', '変更種類', '変更日'];
  const headers = ['生徒ID', '氏名', '現在クラス', '現在番号', '新クラス', '新番号'];
  const format = 'gd-roster-reassign-v1';
  const wholeFields = ['形式', 'データ名', '進級後の年度', '対象区分', '対象値', '新2年の組名方式', '新2年のクラス数', '新3年の組名方式', '新3年のクラス数', '変更種類', '変更日'];
  const wholeHeaders = ['生徒ID', '氏名', '現在クラス', '現在番号', '新しい扱い', '新クラス', '新番号'];
  const wholeFormat = 'gd-roster-promotion-v1';
  const isActive = s => s.enrollmentStatus !== 'graduated';
  const isWhole = c => c?.operation === 'whole';
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1900) return false;
    const d = new Date(value + 'T00:00:00Z');
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }
  function number(value) {
    if (!scalar(value)) return null;
    const n = normalized(value);
    return /^\d+$/.test(n) && Number.isSafeInteger(Number(n)) && Number(n) > 0 ? Number(n) : null;
  }
  function gradeOf(student) {
    return root.GD_IMPORT.splitClassName(normalized(student.className)).grade;
  }
  function selectedStudents(students, config) {
    return students.filter(s => isActive(s) && (isWhole(config) || config.sourceType === 'all' ||
      (config.sourceType === 'grade' ? gradeOf(s) === config.sourceValue : (s.className || '') === config.sourceValue)));
  }
  function configErrors(c) {
    const errors = [];
    if (c?.operation != null && !['partial', 'whole'].includes(c.operation)) errors.push('変更の操作を選び直してください。');
    if (isWhole(c)) {
      if (!Number.isInteger(c.schoolYear) || c.schoolYear < 1900 || c.schoolYear > 9999) errors.push('進級後の年度は1900〜9999の整数を入力してください。');
      if (c.sourceType !== 'all' || c.sourceValue !== '' || c.mode !== 'all' || c.kind !== 'move') errors.push('進級・卒業は在籍中の名簿全員をまとめて実行してください。');
      for (const grade of [2, 3]) if (!['numbers', 'letters'].includes(c['naming' + grade]) ||
        !Number.isInteger(c['count' + grade]) || c['count' + grade] < 1 || c['count' + grade] > (c['naming' + grade] === 'letters' ? 26 : 50)) errors.push(`新${grade}年の組名とクラス数を選び直してください。`);
      if (typeof c.date !== 'string' || !validDate(c.date)) errors.push('変更日は実在する日付を入力してください。');
      return errors;
    }
    if (!c || !['all', 'grade', 'class'].includes(c.sourceType) || typeof c.sourceValue !== 'string' ||
      (c.sourceType === 'all' && c.sourceValue !== '') || (c.sourceType === 'grade' && !/^[123]$/.test(c.sourceValue)) || (c.sourceType === 'class' && !c.sourceValue)) errors.push('対象の学年・クラスを選び直してください。');
    if (!c || !Number.isInteger(c.grade) || c.grade < 1 || c.grade > 3 || !['numbers', 'letters'].includes(c.naming) ||
      !Number.isInteger(c.count) || c.count < 1 || c.count > (c.naming === 'letters' ? 26 : 50)) errors.push('移動先の学年は1〜3、クラス数は数字で1〜50・英字で1〜26にしてください。');
    if (!c || !['all', 'partial'].includes(c.mode) || !['move', 'correction'].includes(c.kind)) errors.push('変更対象・変更の種類を選び直してください。');
    if (!c || typeof c.date !== 'string' || !validDate(c.date)) errors.push('変更日は実在する日付で入力してください。');
    return errors;
  }
  function destinations(c) {
    if (configErrors(c).length) return [];
    if (isWhole(c)) return [...destinationsForGrade(c, 2), ...destinationsForGrade(c, 3)];
    return Array.from({ length: c.count }, (_, i) => `${c.grade}年${c.naming === 'letters' ? String.fromCharCode(65 + i) : i + 1}組`);
  }
  function destinationsForGrade(c, grade) {
    if (!isWhole(c)) return grade === c.grade ? destinations(c) : [];
    if (configErrors(c).length || ![2, 3].includes(grade)) return [];
    return Array.from({ length: c['count' + grade] }, (_, i) => `${grade}年${c['naming' + grade] === 'letters' ? String.fromCharCode(65 + i) : i + 1}組`);
  }
  function promotionYearErrors(students, c) {
    if (!isWhole(c)) return [];
    const errors = [];
    for (const student of students) {
      if (student.lastPromotionYear != null && (!Number.isInteger(student.lastPromotionYear) || student.lastPromotionYear < 1900 || student.lastPromotionYear > 9999)) errors.push(`「${text(student.name)}」の進級年度の記録が不正です。現在のJSONを確認してください。`);
      else if (student.lastPromotionYear >= c.schoolYear) errors.push(`「${text(student.name)}」には${student.lastPromotionYear}年度の進級履歴があるため、${c.schoolYear}年度の進級は重ねて反映できません。やり直す場合は直前の一括変更を取り消すか、控えJSONから戻してください。`);
      if (errors.length === 50) break;
    }
    return errors;
  }
  function promotionTarget(student, c) {
    const yearErrors = promotionYearErrors([student], c);
    if (yearErrors.length) throw new Error(yearErrors[0]);
    const grade = Number(gradeOf(student));
    if (![1, 2, 3].includes(grade)) throw new Error(`「${text(student.name)}」の現在の学年を判別できません。名簿を確認してから発行してください。`);
    if (grade === 3) return { action: 'graduate', grade: null, className: student.className || '', number: student.number ?? '' };
    const parts = root.GD_IMPORT.splitClassName(normalized(student.className));
    const group = /^\d+$/.test(parts.className) ? String(Number(parts.className)) : parts.className.toUpperCase();
    const className = `${grade + 1}年${group}組`;
    return { action: 'promote', grade: grade + 1, className: destinationsForGrade(c, grade + 1).includes(className) ? className : '', number: number(student.number) ?? '' };
  }
  function metadata(c, name) {
    if (isWhole(c)) {
      const values = [wholeFormat, name || '', c.schoolYear, c.sourceType, c.sourceValue, c.naming2, c.count2, c.naming3, c.count3, c.kind, c.date];
      return wholeFields.map((field, i) => [field, values[i]]);
    }
    const values = [format, name || '', c.sourceType, c.sourceValue, c.grade, c.naming, c.count, c.mode, c.kind, c.date];
    return fields.map((field, i) => [field, values[i]]);
  }
  function configFrom(values) {
    if (values[0] === wholeFormat) {
      const [, , schoolYear, sourceType, sourceValue, naming2, count2, naming3, count3, kind, date] = values;
      return { operation: 'whole', schoolYear: Number(schoolYear), sourceType, sourceValue, naming2, count2: Number(count2), naming3, count3: Number(count3), kind, mode: 'all', date };
    }
    const [, , sourceType, sourceValue, grade, naming, count, mode, kind, date] = values;
    return { sourceType, sourceValue, grade: Number(grade), naming, count: Number(count), mode, kind, date };
  }
  function planWorkbook(wb, X, data, today) {
    const errors = [], changes = [];
    const add = message => { if (errors.length < 50) errors.push(message); };
    const fail = () => ({ errors, changes: [] });
    try { root.GD_IMPORT.validateWorkbook(wb, X); }
    catch (e) { add(e.message); return fail(); }
    if (!wb.SheetNames.includes('クラス替え') || !wb.SheetNames.includes('発行設定')) { add('アプリから発行したクラス替え用Excelを選んでください。「クラス替え」「発行設定」シートが必要です。'); return fail(); }
    for (const name of ['クラス替え', '発行設定']) {
      for (const [address, cell] of Object.entries(wb.Sheets[name])) {
        if (!address.startsWith('!') && (cell.f || !scalar(cell.v) || cell.t === 'e' || cell.t === 'b' || cell.t === 'd')) add(`${name}・${address}：数式などは使わず、文字または数字を入力してください。`);
      }
    }
    if (errors.length) return fail();
    const settings = X.utils.sheet_to_json(wb.Sheets['発行設定'], { header: 1, defval: '', raw: true });
    const useWhole = settings[6]?.[1] === wholeFormat;
    const settingFields = useWhole ? wholeFields : fields;
    const values = settingFields.map((field, i) => {
      const row = settings[6 + i] || [];
      if (row[0] !== field) add('発行設定が変更されています。設定を画面で選び直し、新しいExcelを発行してください。');
      return row[1];
    });
    if (![format, wholeFormat].includes(values[0]) || values[1] !== (data.name || '')) add('発行形式またはデータ名が一致しません。このJSONからExcelを発行し直してください。');
    const config = configFrom(values);
    errors.push(...configErrors(config));
    if (errors.length) return fail();
    errors.push(...promotionYearErrors(data.students, config));
    if (errors.length) return fail();
    if (config.kind === 'move' && config.date > today) add('変更日が未来です。Excelの準備はできますが、反映は変更日以降に行ってください。');
    const expected = selectedStudents(data.students, config);
    if (!expected.length) add('対象の名簿がありません。最新の名簿からExcelを発行し直してください。');
    if (useWhole) for (const s of expected) {
      try { promotionTarget(s, config); } catch (error) { add(error.message); }
    }
    if (data.students.some(s => typeof s.id !== 'string' || !s.id) || new Set(data.students.map(s => s.id)).size !== data.students.length) add('名簿の生徒IDが空欄、または重複しています。現在のJSONを確認してください。');
    if (errors.length) return fail();
    const byId = new Map(expected.map(s => [s.id, s]));
    const rows = X.utils.sheet_to_json(wb.Sheets['クラス替え'], { header: 1, defval: '', raw: true });
    const rowHeaders = useWhole ? wholeHeaders : headers;
    if (!rowHeaders.every((h, i) => rows[8]?.[i] === h) || rows[8]?.slice(rowHeaders.length).some(v => text(v))) add('クラス替えシートの9行目の見出しが変わっています。新しいExcelを発行してください。');
    const allowed = new Set(destinations(config)), seen = new Set();
    let unchanged = 0;
    for (let r = 9; r < rows.length; r++) {
      const row = rows[r];
      if (!row.some(v => text(v))) continue;
      const at = `${r + 1}行目`;
      if (row.slice(rowHeaders.length).some(v => text(v))) add(`${at}：A〜${useWhole ? 'G' : 'F'}列の欄だけを使ってください。`);
      const id = String(row[0] ?? ''), s = byId.get(id);
      if (!s) { add(`${at}・A列：生徒IDが対象名簿にありません。追加や氏名での振替はしません。`); continue; }
      if (seen.has(id)) { add(`${at}・A列：同じ生徒の行が重複しています。`); continue; }
      seen.add(id);
      const currentNumber = number(s.number), originalNumber = number(row[3]);
      if (text(row[1]) !== text(s.name) || text(row[2]) !== text(s.className) ||
        currentNumber !== originalNumber || (!currentNumber && text(row[3]) !== text(s.number))) {
        add(`${at}・B〜D列：現在の名簿と一致しません。灰色の欄は変更せず、名簿変更後はExcelを発行し直してください。`); continue;
      }
      const target = useWhole ? promotionTarget(s, config) : null;
      if (useWhole && text(row[4]) !== (target.action === 'graduate' ? '卒業' : '進級')) { add(`${at}・E列：新しい扱いは自動表示です。変更せず、新しいExcelを発行してください。`); continue; }
      const datedHistory = (s.classHistory || []).map(h => h.at).filter(Boolean);
      if (useWhole && datedHistory.some(date => date > config.date)) { add(`${at}：変更日は記録済みの所属変更日より前にできません。日付または「入力ミスの訂正」を確認してください。`); continue; }
      if (useWhole && target.action === 'graduate') {
        if (text(row[5]) || text(row[6])) { add(`${at}・F〜G列：卒業する生徒の新クラス・新番号は空欄のままにしてください。`); continue; }
        changes.push({ id, name: s.name, fromClass: s.className || '', fromNumber: s.number ?? '', className: s.className || '', number: s.number ?? '', action: 'graduate' });
        continue;
      }
      const classColumn = useWhole ? 5 : 4, numberColumn = useWhole ? 6 : 5;
      const className = normalized(row[classColumn]), rawNumber = normalized(row[numberColumn]);
      if (!className && !rawNumber && config.mode === 'partial') { unchanged++; continue; }
      const rowAllowed = useWhole ? new Set(destinationsForGrade(config, target.grade)) : allowed;
      if (!rowAllowed.has(className)) { add(`${at}・${useWhole ? 'F' : 'E'}列：新クラスを${useWhole ? `新${target.grade}年の` : '発行時の'}候補から選んでください。`); continue; }
      const newNumber = number(row[numberColumn]);
      if (newNumber == null) { add(`${at}・${useWhole ? 'G' : 'F'}列：新番号は正の整数を入力してください。`); continue; }
      if (className === text(s.className) && newNumber === currentNumber) { unchanged++; continue; }
      if (!useWhole && config.kind === 'move' && datedHistory.some(date => date > config.date)) { add(`${at}：変更日は記録済みの所属変更日より前にできません。日付または「入力ミスの訂正」を確認してください。`); continue; }
      changes.push({ id, name: s.name, fromClass: s.className || '', fromNumber: s.number ?? '', className, number: newNumber, ...(useWhole ? { action: 'promote' } : {}) });
    }
    if (seen.size !== expected.length) add('発行時と対象名簿の人数・生徒IDが一致しません。生徒の行は削除せず、名簿が変わった場合はExcelを発行し直してください。');
    const changed = new Map(changes.map(c => [c.id, c])), slots = new Map();
    for (const s of data.students) {
      const next = changed.get(s.id) || s;
      if (!isActive(s) || next.action === 'graduate') continue;
      if (!next.className || !number(next.number)) continue;
      // Only recognized class spellings are normalized; arbitrary existing names stay intact.
      const parts = root.GD_IMPORT.splitClassName(normalized(next.className));
      const klass = parts.grade ? `${parts.grade}年${/^\d+$/.test(parts.className) ? Number(parts.className) : parts.className}組` : text(next.className);
      const slot = JSON.stringify([klass, number(next.number)]);
      if (slots.has(slot)) add(`反映後に ${klass}・${number(next.number)}番が重複します（${slots.get(slot)}／${s.name}）。変更しない生徒も含めて番号を確認してください。`);
      else slots.set(slot, s.name);
    }
    return { errors, changes: errors.length ? [] : changes, config, unchanged, targetCount: expected.length };
  }
  function changedStudents(students, plan) {
    const changes = new Map(plan.changes.map(c => [c.id, c]));
    return students.map(s => {
      const c = changes.get(s.id);
      if (!c) return JSON.parse(JSON.stringify(s));
      const next = JSON.parse(JSON.stringify(s));
      if (isWhole(plan.config)) next.lastPromotionYear = plan.config.schoolYear;
      if (plan.config.kind === 'move') {
        if (!Array.isArray(next.classHistory)) next.classHistory = [];
        next.classHistory.push({ className: s.className || '', number: s.number ?? '', at: plan.config.date });
      }
      if (c.action === 'graduate') {
        next.enrollmentStatus = 'graduated'; next.graduatedAt = plan.config.date;
        return next;
      }
      next.className = c.className; next.number = c.number;
      return next;
    });
  }
  root.GD_ROSTER = { fields, headers, wholeFields, wholeHeaders, isActive, gradeOf, isWhole, configErrors, destinations, destinationsForGrade, promotionYearErrors, promotionTarget, selectedStudents, metadata, planWorkbook, changedStudents };
})(typeof window !== 'undefined' ? window : globalThis);
