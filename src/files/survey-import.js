/* Bounded, offline readers for the inspected NIER 2026 public workbooks. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_SURVEY_IMPORT = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  // These limits are independent of the existing school Excel importer. The
  // largest inspected original has 131 sheets, 403 ZIP entries and 5.31 MB XML.
  const limits = Object.freeze({ fileBytes: 8 * 1024 * 1024, expandedBytes: 50 * 1024 * 1024,
    entryBytes: 16 * 1024 * 1024, entries: 1024, sheets: 200, rows: 3000, columns: 64, cells: 500000 });
  const version = '1.0.0';
  const fail = message => new Error('全国調査Excel：' + message + ' 取込は反映していません。公式の未加工の原本を選び直してください。');
  const capacity = () => fail('容量・展開量・シート数またはセル範囲が上限を超えています。');
  const norm = s => typeof s === 'string' ? s.normalize('NFKC').replace(/\s+/g, '') : '';
  const clone = value => JSON.parse(JSON.stringify(value));
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function budget(input) {
    const result = input || limits;
    for (const key of Object.keys(limits)) if (!Number.isSafeInteger(result[key]) || result[key] <= 0) throw capacity();
    return result;
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = (previous, bytes) => {
    let result = previous;
    for (const byte of bytes) result = crcTable[(result ^ byte) & 255] ^ (result >>> 8);
    return result;
  };

  // Inspect every entry before SheetJS runs, including the actual streamed
  // expansion and CRC. ZIP declarations alone cannot bound a forged archive.
  async function inspectZip(input, customLimits) {
    const lim = budget(customLimits), bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 22 || bytes.length > lim.fileBytes) throw capacity();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = n => view.getUint16(n, true), u32 = n => view.getUint32(n, true);
    let end = -1;
    for (let n = bytes.length - 22; n >= Math.max(0, bytes.length - 65557); n--) {
      if (u32(n) === 0x06054b50 && n + 22 + u16(n + 20) === bytes.length) { end = n; break; }
    }
    if (end < 0 || u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) throw capacity();
    const count = u16(end + 10), start = u32(end + 16), size = u32(end + 12);
    if (!count || count === 65535 || count > lim.entries || start + size !== end) throw capacity();
    const names = new Set(), segments = [], entries = [];
    let cursor = start, declared = 0;
    for (let i = 0; i < count; i++) {
      if (cursor + 46 > end || u32(cursor) !== 0x02014b50) throw capacity();
      const flags = u16(cursor + 8), method = u16(cursor + 10), checksum = u32(cursor + 16);
      const compressed = u32(cursor + 20), expanded = u32(cursor + 24), local = u32(cursor + 42);
      const nameLength = u16(cursor + 28), extra = u16(cursor + 30), comment = u16(cursor + 32);
      declared += expanded;
      if (flags & ~0x808 || ![0, 8].includes(method) || expanded > lim.entryBytes || declared > lim.expandedBytes ||
          compressed === 0xffffffff || expanded === 0xffffffff || local === 0xffffffff || u16(cursor + 34) ||
          cursor + 46 + nameLength + extra + comment > end) throw capacity();
      const name = Array.from(bytes.subarray(cursor + 46, cursor + 46 + nameLength), b => String.fromCharCode(b)).join('');
      if (!name || names.has(name) || /[\\\x00-\x1f]/.test(name) || name.startsWith('/') || name.includes(':') ||
          name.split('/').some(part => part === '..' || part === '.')) throw fail('ZIP内部のファイル名が不正または重複しています。');
      if (/vbaProject|externalLinks|embeddings|activeX/i.test(name)) throw fail('マクロ・外部参照・埋込オブジェクトを含む資料には対応していません。');
      names.add(name);
      if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 8) !== method || u16(local + 6) !== flags) throw capacity();
      const localNameLength = u16(local + 26), localExtra = u16(local + 28), begin = local + 30 + localNameLength + localExtra;
      if (localNameLength !== nameLength || begin + compressed > start || begin < local) throw capacity();
      for (let j = 0; j < nameLength; j++) if (bytes[local + 30 + j] !== bytes[cursor + 46 + j]) throw capacity();
      if (!(flags & 8) && (u32(local + 14) !== checksum || u32(local + 18) !== compressed || u32(local + 22) !== expanded)) throw capacity();
      let segmentEnd = begin + compressed;
      if (flags & 8) {
        const descriptor = segmentEnd + (segmentEnd + 4 <= start && u32(segmentEnd) === 0x08074b50 ? 4 : 0);
        if (descriptor + 12 > start || u32(descriptor) !== checksum || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== expanded) throw capacity();
        segmentEnd = descriptor + 12;
      }
      if (segments.some(([a, b]) => local < b && segmentEnd > a)) throw capacity();
      segments.push([local, segmentEnd]); entries.push({ name, begin, compressed, expanded, method, checksum });
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== end) throw capacity();
    for (const name of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels']) {
      if (!names.has(name)) throw fail('XLSXブックの構成を確認できません。.xlsx形式の公式資料を使用してください。');
    }
    let total = 0;
    for (const entry of entries) {
      let actual = 0, checksum = 0xffffffff;
      const accept = chunk => {
        actual += chunk.byteLength;
        if (actual > entry.expanded || actual > lim.entryBytes || total + actual > lim.expandedBytes) throw capacity();
        checksum = crc(checksum, chunk);
      };
      if (entry.method === 0) accept(bytes.subarray(entry.begin, entry.begin + entry.compressed));
      else {
        if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined') throw fail('このブラウザでは展開量を検査できません。学校で承認された最新のChromeまたはEdgeを使用してください。');
        const stream = new Blob([bytes.subarray(entry.begin, entry.begin + entry.compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const reader = stream.getReader();
        try {
          while (true) { const next = await reader.read(); if (next.done) break; accept(next.value); }
        } catch (error) { await reader.cancel().catch(() => {}); throw fail('ZIPの展開量が上限を超えているか、ファイルが破損しています。'); }
        finally { reader.releaseLock(); }
      }
      if (actual !== entry.expanded || ((checksum ^ 0xffffffff) >>> 0) !== entry.checksum) throw fail('ZIP内部のサイズまたはCRCが一致しません。ファイルが破損しています。');
      total += actual;
    }
    return { entries: count, expandedBytes: total };
  }

  function validateWorkbook(wb, X, customLimits) {
    const lim = budget(customLimits);
    if (!wb || !X?.utils || !Array.isArray(wb.SheetNames) || !wb.Sheets || !wb.SheetNames.length || wb.SheetNames.length > lim.sheets ||
        new Set(wb.SheetNames).size !== wb.SheetNames.length) throw capacity();
    let area = 0, actual = 0, characters = 0;
    for (const name of wb.SheetNames) {
      const sheet = wb.Sheets[name];
      if (typeof name !== 'string' || !name || name.length > 100 || !sheet || typeof sheet !== 'object') throw capacity();
      const ref = sheet['!ref'];
      if (typeof ref !== 'string' || !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(ref)) throw capacity();
      const range = X.utils.decode_range(ref);
      for (const address of [ref, sheet['!fullref']].filter(Boolean)) {
        if (typeof address !== 'string' || !/^[A-Z]+[1-9]\d*(?::[A-Z]+[1-9]\d*)?$/.test(address)) throw capacity();
        const bounds = X.utils.decode_range(address);
        if (bounds.s.r > bounds.e.r || bounds.s.c > bounds.e.c || bounds.e.r >= lim.rows || bounds.e.c >= lim.columns) throw capacity();
        if (address !== ref && (bounds.s.r !== range.s.r || bounds.s.c !== range.s.c || bounds.e.r !== range.e.r || bounds.e.c !== range.e.c)) throw capacity();
      }
      area += (range.e.r - range.s.r + 1) * (range.e.c - range.s.c + 1);
      if (area > lim.cells) throw capacity();
      for (const [address, cell] of Object.entries(sheet)) {
        if (address.startsWith('!')) continue;
        if (!/^[A-Z]+[1-9]\d*$/.test(address) || ++actual > lim.cells) throw capacity();
        const pos = X.utils.decode_cell(address);
        if (pos.r < range.s.r || pos.c < range.s.c || pos.r > range.e.r || pos.c > range.e.c || pos.r >= lim.rows || pos.c >= lim.columns) throw capacity();
        if (!cell || typeof cell !== 'object' || Object.hasOwn(cell, 'f') || Object.hasOwn(cell, 'F') || cell.t === 'e') throw fail('「' + name + '」' + address + 'に数式またはExcelのエラー値があります。数式の保存値は使用できません。');
        if (cell.v != null && typeof cell.v !== 'string' && (typeof cell.v !== 'number' || !Number.isFinite(cell.v))) throw fail('「' + name + '」' + address + 'は有限の数値または文字列ではありません。');
        if (typeof cell.v === 'string') { characters += cell.v.length; if (cell.v.length > 20000 || characters > 4000000) throw capacity(); }
      }
    }
    return wb;
  }

  const questionCodes = (() => {
    const codes = [], subdivisions = { 18: 3, 19: 3, 31: 2, 32: 4, 34: 2, 36: 4, 37: 11, 68: 10, 77: 5 };
    for (let n = 1; n <= 80; n++) {
      if (subdivisions[n]) for (let j = 1; j <= subdivisions[n]; j++) codes.push(n + '-' + j);
      else codes.push(String(n));
    }
    codes.push('国1', '国2', '数1', '数2');
    for (const [part, count] of [[1, 3], [2, 5], [3, 4]]) for (let n = 1; n <= count; n++) codes.push('英' + part + '-' + n);
    return Object.freeze(codes);
  })();
  const randomQuestion = code => /^(18-|19-|31-|32-|34-|37-|68-|77-|英[123]-)/.test(code);
  // Administrative metadata is a versioned reader profile, not a statistical
  // fixture. Exact matching prevents a changed participation rule being
  // interpreted with the original rule's structured denominator fields.
  const administrationNotes = {
    distribution: '※１：質問番号（１）～（８０）は、４月２０日以降５月８日までに実施した調査の結果を集計した値である。' +
      '※２：質問番号（国１）と（国２）、（数１）と（数２）は、それぞれ国語、数学の調査を４月２３日以降４月３０日までに実施した調査の結果を集計した値である。' +
      '※３：質問番号（英１－１）～（英１－３）、（英２－１）～（英２－５）は、英語３技能「聞くこと」「読むこと」「書くこと」の調査を４月２０日以降５月１日までに実施した調査の結果を集計した値である。' +
      '※４：質問番号（英３－１）～（英３－４）は、英語「話すこと」の調査を４月２４日以降５月２９日までに実施した調査の結果を集計した値である。' +
      '※５：以下の質問番号はランダム方式の質問項目で、生徒はこの中からそれぞれ指定の項目数を回答するように実施された。' +
      '１項目回答：（１８－１）～（１８－３）、（１９－１）～（１９－３）、（３１－１）～（３１－２）、（３２－１）～（３２－４）、（３４－１）～（３４－２）、（英１－１）～（英１－３）、（英２－１）～（英２－５）、（英３－１）～（英３－４）' +
      '２項目回答：（３７－１）～（３７－１１）、（６８－１）～（６８－１０）、（７７－１）～（７７－５）' +
      '※６：①～⑥の表の「生徒数」は、この集計の対象となった生徒数、「学校数」は、「生徒数」集計の対象者が属する学校数である。' +
      '※７：【その他】とは、『回答対象とされた設問のうち、回答結果が得られなかったもの』である。',
    cross: '・以下の集計値は、次の実施日に教科に関する調査を一つ以上実施し、かつ、生徒質問調査を実施した生徒を対象として集計した値である。' +
      '４月２３日（国語、数学）４月２０日～４月２４日（英語３技能「聞くこと」「読むこと」「書くこと」）',
    quartile: '※Ａ～Ｄ層について 各層は生徒を正答数の大きい順に整列し、人数比率により２５％刻みで４つの層分けを行っている。' +
      '上位から１番目をＡ層、２番目をＢ層、３番目をＣ層、４番目をＤ層と呼称する。正答数が同じ場合は、上位の層に含む。',
    means: '※以下の質問番号はランダム方式の質問項目で、児童生徒はこの中からそれぞれ指定の項目数を回答するように実施された。' +
      '１項目回答：（１８－１）～（１８－３）、（１９－１）～（１９－３）、（３１－１）～（３１－２）、（３２－１）～（３２－４）、（３４－１）～（３４－２）、' +
      '（英１－１）～（英１－３）、（英２－１）～（英２－５）、（英３－１）～（英３－４）' +
      '２項目回答：（３７－１）～（３７－１１）、（６８－１）～（６８－１０）、（７７－１）～（７７－５）'
  };
  function randomCodesFromNote(note, reader, address) {
    const normalized = norm(note), start = normalized.indexOf('ランダム方式'), codes = new Set();
    for (const match of normalized.slice(start).matchAll(/\((\d+|英[123])-(\d+)\)[~～]\((\d+|英[123])-(\d+)\)/g)) {
      const first = Number(match[2]), last = Number(match[4]);
      if (match[1] !== match[3] || first < 1 || last < first || last > 20) throw reader.problem(address, 'ランダム質問の範囲が対応形式と一致しません。');
      for (let n = first; n <= last; n++) codes.add(match[1] + '-' + n);
    }
    const expected = questionCodes.filter(randomQuestion);
    if (start < 0 || codes.size !== expected.length || expected.some(code => !codes.has(code))) throw reader.problem(address, 'ランダム質問52項目の指定範囲を注記から確認できません。');
    return codes;
  }
  const otherLabel = 'その他（回答対象とされた設問のうち、回答結果が得られなかったもの）';
  const extraOptions = () => [{ code: 'other', label: otherLabel, responseStatus: 'unknown' }, { code: 'noResponse', label: '無回答', responseStatus: 'noResponse' }];
  const scale = kind => ({ kind, unit: { response: 'category', percentCorrect: 'percent', irtScore: 'irtScore' }[kind],
    version: null, minimum: kind === 'percentCorrect' ? 0 : null, maximum: kind === 'percentCorrect' ? 100 : null, step: null, bands: [] });
  const missing = () => ({ value: null, status: 'notProvided', decimals: null });
  const codeId = code => code.replace('国', 'ja').replace('数', 'ma').replace('算', 'ar').replace('英', 'en');
  function sheetReader(sheet, name, sourceId) {
    const used = new Set();
    const read = address => { used.add(address); return sheet[address]?.v ?? null; };
    const problem = (address, message) => fail('「' + name + '」' + address + '：' + message);
    const label = (address, expected) => {
      const value = read(address);
      if (typeof value !== 'string' || (expected !== undefined && norm(value) !== norm(expected))) throw problem(address, '見出しまたは表の配置が対応形式と一致しません。');
      return value;
    };
    const numeric = (address, kind, decimals) => {
      const raw = read(address), provenance = { sourceId, sheet: name, range: address, raw, derivation: 'literal' };
      if (raw === null || raw === '' || raw === '－' || raw === '—' || raw === '-') return { value: null, status: 'notProvided', decimals: null, provenance };
      if (typeof raw !== 'number' || !Number.isFinite(raw) || (kind === 'count' && (!Number.isSafeInteger(raw) || raw < 0 || raw > 1e9)) ||
          (kind === 'percent' && (raw < 0 || raw > 100))) throw problem(address, '公表値が有効な数値ではありません。');
      const format = typeof sheet[address]?.z === 'string' ? sheet[address].z.replace(/_./g, '').trim() : '';
      if (format !== (decimals === 1 ? '0.0' : '0') && !(decimals === 0 && format === '#,##0')) throw problem(address, '公表精度・表示単位の書式が対応する原本と一致しません。');
      return { value: raw, status: 'observed', decimals, provenance };
    };
    return { read, label, numeric, problem, name,
      code(address, expected) {
        const value = label(address), match = /^\((\d+(?:-\d+)?|[国数算]\d+|英\d+-\d+)\)$/.exec(norm(value));
        if (!match || (expected !== undefined && match[1] !== expected)) throw problem(address, '質問番号・順序が対応年度の表と一致しません。');
        return match[1];
      },
      complete() {
        for (const [address, cell] of Object.entries(sheet)) if (!address.startsWith('!') && cell.v != null && cell.v !== '' && !used.has(address)) {
          throw problem(address, '未対応の位置に値があります。行列の追加・移動または別形式の表を読み飛ばすことはできません。');
        }
      }
    };
  }
  function sourceNotes(raw) { return raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean); }
  function noteQuestion(code) {
    return randomQuestion(code) ? ['ランダム方式の質問です。質問ごとの回答対象者を分母とし、通常の名簿人数・調査全体人数へ置き換えません。学校返却資料にない値は未提供として扱ってください。'] : [];
  }
  function question(context, reader, code, text, options, schoolLevel, complete) {
    const instrument = { id: context.source.id + '-q-' + (schoolLevel === 'elementary' ? 'e-' : 'm-') + codeId(code), version: 1,
      year: 2026, schoolLevel, grade: schoolLevel === 'elementary' ? 6 : 3, respondent: 'student', kind: 'question', code, text,
      options, subject: null, skills: [], formId: null, scale: scale('response'), sourceIds: [context.source.id], definitionStatus: complete ? 'complete' : 'codesOnly' };
    instrument.schoolAvailability = randomQuestion(code) ? 'notReturned' : 'unknown';
    instrument.locations = [];
    context.candidate.instruments.push(instrument);
    return instrument;
  }
  function subject(context, schoolLevel, name, location) {
    const id = context.source.id + '-s-' + (schoolLevel === 'elementary' ? 'e-' : 'm-') + name;
    const existing = context.candidate.instruments.find(i => i.id === id);
    if (existing) {
      if (location && !existing.locations.some(loc => loc.sheet === location.sheet && loc.range === location.range)) existing.locations.push({ sourceId: context.source.id, ...location });
      return existing;
    }
    const english = name === 'english', label = { japanese: '国語', mathematics: schoolLevel === 'elementary' ? '算数' : '数学', english: '英語３技能' }[name];
    const instrument = { id, version: 1, year: 2026, schoolLevel, grade: schoolLevel === 'elementary' ? 6 : 3, respondent: 'student', kind: 'subject',
      code: 'NIER-2026-' + name, text: label + (english ? ' 平均IRTスコア' : ' 平均正答率'), options: [], subject: name,
      skills: english ? ['listening', 'reading', 'writing'] : [], formId: null,
      scale: scale(english ? 'irtScore' : 'percentCorrect'), sourceIds: [context.source.id], definitionStatus: 'complete' };
    instrument.schoolAvailability = 'unknown';
    instrument.locations = location ? [{ sourceId: context.source.id, ...location }] : [];
    if (context.source.reader.id === 'nier-2026-cross') {
      instrument.formId = 'nier:2026:lowerSecondary:' + name + (english ? ':3skills' : '') + ':main';
      instrument.scale.version = 'nier:2026:lowerSecondary:' + name + (english ? ':3skills' : '') + ':scale';
      if (!english) instrument.rawScoreMaximum = name === 'japanese' ? 15 : 16;
    }
    context.candidate.instruments.push(instrument);
    return instrument;
  }
  function statistic(context, instrument, suffix, type, denominator, population, notes = []) {
    return { id: instrument.id + '-' + suffix, instrumentId: instrument.id, sourceId: context.source.id, type, version: 1,
      observationUnit: context.unit, geography: { level: 'national', code: 'JP', label: '全国' }, ownership: context.ownership,
      population, denominator, notes: noteQuestion(instrument.code).concat(notes) };
  }
  function sumCount(cells, reader, range, sourceId) {
    if (cells.some(cell => cell.status !== 'observed')) throw reader.problem(range, '人数の一部が未提供のため設問別の分母を確定できません。');
    const value = cells.reduce((sum, cell) => sum + cell.value, 0);
    if (!Number.isSafeInteger(value) || value > 1e9) throw reader.problem(range, '人数合計が範囲外です。');
    return { value, status: 'observed', decimals: 0, provenance: { sourceId, sheet: reader.name, range, raw: null, derivation: 'sum' } };
  }
  function requireCounts(values, total, reader, address) {
    if (total.status !== 'observed' || values.some(cell => cell.status !== 'observed') || values.reduce((sum, cell) => sum + cell.value, 0) !== total.value) throw reader.problem(address, '掲載人数の合計が分母と一致しません。');
  }
  function requirePercentCounts(values, total, reader, address) {
    for (const item of values) {
      const value = item.value || item.count, percent = item.publishedPercent;
      if (!percent || percent.status !== 'observed' || value.status !== 'observed' || total.status !== 'observed' || total.value <= 0 ||
          Math.abs(percent.value - value.value / total.value * 100) > 0.5 * Math.pow(10, -percent.decimals) + 1e-9) throw reader.problem(address, '掲載人数と公表割合が掲載精度を考慮しても一致しません。');
    }
  }
  function commonHeader(reader, kind) {
    const title = reader.label('A1'), year = /^令和(\d+)年度全国学力・学習状況調査$/.exec(norm(title));
    if (!year || Number(year[1]) !== 8) throw reader.problem('A1', '対応年度は内部見出しが令和8年度の全国学力・学習状況調査です。');
    const titles = { distribution: '回答結果集計　［生徒質問］', cross: 'クロス集計表　［生徒質問－教科］', means: '選択肢別平均正答率・平均IRTスコア　［児童生徒質問］' };
    reader.label('A2', titles[kind]);
    reader.label(kind === 'distribution' ? 'AB1' : kind === 'cross' ? 'P1' : 'W1', kind === 'means' ? '小中学校並記' : '中学校調査');
    reader.label('B3', kind === 'distribution' ? '全国－生徒（公立）' : kind === 'cross' ? '全国－生徒（国・公・私立）' : '全国－学校（国・公・私立）');
  }

  function read402(context, wb) {
    if (wb.SheetNames.length !== 1) throw fail('回答結果集計の主シートが一意ではありません。');
    const name = wb.SheetNames[0], r = sheetReader(wb.Sheets[name], name, context.source.id);
    commonHeader(r, 'distribution');
    context.source.notes = sourceNotes(r.label('B5', administrationNotes.distribution));
    if (!norm(context.source.notes.join('')).includes('ランダム方式') || !context.source.notes.join('').includes('回答対象とされた設問')) throw r.problem('B5', '回答対象・その他・ランダム方式の注記を確認できません。');
    randomCodesFromNote(context.source.notes.join(''), r, 'B5');
    for (const [a, text] of [['B7', '生徒数'], ['D7', '学校数'], ['G7', '生徒数'], ['H7', '学校数'], ['I7', '生徒数'], ['J7', '学校数'], ['K7', '生徒数'], ['L7', '学校数'], ['M7', '生徒数'], ['N7', '学校数'], ['O7', '生徒数'], ['P7', '学校数'], ['B10', '質問番号'], ['C10', '質問事項'], ['G10', '選択肢'], ['AA10', 'その他'], ['AB10', '無回答']]) r.label(a, text);
    for (const a of ['B6', 'G6', 'I6', 'K6', 'M6', 'O6']) r.label(a);
    for (const a of ['B8', 'D8', 'G8', 'H8', 'I8', 'J8', 'K8', 'L8', 'M8', 'N8', 'O8', 'P8']) r.numeric(a, 'count', 0);
    r.label('N9', '1段目：生徒数　2段目：生徒数の割合(％)');
    for (let n = 1; n <= 20; n++) r.label(context.X.utils.encode_cell({ r: 10, c: n + 5 }), String(n));
    questionCodes.forEach((code, index) => {
      const row = index < 115 ? 12 + index * 4 : 613 + (index - 115) * 4;
      r.code('B' + row, code); const text = r.label('C' + row), options = [], values = [];
      let gap = false;
      for (let n = 1; n <= 20; n++) {
        const column = context.X.utils.encode_col(n + 5), count = r.numeric(column + row, 'count', 0), percent = r.numeric(column + (row + 1), 'percent', 1);
        if (count.status !== 'observed' && percent.status !== 'observed') { gap = true; continue; }
        if (gap || count.status !== 'observed' || percent.status !== 'observed') throw r.problem(column + row, '選択肢の人数・割合の配置が対応形式と一致しません。');
        options.push({ code: String(n), label: '選択肢' + n + '（文言未掲載）', responseStatus: 'answered' });
        values.push({ code: String(n), value: count, publishedPercent: percent });
      }
      if (!options.length) throw r.problem('G' + row, '回答選択肢がありません。');
      options.push(...extraOptions());
      for (const [code, column] of [['other', 'AA'], ['noResponse', 'AB']]) values.push({ code, value: r.numeric(column + row, 'count', 0), publishedPercent: r.numeric(column + (row + 1), 'percent', 1) });
      const instrument = question(context, r, code, text, options, 'lowerSecondary', false);
      instrument.locations.push({ sourceId: context.source.id, sheet: name, range: 'B' + row + ':C' + row }, { sourceId: context.source.id, sheet: name, range: 'G10:AB11' });
      const denominator = { basis: 'questionParticipants', definition: '当該設問の回答対象者（その他・無回答を含む）', count: sumCount(values.map(v => v.value), r, 'G' + row + ':AB' + row, context.source.id) };
      requirePercentCounts(values, denominator.count, r, 'G' + row + ':AB' + (row + 1));
      context.candidate.references.push({ ...statistic(context, instrument, 'distribution', 'distribution', denominator,
        { participation: 'question', definition: '当該設問の回答対象者（その他・無回答を含む）' }, ['設問別の分母は掲載された選択肢別人数の合計です。公表割合は丸め直さず保持しています。', '選択肢の文言はこの資料に掲載されていません。']), basis: 'count', partition: true, values });
    });
    r.complete();
    context.warnings.push({ code: 'codesOnly', message: '回答結果集計には選択肢の文言がありません。同年度・同一設問のクロス集計等を一緒に選ぶと、一致した文言だけを補完します。', locations: [{ sheet: name, range: 'G10:Z11' }] });
  }

  function read424(context, wb) {
    if (wb.SheetNames.length !== questionCodes.length) throw fail('クロス集計は131設問のシートを含む原本に対応しています。シート数が一致しません。');
    const seen = new Set();
    for (const name of wb.SheetNames) {
      const r = sheetReader(wb.Sheets[name], name, context.source.id);
      commonHeader(r, 'cross');
      const note = r.label('B5', administrationNotes.cross), quartileNote = r.label('B75', administrationNotes.quartile);
      if (!norm(note).includes('教科に関する調査を一つ以上実施し') || !norm(note).includes('生徒質問調査を実施した生徒') ||
          !norm(quartileNote).includes('正答数が同じ場合は、上位の層に含む')) throw r.problem('B5', '参加条件または四分位の定義の注記が対応形式と一致しません。');
      if (!context.source.notes.length) context.source.notes = sourceNotes(note).concat(sourceNotes(quartileNote));
      r.label('B7', '質問番号'); r.label('D7', '質問事項');
      const code = r.code('B8'), text = r.label('D8');
      if (!questionCodes.includes(code) || seen.has(code)) throw r.problem('B8', '対象外または重複した質問番号です。');
      seen.add(code);
      for (const [a, label] of [['B10', '＜生徒が回答した選択肢別の平均正答率、平均IRTスコア＞'], ['B11', '選択肢'], ['G11', '生徒数'], ['H11', '生徒数の割合(％)'], ['I11', '平均正答率(％)'], ['K11', '平均IRTスコア'], ['I12', '国語（１５問）'], ['J12', '数学（１６問）'], ['K12', '英語３技能'], ['B23', otherLabel], ['B24', '無回答'], ['B25', '合計'], ['B30', '＜四分位によるクロス＞'], ['P30', '上段：生徒数　下段：生徒数の割合(％)'], ['D31', '全体'], ['E31', '選択肢'], ['O31', 'その他'], ['P31', '無回答']]) r.label(a, label);
      const options = [], optionRows = [];
      let gap = false;
      for (let n = 1; n <= 10; n++) {
        const row = 12 + n; r.label('B' + row, String(n)); r.label(context.X.utils.encode_col(n + 3) + '32', String(n));
        const label = r.read('C' + row);
        if (label === null || label === '') {
          gap = true;
          for (const column of ['G', 'H', 'I', 'J', 'K']) if (r.read(column + row) !== null) throw r.problem(column + row, '文言のない選択肢に統計値があります。');
          continue;
        }
        if (typeof label !== 'string' || gap) throw r.problem('C' + row, '選択肢の文言・順序が不正です。');
        options.push({ code: String(n), label, responseStatus: 'answered' }); optionRows.push(row);
      }
      if (!options.length) throw r.problem('C13', '選択肢の文言がありません。');
      options.push(...extraOptions()); optionRows.push(23, 24);
      const instrument = question(context, r, code, text, options, 'lowerSecondary', true);
      instrument.locations.push({ sourceId: context.source.id, sheet: name, range: 'B8:D8' }, { sourceId: context.source.id, sheet: name, range: 'B13:C24' });
      const population = { participation: 'joint', definition: note };
      const distribution = options.map((option, i) => ({ code: option.code, value: r.numeric('G' + optionRows[i], 'count', 0), publishedPercent: r.numeric('H' + optionRows[i], 'percent', 1) }));
      const total = r.numeric('G25', 'count', 0); r.numeric('H25', 'percent', 1);
      requireCounts(distribution.map(v => v.value), total, r, 'G13:G25');
      requirePercentCounts(distribution, total, r, 'G13:H25');
      context.candidate.references.push({ ...statistic(context, instrument, 'distribution', 'distribution',
        { basis: 'jointParticipants', definition: '生徒質問調査と少なくとも一つの教科調査の参加者のうち、当該設問の回答対象者', count: total }, population,
        ['この人数は教科ごとの平均算出人数ではありません。']), basis: 'count', partition: true, values: distribution });
      for (const [subjectName, column] of [['japanese', 'I'], ['mathematics', 'J'], ['english', 'K']]) {
        const subj = subject(context, 'lowerSecondary', subjectName, { sheet: name, range: column + '11:' + column + '12' }), isEnglish = subjectName === 'english';
        const values = options.map((option, i) => ({ code: option.code, count: missing(), mean: r.numeric(column + optionRows[i], isEnglish ? 'mean' : 'percent', isEnglish ? 0 : 1), standardDeviation: missing() }));
        context.candidate.references.push({ ...statistic(context, instrument, 'mean-' + subjectName, 'conditionalMean',
          { basis: 'jointParticipants', definition: '当該質問と' + (isEnglish ? '英語３技能' : subjectName === 'japanese' ? '国語' : '数学') + 'の有効な結果を持つ対象者（平均算出人数は未掲載）', count: missing() }, population,
          ['G列は少なくとも一つの教科の参加者数であり、この教科平均の分母には使用していません。', '教科尺度の接続IDは本アプリ内の識別子です。同じ令和8年度公式調査・教科・技能範囲の返却結果に限って照合できます。']),
          subjectInstrumentId: subj.id, values, total: { count: missing(), mean: r.numeric(column + '25', isEnglish ? 'mean' : 'percent', isEnglish ? 0 : 1), standardDeviation: missing() } });
      }
      for (const [subjectName, row, label] of [['japanese', 35, '国語'], ['mathematics', 45, '数学']]) {
        r.label('B' + row, label); r.label('C' + row, '全体');
        const count = r.numeric('D' + row, 'count', 0); r.numeric('D' + (row + 1), 'percent', 1);
        const groups = ['A', 'B', 'C', 'D'].map((code, i) => {
          const rr = row + 2 + i * 2; const label = r.label('C' + rr, code + '層');
          return { code, label, count: r.numeric('D' + rr, 'count', 0), publishedPercent: r.numeric('D' + (rr + 1), 'percent', 1) };
        });
        requireCounts(groups.map(group => group.count), count, r, 'D' + row + ':D' + (row + 9));
        requirePercentCounts(groups, count, r, 'D' + row + ':D' + (row + 9));
        const rows = options.map((option, i) => {
          const column = option.code === 'other' ? 'O' : option.code === 'noResponse' ? 'P' : context.X.utils.encode_col(Number(option.code) + 3);
          return { code: option.code, count: r.numeric(column + row, 'count', 0), publishedPercent: r.numeric(column + (row + 1), 'percent', 1),
            values: groups.map((group, j) => ({ code: group.code, value: r.numeric(column + (row + 2 + j * 2), 'count', 0), publishedPercent: r.numeric(column + (row + 3 + j * 2), 'percent', 1) })) };
        });
        requireCounts(rows.map(item => item.count), count, r, 'E' + row + ':P' + row);
        requirePercentCounts(rows, count, r, 'E' + row + ':P' + (row + 1));
        rows.forEach(item => requireCounts(item.values.map(v => v.value), item.count, r, 'E' + row + ':P' + (row + 9)));
        groups.forEach((group, i) => {
          requireCounts(rows.map(item => item.values[i].value), group.count, r, 'E' + row + ':P' + (row + 9));
          requirePercentCounts(rows.map(item => item.values[i]), group.count, r, 'E' + row + ':P' + (row + 9));
        });
        context.candidate.references.push({ ...statistic(context, instrument, 'cross-' + subjectName, 'crossTab',
          { basis: 'jointParticipants', definition: '当該質問と' + label + 'の結果を対応付けた対象者（その他・無回答を含む）', count }, population,
          sourceNotes(quartileNote).concat(['四分位の数値境界はこの資料に未掲載です。A～D層をRTI支援区分やIRTバンドに読み替えません。', '原表の行内割合は、保存時の転置後は列内割合です。'])),
          subjectInstrumentId: subject(context, 'lowerSecondary', subjectName).id, basis: 'count', normalization: 'column',
          grouping: { kind: 'quartile', scope: 'national', definitionId: null, bands: null }, groups, rows });
      }
      r.complete();
    }
    context.warnings.push({ code: 'subjectCountsUnavailable', message: '選択肢別平均の教科別人数は未掲載です。共通の生徒数は回答分布に保持し、各教科平均の人数には流用していません。', locations: [] },
      { code: 'quartileBoundariesUnavailable', message: '四分位は国語・数学の実際のクロス表を保存しました。数値境界は未掲載のため、独自の四分位や支援区分との数値比較はできません。', locations: [] });
  }

  function read427(context, wb) {
    if (wb.SheetNames.length !== 1) throw fail('選択肢別平均の主シートが一意ではありません。');
    const name = wb.SheetNames[0], r = sheetReader(wb.Sheets[name], name, context.source.id);
    commonHeader(r, 'means');
    const note = r.label('B4', administrationNotes.means); context.source.notes = sourceNotes(note);
    if (!norm(note).includes('ランダム方式')) throw r.problem('B4', 'ランダム方式の注記を確認できません。');
    randomCodesFromNote(note, r, 'B4');
    for (const [a, label] of [['B5', '質問番号'], ['D5', '質問事項'], ['L5', '選択肢'], ['R5', '小学校'], ['U5', '中学校'], ['B6', '小'], ['C6', '中'], ['R6', '国語'], ['S6', '算数'], ['U6', '国語'], ['V6', '数学'], ['W6', '英語３技能IRTスコア']]) r.label(a, label);
    questionCodes.forEach((middleCode, index) => {
      const row = 7 + index * 13; r.code('C' + row, middleCode);
      const elementaryRaw = r.read('B' + row), elementaryCode = elementaryRaw === '-' ? null : r.code('B' + row);
      const expectedElementary = /^英/.test(middleCode) || /^(71|72|74|77-\d+|78|79|80)$/.test(middleCode) ? null : ({ 73: '71', 75: '72', 76: '73', '数1': '算1', '数2': '算2' }[middleCode] || middleCode);
      if (elementaryCode !== expectedElementary) throw r.problem('B' + row, '小中の質問番号の対応が令和8年度の原本と一致しません。');
      const text = r.label('D' + row), options = [], optionRows = [];
      let gap = false;
      for (let j = 0; j < 13; j++) {
        const rr = row + j, label = r.read('L' + rr);
        if (label === null || label === '') {
          gap = true;
          for (const column of ['R', 'S', 'U', 'V', 'W']) if (r.read(column + rr) !== null) throw r.problem(column + rr, '選択肢のない行に平均が掲載されています。');
          continue;
        }
        if (typeof label !== 'string' || gap || j >= 10) throw r.problem('L' + rr, '選択肢の文言または配置が不正です。');
        options.push({ code: String(j + 1), label, responseStatus: 'answered' }); optionRows.push(rr);
      }
      if (!options.length) throw r.problem('L' + row, '選択肢がありません。');
      for (const [schoolLevel, code, columns] of [['elementary', elementaryCode, [['japanese', 'R'], ['mathematics', 'S']]], ['lowerSecondary', middleCode, [['japanese', 'U'], ['mathematics', 'V'], ['english', 'W']]]]) {
        if (!code) { for (const rr of optionRows) for (const [, column] of columns) if (r.read(column + rr) !== null) throw r.problem(column + rr, '対象外の学校段階に平均が掲載されています。'); continue; }
        const separate = /^【小学校】([\s\S]+)\n【中学校】([\s\S]+)$/.exec(text);
        const questionText = separate ? separate[schoolLevel === 'elementary' ? 1 : 2] : text;
        const instrument = question(context, r, code, questionText, clone(options), schoolLevel, true);
        instrument.locations.push({ sourceId: context.source.id, sheet: name, range: 'B' + row + ':D' + row }, { sourceId: context.source.id, sheet: name, range: 'L' + row + ':L' + optionRows[optionRows.length - 1] });
        for (const [subjectName, column] of columns) {
          const english = subjectName === 'english', subj = subject(context, schoolLevel, subjectName, { sheet: name, range: column + '5:' + column + '6' });
          context.candidate.references.push({ ...statistic(context, instrument, 'mean-' + subjectName, 'conditionalMean',
            { basis: 'unknown', definition: null, count: missing() }, { participation: 'unknown', definition: null },
            ['原本の主見出しは「全国－学校（国・公・私立）」、表題は「児童生徒質問」です。観測単位・分母を確認できないため参考表示に限ります。', '人数・無回答・その他の平均はこの資料に未掲載です。', '小中併記の質問文・選択肢は原文を保持しています。略記から他資料の設問文を推測して対応付けません。']),
            subjectInstrumentId: subj.id, values: options.map((option, i) => ({ code: option.code, count: missing(), mean: r.numeric(column + optionRows[i], english ? 'mean' : 'percent', english ? 0 : 1), standardDeviation: missing() })) });
        }
      }
    });
    r.complete();
    context.warnings.push({ code: 'observationUnitUnknown', message: '選択肢別平均資料は主見出しが「全国－学校」、表題が「児童生徒質問」です。観測単位・分母は未確認として保持し、参考表示に限ります。', locations: [{ sheet: name, range: 'A2:B3' }] });
  }

  async function bytesFrom(input) {
    if (input && typeof input.arrayBuffer === 'function') {
      if (!Number.isFinite(input.size) || input.size <= 0 || input.size > limits.fileBytes) throw capacity();
      const bytes = new Uint8Array(await input.arrayBuffer());
      if (bytes.byteLength !== input.size) throw fail('読み込んだファイルの容量が一致しません。');
      return bytes;
    }
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    throw fail('FileまたはXLSXのバイナリデータを指定してください。');
  }
  async function identity(bytes) {
    if (root.crypto?.subtle) {
      const digest = await root.crypto.subtle.digest('SHA-256', bytes);
      const value = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      return { suffix: value.slice(0, 24), fingerprint: { algorithm: 'sha256', value } };
    }
    // Content identity remains deterministic where Web Crypto is unavailable;
    // this local checksum is deliberately not presented as a SHA-256 digest.
    let a = 2166136261, b = 0x9e3779b9;
    for (const byte of bytes) { a = Math.imul(a ^ byte, 16777619); b = Math.imul(b ^ byte, 2246822519); }
    return { suffix: (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0'), fingerprint: null };
  }
  function validateCandidate(candidate) {
    const core = root.GD_SURVEY || (typeof require === 'function' ? require('./survey-core.js') : null);
    if (!core?.validate) throw fail('調査データ検証モジュールを読み込めません。アプリをすべて展開して開き直してください。');
    const errors = core.validate(candidate);
    if (errors.length) throw fail('読み取った表の整合性を確認できません。' + errors.slice(0, 3).join(' '));
  }
  async function parseOfficialWorkbook(input, meta = {}, dependencies = {}) {
    const X = dependencies.XLSX || meta.XLSX || root.XLSX;
    if (!X?.read || !X?.utils) throw fail('Excel読取ライブラリがありません。アプリをすべて展開して開き直してください。');
    const bytes = await bytesFrom(input);
    await inspectZip(bytes);
    let wb;
    try { wb = X.read(bytes, { type: 'array', cellFormula: true, cellHTML: false, cellStyles: false, cellNF: true, sheetRows: limits.rows + 1 }); }
    catch (error) { throw fail('XLSXブックを解析できません。'); }
    validateWorkbook(wb, X);
    if (wb.Workbook?.Sheets?.some(sheet => sheet.Hidden)) throw fail('非表示のシートを含む資料には対応していません。');
    const first = wb.Sheets[wb.SheetNames[0]], title = norm(first.A2?.v);
    const kind = title === norm('回答結果集計［生徒質問］') ? 'distribution' : title === norm('クロス集計表［生徒質問－教科］') ? 'cross' : title === norm('選択肢別平均正答率・平均IRTスコア［児童生徒質問］') ? 'means' : null;
    if (!kind) throw fail('内部の正式見出しから対応資料を特定できません。令和8年度の生徒質問・回答結果集計、質問と教科のクロス集計、または選択肢別平均の原本を選んでください。');
    const identityInfo = await identity(bytes), readerId = 'nier-2026-' + kind;
    const source = { id: readerId + '-' + identityInfo.suffix, kind: 'official', title: first.A1.v + ' ' + first.A2.v,
      publisher: '国立教育政策研究所', url: 'https://www.nier.go.jp/26chousakekkahoukoku/factsheet/data/' +
        ({ distribution: '26m_402.xlsx', cross: '26m_424.xlsx', means: '26pm_427.xlsx' })[kind], fileName: meta.fileName || input?.name || null,
      importedAt: meta.importedAt || new Date().toISOString(), fingerprint: identityInfo.fingerprint,
      reader: { id: readerId, version }, locations: wb.SheetNames.map(name => ({ sheet: name, range: wb.Sheets[name]['!ref'] })), notes: [] };
    const candidate = { schemaVersion: 1, sources: [source], instruments: [], references: [], waves: [] };
    const context = { X, source, candidate, ownership: kind === 'distribution' ? 'public' : 'all', unit: kind === 'means' ? 'unknown' : 'student', warnings: [] };
    ({ distribution: read402, cross: read424, means: read427 })[kind](context, wb);
    source.notes.push('出典URLは読取器の年度・資料プロファイルに対応する公開原本の掲載先です。ファイル指紋は選択したファイルの内容識別用であり、公的機関による真正性を検証した証明ではありません。',
      '学年（小学6年・中学3年）はExcelのセルからの読取値ではなく、令和8年度公式調査の対象学年に基づく補完です。https://www.nier.go.jp/26chousakekkahoukoku/report/data/26meng_01.pdf#page=5',
      'ランダム方式52項目は学校別の結果が返却されないため、学校側は未提供のまま扱えます。独自に質問した場合は別の実施回に保存してください。https://www.nier.go.jp/26chousakekkahoukoku/report/data/26qn_01.pdf#page=23');
    if (kind === 'cross') source.notes.push('教科のformId・scale.versionは、令和8年度の同じ公式調査・教科・技能範囲・尺度への接続を表す本アプリ内の識別子です。公的発行IDや同一問題冊子を表すIDではありません。学校側には同じ公式調査から返却された値のみを使用してください。',
      '中学校英語は「聞くこと」「読むこと」「書くこと」の3技能です。生徒ごとに異なる問題をIRTで同尺度に接続する調査のため、4技能や別の調査の得点は同じ接続IDにできません。https://www.nier.go.jp/26chousakekkahoukoku/26meng_irt.pdf');
    validateCandidate(candidate);
    return freeze({ candidate, warnings: context.warnings, recognition: [{ readerId, year: 2026,
      kinds: [...new Set(candidate.references.map(r => r.type))], schoolLevels: [...new Set(candidate.instruments.map(i => i.schoolLevel))], ownerships: [context.ownership] }], definitionMatches: [] });
  }
  async function parseOfficialFiles(files, options = {}) {
    if (!Array.isArray(files) || !files.length || files.length > 3) throw fail('対応する公式資料を1～3ファイル選んでください。');
    const parsed = [];
    // Sequential bounded parsing also bounds peak decompression memory.
    for (const file of files) {
      // Modern File/Blob also expose a bytes() method. A native file must stay
      // a file here; the bytes property is only for our explicit buffer wrapper.
      const input = typeof file?.arrayBuffer === 'function' ? file : file?.bytes || file;
      parsed.push(await parseOfficialWorkbook(input, { ...options, fileName: file?.fileName || file?.name || options.fileName }, options));
    }
    const candidate = { schemaVersion: 1, sources: [], instruments: [], references: [], waves: [] }, warnings = [], recognition = [], definitionMatches = [];
    const sourceIds = new Set();
    for (const result of parsed) {
      const source = result.candidate.sources[0];
      if (sourceIds.has(source.id)) throw fail('同じ内容の資料が複数回選択されています。');
      sourceIds.add(source.id);
      for (const key of ['sources', 'instruments', 'references']) candidate[key].push(...clone(result.candidate[key]));
      warnings.push(...clone(result.warnings)); recognition.push(...clone(result.recognition));
    }
    for (const instrument of candidate.instruments.filter(i => i.definitionStatus === 'codesOnly')) {
      const answered = instrument.options.filter(o => o.responseStatus === 'answered');
      const definitions = candidate.instruments.filter(i => i.kind === 'question' && i.definitionStatus === 'complete' && i.year === instrument.year &&
        i.schoolLevel === instrument.schoolLevel && i.respondent === instrument.respondent && i.code === instrument.code && i.text === instrument.text &&
        i.options.filter(o => o.responseStatus === 'answered').length === answered.length && answered.every(o => i.options.some(other => other.code === o.code && other.responseStatus === 'answered')));
      if (!definitions.length) continue;
      const signatures = new Set(definitions.map(i => JSON.stringify(answered.map(o => i.options.find(other => other.code === o.code).label))));
      if (signatures.size !== 1) { warnings.push({ code: 'definitionConflict', message: '質問' + instrument.code + 'は資料間で選択肢の文言が一致しないため補完していません。', locations: [] }); continue; }
      for (const option of answered) option.label = definitions[0].options.find(other => other.code === option.code).label;
      instrument.definitionStatus = 'complete'; instrument.sourceIds = [...new Set(instrument.sourceIds.concat(definitions.flatMap(i => i.sourceIds)))];
      instrument.locations.push(...definitions.flatMap(i => clone(i.locations || [])));
      definitionMatches.push({ instrumentId: instrument.id, definitionInstrumentIds: definitions.map(i => i.id) });
      for (const reference of candidate.references.filter(r => r.instrumentId === instrument.id)) reference.notes = reference.notes.filter(note => note !== '選択肢の文言はこの資料に掲載されていません。').concat('年度・学校段階・質問番号・質問文が完全一致した別資料から選択肢の文言だけを補完しました。統計値・設置者区分は変更していません。');
    }
    if (!candidate.instruments.some(i => i.definitionStatus === 'codesOnly')) for (let i = warnings.length - 1; i >= 0; i--) if (warnings[i].code === 'codesOnly') warnings.splice(i, 1);
    validateCandidate(candidate);
    return freeze({ candidate, warnings, recognition, definitionMatches });
  }
  return Object.freeze({ limits, version, inspectZip, validateWorkbook, parseOfficialWorkbook, parseOfficialFiles, parseOfficialWorkbooks: parseOfficialFiles });
});
