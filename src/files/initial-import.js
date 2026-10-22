/* Offline initial roster and optional first-test workbook workflow. */
(function (global) {
  'use strict';
  const text = value => value == null ? '' : String(value).trim();
  const normalized = value => text(value).normalize('NFKC');
  const ignoredSheet = name => /記入例|入力例|サンプル|説明|手順|使い方|help|example|instruction/i.test(name);
  const empty = value => value == null || text(value) === '';

  function createTemplate(XLSX) {
    const wb = XLSX.utils.book_new();
    const rows = [
      ['データ名', '', '名簿だけならテスト名と点数は空欄'],
      ['テスト名', '', '教科', '英語', '満点', 100, '実施学年', '', '実施日', ''],
      ['学年', 'クラス', '出席番号', '氏名', '合計点（任意）'],
      ...Array.from({ length: 30 }, () => ['', '', '', '', '']),
    ];
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 25 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, sheet, '初回登録');
    const example = XLSX.utils.aoa_to_sheet([
      ['記入例（すべて架空。このシートは取り込まれません）'],
      ['データ名', '架空の英語クラス'],
      ['テスト名', '第1回実力テスト', '教科', '英語', '満点', 100, '実施学年', 2, '実施日', '2026-04-20'],
      ['学年', 'クラス', '出席番号', '氏名', '合計点（任意）'],
      [2, 'A', 1, '架空生徒 あおい', 72],
      [2, 'A', 2, '架空生徒 みどり', ''],
      [2, 'B', 1, '架空生徒 そら', 0],
      [1, 'A', 1, '架空生徒 しろ', ''],
      ['空欄は未入力（0点として登録しない）。0は0点。欠席は「欠」と入力。'],
      ['使うときは「初回登録」シートにご自身の名簿を貼り付けてください。'],
    ]);
    example['!cols'] = [{ wch: 58 }, { wch: 24 }, { wch: 16 }, { wch: 28 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, example, '記入例');
    const help = XLSX.utils.aoa_to_sheet([
      ['初回登録の手順'],
      ['1. 「初回登録」シートの4行目から、A列に学年（1〜3）、B列にクラス（組のみ。例：1、A）、C列に出席番号、D列に氏名を入力・貼り付けます。'],
      ['2. 名簿だけならE列の点数とB2のテスト名を空欄のまま保存します。テスト結果は作られません。'],
      ['3. 最初の点数も登録するならB2のテスト名、D2の教科、F2の満点を確認し、E列に合計点を入力します。'],
      ['4. H2の実施学年はテストを受けたときの学年（1〜3、任意）。名簿のA列の学年とは別です。J2の実施日はYYYY-MM-DD形式で任意入力できます。'],
      ['5. 空欄の点数は未入力、0は0点、「欠」は欠席です。全員分を埋める必要はありません。'],
      ['6. 同じ学年・クラス・出席番号は重複できません。学年や組が違えば同じ番号・同姓同名でも別の生徒として登録します。'],
      ['7. 行が足りない場合は34行目以降に追加できます。見出しと列の順番を変えないでください。'],
      ['8. 保存後、アプリの「初めて使う」から取り込み、確認画面を見てから登録してください。'],
      ['9. 2回目以降はアプリから登録済み名簿入りのテスト・アンケート用Excelを出力します。生徒ID列を変更しないでください。'],
      ['10. 初回は生徒IDを入力しません。取込時に自動発行し、画面では「1年1組」などにまとめて表示します。クラス欄の「1」と「1組」は同じ組として扱います。'],
      ['「記入例」「説明」シートは取り込み対象になりません。名簿をこれらのシートに入力しないでください。'],
    ]);
    help['!cols'] = [{ wch: 120 }];
    XLSX.utils.book_append_sheet(wb, help, '説明');
    return wb;
  }

  function findHeader(rows) {
    const found = [];
    rows.forEach((row, i) => {
      if (normalized(row[0]) === '学年' && normalized(row[1]) === 'クラス' && normalized(row[2]) === '出席番号' && normalized(row[3]) === '氏名' && /^(合計点(?:\(任意\))?|合計|点数)$/.test(normalized(row[4]))) found.push(i);
    });
    return found;
  }

  function dateValue(value, XLSX) {
    if (empty(value)) return '';
    let y, m, d;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      const parsed = XLSX.SSF.parse_date_code(value);
      // The test date uses only the calendar day, including for serials with a time.
      if (!parsed) return null;
      ({ y, m, d } = parsed);
    } else if (Object.prototype.toString.call(value) === '[object Date]') {
      if (!Number.isFinite(value.getTime())) return null;
      y = value.getFullYear(); m = value.getMonth() + 1; d = value.getDate();
    } else {
      const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(normalized(value));
      if (!match) return null;
      y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
    }
    const candidate = new Date(Date.UTC(y, m - 1, d));
    if (y < 1900 || y > 9999 || candidate.getUTCFullYear() !== y || candidate.getUTCMonth() !== m - 1 || candidate.getUTCDate() !== d) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function planWorkbook(wb, XLSX) {
    const errors = [], warnings = [];
    const summary = { studentCount: 0, classCount: 0, scoreCount: 0, absentCount: 0, blankCount: 0, testName: '', duplicateNameCount: 0 };
    const fail = () => ({ summary, errors, warnings });
    if (!wb || !Array.isArray(wb.SheetNames) || !wb.Sheets) { errors.push('Excelファイルを読み取れませんでした。初回登録テンプレートを使用してください。'); return fail(); }
    let sheetName;
    if (wb.SheetNames.includes('初回登録')) sheetName = '初回登録';
    else {
      const candidates = wb.SheetNames.filter(name => !ignoredSheet(name) && wb.Sheets[name] && findHeader(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: true })).length);
      if (candidates.length !== 1) {
        errors.push(candidates.length ? '初回登録の見出しが複数のシートにあります。取り込むシート名を「初回登録」にしてください。' : '初回登録のシートが見つかりません。最新版の初回登録用Excelを発行し、学年・クラス・出席番号・氏名・合計点（任意）の見出しを残してください。');
        return fail();
      }
      sheetName = candidates[0];
    }
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true });
    const headers = findHeader(rows);
    if (headers.length !== 1) { errors.push('最新版の初回登録用Excelを使い、見出し行を1行にしてください。学年・クラス・出席番号・氏名・合計点（任意）の列が必要です。'); return fail(); }
    const hi = headers[0];
    const metadata = {};
    rows.slice(0, hi).forEach(row => {
      for (let c = 0; c < row.length - 1; c++) {
        const label = normalized(row[c]);
        if (['データ名', 'テスト名', '教科', '満点', '実施学年', '実施日'].includes(label)) {
          if (Object.hasOwn(metadata, label)) errors.push(`「${label}」の設定が重複しています。`);
          metadata[label] = row[c + 1]; c++;
        }
      }
    });
    const roster = [], keys = new Set(), classes = new Set(), nameCounts = new Map();
    rows.slice(hi + 1).forEach((row, offset) => {
      if (row.every(empty)) return;
      const label = `${hi + offset + 2}行目`;
      const grade = normalized(row[0]), numberText = normalized(row[2]), name = text(row[3]);
      if (!/^[123]$/.test(grade)) { errors.push(`${label}：名簿の学年は1〜3の整数を入力してください。`); return; }
      let klass = normalized(row[1]).replace(/組$/, '').trim();
      if (!klass || klass.includes('年')) { errors.push(`${label}：クラスは組だけを入力してください（例：1、A）。学年はA列に入力します。`); return; }
      if (/^\d+$/.test(klass)) klass = klass.replace(/^0+(?=\d)/, '');
      const className = `${grade}年${klass}組`;
      if (!/^\d+$/.test(numberText) || !Number.isSafeInteger(Number(numberText)) || Number(numberText) <= 0 || !name) {
        errors.push(`${label}：学年・クラス・正の整数の出席番号・氏名をすべて入力してください。点数だけの行は登録できません。`); return;
      }
      const number = String(Number(numberText));
      const key = JSON.stringify([className, number]);
      if (keys.has(key)) { errors.push(`${label}：同じ学年・クラス・出席番号が重複しています。`); return; }
      keys.add(key); classes.add(className); nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
      const rawScore = row[4], score = normalized(rawScore);
      let value = null, absent = false;
      if (score === '') summary.blankCount++;
      else if (score === '欠') { absent = true; summary.absentCount++; }
      else {
        if ((typeof rawScore !== 'number' && typeof rawScore !== 'string') || !Number.isFinite(Number(score))) errors.push(`${label}：合計点は数値、空欄、または「欠」にしてください。`);
        else { value = Number(score); summary.scoreCount++; }
      }
      roster.push({ className, number, name, value, absent, rowLabel: label });
    });
    summary.studentCount = roster.length; summary.classCount = classes.size;
    summary.duplicateNameCount = [...nameCounts.values()].reduce((n, count) => n + (count > 1 ? count : 0), 0);
    if (!roster.length) errors.push('登録できる名簿がありません。「初回登録」シートに学年・クラス・出席番号・氏名を入力してください。');
    if (summary.duplicateNameCount) warnings.push(`同姓同名の生徒が${summary.duplicateNameCount}名います。学年・クラス・出席番号ごとに別の生徒IDを発行します。`);
    const hasResults = summary.scoreCount + summary.absentCount > 0;
    const testName = text(metadata['テスト名']), subject = text(metadata['教科']);
    const maxScore = Number(normalized(metadata['満点']));
    let gradeYear, date = '';
    if (hasResults) {
      summary.testName = testName;
      if (!testName || !subject) errors.push('点数または欠席を取り込む場合は、見出しより上のテスト名と教科を入力してください。');
      if (typeof metadata['満点'] === 'boolean' || !Number.isFinite(maxScore) || maxScore <= 0) errors.push('満点は0より大きい数値にしてください。');
      if (!empty(metadata['実施学年'])) {
        const g = normalized(metadata['実施学年']);
        if (!/^[123]$/.test(g)) errors.push('実施学年は1〜3の整数、または空欄にしてください。');
        else gradeYear = Number(g);
      }
      date = dateValue(metadata['実施日'], XLSX);
      if (date === null) errors.push('実施日は正しい日付（例：2026-04-20）、または空欄にしてください。');
      roster.forEach(s => { if (s.value != null && (s.value < 0 || s.value > maxScore)) errors.push(`${s.rowLabel}：合計点は0〜${Number.isFinite(maxScore) ? maxScore : '満点'}の範囲にしてください。`); });
    } else if (testName) warnings.push('点数・欠席が1件もないため、名簿だけを登録します。テスト結果は作成しません。');
    if (errors.length) return fail();
    if (!global.crypto || typeof global.crypto.randomUUID !== 'function') { errors.push('生徒IDを安全に作成できません。最新版のブラウザで開いてください。'); return fail(); }
    const students = roster.map(s => ({ id: 'student-' + global.crypto.randomUUID(), name: s.name, className: s.className, number: s.number }));
    const dataset = { version: 3, name: text(metadata['データ名']) || '成績データ', students, tests: [], scores: [], metrics: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null }, interventions: [] };
    if (hasResults) {
      const test = { id: 't-' + global.crypto.randomUUID(), name: testName, subject, maxScore, domains: [], questions: [] };
      if (gradeYear) test.gradeYear = gradeYear;
      if (date) test.date = date;
      dataset.tests.push(test);
      roster.forEach((s, i) => {
        if (s.value == null && !s.absent) return;
        const rec = { studentId: students[i].id, testId: test.id, total: s.value, domains: {}, questions: {} };
        if (s.absent) rec.absent = true;
        dataset.scores.push(rec);
      });
    }
    return { dataset, summary, errors, warnings };
  }
  global.GD_INITIAL = { createTemplate, planWorkbook };
})(window);
