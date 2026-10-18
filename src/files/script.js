'use strict';

/* ========== 状態 ========== */
let data = null;          // 読み込んだJSON全体（保存時はこれをそのまま書き出す）
let fileHandle = null;    // File System Access API のハンドル
let fileName = '';
let dirty = false;
let lastDiskText = '';    // 開いた／前回保存した時点のディスク上の内容（外部変更検知用）

// Local double-click mode always uses file input and downloads; no server or picker permission needed.
const supportsFS = ['http:', 'https:'].includes(window.location?.protocol) && 'showOpenFilePicker' in window;
const FILE_TYPES = [{ description: 'JSONファイル', accept: { 'application/json': ['.json'] } }];

// 系列色。色だけに頼らず、パターンと数値のデータ表を併用する。
const PALETTE = ['#2458a6', '#16715c', '#985900', '#7653a3', '#a33d63', '#56772b', '#08788d', '#994922'];
const AVG_COLOR = '#9aa4b0';
const CHART_TEXT = '#536276';
const CHART_AXIS = '#e8eaf0';
// 全チャート共通のテキスト/フォント設定
const CHART_TEXT_STYLE = { fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Yu Gothic', sans-serif", color: CHART_TEXT };

// 画面の選択状態
const ui = {
  tab: 'overview',
  ovClass: 'all', ovTest: '', ovSubject: 'all',
  inClass: 'all', inTest: '', inSubject: 'all',
  anClass: 'all', anTest: '', anSubject: 'all',
  trendClass: 'all', trendSearch: '', trendSubject: '',
  trendSelected: new Set(),
  metClass: 'all', metricId: '',
  corrX: '', corrY: '',
  listSubject: 'all', listClass: 'all', listMode: 'total', listHeat: true, listPivot: 60, listSort: null,
  listGrade: 'all', listTerm: 'all',
  rtiSubject: 'all', rtiClass: 'all', rtiBasis: 'latest', rtiSelectedIv: null,
};

let isAdmin = false; // 管理者モード（誤操作防止。本来の保護は共有フォルダの権限で行う）

const SUM_KEY = '__sum__'; // 個人推移の「5教科合計」モード

let scoreIndex = new Map(); // `${studentId}:${testId}` -> score record

/* ========== ユーティリティ ========== */
const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function localDateString(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function normalizeDateValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF) {
    const d = XLSX.SSF.parse_date_code(value);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const match = String(value).trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function parseBoundedNumber(raw, max, min = 0) {
  if (String(raw).trim() === '') return { valid: true, value: null };
  const value = Number(raw);
  return {
    valid: Number.isFinite(value) && value >= min && value <= max,
    value,
  };
}

/* ---- 効果量（Cohen's d）の共通ヘルパー ---- */
function esFmt(d) {
  return `${d >= 0 ? '+' : ''}${(Math.round(d * 100) / 100).toFixed(2)}`;
}

function esLabel(d) {
  const a = Math.abs(d);
  return a < 0.2 ? 'ごく小さい' : a < 0.5 ? '小' : a < 0.8 ? '中' : '大';
}

function sdOf(arr, m) {
  return Math.sqrt(mean(arr.map((v) => (v - m) ** 2)));
}

function sampleSd(arr, m = mean(arr)) {
  if (arr.length < 2 || m == null) return null;
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1));
}

// 独立した2群の Cohen's d（プールした標本標準偏差を使用）
function independentCohensD(a, b) {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a), mb = mean(b);
  const sda = sampleSd(a, ma), sdb = sampleSd(b, mb);
  const pooled = Math.sqrt(
    ((a.length - 1) * sda ** 2 + (b.length - 1) * sdb ** 2) /
    (a.length + b.length - 2)
  );
  return pooled > 0 ? (mb - ma) / pooled : null;
}

// 同じ生徒の前後比較に使う Cohen's dz（差分の標本標準偏差を使用）
function pairedCohensDz(pairs) {
  if (pairs.length < 2) return null;
  const diffs = pairs.map(([before, after]) => after - before);
  const md = mean(diffs);
  const sd = sampleSd(diffs, md);
  return sd > 0 ? md / sd : null;
}

function quantile(sorted, p) {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* ========== データアクセス ========== */
function rebuildIndex() {
  scoreIndex = new Map();
  for (const s of data.scores) scoreIndex.set(`${s.studentId}:${s.testId}`, s);
}

function getScore(sid, tid) {
  return scoreIndex.get(`${sid}:${tid}`) || null;
}

// 集計・グラフでは欠席者の復元用得点を使わない。入力は getScore で元の値を保持する。
function getAttendedScore(sid, tid) {
  const rec = getScore(sid, tid);
  return rec && !rec.absent ? rec : null;
}

function ensureScore(sid, tid) {
  let rec = getScore(sid, tid);
  if (!rec) {
    rec = { studentId: sid, testId: tid, total: null, domains: {}, questions: {} };
    data.scores.push(rec);
    scoreIndex.set(`${sid}:${tid}`, rec);
  }
  if (!rec.domains) rec.domains = {};
  if (!rec.questions) rec.questions = {};
  return rec;
}

// 出席番号（並び順）。number があればそれを、なければ id を流用
function studentNumber(s) {
  const n = s.number != null && s.number !== '' ? s.number : s.id;
  return parseInt(n, 10) || 0;
}

function sortedStudents() {
  return [...data.students].sort((a, b) => {
    const c = (a.className || '').localeCompare(b.className || '', 'ja');
    if (c !== 0) return c;
    return studentNumber(a) - studentNumber(b);
  });
}

function classList() {
  return [...new Set(data.students.map((s) => s.className).filter(Boolean))].sort();
}

function studentsOf(klass) {
  const all = sortedStudents();
  return klass === 'all' ? all : all.filter((s) => s.className === klass);
}

function testById(tid) {
  return data.tests.find((t) => t.id === tid) || null;
}

/* ---- テスト回（実施学年＋テスト名）の扱い ----
   同じ「前期中間テスト」でも1年時と3年時は別の回。テストの gradeYear
   （何年生のときのテストか）を含めた「回キー」でグループ化・並び替えする */
function termKeyOf(t) {
  return (t.gradeYear ? `${t.gradeYear}年・` : '') + t.name;
}

// 回の一覧を時間順（実施学年→登録順）で返す
function termOrderedList() {
  const seen = new Map();
  data.tests.forEach((t, i) => {
    const k = termKeyOf(t);
    if (!seen.has(k)) {
      seen.set(k, { key: k, gy: t.gradeYear || 0, date: t.date || '', idx: i });
    } else if (t.date) {
      const current = seen.get(k);
      if (!current.date || t.date < current.date) current.date = t.date;
    }
  });
  return [...seen.values()].sort((a, b) => {
    const gradeOrder = (a.gy || 99) - (b.gy || 99);
    if (gradeOrder) return gradeOrder;
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.date !== b.date) return a.date ? -1 : 1;
    return a.idx - b.idx;
  }).map((x) => x.key);
}

// テスト配列を回の時間順に並べ替える
function sortTestsByTerm(tests) {
  const order = termOrderedList();
  return [...tests].sort((a, b) => order.indexOf(termKeyOf(a)) - order.indexOf(termKeyOf(b)));
}

// 問題得点から合計・分野別を再計算する
function recalcScore(rec, test) {
  if (!test.questions || !test.questions.length) return;
  let total = 0;
  let any = false;
  const domains = {};
  for (const q of test.questions) {
    const v = rec.questions[q.key];
    if (v == null || v === '') continue;
    any = true;
    total += v;
    if (q.domain) domains[q.domain] = (domains[q.domain] || 0) + v;
  }
  rec.total = any ? total : null;
  rec.domains = domains;
}

// 分野満点（domains定義がなければ問題から集計）
function domainMax(test, key) {
  const d = (test.domains || []).find((x) => x.key === key);
  if (d) return d.max;
  return (test.questions || []).filter((q) => q.domain === key).reduce((a, q) => a + q.max, 0);
}

function testDomains(test) {
  if (test.domains && test.domains.length) return test.domains;
  const keys = [...new Set((test.questions || []).map((q) => q.domain).filter(Boolean))];
  return keys.map((k) => ({ key: k, label: k, max: domainMax(test, k) }));
}

/* ========== ECharts ========== */
const chartIds = ['rtiProgressChart', 'histChart', 'ovDomainChart', 'ovTrendChart', 'trendChart', 'trendDomainChart',
  'anDomainChart', 'anQuestionChart', 'anBoxChart', 'corrChart'];

let chartLibWarned = false;

// 全チャート共通テーマ（フォント・配色・軸線色を統一）
if (typeof echarts !== 'undefined') {
  echarts.registerTheme('gd', {
    color: PALETTE,
    textStyle: CHART_TEXT_STYLE,
    title: { textStyle: { color: '#1e2330' } },
    legend: { textStyle: { color: CHART_TEXT } },
    categoryAxis: {
      axisLine: { lineStyle: { color: CHART_AXIS } },
      axisTick: { show: false },
      axisLabel: { color: CHART_TEXT },
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: CHART_TEXT },
      splitLine: { lineStyle: { color: CHART_AXIS } },
      nameTextStyle: { color: CHART_TEXT },
    },
    tooltip: {
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderColor: '#e8eaf0',
      borderWidth: 1,
      textStyle: { color: '#1e2330', fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Yu Gothic UI', 'Yu Gothic', sans-serif" },
      extraCssText: 'box-shadow:0 6px 20px rgba(20,28,56,0.12);border-radius:10px;',
    },
  });
}

// グラフ描画ライブラリが読めなかった場合のフォールバック表示
function warnChartLibMissing() {
  if (chartLibWarned) return;
  chartLibWarned = true;
  for (const id of chartIds) {
    const el = $(id);
    if (el) el.innerHTML = '<div style="display:grid;place-items:center;height:100%;color:#6b7684;font-size:13px;text-align:center;padding:16px">グラフ表示用ファイル（vendor/echarts.min.js）が読み込めませんでした。<br>ファイル一式がそろっているか確認してください。</div>';
  }
}

function chart(id) {
  const el = $(id);
  if (typeof echarts === 'undefined') {
    warnChartLibMissing();
    return { setOption() {}, resize() {}, clear() {}, getDataURL() { return ''; }, getOption() { return { series: [] }; } };
  }
  const inst = echarts.getInstanceByDom(el) || echarts.init(el, 'gd');
  if (!inst.accessibleSetOption) {
    const setOption = inst.setOption.bind(inst);
    const clear = inst.clear.bind(inst);
    inst.clear = () => {
      clear();
      document.getElementById(el.id + '-data')?.remove();
      el.removeAttribute('aria-describedby');
    };
    inst.setOption = (option, ...args) => {
      option.aria = { enabled: true, decal: { show: true } };
      option.animation = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Rich-text tooltips draw within the canvas instead of interpreting data as HTML.
      option.tooltip = { ...option.tooltip, renderMode: 'richText' };
      setOption(option, ...args);
      if (window.updateChartData) window.updateChartData(el, inst.getOption());
    };
    inst.accessibleSetOption = true;
  }
  return inst;
}

function resizeCharts() {
  if (typeof echarts === 'undefined') return;
  requestAnimationFrame(() => {
    for (const id of chartIds) {
      const el = $(id);
      const inst = el && echarts.getInstanceByDom(el);
      if (inst) inst.resize();
    }
  });
}

window.addEventListener('resize', resizeCharts);

const BASE_GRID = { left: 50, right: 20, top: 30, bottom: 40 };

/* ========== ファイルI/O ========== */
async function openJson() {
  if (dirty && !confirm('保存していない変更があります。破棄して開きますか？')) return;
  if (supportsFS) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES });
      const file = await handle.getFile();
      applyJsonText(await file.text(), file.name, handle);
    } catch (e) {
      if (e.name !== 'AbortError') alert('ファイルを開けませんでした: ' + e.message);
    }
  } else {
    $('fileInput').click();
  }
}

function validateDataset(parsed) {
  const errors = [];
  const add = (message) => {
    if (errors.length < 12) errors.push(message);
  };
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['ルートがオブジェクトではありません。'];
  }
  for (const key of ['students', 'tests', 'scores']) {
    if (!Array.isArray(parsed[key])) add(`${key} は配列である必要があります。`);
  }
  if (errors.length) return errors;

  if (parsed.name != null && typeof parsed.name !== 'string') add('データ名は文字列である必要があります。');
  const settings = parsed.settings;
  if (settings != null && (typeof settings !== 'object' || Array.isArray(settings))) add('settings はオブジェクトである必要があります。');
  if (settings?.rti != null) {
    const { tier2, tier3 } = settings.rti;
    if (!Number.isFinite(tier2) || !Number.isFinite(tier3) || tier3 <= 0 || tier2 >= 100 || tier3 >= tier2) {
      add('RTIしきい値は 0 < Tier 3 < Tier 2 < 100 にしてください。');
    }
  }

  const studentIds = new Set();
  parsed.students.forEach((s, i) => {
    if (!s || typeof s !== 'object') { add(`students[${i}] がオブジェクトではありません。`); return; }
    if (typeof s.id !== 'string' || !s.id) add(`students[${i}].id が空、または文字列ではありません。`);
    else if (studentIds.has(s.id)) add(`生徒ID「${s.id}」が重複しています。`);
    else studentIds.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim()) add(`students[${i}].name が空です。`);
    if (s.className != null && typeof s.className !== 'string') add(`students[${i}].className は文字列にしてください。`);
    if (s.classHistory != null && (!Array.isArray(s.classHistory) || s.classHistory.some(h => !h || typeof h !== 'object'))) add(`students[${i}].classHistory が不正です。`);
  });

  const testIds = new Set();
  const testsById = new Map();
  parsed.tests.forEach((t, i) => {
    if (!t || typeof t !== 'object') { add(`tests[${i}] がオブジェクトではありません。`); return; }
    if (typeof t.id !== 'string' || !t.id) add(`tests[${i}].id が空、または文字列ではありません。`);
    else if (testIds.has(t.id)) add(`テストID「${t.id}」が重複しています。`);
    else { testIds.add(t.id); testsById.set(t.id, t); }
    if (typeof t.name !== 'string' || typeof t.subject !== 'string') add(`tests[${i}] のテスト名・教科は文字列にしてください。`);
    if (!Number.isFinite(t.maxScore) || t.maxScore <= 0) add(`テスト「${t.name || t.id || i}」の満点が不正です。`);
    if (t.date && normalizeDateValue(t.date) !== t.date) add(`テスト「${t.name || t.id || i}」の実施日が不正です。`);
    if (t.domains != null && (!Array.isArray(t.domains) || t.domains.some(d => !d || typeof d.key !== 'string' || typeof d.label !== 'string' || !Number.isFinite(d.max) || d.max <= 0))) add(`テスト「${t.name || t.id || i}」の分野が不正です。`);
    if (t.questions != null && !Array.isArray(t.questions)) {
      add(`テスト「${t.name || t.id || i}」の questions が配列ではありません。`);
    } else if (Array.isArray(t.questions)) {
      const qKeys = new Set();
      let qMaxSum = 0;
      for (const q of t.questions) {
        if (!q || typeof q !== 'object') { add(`テスト「${t.name || t.id || i}」の問題が不正です。`); continue; }
        if (!q || typeof q.key !== 'string' || !q.key || qKeys.has(q.key)) add(`テスト「${t.name || t.id || i}」の問題キーが空、または重複しています。`);
        else qKeys.add(q.key);
        if (!Number.isFinite(q.max) || q.max <= 0) add(`テスト「${t.name || t.id || i}」の問題配点が不正です。`);
        else qMaxSum += q.max;
      }
      if (Number.isFinite(t.maxScore) && qMaxSum > t.maxScore) add(`テスト「${t.name || t.id || i}」の問題配点合計が満点を超えています。`);
    }
  });

  const scoreKeys = new Set();
  parsed.scores.forEach((rec, i) => {
    if (!rec || typeof rec !== 'object') { add(`scores[${i}] がオブジェクトではありません。`); return; }
    if (!studentIds.has(rec.studentId)) add(`scores[${i}] が存在しない生徒IDを参照しています。`);
    const test = testsById.get(rec.testId);
    if (!test) add(`scores[${i}] が存在しないテストIDを参照しています。`);
    const key = `${rec.studentId}:${rec.testId}`;
    if (scoreKeys.has(key)) add(`生徒ID「${rec.studentId}」のテスト「${rec.testId}」が重複しています。`);
    scoreKeys.add(key);
    if (rec.total != null && test && (!Number.isFinite(rec.total) || rec.total < 0 || rec.total > test.maxScore)) {
      add(`scores[${i}].total が0〜${test.maxScore}の範囲外です。`);
    }
    if (rec.questions != null && (typeof rec.questions !== 'object' || Array.isArray(rec.questions))) {
      add(`scores[${i}].questions がオブジェクトではありません。`);
    } else if (test && rec.questions) {
      const qByKey = new Map((Array.isArray(test.questions) ? test.questions : []).filter(Boolean).map((q) => [q.key, q]));
      for (const [qkey, value] of Object.entries(rec.questions)) {
        const q = qByKey.get(qkey);
        if (q && (!Number.isFinite(value) || value < 0 || value > q.max)) {
          add(`scores[${i}].questions.${qkey} が0〜${q.max}の範囲外です。`);
        }
      }
    }
  });

  if (parsed.metrics != null && !Array.isArray(parsed.metrics)) add('metrics は配列である必要があります。');
  const metricIds = new Set();
  for (const m of (Array.isArray(parsed.metrics) ? parsed.metrics : [])) {
    if (!m || typeof m !== 'object' || !m.values || typeof m.values !== 'object' || Array.isArray(m.values)) {
      add('指標にはオブジェクト形式の values が必要です。'); continue;
    }
    if (typeof m.id !== 'string' || !m.id || metricIds.has(m.id)) add('指標IDが空、または重複しています。');
    metricIds.add(m.id);
    if (typeof m.label !== 'string' || !['number', 'scale'].includes(m.type)) add('指標名または指標の種類が不正です。');
    for (const [sid, value] of Object.entries(m.values)) {
      if (!studentIds.has(sid)) add(`指標「${m.label || m.id}」が存在しない生徒IDを参照しています。`);
      if (!Number.isFinite(value) || (m.type === 'scale' && (value < 1 || value > 5))) {
        add(`指標「${m.label || m.id}」に不正な値があります。`);
      }
    }
  }

  if (parsed.interventions != null && !Array.isArray(parsed.interventions)) add('interventions は配列である必要があります。');
  for (const iv of (Array.isArray(parsed.interventions) ? parsed.interventions : [])) {
    if (!iv || typeof iv !== 'object') { add('支援記録はオブジェクトにしてください。'); continue; }
    if (iv && !studentIds.has(iv.studentId)) add(`支援記録「${iv.title || iv.id}」が存在しない生徒IDを参照しています。`);
    if (typeof iv.id !== 'string' || typeof iv.title !== 'string' || typeof iv.subject !== 'string') add('支援記録のID・内容・教科は文字列にしてください。');
    // 旧形式の未設定項目は許容し、指定された日付は並び替え可能な形式に限定する。
    for (const field of ['startDate', 'endDate', 'createdAt']) {
      const value = iv[field];
      if (value != null && (typeof value !== 'string' || (value !== '' && normalizeDateValue(value) !== value))) {
        add(`支援記録の ${field} は YYYY-MM-DD 形式の実在する日付、または未設定にしてください。`);
      }
    }
    if (iv.status != null && !['active', 'done'].includes(iv.status)) {
      add('支援記録の状態は active または done にしてください。');
    }
    if (iv.note != null && typeof iv.note !== 'string') add('支援記録のメモは文字列にしてください。');
    if (iv.baseline != null && (!Number.isFinite(iv.baseline) || iv.baseline < 0 || iv.baseline > 100)) {
      add('支援記録の開始時基準値は0〜100の数値、または未設定にしてください。');
    }
  }
  return errors;
}

function applyJsonText(text, name, handle) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    alert('JSONの形式が正しくありません。');
    return;
  }
  // 旧版の削除処理が残した、所有者のいない支援記録は読み込み時に安全に除外する
  let removedOrphanInterventions = 0;
  if (parsed && Array.isArray(parsed.students) && Array.isArray(parsed.interventions)) {
    const ids = new Set(parsed.students.filter(Boolean).map((s) => s.id));
    const before = parsed.interventions.length;
    parsed.interventions = parsed.interventions.filter((iv) => iv && ids.has(iv.studentId));
    removedOrphanInterventions = before - parsed.interventions.length;
  }
  const validationErrors = validateDataset(parsed);
  if (validationErrors.length) {
    alert('成績データに問題があります。修正してから開いてください。\n\n・' + validationErrors.join('\n・'));
    return;
  }
  data = parsed;
  let migrated = removedOrphanInterventions > 0;
  if (!data.metrics) { data.metrics = []; migrated = true; }
  // 移行：出席番号(number)が無い生徒は id を初期値として補う
  for (const s of data.students) {
    if (s.number == null || s.number === '') {
      s.number = parseInt(s.id, 10) || '';
      migrated = true;
    }
  }
  // 移行（V2 / version 3）：設定と支援記録
  if (!data.settings || typeof data.settings !== 'object') { data.settings = {}; migrated = true; }
  if (!data.settings.rti) { data.settings.rti = { tier2: 60, tier3: 40 }; migrated = true; }
  if (data.settings.adminPinHash === undefined) { data.settings.adminPinHash = null; migrated = true; }
  if (!Array.isArray(data.interventions)) { data.interventions = []; migrated = true; }
  if (!data.version || data.version < 3) { data.version = 3; migrated = true; }
  fileHandle = handle || null;
  fileName = name;
  dirty = migrated;
  lastDiskText = text;  // 読み込んだ時点のディスク内容を記録
  rebuildIndex();

  // 選択状態を初期化
  ui.ovClass = ui.inClass = ui.anClass = ui.trendClass = ui.metClass = 'all';
  ui.inSubject = ui.ovSubject = ui.anSubject = ui.listSubject = 'all';
  ui.listClass = 'all'; ui.listMode = 'total'; ui.listSort = null; ui.listPivot = 60;
  ui.listGrade = 'all'; ui.listTerm = 'all';
  ui.rtiSubject = 'all'; ui.rtiClass = 'all'; ui.rtiBasis = 'latest'; ui.rtiSelectedIv = null;
  isAdmin = false; // ファイルを開くたびに教員モードへ戻す
  ui.trendSubject = data.tests.length ? data.tests[0].subject : '';
  const lastTest = data.tests.length ? data.tests[data.tests.length - 1].id : '';
  ui.ovTest = ui.inTest = ui.anTest = lastTest;
  ui.trendSelected = new Set();
  ui.trendSearch = '';
  ui.metricId = data.metrics.length ? data.metrics[0].id : '';
  ui.corrX = data.metrics.length ? 'm:' + data.metrics[0].id : (lastTest ? 't:' + lastTest : '');
  ui.corrY = lastTest ? 't:' + lastTest : '';

  $('emptyState').hidden = true;
  $('appMain').hidden = false;
  $('saveBtn').disabled = false;
  $('rosterBtn').disabled = false;
  $('backupBtn').disabled = false;
  $('roleBtn').disabled = false;
  updateRoleUI(); // ロールに応じたUI（admin-onlyの表示制御）を反映
  $('datasetName').textContent = `${data.name || ''}（${fileName}）`;
  updateSaveStatus();
  renderAll();
  if (removedOrphanInterventions) {
    alert(`削除済みの生徒に紐づいていた支援記録 ${removedOrphanInterventions}件を整理しました。右上の「保存」でデータファイルへ反映してください。`);
  }
}

async function saveJson() {
  if (!data) return;
  const validationErrors = validateDataset(data);
  if (validationErrors.length) {
    alert('データに問題があるため保存できません。\n\n・' + validationErrors.join('\n・'));
    return;
  }
  const text = JSON.stringify(data, null, 2);
  if (supportsFS) {
    try {
      if (!fileHandle) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: fileName || 'seiseki-data.json',
          types: FILE_TYPES,
        });
        fileName = fileHandle.name;
        $('datasetName').textContent = `${data.name || ''}（${fileName}）`;
      } else {
        // 共有ファイルの上書き事故防止：開いた時から他者が更新していないか確認
        let diskNow = null;
        try {
          diskNow = await (await fileHandle.getFile()).text();
        } catch { /* 読めない場合は検知をスキップ */ }
        if (diskNow != null && diskNow !== lastDiskText) {
          const ok = confirm(
            'このファイルは、あなたが開いたあとに別の人が更新しています。\n' +
            'このまま保存すると、その人の入力が消える可能性があります。\n\n' +
            '［OK］あなたの内容で上書きする\n' +
            '［キャンセル］保存をやめる（先にファイルを開き直して、最新を確認してください）'
          );
          if (!ok) return;
        }
      }
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      dirty = false;
      lastDiskText = text;  // 保存した内容を新たな基準に
      updateSaveStatus(true);
    } catch (e) {
      if (e.name !== 'AbortError') alert('保存に失敗しました: ' + e.message);
    }
  } else {
    // フォールバック：ダウンロード
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName || 'seiseki-data.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    dirty = false;
    lastDiskText = text;
    updateSaveStatus(true);
  }
}

function markDirty() {
  dirty = true;
  updateSaveStatus();
}

function updateSaveStatus(justSaved) {
  const el = $('saveStatus');
  el.hidden = false;
  if (dirty) {
    el.textContent = '● 未保存の変更';
    el.className = 'save-status is-dirty';
  } else {
    el.textContent = justSaved ? '✓ 保存しました' : '✓ 保存済み';
    el.className = 'save-status is-saved';
  }
}

window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveJson();
  }
});

/* ========== セレクト構築 ========== */
function fillClassSelect(sel, value) {
  sel.innerHTML = `<option value="all">全クラス</option>` +
    classList().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = value;
}

function fillTestSelect(sel, value) {
  sel.innerHTML = sortTestsByTerm(data.tests).map((t) =>
    `<option value="${esc(t.id)}">${esc(termKeyOf(t))}（${esc(t.subject)}）</option>`).join('');
  if (value && testById(value)) sel.value = value;
}

function subjectList() {
  return [...new Set(data.tests.map((t) => t.subject).filter(Boolean))].sort();
}

function fillSubjectSelect(sel, value) {
  sel.innerHTML = `<option value="all">全教科</option>` +
    subjectList().map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
  sel.value = subjectList().includes(value) ? value : 'all';
}

// 教科で絞ったテスト一覧をセレクトに反映。選択中テストが範囲外なら先頭に寄せる。
// selectId=テスト用select, subjKey/testKey=ui上のキー名
function fillScopedTestSelect(selectId, subjKey, testKey) {
  const subj = ui[subjKey];
  const tests = sortTestsByTerm(subj === 'all' ? data.tests : data.tests.filter((t) => t.subject === subj));
  $(selectId).innerHTML = tests.map((t) =>
    `<option value="${esc(t.id)}">${esc(termKeyOf(t))}（${esc(t.subject)}）</option>`).join('');
  if (!tests.some((t) => t.id === ui[testKey])) ui[testKey] = tests.length ? tests[0].id : '';
  if (ui[testKey]) $(selectId).value = ui[testKey];
}

// 個人推移の教科セレクト（各教科 ＋ 5教科合計）
function fillTrendSubjectSelect() {
  const subjects = subjectList();
  $('trendSubject').innerHTML =
    subjects.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('') +
    `<option value="${SUM_KEY}">全教科合計</option>`;
  if (ui.trendSubject !== SUM_KEY && !subjects.includes(ui.trendSubject)) {
    ui.trendSubject = subjects.length ? subjects[0] : SUM_KEY;
  }
  $('trendSubject').value = ui.trendSubject;
}

/* ========== 描画：全体 ========== */
function renderAll() {
  fillClassSelect($('ovClass'), ui.ovClass);
  fillSubjectSelect($('ovSubject'), ui.ovSubject);
  fillScopedTestSelect('ovTest', 'ovSubject', 'ovTest');
  fillClassSelect($('inClass'), ui.inClass);
  fillSubjectSelect($('inSubject'), ui.inSubject);
  fillScopedTestSelect('inTest', 'inSubject', 'inTest');
  fillClassSelect($('anClass'), ui.anClass);
  fillSubjectSelect($('anSubject'), ui.anSubject);
  fillScopedTestSelect('anTest', 'anSubject', 'anTest');
  fillClassSelect($('trendClass'), ui.trendClass);
  fillTrendSubjectSelect();
  fillClassSelect($('metClass'), ui.metClass);
  fillSubjectSelect($('listSubject'), ui.listSubject);
  fillListGradeSelect();
  fillListTermSelect();
  fillListClassSelect();
  fillSubjectSelect($('rtiSubject'), ui.rtiSubject);
  fillClassSelect($('rtiClass'), ui.rtiClass);
  $('rtiBasis').value = ui.rtiBasis;
  $('listMode').value = ui.listMode;
  $('listHeat').checked = ui.listHeat;
  $('listPivot').value = ui.listPivot;
  fillAxisSelects();
  fillMetricSelect();
  renderCurrentTab();
}

function renderCurrentTab() {
  if (ui.tab === 'overview') renderOverview();
  else if (ui.tab === 'input') renderInput();
  else if (ui.tab === 'trend') renderTrend();
  else if (ui.tab === 'analysis') renderAnalysis();
  else if (ui.tab === 'metrics') renderMetricsTab();
  else if (ui.tab === 'list') renderList();
  else if (ui.tab === 'rti') renderRti();
  resizeCharts();
}

/* ========== 概要タブ ========== */
function renderOverview() {
  const test = testById(ui.ovTest);
  const students = studentsOf(ui.ovClass);
  const kpiEl = $('kpiGrid');

  if (!test) {
    kpiEl.innerHTML = '<div class="kpi"><div class="kpi-label">テストがまだ登録されていません</div></div>';
    return;
  }

  const totals = students
    .map((s) => getAttendedScore(s.id, test.id))
    .filter((r) => r && r.total != null)
    .map((r) => r.total);

  // 前回比：同じ教科でこのテストの1つ前のテストと平均点を比較
  const subjTests = sortTestsByTerm(data.tests.filter((t) => t.subject === test.subject));
  const idx = subjTests.findIndex((t) => t.id === test.id);
  let deltaHtml = '';
  if (idx > 0 && totals.length) {
    const prev = subjTests[idx - 1];
    // 両方受けた生徒だけで比較（対応のある比較）
    const pairs = [];
    for (const s of students) {
      const a = getAttendedScore(s.id, prev.id);
      const b = getAttendedScore(s.id, test.id);
      if (a && a.total != null && b && b.total != null) pairs.push([a.total, b.total]);
    }
    if (pairs.length >= 2) {
      const m1 = mean(pairs.map((p) => p[0]));
      const m2 = mean(pairs.map((p) => p[1]));
      const diff = round1(m2 - m1);
      if (diff >= 0.5) deltaHtml = `<div class="kpi-delta up">▲ ${diff} <small>前回比</small></div>`;
      else if (diff <= -0.5) deltaHtml = `<div class="kpi-delta down">▼ ${Math.abs(diff)} <small>前回比</small></div>`;
      else deltaHtml = `<div class="kpi-delta flat">→ ほぼ横ばい</div>`;
      // 同じ生徒の前後比較なので、差分の標準偏差を使う Cohen's dz
      const dz = pairedCohensDz(pairs);
      if (dz != null) {
        deltaHtml += `<div class="kpi-es es-link" title="クリックで効果量の説明を表示（両方受験した${pairs.length}名で計算）">効果量 dz = ${esFmt(dz)}（${esLabel(dz)}）</div>`;
      }
    }
  }

  // クラス間の差（全クラス表示時）：最高クラスと最低クラスの平均差を効果量つきで
  let classGapKpi = null;
  if (ui.ovClass === 'all') {
    const perClass = classList().map((k) => {
      const vals = studentsOf(k).map((s) => getAttendedScore(s.id, test.id))
        .filter((r) => r && r.total != null).map((r) => r.total);
      return { k, vals, m: vals.length >= 2 ? mean(vals) : null };
    }).filter((c) => c.m != null);
    if (perClass.length >= 2) {
      perClass.sort((a, b) => a.m - b.m);
      const lo = perClass[0], hi = perClass[perClass.length - 1];
      const dval = independentCohensD(lo.vals, hi.vals);
      if (dval != null) {
        classGapKpi = {
          label: 'クラス間の差', value: round1(hi.m - lo.m), unit: `点（${hi.k}−${lo.k}）`,
          extra: `<div class="kpi-es es-link" title="クリックで効果量の説明を表示">効果量 d = ${esFmt(dval)}（${esLabel(dval)}）</div>`,
        };
      }
    }
  }

  const kpis = [
    { label: '受験者数', value: totals.length, unit: `名 / ${students.length}名` },
    { label: '平均点', value: totals.length ? round1(mean(totals)) : '—', unit: `/ ${test.maxScore}`, extra: deltaHtml },
    { label: '中央値', value: totals.length ? round1(median(totals)) : '—', unit: `/ ${test.maxScore}` },
    { label: '最高点', value: totals.length ? Math.max(...totals) : '—', unit: '' },
    { label: '最低点', value: totals.length ? Math.min(...totals) : '—', unit: '' },
  ];
  if (classGapKpi) kpis.push(classGapKpi);
  kpiEl.innerHTML = kpis.map((k) =>
    `<div class="kpi"><div class="kpi-label">${esc(k.label)}</div>
     <div class="kpi-value">${esc(k.value)}<small>${esc(k.unit)}</small></div>${k.extra || ''}</div>`).join('');

  renderHistogram(test, totals);
  renderDomainBar('ovDomainChart', test, students);
  renderOverviewTrend();
}

function renderHistogram(test, totals) {
  const binSize = Math.max(1, Math.ceil(test.maxScore / 10));
  const bins = [];
  for (let lo = 0; lo < test.maxScore; lo += binSize) {
    const hi = Math.min(lo + binSize - 1, test.maxScore);
    bins.push({ lo, hi: lo + binSize >= test.maxScore ? test.maxScore : hi, count: 0 });
  }
  for (const t of totals) {
    const idx = Math.min(bins.length - 1, Math.floor(t / binSize));
    bins[idx].count++;
  }
  // 平均の位置に縦線を引く（カテゴリ軸なのでビン内の相対位置に換算）
  const avg = totals.length ? mean(totals) : null;
  const avgMark = avg != null ? {
    silent: true, symbol: 'none',
    lineStyle: { color: '#1a1a2e', type: 'dashed', width: 1.5 },
    label: { formatter: `平均 ${round1(avg)}`, position: 'end', rotate: 0, fontSize: 11, color: '#1a1a2e', distance: 4 },
    data: [{ xAxis: Math.min(bins.length - 1 + 0.49, avg / binSize - 0.5) }],
  } : undefined;

  chart('histChart').setOption({
    grid: BASE_GRID,
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: bins.map((b) => `${b.lo}–${b.hi}`),
      axisLabel: { rotate: 40, fontSize: 11 },
    },
    yAxis: { type: 'value', name: '人数', minInterval: 1 },
    series: [{
      type: 'bar',
      data: bins.map((b) => b.count),
      itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] },
      barWidth: '70%',
      markLine: avgMark,
    }],
  }, true);
}

// 分野別平均得点率の棒グラフ（概要・分析共用）
function renderDomainBar(chartId, test, students, highlightWeakest) {
  const domains = testDomains(test);
  const rates = domains.map((d) => {
    const vals = students
      .map((s) => getAttendedScore(s.id, test.id))
      .filter((r) => r && r.domains && r.domains[d.key] != null)
      .map((r) => r.domains[d.key] / domainMax(test, d.key) * 100);
    return vals.length ? round1(mean(vals)) : null;
  });
  const minRate = Math.min(...rates.filter((r) => r != null));
  chart(chartId).setOption({
    grid: BASE_GRID,
    tooltip: { trigger: 'axis', valueFormatter: (v) => v + '%' },
    xAxis: { type: 'category', data: domains.map((d) => d.label) },
    yAxis: { type: 'value', max: 100, name: '得点率%' },
    series: [{
      type: 'bar',
      data: rates.map((r) => ({
        value: r,
        itemStyle: {
          color: highlightWeakest && r === minRate ? '#c0392b' : PALETTE[1],
          borderRadius: [4, 4, 0, 0],
        },
      })),
      barWidth: '50%',
      label: { show: true, position: 'top', formatter: '{c}%' },
    }],
  }, true);
  return { domains, rates };
}

function renderOverviewTrend() {
  // 教科をまたいで混ざらないよう、選択中テストの教科に絞って推移を描く（回の時間順）
  const test = testById(ui.ovTest);
  const subject = test ? test.subject : (subjectList()[0] || '');
  const subjectTests = sortTestsByTerm(data.tests.filter((t) => t.subject === subject));

  const classes = classList();
  const series = [];
  const targets = ui.ovClass === 'all' ? classes : [ui.ovClass];

  targets.forEach((klass, i) => {
    const students = studentsOf(klass);
    series.push({
      name: klass,
      type: 'line',
      symbol: 'circle',
      symbolSize: 8,
      connectNulls: true,
      // 線の終端にクラス名を直接ラベル（凡例との往復を不要に）
      endLabel: { show: true, formatter: klass, fontSize: 11, color: '#1a1a2e', fontWeight: 600, distance: 6 },
      labelLayout: { moveOverlap: 'shiftY' },
      data: subjectTests.map((t) => {
        const vals = students.map((s) => getAttendedScore(s.id, t.id))
          .filter((r) => r && r.total != null).map((r) => r.total);
        return vals.length ? round1(mean(vals)) : null;
      }),
      itemStyle: { color: PALETTE[i % PALETTE.length] },
    });
  });

  if (ui.ovClass === 'all') {
    series.push({
      name: '全体',
      type: 'line',
      symbol: 'none',
      lineStyle: { type: 'dashed', color: AVG_COLOR },
      itemStyle: { color: AVG_COLOR },
      connectNulls: true,
      data: subjectTests.map((t) => {
        const vals = data.students.map((s) => getAttendedScore(s.id, t.id))
          .filter((r) => r && r.total != null).map((r) => r.total);
        return vals.length ? round1(mean(vals)) : null;
      }),
    });
  }

  const card = $('ovTrendChart').closest('.card');
  if (card) card.querySelector('h3').textContent = `テスト別 平均点の推移（${subject}）`;

  // どの系列にも値がない回は表示しない（クラス絞り込み時、他学年の回を省く）
  let ovLabels = subjectTests.map(termKeyOf);
  const ovUsed = ovLabels.map((_, i) => series.some((sr) => sr.data[i] != null));
  if (ovUsed.some((u) => !u)) {
    ovLabels = ovLabels.filter((_, i) => ovUsed[i]);
    for (const sr of series) sr.data = sr.data.filter((_, i) => ovUsed[i]);
  }

  chart('ovTrendChart').setOption({
    grid: { ...BASE_GRID, right: 56, bottom: ovLabels.length > 6 ? 60 : 40 }, // 終端ラベルの逃げ場
    tooltip: { trigger: 'axis' },
    legend: { top: 0 },
    xAxis: { type: 'category', data: ovLabels, boundaryGap: false, axisLabel: { rotate: ovLabels.length > 6 ? 30 : 0, fontSize: 11 } },
    yAxis: { type: 'value', name: '平均点' },
    series,
  }, true);
}

/* ========== 成績入力タブ ========== */
function renderInput() {
  const test = testById(ui.inTest);
  const wrap = $('scoreTableWrap');
  const statusEl = $('inputStatus');
  $('deleteTestBtn').disabled = !test;

  if (!test) {
    wrap.innerHTML = '<div class="table-empty">テストがありません。「＋ テストを追加」から登録してください。</div>';
    if (statusEl) statusEl.textContent = '';
    return;
  }

  const students = studentsOf(ui.inClass);
  const qs = test.questions || [];
  const hasQ = qs.length > 0;

  let html = '<table class="score-table"><thead><tr>';
  html += '<th>No.</th><th style="text-align:left">氏名</th><th>クラス</th>';
  for (const q of qs) {
    html += `<th>${esc(q.label)}<span class="th-max">/${q.max}</span></th>`;
  }
  html += hasQ
    ? `<th>合計<span class="th-max">/${test.maxScore}</span></th>`
    : `<th>合計<span class="th-max">/${test.maxScore}（直接入力）</span></th>`;
  html += '<th>得点率</th><th>欠席</th></tr></thead><tbody>';

  let entered = 0, absentCount = 0, blankCount = 0;

  students.forEach((s, rowIdx) => {
    const rec = getScore(s.id, test.id);
    const isAbsent = !!(rec && rec.absent);
    if (isAbsent) absentCount++;
    else if (rec && rec.total != null) entered++;
    else blankCount++;

    html += `<tr data-sid="${esc(s.id)}" class="${isAbsent ? 'is-absent' : ''}">`;
    html += `<td class="cell-no">${esc(s.number != null && s.number !== '' ? s.number : rowIdx + 1)}</td>`;
    html += `<td class="cell-name">${esc(s.name)}</td>`;
    html += `<td class="cell-class">${esc(s.className || '')}</td>`;
    qs.forEach((q, colIdx) => {
      const v = rec && rec.questions ? rec.questions[q.key] : null;
      // 欠席行は値を表示しない（データは保持し、欠席解除で復元）
      html += `<td><input class="cell-input" type="number" min="0" max="${q.max}"
        data-row="${rowIdx}" data-col="${colIdx}" data-sid="${esc(s.id)}" data-q="${esc(q.key)}"
        value="${isAbsent ? '' : (v != null ? v : '')}" ${isAbsent ? 'disabled' : ''}></td>`;
    });
    if (hasQ) {
      const totalText = isAbsent ? '欠' : (rec && rec.total != null ? rec.total : '');
      html += `<td class="cell-total" data-total="${esc(s.id)}">${totalText}</td>`;
    } else {
      const v = rec && rec.total != null ? rec.total : '';
      html += `<td><input class="cell-input" type="number" min="0" max="${test.maxScore}"
        data-row="${rowIdx}" data-col="0" data-sid="${esc(s.id)}" data-q="__total__"
        value="${isAbsent ? '' : v}" ${isAbsent ? 'disabled' : ''}></td>`;
    }
    const rate = isAbsent ? '—' : (rec && rec.total != null ? round1(rec.total / test.maxScore * 100) + '%' : '');
    html += `<td class="cell-rate" data-rate="${esc(s.id)}">${rate}</td>`;
    html += `<td><input type="checkbox" class="absent-check" data-sid="${esc(s.id)}" ${isAbsent ? 'checked' : ''}></td>`;
    html += '</tr>';
  });
  html += '</tbody></table>';
  if (!students.length) html = '<div class="table-empty">生徒がいません。</div>';
  wrap.innerHTML = html;

  if (statusEl) {
    if (students.length) {
      const blankLabel = blankCount > 0
        ? `<strong class="status-blank">未入力 ${blankCount}名</strong>`
        : `未入力 0名`;
      statusEl.innerHTML = `入力済 ${entered}名　/　欠席 ${absentCount}名　/　${blankLabel}　（対象 ${students.length}名）`;
    } else {
      statusEl.textContent = '';
    }
  }
}

// セル入力 → スコア更新
function handleCellInput(input) {
  const test = testById(ui.inTest);
  if (!test) return;
  const sid = input.dataset.sid;
  const qkey = input.dataset.q;
  const raw = input.value.trim();
  const max = qkey === '__total__' ? test.maxScore
    : (test.questions.find((q) => q.key === qkey) || {}).max || 0;
  const parsed = parseBoundedNumber(raw, max);
  const val = parsed.value;

  input.classList.toggle('is-over', !parsed.valid);
  input.setAttribute('aria-invalid', String(!parsed.valid));
  input.title = parsed.valid ? '' : `0〜${max}の範囲で入力してください`;
  // 範囲外の値は画面で警告するだけでなく、データへ入れない
  if (!parsed.valid) return;
  const rec = ensureScore(sid, test.id);

  if (qkey === '__total__') {
    rec.total = val;
  } else {
    if (val == null) delete rec.questions[qkey];
    else rec.questions[qkey] = val;
    recalcScore(rec, test);
    const totalCell = document.querySelector(`[data-total="${CSS.escape(sid)}"]`);
    if (totalCell) totalCell.textContent = rec.total != null ? rec.total : '';
  }
  const rateCell = document.querySelector(`[data-rate="${CSS.escape(sid)}"]`);
  if (rateCell) rateCell.textContent = rec.total != null ? round1(rec.total / test.maxScore * 100) + '%' : '';
  markDirty();
}

// 欠席チェックの切り替え
function handleAbsentToggle(checkbox) {
  const test = testById(ui.inTest);
  if (!test) return;
  const sid = checkbox.dataset.sid;
  const rec = ensureScore(sid, test.id);
  if (checkbox.checked) {
    rec.absent = true;
    rec.total = null; // 統計（total!=null判定）から除外。問題別の値は残す
  } else {
    delete rec.absent;
    recalcScore(rec, test); // 問題別の値から合計を復元（問題なしのテストはnullのまま）
  }
  markDirty();
  renderInput(); // 行の表示（入力可否・合計・状況）を更新
}

// Excel風キーボード操作：Enterで下、Shift+Enterで上のセルへ
function handleCellKeydown(e) {
  if (e.key !== 'Enter') return;
  const input = e.target;
  if (!input.classList.contains('cell-input')) return;
  e.preventDefault();
  const row = Number(input.dataset.row);
  const col = Number(input.dataset.col);
  const nextRow = e.shiftKey ? row - 1 : row + 1;
  const next = $('scoreTableWrap').querySelector(
    `.cell-input[data-row="${nextRow}"][data-col="${col}"]:not([disabled])`);
  if (next) {
    next.focus();
    next.select();
  } else {
    input.blur();
  }
}

// Excel貼り付け：起点セルから右・下へ流し込む
function handleCellPaste(e, input) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text || (!text.includes('\t') && !text.includes('\n'))) return; // 単一値は通常入力に任せる
  e.preventDefault();

  const test = testById(ui.inTest);
  const students = studentsOf(ui.inClass);
  const qs = test.questions || [];
  const hasQ = qs.length > 0;
  const startRow = Number(input.dataset.row);
  const startCol = Number(input.dataset.col);

  const rows = text.replace(/\r/g, '').split('\n').filter((r) => r.length);
  let invalidCount = 0, changed = false;
  rows.forEach((rowText, ri) => {
    const student = students[startRow + ri];
    if (!student) return;
    let rec = getScore(student.id, test.id);
    const editableRec = () => rec || (rec = ensureScore(student.id, test.id));
    rowText.split('\t').forEach((cell, ci) => {
      const v = cell.trim();
      if (v === '' || isNaN(Number(v))) return;
      if (hasQ) {
        const q = qs[startCol + ci];
        if (q) {
          const parsed = parseBoundedNumber(v, q.max);
          if (!parsed.valid) { invalidCount++; return; }
          editableRec().questions[q.key] = parsed.value;
          changed = true;
        }
      } else if (ci === 0) {
        const parsed = parseBoundedNumber(v, test.maxScore);
        if (!parsed.valid) { invalidCount++; return; }
        editableRec().total = parsed.value;
        changed = true;
      }
    });
    if (hasQ && rec) recalcScore(rec, test);
  });
  if (changed) markDirty();
  renderInput();
  if (invalidCount) alert(`範囲外の点数 ${invalidCount}件は取り込みませんでした。各問題の0点〜満点の範囲で入力してください。`);
}

/* ---- テスト追加ダイアログ ---- */
function builderDomainKeys() {
  // 分野キー＝分野名。テストが違っても同じ分野名なら同じ分野として扱われ、
  // 分野別の推移が年をまたいでつながる
  return [...$('tfDomains').querySelectorAll('.builder-row')].map((row) => {
    const label = row.querySelector('.bd-label').value.trim();
    return { key: label, label, max: Number(row.querySelector('.bd-max').value) || 0 };
  });
}

function addDomainRow(label = '', max = '') {
  const div = document.createElement('div');
  div.className = 'builder-row';
  div.innerHTML = `
    <input type="text" class="bd-label" placeholder="分野名（例：読解）" value="${esc(label)}">
    <input type="number" class="bd-max" placeholder="満点" min="1" value="${esc(max)}">
    <button type="button" class="row-del" title="削除">✕</button>`;
  div.querySelector('.row-del').onclick = () => { div.remove(); refreshQuestionDomainSelects(); };
  div.querySelector('.bd-label').oninput = refreshQuestionDomainSelects;
  $('tfDomains').appendChild(div);
}

function addQuestionRow(label = '', max = '') {
  const div = document.createElement('div');
  div.className = 'builder-row';
  div.innerHTML = `
    <input type="text" class="bq-label" placeholder="問題名（例：問1）" value="${esc(label)}">
    <input type="number" class="bq-max" placeholder="配点" min="1" value="${esc(max)}">
    <select class="bq-domain"></select>
    <button type="button" class="row-del" title="削除">✕</button>`;
  div.querySelector('.row-del').onclick = () => div.remove();
  $('tfQuestions').appendChild(div);
  refreshQuestionDomainSelects();
}

function refreshQuestionDomainSelects() {
  const domains = builderDomainKeys();
  for (const sel of $('tfQuestions').querySelectorAll('.bq-domain')) {
    const cur = sel.value;
    sel.innerHTML = '<option value="">分野なし</option>' +
      domains.map((d) => `<option value="${d.key}">${esc(d.label || '(無名)')}</option>`).join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  }
}

// 同じ教科の直近テストから分野・問題・配点をコピー（分野名を揃えるための近道）
function copyPrevStructure() {
  const subj = $('tfSubject').value.trim();
  if (!subj) { alert('先に「教科」を入力してください。'); return; }
  const prev = [...data.tests].reverse().find((t) =>
    t.subject === subj && ((t.domains && t.domains.length) || (t.questions && t.questions.length)));
  if (!prev) { alert(`「${subj}」のテストはまだ登録されていません。`); return; }
  $('tfDomains').innerHTML = '';
  $('tfQuestions').innerHTML = '';
  for (const d of (prev.domains || [])) addDomainRow(d.label, d.max);
  const dLabelOf = new Map((prev.domains || []).map((d) => [d.key, d.label]));
  for (const q of (prev.questions || [])) {
    addQuestionRow(q.label, q.max);
    const sel = $('tfQuestions').lastElementChild.querySelector('.bq-domain');
    const label = dLabelOf.get(q.domain) || q.domain || '';
    if ([...sel.options].some((o) => o.value === label)) sel.value = label;
  }
  $('tfMax').value = prev.maxScore || 100;
}

function openTestDialog() {
  $('tfName').value = '';
  $('tfSubject').value = data.tests.length ? data.tests[data.tests.length - 1].subject : '';
  const lastGy = data.tests.length ? data.tests[data.tests.length - 1].gradeYear : null;
  $('tfGrade').value = lastGy ? String(lastGy) : '';
  $('tfDate').value = '';
  $('tfMax').value = 100;
  $('tfDomains').innerHTML = '';
  $('tfQuestions').innerHTML = '';
  $('testDialog').showModal();
}

function submitTestDialog(e) {
  e.preventDefault();
  // 分野名の重複は1つにまとめる（キー＝分野名）
  const seenD = new Set();
  const domains = builderDomainKeys().filter((d) => d.label && !seenD.has(d.label) && seenD.add(d.label));
  const questions = [...$('tfQuestions').querySelectorAll('.builder-row')].map((row, i) => ({
    key: 'q' + (i + 1),
    label: row.querySelector('.bq-label').value.trim() || `問${i + 1}`,
    max: Number(row.querySelector('.bq-max').value) || 0,
    domain: row.querySelector('.bq-domain').value || undefined,
  })).filter((q) => q.max > 0);
  const maxScore = Number($('tfMax').value) || 100;
  const questionMaxSum = questions.reduce((sum, q) => sum + q.max, 0);
  if (questionMaxSum > maxScore) {
    alert(`問題の配点合計（${questionMaxSum}点）がテストの満点（${maxScore}点）を超えています。配点を修正してください。`);
    return;
  }
  const domainMismatch = domains.find((d) => {
    const assignedMax = questions.filter((q) => q.domain === d.key).reduce((sum, q) => sum + q.max, 0);
    return assignedMax > 0 && assignedMax !== d.max;
  });
  if (domainMismatch) {
    const assignedMax = questions.filter((q) => q.domain === domainMismatch.key).reduce((sum, q) => sum + q.max, 0);
    alert(`分野「${domainMismatch.label}」の満点（${domainMismatch.max}点）と、所属する問題の配点合計（${assignedMax}点）が一致しません。`);
    return;
  }

  const test = {
    id: 't' + Date.now(),
    name: $('tfName').value.trim(),
    subject: $('tfSubject').value.trim(),
    maxScore,
    domains,
    questions,
  };
  const gy = parseInt($('tfGrade').value, 10);
  if (gy >= 1 && gy <= 3) test.gradeYear = gy;
  const date = $('tfDate').value;
  if (date) test.date = date;
  data.tests.push(test);
  ui.inTest = test.id;
  // 追加したテストが教科フィルタで隠れないよう、その教科に合わせる
  if (ui.inSubject !== 'all' && ui.inSubject !== test.subject) ui.inSubject = test.subject;
  ui.ovTest = ui.ovTest || test.id;
  ui.anTest = ui.anTest || test.id;
  markDirty();
  $('testDialog').close();
  renderAll();
}

function deleteCurrentTest() {
  if (!requireAdmin()) return;
  const test = testById(ui.inTest);
  if (!test) return;
  if (!confirm(`「${test.name}」と入力済みの得点をすべて削除します。よろしいですか？`)) return;
  data.tests = data.tests.filter((t) => t.id !== test.id);
  data.scores = data.scores.filter((s) => s.testId !== test.id);
  rebuildIndex();
  const last = data.tests.length ? data.tests[data.tests.length - 1].id : '';
  if (ui.inTest === test.id) ui.inTest = last;
  if (ui.ovTest === test.id) ui.ovTest = last;
  if (ui.anTest === test.id) ui.anTest = last;
  markDirty();
  renderAll();
}

/* ========== 個人推移タブ ========== */
function renderTrend() {
  renderStudentList();
  renderTrendChart();
  renderTrendDomainChart();
  // カルテ印刷は生徒1名選択時のみ
  $('printKarteBtn').disabled = ui.trendSelected.size !== 1;
}

function renderStudentList() {
  const listEl = $('studentList');
  const kw = ui.trendSearch.trim();
  const students = studentsOf(ui.trendClass).filter((s) => !kw || s.name.includes(kw));
  listEl.innerHTML = students.map((s) => `
    <li data-sid="${esc(s.id)}" class="${ui.trendSelected.has(s.id) ? 'is-checked' : ''}">
      <input type="checkbox" ${ui.trendSelected.has(s.id) ? 'checked' : ''} tabindex="-1">
      <span class="sl-num">${esc(s.number != null && s.number !== '' ? s.number : '')}</span>
      <span>${esc(s.name)}</span>
      <span class="sl-class">${esc(s.className || '')}</span>
    </li>`).join('');
}

// 個人推移の横軸定義：教科別はその教科のテスト、全教科合計は同じ回
// （実施学年＋テスト名）でまとめる。どちらも回の時間順（1年→2年→3年）に並ぶ
function trendAxis() {
  const subj = ui.trendSubject;
  if (subj === SUM_KEY) {
    const keys = termOrderedList();
    const byKey = new Map(keys.map((k) => [k, []]));
    for (const t of data.tests) byKey.get(termKeyOf(t)).push(t);
    return {
      labels: keys,
      yName: '合計点',
      valueOf: (sid) => keys.map((k) => {
        let sum = 0, any = false;
        for (const t of byKey.get(k)) {
          const r = getScore(sid, t.id);
          if (r && r.total != null) { sum += r.total; any = true; }
        }
        return any ? sum : null;
      }),
    };
  }
  const tests = sortTestsByTerm(data.tests.filter((t) => t.subject === subj));
  return {
    labels: tests.map(termKeyOf),
    yName: '得点',
    valueOf: (sid) => tests.map((t) => {
      const r = getAttendedScore(sid, t.id);
      return r && r.total != null ? r.total : null;
    }),
  };
}

function renderTrendChart() {
  const axis = trendAxis();
  const selected = [...ui.trendSelected]
    .map((sid) => data.students.find((s) => s.id === sid))
    .filter(Boolean);

  const series = selected.map((s, i) => ({
    name: s.name,
    type: 'line',
    symbol: 'circle',
    symbolSize: 8,
    connectNulls: true,
    data: axis.valueOf(s.id),
    itemStyle: { color: PALETTE[i % PALETTE.length] },
  }));

  // クラス平均（フィルタ中のクラス範囲）
  const scope = studentsOf(ui.trendClass);
  const scopeVals = scope.map((s) => axis.valueOf(s.id));
  series.push({
    name: ui.trendClass === 'all' ? '全体平均' : `${ui.trendClass}平均`,
    type: 'line',
    symbol: 'none',
    lineStyle: { type: 'dashed', color: AVG_COLOR, width: 2 },
    itemStyle: { color: AVG_COLOR },
    connectNulls: true,
    data: axis.labels.map((_, idx) => {
      const vals = scopeVals.map((arr) => arr[idx]).filter((v) => v != null);
      return vals.length ? round1(mean(vals)) : null;
    }),
  });

  // どの系列にも値がない回は表示しない（例：1年生にはまだ2・3年時の回が無い）
  let labels = axis.labels;
  const used = labels.map((_, i) => series.some((sr) => sr.data[i] != null));
  if (used.some((u) => !u)) {
    labels = labels.filter((_, i) => used[i]);
    for (const sr of series) sr.data = sr.data.filter((_, i) => used[i]);
  }

  chart('trendChart').setOption({
    grid: { ...BASE_GRID, top: 50, bottom: labels.length > 6 ? 60 : 40 },
    tooltip: { trigger: 'axis' },
    legend: { top: 0, type: 'scroll' },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { rotate: labels.length > 6 ? 30 : 0, fontSize: 11 } },
    yAxis: { type: 'value', name: axis.yName },
    series,
  }, true);

  const card = $('trendChart').closest('.card');
  const subjLabel = ui.trendSubject === SUM_KEY ? '全教科合計' : ui.trendSubject;
  card.querySelector('h3').textContent = selected.length
    ? `得点の推移：${subjLabel}（クラス平均と比較）`
    : `得点の推移：${subjLabel} — 左の名簿から生徒を選択してください`;
}

// 1名選択時のみ：分野別得点率の推移（教科別のみ。5教科合計では非表示）
function renderTrendDomainChart() {
  const card = $('trendDomainCard');
  if (ui.trendSelected.size !== 1 || ui.trendSubject === SUM_KEY) {
    card.hidden = true;
    return;
  }
  const sid = [...ui.trendSelected][0];
  const student = data.students.find((s) => s.id === sid);
  const subjectTests = sortTestsByTerm(data.tests.filter((t) => t.subject === ui.trendSubject));
  card.hidden = false;
  $('trendDomainTitle').textContent = `${student.name}さんの分野別 得点率の推移（${ui.trendSubject}）`;

  // 当該教科の分野キーを集約（同一keyは同一分野とみなす）
  const keyLabel = new Map();
  for (const t of subjectTests) for (const d of testDomains(t)) {
    if (!keyLabel.has(d.key)) keyLabel.set(d.key, d.label);
  }

  const series = [...keyLabel].map(([key, label], i) => ({
    name: label,
    type: 'line',
    symbol: 'circle',
    symbolSize: 8,
    connectNulls: true,
    data: subjectTests.map((t) => {
      const r = getAttendedScore(sid, t.id);
      if (!r || !r.domains || r.domains[key] == null) return null;
      const max = domainMax(t, key);
      return max ? round1(r.domains[key] / max * 100) : null;
    }),
    itemStyle: { color: PALETTE[i % PALETTE.length] },
  }));

  // 本人にデータがない回は表示しない
  let dLabels = subjectTests.map(termKeyOf);
  const dUsed = dLabels.map((_, i) => series.some((sr) => sr.data[i] != null));
  if (dUsed.some((u) => !u)) {
    dLabels = dLabels.filter((_, i) => dUsed[i]);
    for (const sr of series) sr.data = sr.data.filter((_, i) => dUsed[i]);
  }

  chart('trendDomainChart').setOption({
    grid: { ...BASE_GRID, top: 50, bottom: dLabels.length > 6 ? 60 : 40 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => v + '%' },
    legend: { top: 0 },
    xAxis: { type: 'category', data: dLabels, boundaryGap: false, axisLabel: { rotate: dLabels.length > 6 ? 30 : 0, fontSize: 11 } },
    yAxis: { type: 'value', max: 100, name: '得点率%' },
    series,
  }, true);
}

/* ========== 分野・問題分析タブ ========== */
function renderAnalysis() {
  const test = testById(ui.anTest);
  const banner = $('weakBanner');
  if (!test) {
    banner.hidden = true;
    return;
  }
  const students = studentsOf(ui.anClass);

  const { domains, rates } = renderDomainBar('anDomainChart', test, students, true);
  const qResult = renderQuestionBar(test, students);
  renderQuestionBox(test, students);

  // 弱点バナー
  const validD = domains.map((d, i) => ({ d, r: rates[i] })).filter((x) => x.r != null);
  const validQ = qResult.filter((x) => x.rate != null);
  if (validD.length || validQ.length) {
    let msg = '';
    if (validD.length) {
      const weak = validD.reduce((a, b) => (a.r <= b.r ? a : b));
      msg += `最も弱い分野は <strong>${esc(weak.d.label)}</strong>（平均得点率 ${weak.r}%）`;
    }
    if (validQ.length) {
      const weakQ = validQ.reduce((a, b) => (a.rate <= b.rate ? a : b));
      msg += `${msg ? '、' : ''}最も正答率が低い問題は <strong>${esc(weakQ.label)}</strong>（${weakQ.rate}%）`;
    }
    msg = '📌 ' + msg + ' です。';

    // 前回テスト比：分野ごとの伸びを効果量で（同じ分野キーを持つ直前テストと比較）
    const subjTests = sortTestsByTerm(data.tests.filter((t) => t.subject === test.subject));
    const tIdx = subjTests.findIndex((t) => t.id === test.id);
    if (tIdx > 0) {
      const prev = subjTests[tIdx - 1];
      const moves = [];
      for (const d of testDomains(test)) {
        const prevMax = domainMax(prev, d.key);
        const curMax = domainMax(test, d.key);
        if (!prevMax || !curMax) continue;
        const pairs = [];
        for (const s of students) {
          const a = getAttendedScore(s.id, prev.id);
          const b = getAttendedScore(s.id, test.id);
          if (a && a.domains && a.domains[d.key] != null && b && b.domains && b.domains[d.key] != null) {
            pairs.push([a.domains[d.key] / prevMax * 100, b.domains[d.key] / curMax * 100]);
          }
        }
        if (pairs.length >= 5) {
          const dz = pairedCohensDz(pairs);
          if (dz != null) moves.push({ label: d.label, d: dz });
        }
      }
      if (moves.length) {
        const best = moves.reduce((a, b) => (a.d >= b.d ? a : b));
        const worst = moves.reduce((a, b) => (a.d <= b.d ? a : b));
        let line = `<br>📈 前回（${esc(prev.name)}）と比べて、伸びが大きい分野は <strong>${esc(best.label)}</strong>（効果量 dz=${esFmt(best.d)}・${esLabel(best.d)}）`;
        if (worst.label !== best.label && worst.d <= -0.2) {
          line += `、下がったのは <strong>${esc(worst.label)}</strong>（dz=${esFmt(worst.d)}）`;
        }
        line += `<span class="es-link">効果量とは？</span>`;
        msg += line;
      }
    }

    banner.innerHTML = msg;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderQuestionBar(test, students) {
  const qs = test.questions || [];
  const result = qs.map((q) => {
    const vals = students.map((s) => getAttendedScore(s.id, test.id))
      .filter((r) => r && r.questions && r.questions[q.key] != null)
      .map((r) => r.questions[q.key] / q.max * 100);
    return { label: q.label, rate: vals.length ? round1(mean(vals)) : null };
  });
  const minRate = Math.min(...result.filter((x) => x.rate != null).map((x) => x.rate));
  chart('anQuestionChart').setOption({
    grid: BASE_GRID,
    tooltip: { trigger: 'axis', valueFormatter: (v) => v + '%' },
    xAxis: { type: 'category', data: result.map((x) => x.label), axisLabel: { rotate: 20, fontSize: 11 } },
    yAxis: { type: 'value', max: 100, name: '得点率%' },
    series: [{
      type: 'bar',
      data: result.map((x) => ({
        value: x.rate,
        itemStyle: {
          color: x.rate === minRate ? '#c0392b' : PALETTE[0],
          borderRadius: [4, 4, 0, 0],
        },
      })),
      barWidth: '55%',
      label: { show: true, position: 'top', formatter: '{c}%' },
    }],
  }, true);
  return result;
}

function formatBoxTooltip(params) {
  const values = Array.isArray(params.data) ? params.data : params.value;
  if (!Array.isArray(values) || values[0] == null) return params.name + ': データ不足';
  const [min, q1, med, q3, max] = values;
  return `${params.name}<br>最小 ${min}% ／ 第1四分位 ${q1}%<br>中央値 ${med}%<br>第3四分位 ${q3}% ／ 最大 ${max}%`;
}

function renderQuestionBox(test, students) {
  const qs = test.questions || [];
  const boxData = [];
  const labels = [];
  for (const q of qs) {
    const vals = students.map((s) => getAttendedScore(s.id, test.id))
      .filter((r) => r && r.questions && r.questions[q.key] != null)
      .map((r) => r.questions[q.key] / q.max * 100)
      .sort((a, b) => a - b);
    labels.push(q.label);
    if (vals.length < 4) {
      boxData.push([null, null, null, null, null]);
      continue;
    }
    boxData.push([
      round1(vals[0]),
      round1(quantile(vals, 0.25)),
      round1(quantile(vals, 0.5)),
      round1(quantile(vals, 0.75)),
      round1(vals[vals.length - 1]),
    ]);
  }
  chart('anBoxChart').setOption({
    grid: BASE_GRID,
    tooltip: {
      trigger: 'item',
      formatter: formatBoxTooltip,
    },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: 20, fontSize: 11 } },
    yAxis: { type: 'value', max: 100, name: '得点率%' },
    series: [{
      type: 'boxplot',
      data: boxData,
      itemStyle: { color: '#dceaf7', borderColor: PALETTE[0] },
    }],
  }, true);
}

/* ========== 相関分析タブ ========== */
function metricById(mid) {
  return data.metrics.find((m) => m.id === mid) || null;
}

// 軸の選択肢：テスト合計とすべての指標
function fillAxisSelects() {
  const opts =
    data.metrics.map((m) => `<option value="m:${esc(m.id)}">${esc(m.label)}［${metricKindLabel(m)}］</option>`).join('') +
    data.tests.map((t) => `<option value="t:${esc(t.id)}">${esc(termKeyOf(t))}・${esc(t.subject)}（合計）</option>`).join('');
  for (const [sel, val] of [[$('corrX'), ui.corrX], [$('corrY'), ui.corrY]]) {
    sel.innerHTML = opts;
    if (val && [...sel.options].some((o) => o.value === val)) sel.value = val;
  }
  ui.corrX = $('corrX').value;
  ui.corrY = $('corrY').value;
}

// 指標の種類ラベル（画面表示用）
function metricKindLabel(m) {
  return m.type === 'scale' ? '5段階' : '数値';
}

function fillMetricSelect() {
  const sel = $('metricSel');
  sel.innerHTML = data.metrics.map((m) =>
    `<option value="${esc(m.id)}">${esc(m.label)}［${metricKindLabel(m)}］</option>`).join('');
  if (ui.metricId && metricById(ui.metricId)) sel.value = ui.metricId;
  ui.metricId = sel.value;
}

// 軸指定（"m:id" / "t:id"）から値の取得関数を作る
function axisInfo(v) {
  if (!v) return null;
  const [kind, id] = [v.slice(0, 1), v.slice(2)];
  if (kind === 'm') {
    const m = metricById(id);
    if (!m) return null;
    return {
      label: m.label,
      isScale: m.type === 'scale',
      get: (sid) => {
        const raw = m.values ? m.values[sid] : null;
        return raw == null || raw === '' ? null : Number(raw);
      },
    };
  }
  const t = testById(id);
  if (!t) return null;
  return {
    label: `${termKeyOf(t)}・${t.subject}（合計）`,
    isScale: false,
    get: (sid) => {
      const r = getAttendedScore(sid, t.id);
      return r && r.total != null ? r.total : null;
    },
  };
}

function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = mean(pairs.map((p) => p[0]));
  const my = mean(pairs.map((p) => p[1]));
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (!sxx || !syy) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function corrStrength(r) {
  const a = Math.abs(r);
  const dir = r > 0 ? '正' : '負';
  if (a >= 0.7) return `強い${dir}の相関`;
  if (a >= 0.4) return `中程度の${dir}の相関`;
  if (a >= 0.2) return `弱い${dir}の相関`;
  return 'ほとんど相関なし';
}

// 教員向けの平易な解釈文
function corrInterpretation(xLabel, yLabel, r) {
  const a = Math.abs(r);
  if (a < 0.2) return `${xLabel} と ${yLabel} には、はっきりした関係は見られません。`;
  const adv = a >= 0.7 ? 'はっきりと' : a >= 0.4 ? 'ある程度' : 'ゆるやかに';
  const yDir = r > 0 ? '高い' : '低い';
  return `${xLabel}が大きい生徒ほど ${yLabel} が${yDir}傾向が、${adv}見られます。（あくまで傾向で、例外もあります）`;
}

// 離散値（5段階など）の点が重ならないよう、生徒IDから安定した微小ズレを作る
function jitterFor(sid) {
  let h = 0;
  for (let i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.36;
}

function renderMetricsTab() {
  renderMetricTable();
  renderCorrelation();
}

function renderCorrelation() {
  const x = axisInfo(ui.corrX);
  const y = axisInfo(ui.corrY);
  const banner = $('corrBanner');
  if (!x || !y) {
    banner.hidden = true;
    chart('corrChart').clear();
    return;
  }

  const scope = studentsOf(ui.metClass);
  const jx = !!x.isScale, jy = !!y.isScale;
  const points = []; // {x,y,name,className}（xyは実値）
  const byClass = new Map();
  for (const s of scope) {
    const xv = x.get(s.id);
    const yv = y.get(s.id);
    if (xv == null || yv == null || isNaN(xv) || isNaN(yv)) continue;
    points.push({ x: xv, y: yv, name: s.name, className: s.className || '' });
    const k = s.className || '（クラスなし）';
    if (!byClass.has(k)) byClass.set(k, []);
    // 離散値は描画座標にジッターを足す（ツールチップは実値 ox/oy を表示）
    byClass.get(k).push({
      value: [xv + (jx ? jitterFor(s.id) : 0), yv + (jy ? jitterFor(s.id) : 0)],
      ox: xv, oy: yv, name: s.name,
    });
  }

  const series = [...byClass].map(([klass, pts], i) => ({
    name: klass,
    type: 'scatter',
    symbolSize: 11,
    data: pts,
    itemStyle: { color: PALETTE[i % PALETTE.length], opacity: 0.7 },
  }));

  const r = pearson(points.map((p) => [p.x, p.y]));
  let mx = null, my = null, slope = 0;
  if (r != null) {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    mx = mean(xs); my = mean(ys);
    const sx = Math.sqrt(mean(xs.map((v) => (v - mx) ** 2)));
    const sy = Math.sqrt(mean(ys.map((v) => (v - my) ** 2)));
    slope = r * sy / sx;
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    // 傾向線＋平均の十字線
    series.push({
      name: '傾向線',
      type: 'line',
      symbol: 'none',
      silent: true,
      lineStyle: { type: 'dashed', color: AVG_COLOR, width: 2 },
      itemStyle: { color: AVG_COLOR },
      data: [[x0, my + slope * (x0 - mx)], [x1, my + slope * (x1 - mx)]],
      markLine: {
        silent: true,
        symbol: 'none',
        lineStyle: { type: 'dashed', color: '#cfd3dc', width: 1 },
        label: { formatter: '平均', color: CHART_TEXT, fontSize: 10 },
        data: [{ xAxis: round1(mx) }, { yAxis: round1(my) }],
      },
    });
  }

  chart('corrChart').setOption({
    grid: { ...BASE_GRID, top: 50, left: 60 },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        if (p.seriesName === '傾向線') return '';
        const d = p.data || {};
        return `<strong>${esc(p.name)}</strong>（${esc(p.seriesName)}）<br>${esc(x.label)}: ${d.ox}<br>${esc(y.label)}: ${d.oy}`;
      },
    },
    legend: { top: 0, type: 'scroll' },
    xAxis: { type: 'value', name: x.label, nameLocation: 'middle', nameGap: 28, scale: true },
    yAxis: { type: 'value', name: y.label, scale: true },
    series,
  }, true);

  // バナー：係数＋強さバー＋平易な解釈
  if (r == null) {
    banner.innerHTML = `データが足りません（両方の値がある生徒が3名以上必要です。現在 ${points.length} 名）`;
    banner.hidden = false;
  } else {
    const rTxt = `${r >= 0 ? '+' : ''}${(Math.round(r * 100) / 100).toFixed(2)}`;
    const pct = Math.round(Math.abs(r) * 100);
    const barColor = Math.abs(r) >= 0.7 ? 'var(--primary)' : Math.abs(r) >= 0.4 ? 'var(--warn)' : 'var(--text-faint)';
    banner.innerHTML =
      `<div class="corr-head"><strong>${esc(x.label)} × ${esc(y.label)}</strong>　相関係数 <strong>r = ${rTxt}</strong></div>` +
      `<div class="corr-strength"><div class="corr-bar"><span style="width:${pct}%;background:${barColor}"></span></div>` +
      `<span class="corr-strength-label">${corrStrength(r)}・対象 ${points.length} 名</span></div>` +
      `<div class="corr-interp">${esc(corrInterpretation(x.label, y.label, r))}</div>`;
    banner.hidden = false;
  }

  renderCorrOutliers(points, x, y, r, mx, my, slope);
  renderChiSquare(points, x, y);
}

// 傾向線から外れる生徒を抽出して表示
function renderCorrOutliers(points, x, y, r, mx, my, slope) {
  const card = $('corrOutlierCard');
  // 明確な傾向があるときだけ意味を持つ
  if (r == null || Math.abs(r) < 0.2 || points.length < 5) {
    card.hidden = true;
    return;
  }
  const withRes = points.map((p) => ({ ...p, res: p.y - (my + slope * (p.x - mx)) }));
  const sd = Math.sqrt(mean(withRes.map((p) => p.res ** 2))) || 1;
  const thr = sd * 1.2;
  const below = withRes.filter((p) => p.res <= -thr).sort((a, b) => a.res - b.res).slice(0, 6);
  const above = withRes.filter((p) => p.res >= thr).sort((a, b) => b.res - a.res).slice(0, 6);

  if (!below.length && !above.length) {
    card.hidden = true;
    return;
  }
  const chip = (p) => `<span class="outlier-chip">${esc(p.name)}<small>${esc(p.className)}</small></span>`;
  let html = '';
  if (below.length) {
    html += `<div class="outlier-col"><div class="outlier-head outlier-low">${esc(x.label)}の割に ${esc(y.label)} が低い</div>` +
      `<div class="outlier-chips">${below.map(chip).join('')}</div></div>`;
  }
  if (above.length) {
    html += `<div class="outlier-col"><div class="outlier-head outlier-high">${esc(x.label)}の割に ${esc(y.label)} が高い</div>` +
      `<div class="outlier-chips">${above.map(chip).join('')}</div></div>`;
  }
  $('corrOutliers').innerHTML = html;
  card.hidden = false;
}

/* ---- 指標の入力 ---- */
function renderMetricTable() {
  const wrap = $('metricTableWrap');
  const m = metricById(ui.metricId);
  $('deleteMetricBtn').disabled = !m;

  if (!m) {
    wrap.innerHTML = '<div class="table-empty">指標がありません。「＋ 指標を追加」から登録してください。</div>';
    return;
  }
  if (!m.values) m.values = {};

  const isScale = m.type === 'scale';
  const students = studentsOf(ui.metClass);
  let html = '<table class="score-table"><thead><tr>';
  html += `<th>No.</th><th style="text-align:left">氏名</th><th>クラス</th>`;
  html += `<th>${esc(m.label)}<span class="th-max">${isScale ? '5段階（1〜5）' : '数値'}</span></th>`;
  html += '</tr></thead><tbody>';
  students.forEach((s, rowIdx) => {
    const v = m.values[s.id];
    html += `<tr>
      <td class="cell-no">${esc(s.number != null && s.number !== '' ? s.number : rowIdx + 1)}</td>
      <td class="cell-name">${esc(s.name)}</td>
      <td class="cell-class">${esc(s.className || '')}</td>
      <td><input class="cell-input metric-input" type="number" ${isScale ? 'min="1" max="5"' : ''}
        data-row="${rowIdx}" data-sid="${esc(s.id)}" value="${v != null ? v : ''}"></td>
    </tr>`;
  });
  html += '</tbody></table>';
  if (!students.length) html = '<div class="table-empty">生徒がいません。</div>';
  wrap.innerHTML = html;
}

function handleMetricInput(input) {
  const m = metricById(ui.metricId);
  if (!m) return;
  if (!m.values) m.values = {};
  const sid = input.dataset.sid;
  const raw = input.value.trim();
  if (raw === '') {
    delete m.values[sid];
  } else {
    const v = Number(raw);
    const valid = Number.isFinite(v) && (m.type !== 'scale' || (v >= 1 && v <= 5));
    input.classList.toggle('is-over', !valid);
    input.setAttribute('aria-invalid', String(!valid));
    input.title = valid ? '' : (m.type === 'scale' ? '1〜5の範囲で入力してください' : '数値を入力してください');
    if (!valid) return;
    m.values[sid] = v;
  }
  markDirty();
  renderCorrelation();
}

// 縦1列貼り付け（起点から下方向）
function handleMetricPaste(e, input) {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  if (!text || !text.includes('\n')) return;
  e.preventDefault();
  const m = metricById(ui.metricId);
  if (!m) return;
  if (!m.values) m.values = {};
  const students = studentsOf(ui.metClass);
  const startRow = Number(input.dataset.row);
  const rows = text.replace(/\r/g, '').split('\n');
  let invalidCount = 0, changed = false;
  rows.forEach((rowText, ri) => {
    const s = students[startRow + ri];
    if (!s) return;
    const v = rowText.split('\t')[0].trim();
    if (v === '' || isNaN(Number(v))) return;
    const num = Number(v);
    if (!Number.isFinite(num) || (m.type === 'scale' && (num < 1 || num > 5))) {
      invalidCount++;
      return;
    }
    m.values[s.id] = num;
    changed = true;
  });
  if (changed) markDirty();
  renderMetricTable();
  renderCorrelation();
  if (invalidCount) alert(`範囲外の値 ${invalidCount}件は取り込みませんでした。`);
}

function submitMetricDialog(e) {
  e.preventDefault();
  const m = {
    id: 'm' + Date.now(),
    label: $('mfLabel').value.trim(),
    type: $('mfType').value,
    values: {},
  };
  data.metrics.push(m);
  ui.metricId = m.id;
  ui.corrX = 'm:' + m.id;
  markDirty();
  $('metricDialog').close();
  fillAxisSelects();
  fillMetricSelect();
  renderMetricsTab();
  resizeCharts();
}

function deleteCurrentMetric() {
  if (!requireAdmin()) return;
  const m = metricById(ui.metricId);
  if (!m) return;
  if (!confirm(`指標「${m.label}」と入力済みの値をすべて削除します。よろしいですか？`)) return;
  data.metrics = data.metrics.filter((x) => x.id !== m.id);
  ui.metricId = data.metrics.length ? data.metrics[0].id : '';
  if (ui.corrX === 'm:' + m.id) ui.corrX = data.metrics.length ? 'm:' + data.metrics[0].id : '';
  if (ui.corrY === 'm:' + m.id) ui.corrY = '';
  markDirty();
  fillAxisSelects();
  fillMetricSelect();
  renderMetricsTab();
  resizeCharts();
}

/* ========== データ一覧タブ ========== */
// クラス名の先頭数字を学年として扱う（例：2B → 2）
function gradeOf(s) {
  const m = (s.className || '').match(/^\d+/);
  return m ? m[0] : '';
}

function gradeList() {
  return [...new Set(data.students.map(gradeOf).filter(Boolean))].sort();
}

function listScopedTests() {
  return sortTestsByTerm(data.tests.filter((t) =>
    (ui.listSubject === 'all' || t.subject === ui.listSubject) &&
    (ui.listTerm === 'all' || termKeyOf(t) === ui.listTerm)));
}

function fillListGradeSelect() {
  const sel = $('listGrade');
  sel.innerHTML = `<option value="all">全学年</option>` +
    gradeList().map((g) => `<option value="${esc(g)}">${esc(g)}年</option>`).join('');
  sel.value = gradeList().includes(ui.listGrade) ? ui.listGrade : 'all';
  ui.listGrade = sel.value;
}

function fillListTermSelect() {
  const sel = $('listTerm');
  sel.innerHTML = `<option value="all">全テスト</option>` +
    termOrderedList().map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = termOrderedList().includes(ui.listTerm) ? ui.listTerm : 'all';
  ui.listTerm = sel.value;
}

// クラスの選択肢は選択中の学年に絞る
function fillListClassSelect() {
  const sel = $('listClass');
  const classes = classList().filter((c) => ui.listGrade === 'all' || c.startsWith(ui.listGrade));
  sel.innerHTML = `<option value="all">全クラス</option>` +
    classes.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (!classes.includes(ui.listClass)) ui.listClass = 'all';
  sel.value = ui.listClass;
}

// 一覧の列定義
function listColumns() {
  const cols = [
    { key: 'number', label: 'No.', kind: 'meta' },
    { key: 'name', label: '氏名', kind: 'name' },
    { key: 'className', label: 'クラス', kind: 'meta' },
  ];
  for (const t of listScopedTests()) cols.push({ key: 't:' + t.id, label: `${esc(termKeyOf(t))}<span class="th-sub">${esc(t.subject)}</span>`, kind: 'test', test: t });
  // 特定の回を選び全教科を表示しているときは、その回の合計列（例：500点満点）を出す
  if (ui.listTerm !== 'all' && ui.listSubject === 'all') {
    const termTests = listScopedTests();
    const maxSum = termTests.reduce((a, t) => a + (t.maxScore || 0), 0);
    if (termTests.length >= 2 && maxSum > 0) {
      cols.push({ key: 'termTotal', label: `合計<span class="th-sub">/${maxSum}</span>`, kind: 'termTotal', tests: termTests, maxSum });
    }
  }
  for (const m of data.metrics) cols.push({ key: 'm:' + m.id, label: esc(m.label), kind: 'metric', metric: m });
  cols.push({ key: 'avg', label: '平均', kind: 'avg' });
  return cols;
}

// セルの値 {raw, rate, absent}（rawは点／指標値、rateは得点率）
function listCell(col, s) {
  if (col.kind === 'test') {
    const r = getScore(s.id, col.test.id);
    if (r && r.absent) return { absent: true };
    if (!r || r.total == null) return {};
    return { raw: r.total, rate: r.total / col.test.maxScore * 100 };
  }
  if (col.kind === 'metric') {
    const v = col.metric.values ? col.metric.values[s.id] : null;
    return v == null || v === '' ? {} : { raw: Number(v), metric: true };
  }
  if (col.kind === 'termTotal') {
    // 回の合計：全教科の点がそろっている生徒のみ表示（欠席・未入力が混ざると満点比が歪むため）
    let sum = 0;
    for (const t of col.tests) {
      const r = getScore(s.id, t.id);
      if (!r || r.absent || r.total == null) return {};
      sum += r.total;
    }
    return { raw: sum, rate: sum / col.maxSum * 100 };
  }
  if (col.kind === 'avg') {
    const totals = [], rates = [];
    for (const t of listScopedTests()) {
      const r = getScore(s.id, t.id);
      if (r && !r.absent && r.total != null) { totals.push(r.total); rates.push(r.total / t.maxScore * 100); }
    }
    if (!totals.length) return {};
    return { raw: round1(mean(totals)), rate: round1(mean(rates)) };
  }
  return {};
}

// 得点率→ヒートマップ色。基準点を境に 赤（低い）↔ ほぼ白 ↔ ティール（高い）のダイバージング配色。
// 赤緑の組み合わせを避け、色覚多様性でも読み分けられる（セルには数値も併記される）
function heatColor(rate, pivot) {
  const r = Math.max(0, Math.min(100, rate));
  const p = Math.max(1, Math.min(99, pivot == null ? 60 : pivot)); // 0/100は割り算回避
  if (r < p) {
    const t = (p - r) / p; // 基準点からの離れ具合 0..1
    return `hsl(354, 62%, ${Math.round(97 - t * 15)}%)`;  // 赤系：離れるほど濃く
  }
  const t = (r - p) / (100 - p);
  return `hsl(174, 45%, ${Math.round(97 - t * 15)}%)`;    // ティール系：離れるほど濃く
}

function listSortedStudents() {
  let base = studentsOf(ui.listClass);
  if (ui.listGrade !== 'all') base = base.filter((s) => gradeOf(s) === ui.listGrade);
  if (!ui.listSort) return base;
  const { key, dir } = ui.listSort;
  const col = listColumns().find((c) => c.key === key);
  const arr = [...base];
  if (key === 'name') {
    arr.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
    if (dir === 'desc') arr.reverse();
    return arr;
  }
  if (key === 'className') {
    arr.sort((a, b) => (a.className || '').localeCompare(b.className || '', 'ja') || studentNumber(a) - studentNumber(b));
    if (dir === 'desc') arr.reverse();
    return arr;
  }
  if (key === 'number') {
    arr.sort((a, b) => studentNumber(a) - studentNumber(b));
    if (dir === 'desc') arr.reverse();
    return arr;
  }
  // スコア系：値あり／なしを分け、値ありだけ並べ替え、なし（欠席・未入力）は常に末尾
  if (!col) return arr;
  const withVal = [], noVal = [];
  for (const s of arr) (listCell(col, s).raw == null ? noVal : withVal).push(s);
  withVal.sort((a, b) => listCell(col, a).raw - listCell(col, b).raw);
  if (dir === 'desc') withVal.reverse();
  return [...withVal, ...noVal];
}

function renderList() {
  const wrap = $('listTableWrap');
  const cols = listColumns();
  const students = listSortedStudents();
  const pct = ui.listMode === 'rate';

  let html = '<table class="score-table list-table"><thead><tr>';
  for (const c of cols) {
    const sorted = ui.listSort && ui.listSort.key === c.key;
    const arrow = sorted ? (ui.listSort.dir === 'asc' ? ' ▲' : ' ▼') : '';
    const cls = ['list-th', c.kind === 'name' ? 'th-name' : '', sorted ? 'is-sorted' : ''].filter(Boolean).join(' ');
    html += `<th class="${cls}" data-key="${esc(c.key)}">${c.label}${arrow}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const s of students) {
    html += '<tr>';
    for (const c of cols) {
      if (c.kind === 'meta' && c.key === 'number') {
        html += `<td class="cell-no">${esc(s.number != null && s.number !== '' ? s.number : '')}</td>`;
      } else if (c.kind === 'name') {
        html += `<td class="cell-name">${esc(s.name)}</td>`;
      } else if (c.key === 'className') {
        html += `<td class="cell-class">${esc(s.className || '')}</td>`;
      } else {
        const cv = listCell(c, s);
        let text = '', style = '';
        if (cv.absent) {
          text = '<span class="list-absent">欠</span>';
        } else if (cv.raw == null) {
          text = '';
        } else if (c.kind === 'metric') {
          text = String(cv.raw);
        } else {
          text = pct ? round1(cv.rate) + '%' : String(cv.raw);
          if (ui.listHeat && cv.rate != null) style = ` style="background:${heatColor(cv.rate, ui.listPivot)}"`;
        }
        const strong = (c.kind === 'avg' || c.kind === 'termTotal') ? ' cell-strong' : '';
        html += `<td class="list-cell${strong}"${style}>${text}</td>`;
      }
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  if (!students.length) html = '<div class="table-empty">生徒がいません。</div>';
  wrap.innerHTML = html;
}

function handleListSort(key) {
  if (ui.listSort && ui.listSort.key === key) {
    ui.listSort.dir = ui.listSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    // スコア系は降順から、氏名/クラス/番号は昇順から
    const asc = (key === 'name' || key === 'className' || key === 'number');
    ui.listSort = { key, dir: asc ? 'asc' : 'desc' };
  }
  renderList();
}

function exportList() {
  if (typeof XLSX === 'undefined') { alert('Excel出力ライブラリの読み込みに失敗しました。'); return; }
  const cols = listColumns();
  const students = listSortedStudents();
  const pct = ui.listMode === 'rate';
  const header = cols.map((c) =>
    c.kind === 'test' ? `${termKeyOf(c.test)}(${c.test.subject})` :
    c.kind === 'termTotal' ? `合計(${c.maxSum}点満点)` :
    c.label.replace(/<[^>]*>/g, ''));
  const rows = [header];
  for (const s of students) {
    const row = [];
    for (const c of cols) {
      if (c.key === 'number') row.push(s.number != null ? s.number : '');
      else if (c.kind === 'name') row.push(s.name);
      else if (c.key === 'className') row.push(s.className || '');
      else {
        const cv = listCell(c, s);
        if (cv.absent) row.push('欠');
        else if (cv.raw == null) row.push('');
        else if (c.kind === 'metric') row.push(cv.raw);
        else row.push(pct ? round1(cv.rate) : cv.raw);
      }
    }
    rows.push(row);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'データ一覧');
  const cls = ui.listClass === 'all' ? '全クラス' : ui.listClass;
  const subj = ui.listSubject === 'all' ? '全教科' : ui.listSubject;
  XLSX.writeFile(wb, `データ一覧_${subj}_${cls}.xlsx`.replace(/[\\/:*?"<>|]/g, '_'));
}

/* ========== 権限（管理者モード） ========== */
async function sha256Hex(text) {
  try {
    if (crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* 非セキュアコンテキスト等 → フォールバック */ }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

function updateRoleUI() {
  document.body.classList.toggle('is-admin', isAdmin);
  const btn = $('roleBtn');
  btn.textContent = isAdmin ? '管理者モード' : '教員モード';
  btn.classList.toggle('is-admin-badge', isAdmin);
  $('settingsBtn').hidden = !isAdmin;
  $('settingsBtn').disabled = !isAdmin;
  $('rosterBtn').disabled = !isAdmin || !data;
}

function requireAdmin() {
  if (isAdmin) return true;
  alert('この操作は管理者モードでのみ行えます。右上の「教員モード」から切り替えてください。');
  return false;
}

function openAdminDialog() {
  const hasPin = !!data.settings.adminPinHash;
  $('adminDialogNote').textContent = hasPin
    ? 'PINを入力すると、名簿管理・削除・設定などの管理機能が使えるようになります。'
    : 'PINが未設定です。最初のPIN（数字4〜8桁）を決めて入力してください。以後、管理機能はこのPINで保護されます。';
  $('adminPinInput').value = '';
  $('adminDialog').showModal();
  $('adminPinInput').focus();
}

async function submitAdminDialog(e) {
  e.preventDefault();
  const pin = $('adminPinInput').value.trim();
  if (!/^\d{4,8}$/.test(pin)) { alert('PINは数字4〜8桁で入力してください。'); return; }
  const hash = await sha256Hex('gd-v2:' + pin);
  if (!data.settings.adminPinHash) {
    data.settings.adminPinHash = hash;
    markDirty();
    isAdmin = true;
    alert('PINを設定し、管理者モードに切り替えました。忘れないよう控えてください。');
  } else if (data.settings.adminPinHash === hash) {
    isAdmin = true;
  } else {
    alert('PINが違います。');
    return;
  }
  $('adminDialog').close();
  updateRoleUI();
  if (ui.tab === 'rti') renderRti();
}

/* ---- 設定（管理者） ---- */
function openSettingsDialog() {
  if (!requireAdmin()) return;
  $('setTier3').value = data.settings.rti.tier3;
  $('setTier2').value = data.settings.rti.tier2;
  $('setPin').value = '';
  $('settingsDialog').showModal();
}

async function submitSettingsDialog(e) {
  e.preventDefault();
  const t3 = parseInt($('setTier3').value, 10);
  const t2 = parseInt($('setTier2').value, 10);
  if (isNaN(t3) || isNaN(t2) || t3 < 1 || t2 > 99 || t3 >= t2) {
    alert('しきい値は「Tier 3 ＜ Tier 2」（例：40 と 60）になるように入力してください。');
    return;
  }
  data.settings.rti.tier3 = t3;
  data.settings.rti.tier2 = t2;
  const pin = $('setPin').value.trim();
  if (pin) {
    if (!/^\d{4,8}$/.test(pin)) { alert('PINは数字4〜8桁で入力してください。'); return; }
    data.settings.adminPinHash = await sha256Hex('gd-v2:' + pin);
  }
  markDirty();
  $('settingsDialog').close();
  if (ui.tab === 'rti') renderRti();
}

/* ========== 支援（RTI）タブ ========== */
// テスト回ごとの得点率の系列を返す。
// 各テストは独立していて時系列ではないため、「全教科」のときは同じ回
// （前期中間など同名テスト）の教科をまとめて平均し、回の並びとして扱う
function termSeriesFor(sid, subject) {
  const subj = subject !== undefined ? subject : ui.rtiSubject;
  if (subj !== 'all') {
    const tests = sortTestsByTerm(data.tests.filter((t) => t.subject === subj));
    return {
      labels: tests.map(termKeyOf),
      rates: tests.map((t) => {
        const r = getScore(sid, t.id);
        return r && !r.absent && r.total != null && t.maxScore ? r.total / t.maxScore * 100 : null;
      }),
    };
  }
  // 全教科：同じ回（実施学年＋テスト名）でまとめて平均得点率
  const keys = termOrderedList();
  const byKey = new Map(keys.map((k) => [k, []]));
  for (const t of data.tests) byKey.get(termKeyOf(t)).push(t);
  const rates = keys.map((k) => {
    const vals = [];
    for (const t of byKey.get(k)) {
      const r = getScore(sid, t.id);
      if (r && !r.absent && r.total != null && t.maxScore) vals.push(r.total / t.maxScore * 100);
    }
    return vals.length ? mean(vals) : null;
  });
  return { labels: keys, rates };
}

// 生徒の判定値（得点率%）と直近の前回比を返す（テスト回ベース）
function rtiRateFor(sid, subject, basis) {
  const vals = termSeriesFor(sid, subject).rates.filter((v) => v != null);
  if (!vals.length) return { rate: null, delta: null };
  const useBasis = basis !== undefined ? basis : ui.rtiBasis;
  const rate = useBasis === 'avg' ? mean(vals) : vals[vals.length - 1];
  const delta = vals.length >= 2 ? vals[vals.length - 1] - vals[vals.length - 2] : null;
  return { rate, delta };
}

function rtiTierOf(rate) {
  if (rate == null) return null;
  const { tier2, tier3 } = data.settings.rti;
  if (rate < tier3) return 3;
  if (rate < tier2) return 2;
  return 1;
}

function hasActiveIntervention(sid) {
  return data.interventions.some((iv) => iv.studentId === sid && iv.status === 'active');
}

function renderRti() {
  const { tier2, tier3 } = data.settings.rti;
  $('rtiDesc3').textContent = `${tier3}%未満`;
  $('rtiDesc2').textContent = `${tier3}〜${tier2 - 1}%`;
  $('rtiDesc1').textContent = `${tier2}%以上`;

  const students = studentsOf(ui.rtiClass);
  const buckets = { 1: [], 2: [], 3: [] };
  let noData = 0;
  for (const s of students) {
    const { rate, delta } = rtiRateFor(s.id);
    const tier = rtiTierOf(rate);
    if (tier == null) { noData++; continue; }
    buckets[tier].push({ s, rate, delta });
  }
  // 低い順（支援優先度が高い順）に並べる
  for (const k of [1, 2, 3]) buckets[k].sort((a, b) => a.rate - b.rate);

  for (const tier of [1, 2, 3]) {
    const list = buckets[tier];
    $('rtiCount' + tier).textContent = `${list.length}名`;
    $('rtiCards' + tier).innerHTML = list.map(({ s, rate, delta }) => {
      const deltaHtml = delta == null ? ''
        : delta >= 3 ? `<span class="rti-delta up">▲${round1(delta)}</span>`
        : delta <= -3 ? `<span class="rti-delta down">▼${round1(Math.abs(delta))}</span>`
        : `<span class="rti-delta flat">→</span>`;
      const ivBadge = hasActiveIntervention(s.id) ? '<span class="rti-iv-badge" title="支援実施中">支援中</span>' : '';
      return `<button class="rti-card" data-sid="${esc(s.id)}">
        <span class="rti-card-name">${esc(s.name)}</span>
        <span class="rti-card-class">${esc(s.className || '')}</span>
        <span class="rti-card-rate">${round1(rate)}%</span>
        ${deltaHtml}${ivBadge}
      </button>`;
    }).join('') || '<div class="rti-empty">該当なし</div>';
  }
  const explain = document.querySelector('.rti-explain');
  if (explain) {
    let nd = explain.querySelector('.rti-nodata-note');
    if (!nd) { nd = document.createElement('span'); nd.className = 'rti-nodata-note'; explain.appendChild(nd); }
    nd.textContent = noData ? `／ データ未入力で判定できない生徒：${noData}名` : '';
  }

  renderRtiLog();
  renderRtiProgress();
}

/* ---- 支援記録 ---- */
function openIvDialog(sid) {
  const s = data.students.find((x) => x.id === sid);
  if (!s) return;
  const { rate } = rtiRateFor(sid);
  const tier = rtiTierOf(rate);
  $('ivDialogTitle').textContent = `支援の記録：${s.name}`;
  $('ivStudentSummary').innerHTML =
    `<strong>${esc(s.name)}</strong>（${esc(s.className || '')}）　現在の判定値：${rate != null ? round1(rate) + '%' : 'データなし'}${tier ? `・Tier ${tier}` : ''}`;
  $('ivTitle').value = '';
  $('ivNote').value = '';
  $('ivStart').value = localDateString();
  const subjects = subjectList();
  $('ivSubject').innerHTML = `<option value="all">全教科</option>` +
    subjects.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('ivSubject').value = ui.rtiSubject;
  $('ivForm').dataset.sid = sid;
  $('ivDialog').showModal();
}

function submitIvDialog(e) {
  e.preventDefault();
  const sid = $('ivForm').dataset.sid;
  const subject = $('ivSubject').value;
  const { rate } = rtiRateFor(sid, subject, 'latest');
  const iv = {
    id: 'iv' + Date.now(),
    studentId: sid,
    title: $('ivTitle').value.trim(),
    subject,
    startDate: $('ivStart').value,
    note: $('ivNote').value.trim(),
    baseline: rate != null ? round1(rate) : null, // 開始時の水準（効果確認の基準線）
    status: 'active',
    createdAt: localDateString(),
  };
  data.interventions.push(iv);
  ui.rtiSelectedIv = iv.id;
  markDirty();
  $('ivDialog').close();
  renderRti();
}

function renderRtiLog() {
  const wrap = $('rtiLogWrap');
  const ivs = [...data.interventions].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
    return (b.startDate || '').localeCompare(a.startDate || '');
  });
  if (!ivs.length) {
    wrap.innerHTML = '<div class="table-empty">支援の記録はまだありません。上の生徒カードをクリックして追加します。</div>';
    return;
  }
  let html = '<table class="score-table iv-table"><thead><tr>' +
    '<th>状態</th><th style="text-align:left">生徒</th><th>クラス</th><th style="text-align:left">支援内容</th>' +
    '<th>教科</th><th>開始日</th><th>開始時</th><th></th></tr></thead><tbody>';
  for (const iv of ivs) {
    const s = data.students.find((x) => x.id === iv.studentId);
    if (!s) continue;
    const selected = ui.rtiSelectedIv === iv.id;
    html += `<tr class="iv-row ${selected ? 'is-selected' : ''} ${iv.status === 'done' ? 'is-done' : ''}" data-iv="${esc(iv.id)}">
      <td>${iv.status === 'active' ? '<span class="iv-status active">実施中</span>' : '<span class="iv-status done">完了</span>'}</td>
      <td class="cell-name">${esc(s.name)}</td>
      <td class="cell-class">${esc(s.className || '')}</td>
      <td style="text-align:left">${esc(iv.title)}${iv.note ? `<div class="iv-note">${esc(iv.note)}</div>` : ''}</td>
      <td>${esc(iv.subject === 'all' ? '全教科' : iv.subject)}</td>
      <td>${esc(iv.startDate || '')}</td>
      <td>${iv.baseline != null ? esc(iv.baseline) + '%' : '—'}</td>
      <td class="iv-actions">
        ${iv.status === 'active'
          ? `<button class="btn btn-ghost btn-sm iv-done-btn" data-iv="${esc(iv.id)}">完了にする</button>`
          : `<button class="btn btn-ghost btn-sm iv-reopen-btn" data-iv="${esc(iv.id)}">再開</button>`}
        <button class="btn btn-danger-ghost btn-sm admin-only iv-del-btn" data-iv="${esc(iv.id)}">削除</button>
      </td>
    </tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function renderRtiProgress() {
  const card = $('rtiProgressCard');
  const iv = data.interventions.find((x) => x.id === ui.rtiSelectedIv);
  if (!iv) { card.hidden = true; return; }
  const s = data.students.find((x) => x.id === iv.studentId);
  if (!s) { card.hidden = true; return; }
  card.hidden = false;
  $('rtiProgressTitle').textContent =
    `${s.name}さんの推移（${iv.subject === 'all' ? '全教科' : iv.subject}）— 支援「${iv.title}」開始 ${iv.startDate || ''}`;

  // テスト回ごとの系列（全教科なら同じ回の教科平均）。テストは独立なので回単位で並べる
  const stuSeries = termSeriesFor(s.id, iv.subject);
  let labels = stuSeries.labels;
  let rates = stuSeries.rates.map((v) => (v != null ? round1(v) : null));
  // クラス平均（各生徒の回ごとの値を平均）
  const scope = s.className ? data.students.filter((x) => x.className === s.className) : data.students;
  const scopeSeries = scope.map((x) => termSeriesFor(x.id, iv.subject).rates);
  let avg = labels.map((_, i) => {
    const vals = scopeSeries.map((r) => r[i]).filter((v) => v != null);
    return vals.length ? round1(mean(vals)) : null;
  });
  // 本人・クラスともデータがない回は表示しない（下級生には未実施の回があるため）
  const used = labels.map((_, i) => rates[i] != null || avg[i] != null);
  if (used.some((u) => !u)) {
    labels = labels.filter((_, i) => used[i]);
    rates = rates.filter((_, i) => used[i]);
    avg = avg.filter((_, i) => used[i]);
  }

  // 支援の効果量：開始時からの変化を「クラスのばらつき」を物差しに標準化（個人版の目安）
  let esNote = '';
  const lastIdx = rates.reduce((acc, v, i) => (v != null ? i : acc), -1);
  if (iv.baseline != null && lastIdx >= 0) {
    const latest = rates[lastIdx];
    // クラスのばらつき＝同じ回のクラス各生徒の値から
    const clsRates = scopeSeries.map((r) => r[lastIdx]).filter((v) => v != null);
    if (clsRates.length >= 3) {
      const sd = sampleSd(clsRates);
      if (sd > 0) {
        const dval = (latest - iv.baseline) / sd;
        const dir = dval >= 0.2 ? '伸び' : dval <= -0.2 ? '低下' : '変化';
        esNote = `開始時 ${esc(iv.baseline)}% → 直近 ${round1(latest)}%（${latest >= iv.baseline ? '+' : ''}${round1(latest - iv.baseline)}pt）。` +
          `直近クラスのばらつきを物差しにした標準化変化量は <strong>${esFmt(dval)}</strong>（${esLabel(dval)}${dir}・参考値）` +
          `<span class="es-link">効果量とは？</span>`;
      }
    }
  }
  $('rtiEsNote').innerHTML = esNote;
  $('rtiEsNote').hidden = !esNote;

  const { tier2, tier3 } = data.settings.rti;
  const markLines = [
    { yAxis: tier2, lineStyle: { color: '#d9a10a' }, label: { formatter: `Tier2 ${tier2}%`, fontSize: 10 } },
    { yAxis: tier3, lineStyle: { color: '#c0392b' }, label: { formatter: `Tier3 ${tier3}%`, fontSize: 10 } },
  ];
  if (iv.baseline != null) {
    markLines.push({ yAxis: iv.baseline, lineStyle: { color: '#7c4a9c', type: 'dotted', width: 2 }, label: { formatter: `開始時 ${iv.baseline}%`, fontSize: 10 } });
  }

  chart('rtiProgressChart').setOption({
    grid: { ...BASE_GRID, top: 50, right: 90 },
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : v + '%') },
    legend: { top: 0 },
    xAxis: { type: 'category', data: labels, boundaryGap: false, axisLabel: { rotate: labels.length > 5 ? 25 : 0, fontSize: 11 } },
    yAxis: { type: 'value', max: 100, min: 0, name: '得点率%' },
    series: [
      {
        name: s.name, type: 'line', symbol: 'circle', symbolSize: 9, connectNulls: true,
        data: rates, itemStyle: { color: PALETTE[0] }, lineStyle: { width: 3 },
        markLine: { silent: true, symbol: 'none', data: markLines },
      },
      {
        name: 'クラス平均', type: 'line', symbol: 'none', connectNulls: true,
        lineStyle: { type: 'dashed', color: AVG_COLOR }, itemStyle: { color: AVG_COLOR }, data: avg,
      },
    ],
  }, true);
}

/* ========== 名簿管理 ========== */
function nextStudentId() {
  let id;
  do {
    id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? 's-' + crypto.randomUUID()
      : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  } while (data.students.some((s) => s.id === id));
  return id;
}

function studentHasScores(sid) {
  return data.scores.some((sc) => sc.studentId === sid) ||
    data.metrics.some((m) => m.values && m.values[sid] != null) ||
    data.interventions.some((iv) => iv.studentId === sid);
}

function removeStudentData(sid) {
  data.students = data.students.filter((s) => s.id !== sid);
  data.scores = data.scores.filter((sc) => sc.studentId !== sid);
  for (const m of data.metrics) if (m.values) delete m.values[sid];
  data.interventions = data.interventions.filter((iv) => iv.studentId !== sid);
}

function openRosterDialog() {
  if (!requireAdmin()) return;
  switchRosterPane('edit');
  $('reassignText').value = '';
  $('reassignPreview').hidden = true;
  $('reassignApplyBtn').disabled = true;
  renderRosterTable();
  $('rosterDialog').showModal();
}

function switchRosterPane(name) {
  for (const b of document.querySelectorAll('.rtab')) b.classList.toggle('is-active', b.dataset.rtab === name);
  for (const p of document.querySelectorAll('.rpane')) p.classList.toggle('is-active', p.id === 'rpane-' + name);
}

// クラスの変遷（過去→現在）を文字列で返す。履歴が無ければ空文字
function classTrail(s) {
  const hist = Array.isArray(s.classHistory) ? s.classHistory : [];
  if (!hist.length) return '';
  const past = hist.map((h) => h.className || '（空）');
  return [...past, `${s.className || '（空）'}（現在）`].join(' → ');
}

function renderRosterTable() {
  const students = sortedStudents();
  $('rosterCount').textContent = `${students.length}名`;
  let html = '<table class="roster-table"><thead><tr>' +
    '<th style="width:56px">番号</th><th>氏名</th><th style="width:84px">クラス</th>' +
    '<th>クラス履歴</th><th style="width:32px"></th>' +
    '</tr></thead><tbody>';
  for (const s of students) {
    const trail = classTrail(s);
    html += `<tr data-sid="${esc(s.id)}">
      <td><input class="col-num" type="number" data-field="number" value="${esc(s.number != null ? s.number : '')}"></td>
      <td><input type="text" data-field="name" value="${esc(s.name)}"></td>
      <td><input type="text" data-field="className" value="${esc(s.className || '')}"></td>
      <td class="roster-history">${trail ? esc(trail) : '<span class="rh-none">—</span>'}</td>
      <td><button class="row-del" title="削除（転出）">✕</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  if (!students.length) html = '<div class="table-empty">生徒がいません。</div>';
  $('rosterTableWrap').innerHTML = html;
}

function handleRosterEdit(input) {
  const sid = input.closest('tr').dataset.sid;
  const s = data.students.find((x) => x.id === sid);
  if (!s) return;
  const field = input.dataset.field;
  let val = input.value.trim();
  if (field === 'number') val = val === '' ? '' : (parseInt(val, 10) || '');
  s[field] = val;
  markDirty();
}

function handleRosterDelete(sid) {
  const s = data.students.find((x) => x.id === sid);
  if (!s) return;
  const warn = studentHasScores(sid)
    ? `${s.name} さんには成績・指標・支援記録のいずれかがあります。削除すると一緒に消えます。\n本当に削除しますか？`
    : `${s.name} さんを名簿から削除しますか？`;
  if (!confirm(warn)) return;
  removeStudentData(sid);
  if (ui.rtiSelectedIv && !data.interventions.some((iv) => iv.id === ui.rtiSelectedIv)) ui.rtiSelectedIv = null;
  rebuildIndex();
  markDirty();
  renderRosterTable();
  renderAll();
}

function addRosterStudent() {
  const id = nextStudentId();
  data.students.push({ id, name: '（新入生）', className: '', number: '' });
  markDirty();
  renderRosterTable();
  // 追加した行の氏名欄へフォーカス
  const row = $('rosterTableWrap').querySelector(`tr[data-sid="${CSS.escape(id)}"]`);
  if (row) {
    const nameInput = row.querySelector('[data-field="name"]');
    nameInput.focus();
    nameInput.select();
  }
}

/* ---- クラス替え一括取込 ---- */
let reassignPlan = null;

function buildReassignPlan() {
  const lines = $('reassignText').value.split('\n').map((l) => l.replace(/\r/, '')).filter((l) => l.trim());
  const byName = new Map();
  for (const s of data.students) {
    const key = s.name.replace(/\s+/g, '');
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(s);
  }
  const updates = [];
  const newcomers = [];
  const dupes = [];
  const seenStudents = new Set();
  const seenSlots = new Set();
  for (const line of lines) {
    const [name, klass, num] = line.split('\t').map((x) => (x || '').trim());
    if (!name) continue;
    const key = name.replace(/\s+/g, '');
    const matched = byName.get(key);
    if (num && (!/^\d+$/.test(num) || Number(num) < 1)) { dupes.push(name + '（番号は1以上の整数）'); continue; }
    const numberVal = num ? Number(num) : '';
    const slot = klass && num ? klass + '#' + numberVal : '';
    if (slot && seenSlots.has(slot)) { dupes.push(name + '（組・番号が重複）'); continue; }
    if (slot) seenSlots.add(slot);
    if (matched && matched.length === 1) {
      if (seenStudents.has(matched[0].id)) { dupes.push(name + '（同じ生徒の行が重複）'); continue; }
      seenStudents.add(matched[0].id);
      updates.push({ student: matched[0], className: klass || '', number: numberVal });
    } else if (matched && matched.length > 1) {
      dupes.push(name);
    } else {
      newcomers.push({ name, className: klass || '', number: numberVal });
    }
  }
  const projected = data.students.map((s) => { const u = updates.find((x) => x.student.id === s.id); return u || s; }).concat($('reassignAddNew').checked ? newcomers : []);
  const occupied = new Set();
  for (const s of projected) {
    if (!s.className || !s.number) continue;
    const slot = s.className + '#' + s.number;
    if (occupied.has(slot)) dupes.push(s.className + ' ' + s.number + '番（反映後の組・番号が重複）');
    occupied.add(slot);
  }
  return { updates, newcomers, dupes };
}

function previewReassign() {
  reassignPlan = buildReassignPlan();
  const { updates, newcomers, dupes } = reassignPlan;
  const addNew = $('reassignAddNew').checked;
  const el = $('reassignPreview');
  let html = `更新：<strong>${updates.length}名</strong>`;
  html += `　／　新規追加：<strong>${addNew ? newcomers.length : 0}名</strong>`;
  if (!addNew && newcomers.length) html += `（${newcomers.length}名は取込みません）`;
  if (dupes.length) {
    html += `<br><span class="pv-warn">⚠ 反映できない行：${esc(dupes.join('、'))}（名簿編集タブで個別に直してください）</span>`;
  }
  if (!updates.length && !(addNew && newcomers.length)) {
    html += '<br>反映できる変更がありません。形式（氏名⇥クラス⇥番号）を確認してください。';
  }
  el.innerHTML = html;
  el.hidden = false;
  $('reassignApplyBtn').disabled = dupes.length > 0 || (!updates.length && !(addNew && newcomers.length));
}

function applyReassign() {
  if (!reassignPlan) return;
  // Revalidate text and add-new choice at commit time; never apply a stale preview.
  const latest = buildReassignPlan();
  if (latest.dupes.length || JSON.stringify(latest) !== JSON.stringify(reassignPlan)) { alert('入力に変更または重複があります。もう一度「確認」してください。変更は反映していません。'); return; }
  const { updates, newcomers } = reassignPlan;
  if (!confirm(`クラス替えを反映しますか？ 更新 ${updates.length}名／追加 ${$('reassignAddNew').checked ? newcomers.length : 0}名`)) return;
  const today = localDateString();
  for (const u of updates) {
    // クラスが変わる場合、旧クラス・番号を履歴として残す
    if ((u.student.className || '') !== (u.className || '') || String(u.student.number ?? '') !== String(u.number ?? '')) {
      if (!Array.isArray(u.student.classHistory)) u.student.classHistory = [];
      u.student.classHistory.push({
        className: u.student.className || '',
        number: u.student.number != null ? u.student.number : '',
        at: today,
      });
    }
    u.student.className = u.className;
    u.student.number = u.number;
  }
  if ($('reassignAddNew').checked) {
    for (const n of newcomers) {
      data.students.push({ id: nextStudentId(), name: n.name, className: n.className, number: n.number });
    }
  }
  markDirty();
  reassignPlan = null;
  $('reassignText').value = '';
  $('reassignPreview').hidden = true;
  $('reassignApplyBtn').disabled = true;
  switchRosterPane('edit');
  renderRosterTable();
  renderAll();
  alert('クラス替えを反映しました。過去の成績はそのまま引き継がれています。');
}

/* ========== バックアップ（日付つき控えのダウンロード） ========== */
function backupJson() {
  if (!data) return;
  const text = JSON.stringify(data, null, 2);
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  const base = (fileName || 'seiseki-data.json').replace(/\.json$/i, '');
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${base}_backup_${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/* ========== 面談カルテ印刷 ========== */
// 画面上のチャートを、固定サイズ・アニメ無効でクリーンに画像化する
function chartImageFrom(domId, width, height) {
  if (typeof echarts === 'undefined') return '';
  const live = echarts.getInstanceByDom($(domId));
  if (!live) return '';
  const opt = live.getOption();
  opt.animation = false;
  const div = document.createElement('div');
  div.style.cssText = `position:absolute;left:-10000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(div);
  const tmp = echarts.init(div, 'gd');
  tmp.setOption(opt);
  const url = tmp.getDataURL({ pixelRatio: 2, backgroundColor: '#fff' });
  tmp.dispose();
  div.remove();
  return url;
}

function printKarte() {
  if (ui.trendSelected.size !== 1) return;
  const sid = [...ui.trendSelected][0];
  const student = data.students.find((s) => s.id === sid);
  if (!student) return;

  // 成績の推移テーブル
  let scoreRows = '';
  for (const t of data.tests) {
    const r = getAttendedScore(sid, t.id);
    if (!r || r.total == null) continue;
    const scope = studentsOf(student.className || 'all').length
      ? data.students.filter((s) => s.className === student.className)
      : data.students;
    const avgVals = scope.map((s) => getAttendedScore(s.id, t.id)).filter((x) => x && x.total != null).map((x) => x.total);
    const avg = avgVals.length ? round1(mean(avgVals)) : '—';
    const rate = round1(r.total / t.maxScore * 100);
    scoreRows += `<tr><td class="k-name">${esc(termKeyOf(t))}（${esc(t.subject)}）</td>` +
      `<td>${r.total} / ${t.maxScore}</td><td>${rate}%</td><td>${avg}</td></tr>`;
  }
  if (!scoreRows) scoreRows = '<tr><td colspan="4">記録された成績がありません</td></tr>';

  // チャート画像（固定幅・アニメ無効でクリーンに生成。横並びでA4 1ページに収める）
  const trendImg = chartImageFrom('trendChart', 520, 340);
  let domainImgHtml = '';
  if (!$('trendDomainCard').hidden) {
    const di = chartImageFrom('trendDomainChart', 520, 340);
    domainImgHtml = `<img src="${di}" alt="分野別推移">`;
  }

  const today = new Date();
  const dateStr = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

  $('printArea').innerHTML = `
    <div class="karte">
      <div class="karte-head">
        <div class="karte-title">学習の記録（${esc(data.name || '')}）</div>
        <div class="karte-meta">
          ${esc(student.className || '')}　${esc(student.number != null ? student.number : '')}番<br>
          氏名：${esc(student.name)}<br>
          ${classTrail(student) ? 'クラス履歴：' + esc(classTrail(student)) + '<br>' : ''}
          作成日：${dateStr}
        </div>
      </div>

      <h2>テストの記録</h2>
      <table>
        <thead><tr><th>テスト</th><th>得点</th><th>得点率</th><th>クラス平均</th></tr></thead>
        <tbody>${scoreRows}</tbody>
      </table>

      <h2>推移グラフ</h2>
      <div class="karte-charts">
        <img src="${trendImg}" alt="得点推移">
        ${domainImgHtml}
      </div>

      <h2>面談メモ</h2>
      <div class="karte-comment"></div>

      <p class="karte-note">※ このカルテは校内の個人情報の取り扱いルールに従って管理・廃棄してください。</p>
    </div>`;

  // グラフ画像（dataURL）のデコード完了を待ってから印刷する
  // （待たずにprintするとプレビューでグラフが空白になる）
  const imgs = [...$('printArea').querySelectorAll('img')];
  const ready = imgs.map((img) => (img.complete && img.naturalWidth
    ? Promise.resolve()
    : (img.decode ? img.decode().catch(() => {}) : new Promise((res) => { img.onload = img.onerror = res; }))));
  Promise.all(ready).then(() => window.print());
}

/* ========== 入力用Excelテンプレート発行 ========== */
function exportTemplate() {
  const test = testById(ui.inTest);
  if (!test) {
    alert('先にテストを選択（または追加）してください。');
    return;
  }
  if (typeof XLSX === 'undefined') {
    alert('Excel出力ライブラリの読み込みに失敗しました。ファイル一式がそろっているか確認してください。');
    return;
  }
  const students = studentsOf(ui.inClass);
  const qs = test.questions || [];
  const header = ['出席番号', '氏名', 'クラス'];
  if (qs.length) for (const q of qs) header.push(`${q.label}(${q.max})`);
  else header.push(`合計(${test.maxScore})`);
  header.push('生徒ID');

  const rows = [header];
  for (const s of students) {
    const rec = getScore(s.id, test.id);
    const row = [s.number != null ? s.number : '', s.name, s.className || ''];
    if (qs.length) {
      for (const q of qs) row.push(rec && rec.questions && rec.questions[q.key] != null ? rec.questions[q.key] : '');
    } else {
      row.push(rec && rec.total != null ? rec.total : '');
    }
    row.push(s.id);
    rows.push(row);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = header.map((h, i) => ({ wch: i === 1 ? 14 : Math.max(8, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '点数入力');
  const cls = ui.inClass === 'all' ? '全クラス' : ui.inClass;
  const safe = `${test.name}_${cls}`.replace(/[\\/:*?"<>|]/g, '_');
  XLSX.writeFile(wb, `${safe}_入力用.xlsx`);
}

/* ========== V2: カイ二乗検定（クロス集計） ========== */
// 自由度ごとの臨界値（上段=5%水準、下段=1%水準）
const CHI2_CRIT = {
  1: [3.841, 6.635], 2: [5.991, 9.210], 3: [7.815, 11.345], 4: [9.488, 13.277],
  5: [11.070, 15.086], 6: [12.592, 16.812], 7: [14.067, 18.475], 8: [15.507, 20.090],
  9: [16.919, 21.666], 10: [18.307, 23.209], 11: [19.675, 24.725], 12: [21.026, 26.217],
};

// X=5段階アンケート × Y=テスト のとき、回答×成績帯のクロス表とχ²検定を表示
function renderChiSquare(points, x, y) {
  const card = $('corrChiCard');
  if (!x || !y || !x.isScale || !ui.corrY.startsWith('t:') || points.length < 10) {
    card.hidden = true;
    return;
  }
  const test = testById(ui.corrY.slice(2));
  if (!test) { card.hidden = true; return; }
  const { tier2, tier3 } = data.settings.rti;
  const bandOf = (total) => {
    const rate = total / test.maxScore * 100;
    return rate < tier3 ? 0 : rate < tier2 ? 1 : 2;
  };
  const bandLabels = [`低（${tier3}%未満）`, `中（${tier3}〜${tier2 - 1}%）`, `高（${tier2}%以上）`];

  const xVals = [...new Set(points.map((p) => p.x))].sort((a, b) => a - b);
  let table = xVals.map(() => [0, 0, 0]);
  for (const p of points) table[xVals.indexOf(p.x)][bandOf(p.y)]++;

  // 誰もいない成績帯の列は除いて計算
  const colKeep = [0, 1, 2].filter((c) => table.some((row) => row[c] > 0));
  table = table.map((row) => colKeep.map((c) => row[c]));
  const nRows = table.length, nCols = colKeep.length;
  if (nRows < 2 || nCols < 2) { card.hidden = true; return; }

  const n = points.length;
  const rowSum = table.map((r) => r.reduce((a, b) => a + b, 0));
  const colSum = colKeep.map((_, ci) => table.reduce((a, r) => a + r[ci], 0));
  let chi2 = 0, smallE = 0;
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const E = rowSum[i] * colSum[j] / n;
      if (E < 5) smallE++;
      if (E > 0) chi2 += (table[i][j] - E) ** 2 / E;
    }
  }
  const df = (nRows - 1) * (nCols - 1);
  const crit = CHI2_CRIT[df];
  let verdict, verdictClass;
  if (crit && chi2 >= crit[1]) { verdict = '関連あり（1%水準で有意）'; verdictClass = 'sig'; }
  else if (crit && chi2 >= crit[0]) { verdict = '関連あり（5%水準で有意）'; verdictClass = 'sig'; }
  else { verdict = '統計的に確かな関連は見られません'; verdictClass = 'ns'; }
  const V = Math.sqrt(chi2 / (n * Math.min(nRows - 1, nCols - 1)));
  const vLabel = V < 0.1 ? 'ごく弱い' : V < 0.3 ? '弱い' : V < 0.5 ? '中程度の' : '強い';

  let html = `<table class="score-table chi-table"><thead><tr><th>${esc(x.label)}</th>` +
    colKeep.map((c) => `<th>${bandLabels[c]}</th>`).join('') + '<th>計</th></tr></thead><tbody>';
  xVals.forEach((v, i) => {
    html += `<tr><td class="cell-name">${esc(v)}</td>` +
      table[i].map((c) => `<td>${c}</td>`).join('') +
      `<td class="cell-strong">${rowSum[i]}</td></tr>`;
  });
  html += `<tr><td class="cell-name">計</td>` +
    colSum.map((c) => `<td class="cell-strong">${c}</td>`).join('') +
    `<td class="cell-strong">${n}</td></tr></tbody></table>`;
  $('chiTableWrap').innerHTML = html;

  // 高評価群（4〜5）と低評価群（1〜2）の平均点差を効果量で
  let groupHtml = '';
  const hiG = points.filter((p) => p.x >= 4).map((p) => p.y);
  const loG = points.filter((p) => p.x <= 2).map((p) => p.y);
  if (hiG.length >= 3 && loG.length >= 3) {
    const m1 = mean(loG), m2 = mean(hiG);
    const dval = independentCohensD(loG, hiG);
    if (dval != null) {
      groupHtml = `<div class="chi-groups">「4〜5」と答えた ${hiG.length}名 と「1〜2」の ${loG.length}名 の平均点差：` +
        `<strong>${round1(m2 - m1)}点</strong>（効果量 d = ${esFmt(dval)}・${esLabel(dval)}）` +
        `<span class="es-link">効果量とは？</span></div>`;
    }
  }

  $('chiResult').innerHTML =
    `<div class="chi-verdict ${verdictClass}">${verdict}</div>` +
    `<div class="chi-stats">χ² = ${(Math.round(chi2 * 100) / 100).toFixed(2)}（自由度 ${df}）<br>` +
    `関連の強さ Cramér&#39;s V = ${(Math.round(V * 100) / 100).toFixed(2)}（${vLabel}関連）</div>` +
    groupHtml +
    `<div class="chi-note">成績帯はRTIしきい値（${tier3}% / ${tier2}%）で区切っています` +
    (smallE > nRows * nCols * 0.2 ? '<br>※ 人数の少ないマスが多いため、結果は参考程度に見てください' : '') + '</div>';
  card.hidden = false;
}

/* ========== V2: テンプレート発行・取込 ========== */
// 新規テスト取込テンプレート（名簿プリフィル済み）を発行
function issueNewTestTemplate() {
  if (typeof XLSX === 'undefined') { alert('Excel出力ライブラリの読み込みに失敗しました。'); return; }
  const students = sortedStudents();
  const rows = [
    ['テスト名→', '', '教科→', '', '満点→', '', '実施学年→', '', '実施日→', ''],
    ['分野→', '', '', '知識・技能', '知識・技能', '読解'],
    ['配点→', '', '', 10, 10, 10],
    ['出席番号', '氏名', 'クラス', '問1', '問2', '問3', '生徒ID'],
    ...students.map((s) => [s.number != null ? s.number : '', s.name, s.className || '', '', '', '', s.id]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 9 }, { wch: 14 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '新規テスト');
  XLSX.writeFile(wb, '新規テスト取込テンプレート.xlsx');
  alert('テンプレートをダウンロードしました。Excelで開いて次のように記入してください。\n\n1) 1行目：テスト名・教科・満点（空欄なら配点の合計）・実施学年・実施日\n2) 4行目：「問1」などを実際の問題名に書き換え（列を右に増やしてOK）\n3) 2〜3行目：各問題の分野と配点\n　※分野名は同じ教科で毎回同じにすると、分野別の推移がつながります\n4) 生徒の行に点数を入力（欠席は「欠」、未入力は空欄）。生徒IDは変更しないでください。問題列は生徒ID列の左に挿入します\n5) 保存したら「テンプレから取込」でこのファイルを選択');
}

// テンプレートからテストを取込
async function importTestTemplate(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const { rows } = window.GD_IMPORT.selectSheet(wb, XLSX, ['新規テスト']);
  if (rows.length < 5 || window.GD_IMPORT.findHeader(rows) !== 3) { alert('テンプレートの形式が違います。4行目の出席番号・氏名・クラスを変更せず、アプリの新規テスト用テンプレートを使ってください。'); return; }

  const name = String(rows[0][1] || '').trim();
  const subject = String(rows[0][3] || '').trim();
  if (!name || !subject) { alert('1行目のテスト名・教科が空欄です。記入してから取り込んでください。'); return; }
  if (data.tests.some((t) => t.name === name && t.subject === subject)) {
    if (!confirm(`「${name}（${subject}）」は既に存在します。別のテストとして追加しますか？`)) return;
  }

  const header = rows[3] || [];
  const qCols = [];
  const dataWidth = Math.max(header.length, ...rows.slice(4).map((r) => r.length));
  for (let c = 3; c < dataWidth; c++) {
    const label = String(header[c] || '').trim();
    if (!label && (String(rows[2]?.[c] ?? '').trim() || rows.slice(4).some((r) => String(r[c] ?? '').trim()))) { alert('問題名が空欄の列に配点または点数があります。4行目の問題名を入力してください。'); return; }
    const max = Number(rows[2] ? rows[2][c] : 0);
    if (window.GD_IMPORT.isIdHeader(label)) continue;
    if (label && (!Number.isFinite(max) || max <= 0)) { alert(`問題「${label}」の配点は0より大きい数字で入力してください。`); return; }
    if (label) qCols.push({ c, label, max, domain: String(rows[1] ? rows[1][c] : '').trim() });
  }
  if (!qCols.length) { alert('問題の列が見つかりません。4行目の問題名と3行目の配点を確認してください。'); return; }

  // 分野キー＝分野名（テスト間で同じ分野名なら同じ分野として推移がつながる）
  const domainNames = [...new Set(qCols.map((q) => q.domain).filter(Boolean))];
  const domains = domainNames.map((label) => ({
    key: label, label,
    max: qCols.filter((q) => q.domain === label).reduce((a, q) => a + q.max, 0),
  }));
  const questions = qCols.map((q, i) => ({
    key: 'q' + (i + 1), label: q.label, max: q.max,
    domain: q.domain || undefined,
  }));
  const declaredMax = Number(rows[0][5]);
  const questionMaxSum = qCols.reduce((a, q) => a + q.max, 0);
  if (String(rows[0][5] ?? '').trim() && (!Number.isFinite(declaredMax) || declaredMax <= 0)) { alert('満点は0より大きい数字、または空欄にしてください。'); return; }
  const maxScore = declaredMax > 0 ? declaredMax : questionMaxSum;
  if (questionMaxSum > maxScore) {
    alert(`問題の配点合計（${questionMaxSum}点）がテストの満点（${maxScore}点）を超えています。Excelを修正してください。`);
    return;
  }
  const test = { id: 't' + Date.now(), name, subject, maxScore, domains, questions };
  const gy = parseInt(rows[0][7], 10);
  if (gy >= 1 && gy <= 3) test.gradeYear = gy;
  const rawDate = rows[0][9];
  const date = normalizeDateValue(rawDate);
  if (rawDate !== '' && rawDate != null) {
    if (!date) {
      alert('実施日は YYYY-MM-DD 形式（例：2026-09-26）で入力してください。');
      return;
    }
    test.date = date;
  }

  const resolved = window.GD_IMPORT.matchedRows(rows, 3, data.students, qCols.map((q) => q.c));
  if (resolved.errors.length) { alert('取込は反映していません。Excelを修正してください。\n\n' + resolved.errors.slice(0, 8).join('\n')); return; }
  const invalidScores = [];
  const newScores = [];
  let absentCount = 0;
  for (const { row, student: stu, rowNumber } of resolved.matched) {
    const nm = rowNumber + '行目';
    const rec = { studentId: stu.id, testId: test.id, total: null, domains: {}, questions: {} };
    let any = false, isAbsent = false;
    qCols.forEach((qc, qi) => {
      const sv = String(row[qc.c] ?? '').trim();
      if (sv === '欠') { isAbsent = true; return; }
      if (sv === '') return;
      const parsed = parseBoundedNumber(sv, questions[qi].max);
      if (!parsed.valid) {
        invalidScores.push(`${nm}・${questions[qi].label}（${sv}／${questions[qi].max}点）`);
        return;
      }
      rec.questions[questions[qi].key] = parsed.value;
      any = true;
    });
    if (isAbsent && any) invalidScores.push(`${nm}：欠席と点数が同じ行にあります。欠席なら全点数を空欄にしてください。`);
    if (isAbsent) {
      rec.absent = true;
      absentCount++;
    } else if (any) {
      let total = 0;
      const dm = {};
      for (const q of questions) {
        const v = rec.questions[q.key];
        if (v == null) continue;
        total += v;
        if (q.domain) dm[q.domain] = (dm[q.domain] || 0) + v;
      }
      rec.total = total;
      rec.domains = dm;
    }
    if (any || isAbsent) newScores.push(rec);
  }

  if (invalidScores.length) {
    alert(
      `数字以外・配点の範囲外・欠席との混在が ${invalidScores.length}件あります。取込は反映していません。Excelを修正してください。\n\n` +
      invalidScores.slice(0, 8).join('\n') + (invalidScores.length > 8 ? '\nほか' : '')
    );
    return;
  }

  const ok = confirm(
    `このテストを取り込みますか？\n\n` +
    `テスト名：${name}（${subject}・${maxScore}点満点${test.gradeYear ? `・${test.gradeYear}年時` : '・実施学年 未設定'}${test.date ? `・${test.date}` : ''}）\n` +
    `問題：${questions.length}問 ／ 分野：${domains.length}\n` +
    `点数を取り込む生徒：${newScores.length}名（うち欠席 ${absentCount}名）\n` +
    '空欄は未入力のままです。既存テストの点数は変更しません。');
  if (!ok) return;

  data.tests.push(test);
  data.scores.push(...newScores);
  rebuildIndex();
  ui.inTest = test.id;
  if (ui.inSubject !== 'all' && ui.inSubject !== subject) ui.inSubject = subject;
  markDirty();
  renderAll();
  alert('取込が完了しました。内容を確認して、右上の「保存」を押してください。');
}

// 指標取込テンプレート（名簿プリフィル済み・記入例と書き方シート同梱）を発行
function issueMetricTemplate() {
  if (typeof XLSX === 'undefined') { alert('Excel出力ライブラリの読み込みに失敗しました。'); return; }
  const students = sortedStudents();
  const rows = [
    ['★書き方：すぐ下の行のD列・E列（太字の「指標名①…」）を実際の指標名に書き換え → 各生徒の行のその列に値を入力。完成イメージは「記入例」シートを見てください'],
    ['出席番号', '氏名', 'クラス', '指標名①（ここを書き換え）例：家庭学習時間（分/日）', '指標名②（ここを書き換え）※使わない列はこのまま', '生徒ID'],
    ...students.map((s) => [s.number != null ? s.number : '', s.name, s.className || '', '', '', s.id]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 9 }, { wch: 14 }, { wch: 8 }, { wch: 36 }, { wch: 36 }, { wch: 40 }];

  // 「記入例」シート：完成した状態を見せる（このシートは取込対象外）
  const example = [
    ['※これは記入のイメージです。このシートは取り込まれません。「指標」シートに記入してください'],
    ['出席番号', '氏名', 'クラス', '家庭学習時間（分/日）', '計画的に家庭学習をする（1〜5）'],
    [1, '架空生徒001', '2年A組', 30, 4],
    [2, '架空生徒002', '2年A組', 15, ''],
    [3, '架空生徒003', '2年B組', 60, 5],
    [],
    ['← 架空生徒002さんの「計画的に家庭学習をする」が空欄なのは未回答の例です。未回答は 0 ではなく空欄のままにします'],
  ];
  const wsEx = XLSX.utils.aoa_to_sheet(example);
  wsEx['!cols'] = [{ wch: 9 }, { wch: 14 }, { wch: 8 }, { wch: 18 }, { wch: 20 }];

  // 「書き方」シート：種類の自動判定ルールをファイル内でも読めるように
  const help = [
    ['指標テンプレートの書き方'],
    [],
    ['1) 「指標」シートの2行目・D列から右の「指標名①…」を、実際の指標名に書き換えます'],
    ['   例：家庭学習時間（分/日）、自主学習時間（分/週）、計画的に家庭学習をする（1〜5）'],
    ['   指標列を増やす場合は「生徒ID」列の左に挿入。生徒IDは変更しないでください。使わない指標列はそのままでOK'],
    [],
    ['2) 生徒ごとに、その指標の列へ値を入力します（数字だけ）'],
    [],
    ['3) 保存して、アプリの「② 記入後に取込」でこのファイルを選びます'],
    [],
    ['■ 種類は自動で判定されます'],
    ['値の入り方', '判定される種類', 'アプリでの扱い'],
    ['全員が 1〜5 の整数だけ', '5段階アンケート', '範囲外の入力を警告／カイ二乗検定・クロス集計表が使える'],
    ['それ以外（6以上・小数・0 など）', '数値', '相関係数と散布図で分析'],
    [],
    ['■ 注意'],
    ['・未回答は「空欄」にしてください。0 と書くと 1〜5 の範囲外になり、5段階と判定されません'],
    ['・すでに同じ指標名がある場合は、値が上書き（更新）されます'],
    ['・生徒IDで照合します。ID・氏名・組・番号は変更せず、組替え後は最新のテンプレートを発行してください'],
    ['・このファイルには氏名が入ります。保存・共有は学校のルールに従ってください'],
  ];
  const wsHelp = XLSX.utils.aoa_to_sheet(help);
  wsHelp['!cols'] = [{ wch: 34 }, { wch: 18 }, { wch: 46 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '指標');
  XLSX.utils.book_append_sheet(wb, wsEx, '記入例');
  XLSX.utils.book_append_sheet(wb, wsHelp, '書き方');
  XLSX.writeFile(wb, '指標取込テンプレート.xlsx');
  alert(
    'テンプレートをダウンロードしました。\n\n' +
    '【記入する場所は2か所だけ】\n' +
    '1) 2行目のD列から右：「指標名①…」を実際の指標名に書き換え\n' +
    '2) 各生徒の行：その指標の列に値を入力\n' +
    '完成イメージは「記入例」シートにあります。\n\n' +
    '【種類は自動で判定されます】\n' +
    '・全員が 1〜5 の整数 → 「5段階アンケート」\n' +
    '・それ以外（6以上・小数など）→ 「数値」\n' +
    '※ 未回答は 0 ではなく空欄にしてください');
}

// テンプレートから指標を取込（複数列対応）
async function importMetricTemplate(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const { rows } = window.GD_IMPORT.selectSheet(wb, XLSX, ['指標']);
  const { plans, errors } = window.GD_IMPORT.parseMetricRows(rows, data.students, data.metrics);
  if (errors.length) {
    alert('取込は反映していません。\n\n' + errors.slice(0, 8).join('\n'));
    return;
  }

  const lines = plans.map((p) => {
    const kind = p.isScale ? '5段階アンケート' : '数値';
    const why = p.existing ? '既存の指標に上書き（種類はそのまま）'
      : p.isScale ? '新規・すべて1〜5の整数のため'
      : '新規・1〜5の整数以外を含むため';
    return `・${p.label}\n    ${p.count}名分 → 「${kind}」として登録（${why}）` +
      (p.zeroBlocked ? '\n    ※ 0 が入っています。未回答を0にした場合は空欄に直すと5段階として登録できます' : '');
  });
  const ok = confirm(
    `次の内容で取り込みます。よろしいですか？\n\n${lines.join('\n\n')}\n\n` +
    '空欄は未回答のままとし、登録済みの値を消しません。' +
    `\n\n※「5段階アンケート」はカイ二乗検定・クロス集計が使えます。\n` +
    `　種類は取込後、指標名の横の表示で確認できます。`);
  if (!ok) return;

  for (const p of plans) {
    if (p.existing) {
      Object.assign(p.existing.values, p.values);
    } else {
      data.metrics.push({
        id: 'm' + Date.now() + Math.floor(Math.random() * 1000),
        label: p.label,
        type: p.isScale ? 'scale' : 'number',
        values: p.values,
      });
    }
  }
  markDirty();
  fillAxisSelects();
  fillMetricSelect();
  if (ui.tab === 'metrics') renderMetricsTab();
  alert('指標の取込が完了しました。内容を確認して、右上の「保存」を押してください。');
}

/* ========== 新規作成 ========== */
function submitNewDialog(e) {
  e.preventDefault();
  const name = $('nfName').value.trim();
  const lines = $('nfRoster').value.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
  const students = [], slots = new Set();
  for (let i = 0; i < lines.length; i++) {
    const [n, klass, num] = lines[i].split('\t').map((x) => (x || '').trim());
    if (!n || (num && (!/^\d+$/.test(num) || Number(num) < 1))) { alert(`${i + 1}行目：氏名と出席番号（1以上の整数）を確認してください。`); return; }
    const number = num ? Number(num) : '';
    const slot = klass && number !== '' ? klass + '#' + number : '';
    if (slot && slots.has(slot)) { alert(`${i + 1}行目：同じ組・番号が重複しています。変更は反映していません。`); return; }
    if (slot) slots.add(slot);
    students.push({ id: crypto.randomUUID(), name: n, className: klass || '', number });
  }
  if (!students.length) { alert('名簿を1名以上入力してください。'); return; }
  if (data && !confirm('現在のデータと分けて新しいデータを作成します。未保存の場合はキャンセルして保存してください。新規作成しますか？')) return;
  const fresh = { version: 2, name, students, tests: [], scores: [], metrics: [] };
  $('newDialog').close();
  applyJsonText(JSON.stringify(fresh), 'seiseki-data.json', null);
  markDirty();
}

/* ========== イベント結線 ========== */
function init() {
  // ファイル
  $('openBtn').onclick = openJson;
  $('openBtnEmpty').onclick = openJson;
  $('saveBtn').onclick = () => saveJson();
  $('newBtnEmpty').onclick = () => $('newDialog').showModal();
  $('fileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    file.text().then((text) => applyJsonText(text, file.name, null));
    e.target.value = '';
  };

  // タブ
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.onclick = () => {
      ui.tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) =>
        p.classList.toggle('is-active', p.id === 'panel-' + ui.tab));
      renderCurrentTab();
    };
  }

  // セレクト
  $('ovClass').onchange = (e) => { ui.ovClass = e.target.value; renderOverview(); resizeCharts(); };
  $('ovSubject').onchange = (e) => { ui.ovSubject = e.target.value; fillScopedTestSelect('ovTest', 'ovSubject', 'ovTest'); renderOverview(); resizeCharts(); };
  $('ovTest').onchange = (e) => { ui.ovTest = e.target.value; renderOverview(); resizeCharts(); };
  $('inClass').onchange = (e) => { ui.inClass = e.target.value; renderInput(); };
  $('inTest').onchange = (e) => { ui.inTest = e.target.value; renderInput(); };
  $('inSubject').onchange = (e) => { ui.inSubject = e.target.value; fillScopedTestSelect('inTest', 'inSubject', 'inTest'); renderInput(); };
  $('anClass').onchange = (e) => { ui.anClass = e.target.value; renderAnalysis(); resizeCharts(); };
  $('anSubject').onchange = (e) => { ui.anSubject = e.target.value; fillScopedTestSelect('anTest', 'anSubject', 'anTest'); renderAnalysis(); resizeCharts(); };
  $('anTest').onchange = (e) => { ui.anTest = e.target.value; renderAnalysis(); resizeCharts(); };
  $('trendClass').onchange = (e) => { ui.trendClass = e.target.value; renderTrend(); resizeCharts(); };
  $('trendSubject').onchange = (e) => { ui.trendSubject = e.target.value; renderTrend(); resizeCharts(); };

  // データ一覧
  $('listSubject').onchange = (e) => { ui.listSubject = e.target.value; ui.listSort = null; renderList(); };
  $('listClass').onchange = (e) => { ui.listClass = e.target.value; renderList(); };
  $('listGrade').onchange = (e) => {
    ui.listGrade = e.target.value;
    fillListClassSelect(); // クラスの選択肢を学年に合わせて絞る
    ui.listSort = null;
    renderList();
  };
  $('listTerm').onchange = (e) => { ui.listTerm = e.target.value; ui.listSort = null; renderList(); };
  $('listMode').onchange = (e) => { ui.listMode = e.target.value; renderList(); };
  $('listHeat').onchange = (e) => { ui.listHeat = e.target.checked; renderList(); };
  $('listPivot').oninput = (e) => {
    const v = parseInt(e.target.value, 10);
    ui.listPivot = isNaN(v) ? 60 : Math.max(0, Math.min(100, v));
    renderList();
  };
  $('listExportBtn').onclick = exportList;
  $('listTableWrap').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-key]');
    if (th) handleListSort(th.dataset.key);
  });
  $('trendSearch').oninput = (e) => { ui.trendSearch = e.target.value; renderStudentList(); };
  $('trendClearBtn').onclick = () => { ui.trendSelected.clear(); renderTrend(); resizeCharts(); };

  // 生徒リスト（クリックで選択トグル）
  $('studentList').onclick = (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    const sid = li.dataset.sid;
    if (ui.trendSelected.has(sid)) ui.trendSelected.delete(sid);
    else ui.trendSelected.add(sid);
    renderTrend();
    resizeCharts();
  };

  // 成績入力テーブル（委譲）
  $('scoreTableWrap').addEventListener('input', (e) => {
    if (e.target.classList.contains('cell-input')) handleCellInput(e.target);
  });
  $('scoreTableWrap').addEventListener('change', (e) => {
    if (e.target.classList.contains('absent-check')) handleAbsentToggle(e.target);
  });
  $('scoreTableWrap').addEventListener('keydown', handleCellKeydown);
  $('scoreTableWrap').addEventListener('paste', (e) => {
    if (e.target.classList.contains('cell-input')) handleCellPaste(e, e.target);
  });

  // 相関分析
  $('corrX').onchange = (e) => { ui.corrX = e.target.value; renderCorrelation(); resizeCharts(); };
  $('corrY').onchange = (e) => { ui.corrY = e.target.value; renderCorrelation(); resizeCharts(); };
  $('metClass').onchange = (e) => { ui.metClass = e.target.value; renderMetricsTab(); resizeCharts(); };
  $('metricSel').onchange = (e) => { ui.metricId = e.target.value; renderMetricTable(); };
  $('addMetricBtn').onclick = () => { $('mfLabel').value = ''; $('mfType').value = 'number'; $('metricDialog').showModal(); };
  $('deleteMetricBtn').onclick = deleteCurrentMetric;
  $('metricForm').onsubmit = submitMetricDialog;
  $('mfCancel').onclick = () => $('metricDialog').close();
  $('metricTableWrap').addEventListener('input', (e) => {
    if (e.target.classList.contains('metric-input')) handleMetricInput(e.target);
  });
  $('metricTableWrap').addEventListener('paste', (e) => {
    if (e.target.classList.contains('metric-input')) handleMetricPaste(e, e.target);
  });

  // 効果量の説明（「効果量とは？」「d=…」表示のクリックで開く）
  document.addEventListener('click', (e) => {
    if (e.target.closest('.es-link')) $('esHelpDialog').showModal();
  });
  $('esHelpClose').onclick = () => $('esHelpDialog').close();

  // 権限（管理者モード）
  $('roleBtn').onclick = () => {
    if (!data) return;
    if (isAdmin) { isAdmin = false; updateRoleUI(); renderCurrentTab(); return; }
    openAdminDialog();
  };
  $('adminForm').onsubmit = submitAdminDialog;
  $('adminCancel').onclick = () => $('adminDialog').close();
  $('settingsBtn').onclick = openSettingsDialog;
  $('settingsForm').onsubmit = submitSettingsDialog;
  $('settingsCancel').onclick = () => $('settingsDialog').close();

  // 支援（RTI）
  $('rtiSubject').onchange = (e) => { ui.rtiSubject = e.target.value; renderRti(); };
  $('rtiClass').onchange = (e) => { ui.rtiClass = e.target.value; renderRti(); };
  $('rtiBasis').onchange = (e) => { ui.rtiBasis = e.target.value; renderRti(); };
  $('rtiSettingsBtn').onclick = openSettingsDialog;
  document.querySelector('.rti-board').addEventListener('click', (e) => {
    const cardEl = e.target.closest('.rti-card');
    if (cardEl) openIvDialog(cardEl.dataset.sid);
  });
  $('ivForm').onsubmit = submitIvDialog;
  $('ivCancel').onclick = () => $('ivDialog').close();
  $('rtiLogWrap').addEventListener('click', (e) => {
    const done = e.target.closest('.iv-done-btn');
    const reopen = e.target.closest('.iv-reopen-btn');
    const del = e.target.closest('.iv-del-btn');
    const row = e.target.closest('.iv-row');
    if (done) {
      const iv = data.interventions.find((x) => x.id === done.dataset.iv);
      if (iv) { iv.status = 'done'; iv.endDate = localDateString(); markDirty(); renderRti(); }
      return;
    }
    if (reopen) {
      const iv = data.interventions.find((x) => x.id === reopen.dataset.iv);
      if (iv) { iv.status = 'active'; delete iv.endDate; markDirty(); renderRti(); }
      return;
    }
    if (del) {
      if (!requireAdmin()) return;
      const iv = data.interventions.find((x) => x.id === del.dataset.iv);
      if (iv && confirm(`支援記録「${iv.title}」を削除しますか？`)) {
        data.interventions = data.interventions.filter((x) => x.id !== iv.id);
        if (ui.rtiSelectedIv === iv.id) ui.rtiSelectedIv = null;
        markDirty(); renderRti();
      }
      return;
    }
    if (row) {
      ui.rtiSelectedIv = row.dataset.iv;
      renderRti();
      resizeCharts();
    }
  });

  // バックアップ・カルテ印刷
  $('backupBtn').onclick = backupJson;
  $('printKarteBtn').onclick = printKarte;

  // 名簿管理
  $('rosterBtn').onclick = openRosterDialog;
  $('rosterCloseBtn').onclick = () => $('rosterDialog').close();
  $('rosterAddBtn').onclick = addRosterStudent;
  for (const b of document.querySelectorAll('.rtab')) b.onclick = () => switchRosterPane(b.dataset.rtab);
  $('rosterTableWrap').addEventListener('input', (e) => {
    if (e.target.dataset.field) handleRosterEdit(e.target);
  });
  $('rosterTableWrap').addEventListener('click', (e) => {
    const btn = e.target.closest('.row-del');
    if (btn) handleRosterDelete(btn.closest('tr').dataset.sid);
  });
  $('reassignCheckBtn').onclick = previewReassign;
  $('reassignApplyBtn').onclick = applyReassign;

  // 入力用Excel発行
  $('exportTemplateBtn').onclick = exportTemplate;

  // V2: テンプレート発行・取込
  $('newTestTplBtn').onclick = issueNewTestTemplate;
  $('importTestBtn').onclick = () => $('testXlsxInput').click();
  $('testXlsxInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) importTestTemplate(f).catch((err) => alert('読み込みに失敗しました: ' + err.message));
    e.target.value = '';
  };
  $('metricTplBtn').onclick = issueMetricTemplate;
  $('importMetricBtn').onclick = () => $('metricXlsxInput').click();
  $('metricXlsxInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) importMetricTemplate(f).catch((err) => alert('読み込みに失敗しました: ' + err.message));
    e.target.value = '';
  };

  // テスト追加・削除
  $('addTestBtn').onclick = openTestDialog;
  $('deleteTestBtn').onclick = deleteCurrentTest;
  $('testForm').onsubmit = submitTestDialog;
  $('tfCancel').onclick = () => $('testDialog').close();
  $('tfAddDomain').onclick = () => addDomainRow();
  $('tfCopyPrev').onclick = copyPrevStructure;
  $('tfAddQuestion').onclick = () => addQuestionRow();

  // 新規作成
  $('newForm').onsubmit = submitNewDialog;
  $('nfCancel').onclick = () => $('newDialog').close();

  // 貼り付けヘルプ
  $('pasteHelpBtn').onclick = () => $('pasteDialog').showModal();
  $('pasteCloseBtn').onclick = () => $('pasteDialog').close();
}

init();
