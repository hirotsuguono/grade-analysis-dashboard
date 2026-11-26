'use strict';
// Structural fixtures only. Every question, option and statistic is fictional.
const XLSX = require('../src/files/vendor/xlsx.full.min.js');
const questionCodes = [];
const subdivisions = { 18: 3, 19: 3, 31: 2, 32: 4, 34: 2, 36: 4, 37: 11, 68: 10, 77: 5 };
for (let n = 1; n <= 80; n++) {
  if (subdivisions[n]) for (let part = 1; part <= subdivisions[n]; part++) questionCodes.push(n + '-' + part);
  else questionCodes.push(String(n));
}
questionCodes.push('国1', '国2', '数1', '数2', '英1-1', '英1-2', '英1-3', '英2-1', '英2-2', '英2-3', '英2-4', '英2-5', '英3-1', '英3-2', '英3-3', '英3-4');
const questionText = code => '架空の質問' + code + 'について確認しますか';
const optionLabels = ['架空の選択肢A', '架空の選択肢B'];
const codeLabel = code => '（' + code + '）';
const otherLabel = 'その他（回答対象とされた設問のうち、回答結果が得られなかったもの）';
// The administrative profile and table headers identify the format. They
// contain no school results; all question/option text and numbers below are fictional.
const ranges = '１項目回答：（１８－１）～（１８－３）、（１９－１）～（１９－３）、（３１－１）～（３１－２）、（３２－１）～（３２－４）、（３４－１）～（３４－２）、（英１－１）～（英１－３）、（英２－１）～（英２－５）、（英３－１）～（英３－４）２項目回答：（３７－１）～（３７－１１）、（６８－１）～（６８－１０）、（７７－１）～（７７－５）';
const distributionNote = '※１：質問番号（１）～（８０）は、４月２０日以降５月８日までに実施した調査の結果を集計した値である。' +
  '※２：質問番号（国１）と（国２）、（数１）と（数２）は、それぞれ国語、数学の調査を４月２３日以降４月３０日までに実施した調査の結果を集計した値である。' +
  '※３：質問番号（英１－１）～（英１－３）、（英２－１）～（英２－５）は、英語３技能「聞くこと」「読むこと」「書くこと」の調査を４月２０日以降５月１日までに実施した調査の結果を集計した値である。' +
  '※４：質問番号（英３－１）～（英３－４）は、英語「話すこと」の調査を４月２４日以降５月２９日までに実施した調査の結果を集計した値である。' +
  '※５：以下の質問番号はランダム方式の質問項目で、生徒はこの中からそれぞれ指定の項目数を回答するように実施された。' + ranges +
  '※６：①～⑥の表の「生徒数」は、この集計の対象となった生徒数、「学校数」は、「生徒数」集計の対象者が属する学校数である。' +
  '※７：【その他】とは、『回答対象とされた設問のうち、回答結果が得られなかったもの』である。';
const crossNote = '・以下の集計値は、次の実施日に教科に関する調査を一つ以上実施し、かつ、生徒質問調査を実施した生徒を対象として集計した値である。４月２３日（国語、数学）４月２０日～４月２４日（英語３技能「聞くこと」「読むこと」「書くこと」）';
const quartileNote = '※Ａ～Ｄ層について 各層は生徒を正答数の大きい順に整列し、人数比率により２５％刻みで４つの層分けを行っている。上位から１番目をＡ層、２番目をＢ層、３番目をＣ層、４番目をＤ層と呼称する。正答数が同じ場合は、上位の層に含む。';
const meansNote = '※以下の質問番号はランダム方式の質問項目で、児童生徒はこの中からそれぞれ指定の項目数を回答するように実施された。' + ranges;
const set = (sheet, address, value, decimals) => { if (value !== null) sheet[address] = { t: typeof value === 'number' ? 'n' : 's', v: value, z: decimals === undefined ? 'General' : decimals === 1 ? '0.0' : '0' }; };
function book(name, sheet) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, sheet, name); return wb; }
function header(sheet, kind) {
  set(sheet, 'A1', '令和８年度全国学力・学習状況調査');
  set(sheet, 'A2', { 402: '回答結果集計　［生徒質問］', 424: 'クロス集計表　［生徒質問－教科］', 427: '選択肢別平均正答率・平均IRTスコア　［児童生徒質問］' }[kind]);
  set(sheet, { 402: 'AB1', 424: 'P1', 427: 'W1' }[kind], kind === 427 ? '小中学校並記' : '中学校調査');
  set(sheet, 'B3', kind === 402 ? '全国－生徒（公立）' : kind === 424 ? '全国－生徒（国・公・私立）' : '全国－学校（国・公・私立）');
}
function make402() {
  const sheet = { '!ref': 'A1:AC677' }; header(sheet, 402);
  set(sheet, 'B5', distributionNote);
  for (const address of ['B6', 'G6', 'I6', 'K6', 'M6', 'O6']) set(sheet, address, '架空の対象区分');
  for (const [student, school] of [['B', 'D'], ['G', 'H'], ['I', 'J'], ['K', 'L'], ['M', 'N'], ['O', 'P']]) {
    set(sheet, student + '7', '生徒数'); set(sheet, school + '7', '学校数'); set(sheet, student + '8', 100, 0); set(sheet, school + '8', 5, 0);
  }
  set(sheet, 'N9', '1段目：生徒数　2段目：生徒数の割合(％)');
  for (const [address, label] of [['B10', '質問\n番号'], ['C10', '質問事項'], ['G10', '選択肢'], ['AA10', 'その他'], ['AB10', '無回答']]) set(sheet, address, label);
  for (let n = 1; n <= 20; n++) set(sheet, XLSX.utils.encode_col(n + 5) + '11', String(n));
  questionCodes.forEach((code, index) => {
    const row = index < 115 ? 12 + index * 4 : 613 + (index - 115) * 4;
    set(sheet, 'B' + row, codeLabel(code)); set(sheet, 'C' + row, questionText(code));
    const counts = code === '18-1' ? [2, 3, 0, 1] : [3, 5, 1, 1], total = counts.reduce((a, b) => a + b, 0);
    ['G', 'H', 'AA', 'AB'].forEach((column, i) => { set(sheet, column + row, counts[i], 0); set(sheet, column + (row + 1), Math.round(counts[i] / total * 1000) / 10, 1); });
  });
  return book('架空回答集計', sheet);
}
function make424() {
  const wb = XLSX.utils.book_new();
  questionCodes.forEach((code, index) => {
    const sheet = { '!ref': 'A1:S76' }; header(sheet, 424);
    set(sheet, 'B5', crossNote);
    set(sheet, 'B75', quartileNote);
    for (const [address, label] of [['B7', '質問番号'], ['D7', '質問事項'], ['B10', '＜生徒が回答した選択肢別の平均正答率、平均IRTスコア＞'], ['B11', '選択肢'], ['G11', '生徒数'], ['H11', '生徒数の\n割合(％)'], ['I11', '平均正答率(％)'], ['K11', '平均IRTスコア'], ['I12', '国語\n（１５問）'], ['J12', '数学\n（１６問）'], ['K12', '英語３技能'], ['B23', otherLabel], ['B24', '無回答'], ['B25', '合計'], ['B30', '＜四分位によるクロス＞'], ['P30', '上段：生徒数　下段：生徒数の割合(％)'], ['D31', '全体'], ['E31', '選択肢'], ['O31', 'その他'], ['P31', '無回答']]) set(sheet, address, label);
    set(sheet, 'B8', codeLabel(code)); set(sheet, 'D8', questionText(code));
    for (let n = 1; n <= 10; n++) { set(sheet, 'B' + (12 + n), String(n)); set(sheet, XLSX.utils.encode_col(n + 3) + '32', String(n)); }
    for (const [i, row] of [13, 14, 23, 24].entries()) {
      if (i < 2) set(sheet, 'C' + row, optionLabels[i]);
      set(sheet, 'G' + row, [12, 8, 0, 0][i], 0); set(sheet, 'H' + row, [60, 40, 0, 0][i], 1);
      set(sheet, 'I' + row, [68, 42, '－', '－'][i], 1); set(sheet, 'J' + row, [73, 47, '－', '－'][i], 1); set(sheet, 'K' + row, [515, 485, '－', '－'][i], 0);
    }
    for (const [column, value] of [['G', 20], ['H', 100], ['I', 55], ['J', 60], ['K', 500]]) set(sheet, column + '25', value, column === 'G' || column === 'K' ? 0 : 1);
    for (const [row, label] of [[35, '国語'], [45, '数学']]) {
      set(sheet, 'B' + row, label); set(sheet, 'C' + row, '全体'); set(sheet, 'D' + row, 16, 0); set(sheet, 'D' + (row + 1), 100, 1);
      ['E', 'F', 'O', 'P'].forEach((column, i) => { set(sheet, column + row, [8, 8, 0, 0][i], 0); set(sheet, column + (row + 1), [50, 50, 0, 0][i], 1); });
      ['A', 'B', 'C', 'D'].forEach((group, i) => {
        const rr = row + 2 + i * 2; set(sheet, 'C' + rr, group + '層'); set(sheet, 'D' + rr, 4, 0); set(sheet, 'D' + (rr + 1), 25, 1);
        const cells = [[4, 3, 1, 0][i], [0, 1, 3, 4][i], 0, 0];
        ['E', 'F', 'O', 'P'].forEach((column, j) => { set(sheet, column + rr, cells[j], 0); set(sheet, column + (rr + 1), cells[j] * 25, 1); });
      });
    }
    XLSX.utils.book_append_sheet(wb, sheet, '架空質問' + String(index + 1).padStart(3, '0'));
  });
  return wb;
}
function elementaryCode(code) {
  if (/^英/.test(code) || /^(71|72|74|77-\d+|78|79|80)$/.test(code)) return null;
  return { 73: '71', 75: '72', 76: '73', '数1': '算1', '数2': '算2' }[code] || code;
}
function make427() {
  const sheet = { '!ref': 'A1:X1723' }; header(sheet, 427);
  set(sheet, 'B4', meansNote);
  for (const [address, label] of [['B5', '質問番号'], ['D5', '質問事項'], ['L5', '選択肢'], ['R5', '小学校'], ['U5', '中学校'], ['B6', '小'], ['C6', '中'], ['R6', '国語'], ['S6', '算数'], ['U6', '国語'], ['V6', '数学'], ['W6', '英語３技能\nIRTスコア']]) set(sheet, address, label);
  questionCodes.forEach((code, index) => {
    const row = 7 + 13 * index, elementary = elementaryCode(code);
    set(sheet, 'B' + row, elementary ? codeLabel(elementary) : '-'); set(sheet, 'C' + row, codeLabel(code)); set(sheet, 'D' + row, questionText(code));
    optionLabels.forEach((label, i) => {
      set(sheet, 'L' + (row + i), label);
      for (const [column, values] of [['R', [64, 44]], ['S', [69, 49]], ['U', [68, 42]], ['V', [73, 47]], ['W', [515, 485]]]) {
        if (elementary || !['R', 'S'].includes(column)) set(sheet, column + (row + i), values[i], column === 'W' ? 0 : 1);
      }
    });
  });
  return book('架空選択肢別平均', sheet);
}
function officialWorkbook(kind) { return ({ 402: make402, 424: make424, 427: make427 })[kind](); }
function officialBuffer(kind, options = {}) {
  const wb = options.workbook || officialWorkbook(kind);
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: options.compression !== false }));
}
function officialFiles(kinds = [402, 424, 427]) {
  return kinds.map(kind => { const bytes = officialBuffer(kind); return { name: 'fictional-' + kind + '.xlsx', size: bytes.length, arrayBuffer: async () => Uint8Array.from(bytes).buffer }; });
}
module.exports = { XLSX, questionCodes, questionText, optionLabels, make402, make424, make427, officialWorkbook, officialBuffer, officialFiles };
