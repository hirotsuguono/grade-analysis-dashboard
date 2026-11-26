/* Survey schema 1: fixed definitions, school snapshots and descriptive comparisons. Offline, no mutation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_SURVEY = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const limits = Object.freeze({ nodes: 1000000, characters: 12000000, depth: 20, array: 10000,
    sources: 128, instruments: 1000, references: 3000, waves: 100, results: 5000, categories: 256, participants: 5000, responseSets: 200 });
  const statuses = Object.freeze(['observed', 'unentered', 'noResponse', 'notApplicable', 'notAssigned',
    'invalid', 'notParticipating', 'notProvided', 'suppressed', 'unknown']);
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const canonical = value => JSON.stringify(value, function (_, v) {
    return object(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v;
  });
  const sorted = a => [...a].sort();
  const empty = () => ({ schemaVersion: 1, sources: [], instruments: [], references: [], waves: [] });
  const resultKey = r => JSON.stringify([r.instrumentId, r.type, r.subjectInstrumentId || null]);
  const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    Number.isFinite(Date.parse(v + 'T00:00:00Z')) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;

  // Completion changes only the previously unpublished answered labels. The
  // original question, non-answer meanings and evidence remain available.
  function isDefinitionCompletion(previous, next) {
    if (!previous || !next || previous.kind !== 'question' || previous.definitionStatus !== 'codesOnly' || next.definitionStatus !== 'complete') return false;
    const content = v => {
      const { id, version, supersedes, definitionStatus, sourceIds, locations, options, ...rest } = v;
      return canonical({ ...rest, options: options.map(o => o.responseStatus === 'answered' ? { code: o.code, responseStatus: o.responseStatus } : o)
        .sort((a, b) => a.code.localeCompare(b.code)) });
    };
    if (content(previous) !== content(next)) return false;
    const oldSources = previous.sourceIds || [], newSources = next.sourceIds || [];
    return oldSources.every(id => newSources.includes(id)) && newSources.some(id => !oldSources.includes(id)) &&
      (previous.locations || []).every(loc => (next.locations || []).some(other => canonical(other) === canonical(loc)));
  }

  // Check the whole JSON tree before schema traversal. Accessors, cycles, sparse arrays,
  // non-JSON values and excessive nesting cannot bypass the aggregate-storage limits.
  function inspect(value) {
    const active = new Set(), stack = [{ value, depth: 0 }];
    const prototypes = new Map([[Object.prototype, new Set([Object.prototype])], [Array.prototype, new Set([Array.prototype])]]);
    function builtInPrototype(proto, expected) {
      if (proto === null) return expected === null;
      if (expected === null) return false;
      if (prototypes.get(expected).has(proto)) return true;
      if (!builtInPrototype(Object.getPrototypeOf(proto), Object.getPrototypeOf(expected))) return false;
      const keys = Reflect.ownKeys(proto), expectedKeys = Reflect.ownKeys(expected);
      if (keys.length !== expectedKeys.length || keys.some(key => !expectedKeys.includes(key))) return false;
      for (const key of keys) {
        const actual = Object.getOwnPropertyDescriptor(proto, key), standard = Object.getOwnPropertyDescriptor(expected, key);
        for (const field of ['enumerable', 'configurable', 'writable', 'get', 'set', 'value']) {
          const a = actual[field], b = standard[field];
          if (typeof b === 'function') {
            if (typeof a !== 'function' || Function.prototype.toString.call(a) !== Function.prototype.toString.call(b)) return false;
          } else if (b !== null && typeof b === 'object') {
            // Array.prototype[Symbol.unscopables] is a null-prototype boolean map.
            if (!object(a) || Object.getPrototypeOf(a) !== null || Reflect.ownKeys(a).length !== Reflect.ownKeys(b).length ||
                Reflect.ownKeys(b).some(k => Object.getOwnPropertyDescriptor(a, k)?.value !== b[k])) return false;
          } else if (a !== b) return false;
        }
      }
      prototypes.get(expected).add(proto);
      return true;
    }
    let nodes = 0, characters = 0;
    while (stack.length) {
      const item = stack.pop(), v = item.value;
      if (item.leave) { active.delete(v); continue; }
      if (++nodes > limits.nodes || item.depth > limits.depth) return '調査データの項目数または階層が上限を超えています。';
      if (typeof v === 'string') characters += v.length;
      else if (v !== null && typeof v === 'object') {
        if (active.has(v)) return '調査データに循環参照があります。';
        const proto = Object.getPrototypeOf(v);
        if ((Array.isArray(v) || proto !== null) && !builtInPrototype(proto, Array.isArray(v) ? Array.prototype : Object.prototype)) return '調査データは独自プロトタイプを持たないJSONのオブジェクト・配列にしてください。';
        if (Array.isArray(v) && v.length > limits.array) return '調査データの配列が上限を超えています。';
        const keys = Reflect.ownKeys(v);
        if (Array.isArray(v) && keys.length !== v.length + 1) return '調査データに空き要素または不正な配列プロパティがあります。';
        if (keys.length > limits.array || nodes + keys.length > limits.nodes) return '調査データの項目数が上限を超えています。';
        active.add(v); stack.push({ value: v, leave: true });
        for (const key of keys) {
          if (Array.isArray(v) && key === 'length') continue;
          if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) return '調査データに不正なプロパティがあります。';
          if (Array.isArray(v) && !/^(0|[1-9]\d*)$/.test(key)) return '調査データの配列形式が不正です。';
          const descriptor = Object.getOwnPropertyDescriptor(v, key);
          if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return '調査データにJSONで保存できないプロパティがあります。';
          characters += key.length;
          stack.push({ value: descriptor.value, depth: item.depth + 1 });
        }
      } else if (!['number', 'boolean'].includes(typeof v) && v !== null) return '調査データにJSONで保存できない値があります。';
      else if (typeof v === 'number' && !Number.isFinite(v)) return '調査データの数値は有限の実数にしてください。';
      if (characters > limits.characters) return '調査データの文字量が上限を超えています。';
    }
    return null;
  }

  function validateSchema(data) {
    const inspection = inspect(data);
    if (inspection) return [inspection];
    const errors = [], add = (p, m) => { if (errors.length < 20) errors.push(p + ': ' + m); };
    function shape(v, keys, p, optional = []) {
      if (!object(v)) { add(p, 'オブジェクトにしてください。'); return false; }
      for (const key of Object.keys(v)) if (!keys.includes(key) && !optional.includes(key)) add(p + '.' + key, '未対応の項目です。');
      for (const key of keys) if (!Object.hasOwn(v, key)) add(p + '.' + key, '項目がありません。未確認値は明示的なnullまたはunknownで保存してください。');
      return true;
    }
    function string(v, p, nullable = false, max = 1000) {
      if (!(nullable && v === null) && (!text(v) || v.length > max)) add(p, '空欄でない文字列' + (nullable ? 'またはnull' : '') + 'にしてください。');
    }
    function id(v, p) { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(v)) add(p, '識別子の形式が不正です。'); }
    function choice(v, choices, p) { if (!choices.includes(v)) add(p, '値が未対応です（' + choices.join(', ') + '）。'); }
    function integer(v, p, min, max, nullable = false) {
      if (!(nullable && v === null) && (!Number.isSafeInteger(v) || v < min || v > max)) add(p, '範囲内の整数' + (nullable ? 'またはnull' : '') + 'にしてください。');
    }
    function array(v, p, max) {
      if (!Array.isArray(v) || v.length > max) { add(p, '配列の形式または件数が不正です。'); return []; }
      return v;
    }
    function strings(v, p, max, identifiers = false) {
      const a = array(v, p, max);
      a.forEach((s, i) => identifiers ? id(s, p + '[' + i + ']') : string(s, p + '[' + i + ']'));
      if (new Set(a).size !== a.length) add(p, '値が重複しています。');
      return a;
    }
    function index(a, p) {
      const m = new Map();
      a.forEach((v, i) => {
        if (!object(v)) { add(p + '[' + i + ']', 'オブジェクトにしてください。'); return; }
        id(v.id, p + '[' + i + '].id');
        if (m.has(v.id)) add(p, '識別子が重複しています。');
        else m.set(v.id, v);
      });
      return m;
    }
    function cell(v, p, kind) {
      if (!shape(v, ['value', 'status', 'decimals'], p, ['provenance'])) return;
      if (Object.hasOwn(v, 'provenance')) {
        const q = p + '.provenance', a = v.provenance;
        if (shape(a, ['sourceId', 'sheet', 'range', 'raw'], q, ['derivation'])) {
          if (!sourceById.has(a.sourceId)) add(q + '.sourceId', '出典の参照先がありません。');
          string(a.sheet, q + '.sheet'); string(a.range, q + '.range');
          if (typeof a.range !== 'string' || !/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(a.range)) add(q + '.range', '出典範囲はA1形式にしてください。');
          if (a.raw !== null && typeof a.raw !== 'string' && !Number.isFinite(a.raw)) add(q + '.raw', '元の数値・文字列またはnullにしてください。');
          if (Object.hasOwn(a, 'derivation')) choice(a.derivation, ['literal', 'sum'], q + '.derivation');
        }
      }
      choice(v.status, statuses, p + '.status');
      if (v.status !== 'observed') {
        if (v.value !== null || v.decimals !== null) add(p, '欠測にはvalue:null、decimals:nullが必要です。0は欠測ではありません。');
        return;
      }
      if (typeof v.value !== 'number' || !Number.isFinite(v.value)) { add(p + '.value', '数値にしてください。空欄や文字列を0に変換しないでください。'); return; }
      integer(v.decimals, p + '.decimals', 0, 10, true);
      if (kind === 'count') {
        integer(v.value, p + '.value', 0, 1000000000);
        if (v.decimals !== 0) add(p + '.decimals', '人数には0を指定してください。');
      } else if (kind === 'percent' && (v.value < 0 || v.value > 100)) add(p + '.value', '割合は0〜100にしてください。');
      else if (kind === 'deviation' && v.value < 0) add(p + '.value', '標準偏差は0以上にしてください。');
    }
    if (!shape(data, ['schemaVersion', 'sources', 'instruments', 'references', 'waves'], 'surveys')) return errors;
    if (data.schemaVersion !== 1) add('surveys.schemaVersion', '対応する版は1です。');
    const sources = array(data.sources, 'sources', limits.sources), instruments = array(data.instruments, 'instruments', limits.instruments),
      references = array(data.references, 'references', limits.references), waves = array(data.waves, 'waves', limits.waves);
    if (errors.length) return errors;
    const sourceById = index(sources, 'sources'), instrumentById = index(instruments, 'instruments'), referenceById = index(references, 'references');
    index(waves, 'waves');
    sources.forEach((s, i) => {
      const p = 'sources[' + i + ']';
      if (!shape(s, ['id', 'kind', 'title', 'publisher', 'url', 'fileName', 'importedAt', 'fingerprint', 'reader', 'locations', 'notes'], p)) return;
      choice(s.kind, ['official', 'schoolAggregate', 'schoolIndividual'], p + '.kind');
      for (const key of ['title', 'publisher']) string(s[key], p + '.' + key);
      string(s.url, p + '.url', true, 2000);
      if (s.url !== null && (typeof s.url !== 'string' || !/^https?:\/\/[^\s]+$/.test(s.url))) add(p + '.url', '出典URLはhttp/httpsまたはnullにしてください。');
      string(s.fileName, p + '.fileName', true);
      if (typeof s.importedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s.importedAt) ||
          !Number.isFinite(Date.parse(s.importedAt)) || new Date(s.importedAt).toISOString() !== s.importedAt) add(p + '.importedAt', '実在するUTC日時（ISO形式）にしてください。');
      if (s.fingerprint !== null && shape(s.fingerprint, ['algorithm', 'value'], p + '.fingerprint')) {
        if (s.fingerprint.algorithm !== 'sha256' || typeof s.fingerprint.value !== 'string' || !/^[a-f0-9]{64}$/.test(s.fingerprint.value)) add(p + '.fingerprint', 'SHA-256形式が不正です。指紋は真正性の証明ではありません。');
      }
      if (s.reader !== null && shape(s.reader, ['id', 'version'], p + '.reader')) {
        id(s.reader.id, p + '.reader.id'); string(s.reader.version, p + '.reader.version');
      }
      array(s.locations, p + '.locations', 256).forEach((loc, n) => {
        const q = p + '.locations[' + n + ']';
        if (!shape(loc, ['sheet', 'range'], q)) return;
        string(loc.sheet, q + '.sheet');
        if (typeof loc.range !== 'string' || !/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(loc.range)) add(q + '.range', 'セル範囲はA1形式にしてください。');
      });
      strings(s.notes, p + '.notes', 64);
    });
    instruments.forEach((v, i) => {
      const p = 'instruments[' + i + ']';
      if (!shape(v, ['id', 'version', 'year', 'schoolLevel', 'grade', 'respondent', 'kind', 'code', 'text', 'options', 'subject', 'skills', 'formId', 'scale'], p, ['definitionStatus', 'sourceIds', 'rawScoreMaximum', 'schoolAvailability', 'locations', 'supersedes'])) return;
      if (Object.hasOwn(v, 'supersedes')) id(v.supersedes, p + '.supersedes');
      if (Object.hasOwn(v, 'definitionStatus')) choice(v.definitionStatus, ['complete', 'codesOnly'], p + '.definitionStatus');
      if (Object.hasOwn(v, 'schoolAvailability')) choice(v.schoolAvailability, ['notReturned', 'returned', 'unknown'], p + '.schoolAvailability');
      if (Object.hasOwn(v, 'locations')) array(v.locations, p + '.locations', 256).forEach((loc, j) => {
        const q = p + '.locations[' + j + ']';
        if (!shape(loc, ['sourceId', 'sheet', 'range'], q)) return;
        if (!sourceById.has(loc.sourceId)) add(q + '.sourceId', '定義の出典がありません。');
        string(loc.sheet, q + '.sheet');
        if (typeof loc.range !== 'string' || !/^[A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(loc.range)) add(q + '.range', '定義の出典範囲はA1形式にしてください。');
      });
      if (Object.hasOwn(v, 'sourceIds')) strings(v.sourceIds, p + '.sourceIds', limits.sources, true).forEach(id => { if (!sourceById.has(id)) add(p + '.sourceIds', '定義の出典がありません。'); });
      if (Object.hasOwn(v, 'rawScoreMaximum')) {
        integer(v.rawScoreMaximum, p + '.rawScoreMaximum', 1, 1000000);
        if (v.kind !== 'subject' || v.scale?.kind !== 'percentCorrect') add(p + '.rawScoreMaximum', '正答数の満点は教科の平均正答率の尺度に指定してください。');
      }
      integer(v.version, p + '.version', 1, 1000000);
      integer(v.year, p + '.year', 1900, 9999, true);
      choice(v.schoolLevel, ['elementary', 'lowerSecondary', 'upperSecondary', 'unknown'], p + '.schoolLevel');
      integer(v.grade, p + '.grade', 1, v.schoolLevel === 'elementary' ? 6 : v.schoolLevel === 'unknown' ? 12 : 3, true);
      choice(v.respondent, ['student', 'school', 'unknown'], p + '.respondent');
      choice(v.kind, ['question', 'subject'], p + '.kind');
      string(v.code, p + '.code', false, 100); string(v.text, p + '.text', false, 20000);
      string(v.subject, p + '.subject', true); string(v.formId, p + '.formId', true);
      if (v.skills !== null) strings(v.skills, p + '.skills', 32);
      const options = array(v.options, p + '.options', limits.categories), codes = new Set();
      options.forEach((o, n) => {
        const q = p + '.options[' + n + ']';
        if (!shape(o, ['code', 'label', 'responseStatus'], q)) return;
        string(o.code, q + '.code', false, 100); string(o.label, q + '.label');
        choice(o.responseStatus, ['answered', 'noResponse', 'invalid', 'notApplicable', 'notAssigned', 'notParticipating', 'unknown'], q + '.responseStatus');
        if (codes.has(o.code)) add(q, '選択肢コードが重複しています。');
        codes.add(o.code);
      });
      if (!shape(v.scale, ['kind', 'unit', 'version', 'minimum', 'maximum', 'step', 'bands'], p + '.scale')) return;
      const s = v.scale;
      choice(s.kind, ['response', 'percentCorrect', 'rawScore', 'irtScore', 'irtBand'], p + '.scale.kind');
      const units = { response: 'category', percentCorrect: 'percent', rawScore: 'points', irtScore: 'irtScore', irtBand: 'category' };
      if (typeof s.kind !== 'string' || s.unit !== units[s.kind]) add(p + '.scale.unit', '尺度と単位の組合せが不正です。');
      string(s.version, p + '.scale.version', true);
      // step:null denotes a continuous scale. A positive step describes the
      // individual-score lattice, not the precision of an aggregate mean.
      if (s.step !== null && (!Number.isFinite(s.step) || s.step <= 0)) add(p + '.scale.step', '連続尺度はnull、離散尺度は正の刻み幅を指定してください。');
      for (const key of ['minimum', 'maximum']) if (s[key] !== null && !Number.isFinite(s[key])) add(p + '.scale.' + key, '数値またはnullにしてください。');
      if (Number.isFinite(s.minimum) && Number.isFinite(s.maximum) && s.minimum >= s.maximum) add(p + '.scale', '最小値は最大値より小さくしてください。');
      if (s.kind === 'percentCorrect' && (s.minimum !== 0 || s.maximum !== 100)) add(p + '.scale', '平均正答率の範囲は0〜100です。');
      if (v.kind === 'question' && (s.kind !== 'response' || !options.length || v.subject !== null || !Array.isArray(v.skills) || v.skills.length || v.formId !== null)) add(p, '質問は選択肢とresponse尺度を持ち、subject/formId:null、skills:[]としてください。');
      if (s.kind === 'response' && (s.minimum !== null || s.maximum !== null || s.step !== null)) add(p + '.scale', '回答コードに数値の大小を付けないでください。');
      if (v.kind === 'subject' && s.kind === 'response') add(p + '.scale', '教科には得点またはバンドの尺度を指定してください。');
      const bands = array(s.bands, p + '.scale.bands', limits.categories), bandCodes = new Set();
      const discrete = Number.isFinite(s.step) && s.step > 0;
      const anchor = bands.flatMap(b => object(b) ? [b.lower, b.upper] : []).find(Number.isFinite);
      const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) &&
        Math.abs(a - b) <= Number.EPSILON * 16 * Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b));
      bands.forEach((b, n) => {
        const q = p + '.scale.bands[' + n + ']';
        if (!shape(b, ['code', 'label', 'lower', 'upper', 'lowerInclusive', 'upperInclusive'], q)) return;
        string(b.code, q + '.code', false, 100); string(b.label, q + '.label');
        if (bandCodes.has(b.code)) add(q, 'バンドコードが重複しています。');
        bandCodes.add(b.code);
        for (const key of ['lower', 'upper']) if (b[key] !== null && !Number.isFinite(b[key])) add(q + '.' + key, '数値または無限端を表すnullにしてください。');
        if (typeof b.lowerInclusive !== 'boolean' || typeof b.upperInclusive !== 'boolean') add(q, '境界の包含条件が不正です。');
        if ((b.lower === null && (n !== 0 || b.lowerInclusive)) || (b.upper === null && (n !== bands.length - 1 || b.upperInclusive))) add(q, '無限端の位置または包含条件が不正です。');
        if (discrete && (b.lower === null || Number.isFinite(b.lower)) && (b.upper === null || Number.isFinite(b.upper))) {
          for (const bound of [b.lower, b.upper].filter(Number.isFinite)) {
            const steps = (bound - anchor) / s.step;
            if (!close(steps, Math.round(steps))) add(q, 'バンド境界が尺度の刻み幅と一致しません。');
          }
          const first = b.lower === null ? -Infinity : b.lower + (b.lowerInclusive ? 0 : s.step);
          const last = b.upper === null ? Infinity : b.upper - (b.upperInclusive ? 0 : s.step);
          if (first > last && !close(first, last)) add(q, 'このバンドに該当する離散得点がありません。');
        } else if (Number.isFinite(b.lower) && Number.isFinite(b.upper) && b.lower >= b.upper) add(q, 'バンドの下限は上限より小さくしてください。');
        const previous = bands[n - 1];
        if (n && object(previous)) {
          const gap = Number.isFinite(b.lower) && Number.isFinite(previous.upper) ?
            b.lower + (b.lowerInclusive ? 0 : s.step) - (previous.upper - (previous.upperInclusive ? 0 : s.step)) : NaN;
          const adjacent = discrete ? close(gap, s.step) : previous.upper === b.lower && previous.upperInclusive !== b.lowerInclusive;
          if (!adjacent) add(q, 'バンドに重なりまたは空白があります。');
        }
      });
      if (s.kind === 'irtBand' ? !bands.length || options.length : bands.length) add(p + '.scale.bands', 'IRTバンドは境界を必須とし、他尺度にはバンドを設定できません。');
    });
    if (errors.length) return errors;

    const replacedInstruments = new Set();
    instruments.forEach((v, i) => {
      if (!Object.hasOwn(v, 'supersedes')) return;
      const p = 'instruments[' + i + '].supersedes', previous = instrumentById.get(v.supersedes);
      if (!previous || previous.id === v.id || v.version !== previous.version + 1 || !isDefinitionCompletion(previous, v))
        add(p, '元の設問・出典を保持し、コードのみの定義を選択肢原文で補完した直後の版を指定してください。');
      if (replacedInstruments.has(v.supersedes)) add(p, '同じ定義版を複数の定義が補完しています。');
      replacedInstruments.add(v.supersedes);
    });
    if (errors.length) return errors;

    function distributionValues(items, codes, basis, partition, n, p) {
      const values = array(items, p, Math.max(limits.categories, codes.length)), seen = new Set();
      choice(basis, ['count', 'percent'], p + '.basis');
      values.forEach((r, i) => {
        const q = p + '[' + i + ']';
        if (!shape(r, ['code', 'value'], q, ['publishedPercent'])) return;
        if (!codes.includes(r.code) || seen.has(r.code)) add(q + '.code', '選択肢にないコード、または重複コードです。');
        seen.add(r.code); cell(r.value, q + '.value', basis);
        if (Object.hasOwn(r, 'publishedPercent')) {
          if (basis !== 'count') add(q, '公表割合を別に保持する場合は人数を主値にしてください。');
          cell(r.publishedPercent, q + '.publishedPercent', 'percent');
          if (n === 0 && r.publishedPercent?.status === 'observed') add(q, '分母0人の割合は欠測にしてください。');
          if (n > 0 && r.value?.status === 'observed' && Number.isFinite(r.value.value) && r.publishedPercent?.status === 'observed' && Number.isFinite(r.publishedPercent.value)) {
            const tolerance = Math.pow(10, -(Number.isInteger(r.publishedPercent.decimals) ? r.publishedPercent.decimals : 0)) + 1e-9;
            if (Math.abs(100 * r.value.value / n - r.publishedPercent.value) > tolerance) add(q, '人数・分母と公表割合が掲載精度の範囲で一致しません。');
          }
        }
        if (basis === 'count' && r.value?.status === 'observed' && Number.isFinite(r.value.value) && n !== null && r.value.value > n) add(q, '人数が分母を超えています。');
        if (basis === 'percent' && r.value?.status === 'observed' && n === 0) add(q, '分母0人の割合は欠測にしてください。');
      });
      if (!codes.length || codes.some(code => !seen.has(code))) add(p, '全選択肢を保存してください。未提供値には欠測状態が必要です。');
      if (!partition) return;
      const observed = values.filter(r => r?.value?.status === 'observed' && Number.isFinite(r.value.value));
      const total = observed.reduce((sum, r) => sum + r.value.value, 0);
      if (basis === 'count' && n !== null && (total > n || (observed.length === values.length && total !== n))) add(p, '人数合計と分母が一致しません。');
      const percentages = values.map(r => basis === 'percent' ? r?.value : r?.publishedPercent).filter(c => c?.status === 'observed' && Number.isFinite(c.value));
      const sum = percentages.reduce((sum, c) => sum + c.value, 0), tolerance = percentages.reduce((sum, c) => sum + Math.pow(10, -(Number.isInteger(c.decimals) ? c.decimals : 0)), 0) + 1e-9;
      if (sum > 100 + tolerance || (percentages.length === values.length && sum < 100 - tolerance)) add(p, '掲載精度を考慮しても割合合計が100%と整合しません。');
    }
    function average(v, subject, n, p) {
      if (!['percentCorrect', 'rawScore', 'irtScore'].includes(subject.scale.kind)) add(p, '回答コード・IRTバンドから平均を作成できません。');
      cell(v.mean, p + '.mean', subject.scale.kind === 'percentCorrect' ? 'percent' : 'mean');
      cell(v.standardDeviation, p + '.standardDeviation', 'deviation');
      if (v.mean?.status === 'observed' && Number.isFinite(v.mean.value) && ((subject.scale.minimum !== null && v.mean.value < subject.scale.minimum) ||
          (subject.scale.maximum !== null && v.mean.value > subject.scale.maximum))) add(p + '.mean', '平均が尺度の範囲外です。');
      if (n === 0 && (v.mean?.status === 'observed' || v.standardDeviation?.status === 'observed')) add(p, '分母0人の平均・標準偏差は欠測にしてください。');
    }
    function statistic(v, p, official) {
      const common = ['id', 'instrumentId', 'sourceId', 'type', 'observationUnit', 'geography', 'ownership', 'population', 'denominator', 'notes'];
      const variants = { distribution: ['basis', 'partition', 'values'], summary: ['mean', 'standardDeviation'],
        conditionalMean: ['subjectInstrumentId', 'values'], crossTab: ['subjectInstrumentId', 'basis', 'normalization', 'grouping', 'groups', 'rows'] };
      const variant = typeof v?.type === 'string' && Object.hasOwn(variants, v.type) ? variants[v.type] : [];
      if (!shape(v, common.concat(official ? ['version'] : ['revision', 'supersedes'], variant), p,
        (official ? ['supersedes'] : ['responseSetId']).concat(v?.type === 'conditionalMean' ? ['total'] : []))) return;
      if (!Object.hasOwn(variants, typeof v.type === 'string' ? v.type : '')) { add(p + '.type', '未対応の統計型です。'); return; }
      id(v.instrumentId, p + '.instrumentId'); id(v.sourceId, p + '.sourceId');
      const instrument = instrumentById.get(v.instrumentId), source = sourceById.get(v.sourceId);
      if (!instrument) add(p + '.instrumentId', '設問・尺度の参照先がありません。');
      if (!source || (official ? source.kind !== 'official' : !['schoolAggregate', 'schoolIndividual'].includes(source.kind))) add(p + '.sourceId', '出典の参照先または公式・学校の区分が不正です。');
      if (!official && Object.hasOwn(v, 'responseSetId')) id(v.responseSetId, p + '.responseSetId');
      if (!official && source?.kind === 'schoolIndividual' && !Object.hasOwn(v, 'responseSetId')) add(p + '.responseSetId', '個票から作成した結果には採用した個票版を固定してください。');
      integer(v[official ? 'version' : 'revision'], p + (official ? '.version' : '.revision'), 1, 1000000);
      if (!official && v.supersedes !== null) id(v.supersedes, p + '.supersedes');
      if (official && Object.hasOwn(v, 'supersedes')) id(v.supersedes, p + '.supersedes');
      choice(v.observationUnit, ['student', 'school', 'unknown'], p + '.observationUnit');
      if (instrument && instrument.respondent !== 'unknown' && v.observationUnit !== 'unknown' && instrument.respondent !== v.observationUnit) add(p + '.observationUnit', '回答者と観測単位が一致しません。');
      choice(v.ownership, ['public', 'national', 'private', 'all', 'unknown'], p + '.ownership');
      if (!official && v.ownership === 'all') add(p + '.ownership', '自校の設置者を指定してください。全国の国公私立合計をコピーできません。');
      if (shape(v.geography, ['level', 'code', 'label'], p + '.geography')) {
        choice(v.geography.level, ['national', 'prefecture', 'municipality', 'school', 'other', 'unknown'], p + '.geography.level');
        string(v.geography.code, p + '.geography.code', true); string(v.geography.label, p + '.geography.label');
        if (!official && v.geography.level !== 'school') add(p + '.geography.level', '自校結果はschoolにしてください。');
      }
      if (shape(v.population, ['participation', 'definition'], p + '.population')) {
        choice(v.population.participation, ['eligible', 'question', 'subject', 'joint', 'unknown'], p + '.population.participation');
        string(v.population.definition, p + '.population.definition', true);
      }
      if (shape(v.denominator, ['basis', 'definition', 'count'], p + '.denominator')) {
        choice(v.denominator.basis, ['eligible', 'questionParticipants', 'validResponses', 'subjectParticipants', 'jointParticipants', 'unknown'], p + '.denominator.basis');
        string(v.denominator.definition, p + '.denominator.definition', true);
        cell(v.denominator.count, p + '.denominator.count', 'count');
      }
      strings(v.notes, p + '.notes', 64);
      if (!instrument) return;
      const n = v.denominator?.count?.status === 'observed' && Number.isFinite(v.denominator.count.value) ? v.denominator.count.value : null;
      if (v.type === 'conditionalMean' || v.type === 'crossTab') {
        id(v.subjectInstrumentId, p + '.subjectInstrumentId');
        const subject = instrumentById.get(v.subjectInstrumentId);
        if (instrument.kind !== 'question' || !subject || subject.kind !== 'subject') { add(p, '質問と教科の両方の定義が必要です。'); return; }
        for (const key of ['year', 'schoolLevel', 'grade', 'respondent']) {
          if (instrument[key] !== null && subject[key] !== null && instrument[key] !== 'unknown' && subject[key] !== 'unknown' && instrument[key] !== subject[key]) add(p, '質問と教科の年度・対象が一致しません。');
        }
        const codes = instrument.options.map(o => o.code), seen = new Set();
        if (v.type === 'conditionalMean') {
          array(v.values, p + '.values', limits.categories).forEach((r, i) => {
            const q = p + '.values[' + i + ']';
            if (!shape(r, ['code', 'count', 'mean', 'standardDeviation'], q)) return;
            if (!codes.includes(r.code) || seen.has(r.code)) add(q + '.code', '条件コードが不正または重複しています。');
            seen.add(r.code); cell(r.count, q + '.count', 'count');
            average(r, subject, r.count?.status === 'observed' ? r.count.value : null, q);
          });
          if (codes.some(code => !seen.has(code))) add(p + '.values', '全条件を保存し、未提供の平均・人数には欠測状態を指定してください。');
          distributionValues(v.values.map(r => ({ code: r.code, value: r.count })), codes, 'count', true, n, p + '.conditionCounts');
          if (Object.hasOwn(v, 'total') && shape(v.total, ['count', 'mean', 'standardDeviation'], p + '.total')) {
            cell(v.total.count, p + '.total.count', 'count'); average(v.total, subject, v.total.count?.status === 'observed' ? v.total.count.value : null, p + '.total');
          }
        } else {
          choice(v.basis, ['count', 'percent'], p + '.basis'); choice(v.normalization, ['row', 'column', 'total'], p + '.normalization');
          if (shape(v.grouping, ['kind', 'scope', 'definitionId', 'bands'], p + '.grouping')) {
            choice(v.grouping.kind, ['quartile'], p + '.grouping.kind'); choice(v.grouping.scope, ['national', 'school'], p + '.grouping.scope');
            string(v.grouping.definitionId, p + '.grouping.definitionId', true);
            if (v.grouping.bands !== null) {
              const bands = array(v.grouping.bands, p + '.grouping.bands', 4), bandCodes = new Set();
              bands.forEach((b, j) => {
                const q = p + '.grouping.bands[' + j + ']';
                if (!shape(b, ['code', 'label', 'lower', 'upper', 'lowerInclusive', 'upperInclusive'], q)) return;
                string(b.code, q + '.code'); string(b.label, q + '.label');
                if (bandCodes.has(b.code)) add(q, '境界のコードが重複しています。'); bandCodes.add(b.code);
                for (const k of ['lower', 'upper']) if (b[k] !== null && !Number.isFinite(b[k])) add(q, '境界は数値または無限端のnullです。');
                if (typeof b.lowerInclusive !== 'boolean' || typeof b.upperInclusive !== 'boolean') add(q, '境界の包含条件が不正です。');
                if (Number.isFinite(b.lower) && Number.isFinite(b.upper) && b.lower > b.upper) add(q, '境界の上下が逆です。');
              });
              if (bands.length !== 4 || !v.grouping.definitionId) add(p + '.grouping', '四分位境界には4層と定義IDが必要です。');
              const ordered = [...bands].filter(b => object(b) && (b.lower === null || Number.isFinite(b.lower)) && (b.upper === null || Number.isFinite(b.upper))).sort((a, b) => (a.lower === null ? -Infinity : a.lower) - (b.lower === null ? -Infinity : b.lower));
              const step = subject.scale.step !== null ? subject.scale.step : subject.rawScoreMaximum ? 100 / subject.rawScoreMaximum : null;
              for (let j = 0; j < ordered.length; j++) {
                const band = ordered[j], previous = ordered[j - 1];
                if ((band.lower === null && (j !== 0 || band.lowerInclusive)) || (band.upper === null && (j !== ordered.length - 1 || band.upperInclusive))) add(p + '.grouping.bands', '四分位の無限端が不正です。');
                if (previous) {
                  const gap = band.lower + (band.lowerInclusive ? 0 : step) - (previous.upper - (previous.upperInclusive ? 0 : step));
                  const adjacent = step === null ? previous.upper === band.lower && previous.upperInclusive !== band.lowerInclusive : Number.isFinite(gap) && Math.abs(gap - step) <= 1e-9 * step;
                  if (!adjacent) add(p + '.grouping.bands', '四分位の境界に重なりまたは空白があります。');
                }
              }
            }
          }
          const groups = array(v.groups, p + '.groups', 4), groupCodes = [], rows = array(v.rows, p + '.rows', limits.categories);
          groups.forEach((g, i) => {
            const q = p + '.groups[' + i + ']';
            if (!shape(g, ['code', 'label', 'count'], q, ['publishedPercent'])) return;
            string(g.code, q + '.code'); string(g.label, q + '.label'); groupCodes.push(g.code); cell(g.count, q + '.count', 'count');
          });
          if (groups.length !== 4 || new Set(groupCodes).size !== 4) add(p + '.groups', '四分位には重複しない4層が必要です。');
          distributionValues(groups.map(g => ({ code: g.code, value: g.count, ...(Object.hasOwn(g, 'publishedPercent') ? { publishedPercent: g.publishedPercent } : {}) })), groupCodes, 'count', true, n, p + '.groups');
          if (Array.isArray(v.grouping?.bands) && (v.grouping.bands.some(b => !groupCodes.includes(b?.code)) || new Set(v.grouping.bands.map(b => b?.code)).size !== groupCodes.length)) add(p + '.grouping.bands', '層と境界コードが一致しません。');
          rows.forEach((r, i) => {
            const q = p + '.rows[' + i + ']';
            if (!shape(r, ['code', 'count', 'values'], q, ['publishedPercent'])) return;
            if (!codes.includes(r.code) || seen.has(r.code)) add(q + '.code', '質問の選択肢コードが不正または重複しています。'); seen.add(r.code);
            cell(r.count, q + '.count', 'count');
            const rowN = r.count?.status === 'observed' ? r.count.value : null;
            distributionValues(r.values, groupCodes, v.basis, v.normalization === 'row', v.normalization === 'row' ? rowN : null, q + '.values');
            if (v.basis === 'count') distributionValues(r.values.map(c => ({ code: c.code, value: c.value })), groupCodes, 'count', true, rowN, q + '.counts');
          });
          if (codes.some(code => !seen.has(code))) add(p + '.rows', '全選択肢の行を保存してください。');
          distributionValues(rows.map(r => ({ code: r.code, value: r.count, ...(Object.hasOwn(r, 'publishedPercent') ? { publishedPercent: r.publishedPercent } : {}) })), codes, 'count', true, n, p + '.rowTotals');
          for (const g of groups) {
            const aligned = rows.map(r => { const value = Array.isArray(r.values) ? r.values.find(c => c?.code === g.code) : null; return { ...value, code: r.code }; });
            const groupN = g.count?.status === 'observed' ? g.count.value : null;
            if (v.normalization === 'column') distributionValues(aligned, codes, v.basis, true, groupN, p + '.column[' + g.code + ']');
            if (v.basis === 'count') distributionValues(aligned.map(c => ({ code: c.code, value: c.value })), codes, 'count', true, groupN, p + '.columnCounts[' + g.code + ']');
          }
          if (v.normalization === 'total') {
            const all = rows.flatMap(r => (r.values || []).map(c => ({ ...c, code: r.code + ':' + c.code })));
            distributionValues(all, all.map(c => c.code), v.basis, true, n, p + '.totalCells');
          }
        }
        return;
      }
      if (v.type === 'distribution') {
        if (typeof v.partition !== 'boolean') add(p + '.partition', '全選択肢が分母を分割するかを真偽値で指定してください。');
        if (!['response', 'rawScore', 'irtBand'].includes(instrument.scale.kind)) add(p + '.type', 'この尺度の分布は未対応です。');
        const codes = (instrument.scale.kind === 'irtBand' ? instrument.scale.bands : instrument.options).map(c => c.code);
        distributionValues(v.values, codes, v.basis, v.partition, n, p + '.values');
      } else average(v, instrument, n, p);
    }
    references.forEach((v, i) => statistic(v, 'references[' + i + ']', true));
    if (errors.length) return errors;
    const replacedReferences = new Set();
    references.forEach((v, i) => {
      if (!Object.hasOwn(v, 'supersedes')) return;
      const p = 'references[' + i + '].supersedes', previous = referenceById.get(v.supersedes), instrument = instrumentById.get(v.instrumentId);
      const content = r => { const { id, version, supersedes, instrumentId, ...rest } = r; return canonical(rest); };
      if (!previous || previous.id === v.id || v.version !== previous.version + 1 || instrument?.supersedes !== previous.instrumentId || content(previous) !== content(v))
        add(p, '統計値・掲載精度・出典・対象条件を変えず、補完した設問定義だけを参照する直後の公式統計版を指定してください。');
      if (replacedReferences.has(v.supersedes)) add(p, '同じ公式統計版を複数の統計が補完しています。');
      replacedReferences.add(v.supersedes);
    });
    if (errors.length) return errors;
    waves.forEach((w, i) => {
      const p = 'waves[' + i + ']';
      if (!shape(w, ['id', 'label', 'administeredOn', 'administration', 'instrumentIds', 'referenceIds', 'results'], p, ['participants', 'responseSets', 'ownership', 'schoolLabel'])) return;
      if (Object.hasOwn(w, 'ownership')) choice(w.ownership, ['public', 'national', 'private', 'unknown'], p + '.ownership');
      if (Object.hasOwn(w, 'schoolLabel')) string(w.schoolLabel, p + '.schoolLabel');
      string(w.label, p + '.label');
      if (!date(w.administeredOn)) add(p + '.administeredOn', '実在する実施日を指定してください。資料の年度とは別項目です。');
      choice(w.administration, ['official', 'local'], p + '.administration');
      const selected = strings(w.instrumentIds, p + '.instrumentIds', limits.instruments, true);
      selected.forEach(id => { if (!instrumentById.has(id)) add(p + '.instrumentIds', '設問・尺度の参照先がありません。'); });
      const referenceConditions = new Map();
      strings(w.referenceIds, p + '.referenceIds', limits.references, true).forEach(id => {
        const reference = referenceById.get(id);
        if (!reference) { add(p + '.referenceIds', '比較対象の参照先がありません。'); return; }
        // One school result can serve multiple geographic benchmarks, but it
        // cannot represent two different populations or denominator definitions.
        const key = resultKey(reference), condition = JSON.stringify([reference.observationUnit,
          reference.population.participation, reference.population.definition, reference.denominator.basis, reference.denominator.definition]);
        if (referenceConditions.has(key) && referenceConditions.get(key) !== condition) add(p + '.referenceIds', '同じ設問・統計型でも、対象者・観測単位・分母の定義が異なる比較先は別の調査回に分けてください。');
        else referenceConditions.set(key, condition);
      });
      const participants = Object.hasOwn(w, 'participants') ? array(w.participants, p + '.participants', limits.participants) : [], participantIds = new Set();
      participants.forEach((v, j) => {
        const q = p + '.participants[' + j + ']';
        if (!shape(v, ['id', 'name', 'grade', 'className', 'number'], q)) return;
        id(v.id, q + '.id');
        if (participantIds.has(v.id)) add(q, '調査対象者IDが重複しています。'); participantIds.add(v.id);
        string(v.name, q + '.name', true); string(v.className, q + '.className', true); string(v.number, q + '.number', true);
        integer(v.grade, q + '.grade', 1, 12, true);
      });
      const sets = Object.hasOwn(w, 'responseSets') ? array(w.responseSets, p + '.responseSets', limits.responseSets) : [], setsById = index(sets, p + '.responseSets');
      sets.forEach((set, j) => {
        const q = p + '.responseSets[' + j + ']';
        if (!shape(set, ['id', 'sourceId', 'instrumentIds', 'records'], q)) return;
        if (sourceById.get(set.sourceId)?.kind !== 'schoolIndividual') add(q + '.sourceId', '個票の出典を指定してください。');
        const scope = strings(set.instrumentIds, q + '.instrumentIds', limits.instruments, true), seen = new Set();
        if (!scope.length || scope.some(id => !selected.includes(id))) add(q + '.instrumentIds', '調査回の中の入力範囲を指定してください。');
        array(set.records, q + '.records', limits.participants).forEach((r, k) => {
          const t = q + '.records[' + k + ']';
          if (!shape(r, ['participantId', 'values'], t)) return;
          if (!participantIds.has(r.participantId) || seen.has(r.participantId)) add(t + '.participantId', '固定した対象者にないID、または重複IDです。'); seen.add(r.participantId);
          const cells = new Set();
          array(r.values, t + '.values', limits.instruments).forEach((v, m) => {
            const u = t + '.values[' + m + ']';
            if (!shape(v, ['instrumentId', 'value', 'status'], u, ['rawScore'])) return;
            const instrument = instrumentById.get(v.instrumentId);
            if (!scope.includes(v.instrumentId) || cells.has(v.instrumentId)) add(u + '.instrumentId', '発行範囲にない設問、または重複です。'); cells.add(v.instrumentId);
            choice(v.status, statuses, u + '.status');
            if (v.status !== 'observed') {
              if (v.value !== null || Object.hasOwn(v, 'rawScore')) add(u, '未入力・欠測はvalue:nullとし、原点数を付けないでください。');
            } else if (instrument) {
              if (instrument.kind === 'question' || instrument.scale.kind === 'irtBand') {
                const categories = instrument.kind === 'question' ? instrument.options : instrument.scale.bands;
                if (!categories.some(c => c.code === v.value)) add(u + '.value', '定義にない回答・バンドコードです。');
              } else if (!Number.isFinite(v.value) || (instrument.scale.minimum !== null && v.value < instrument.scale.minimum) || (instrument.scale.maximum !== null && v.value > instrument.scale.maximum)) add(u + '.value', '尺度内の実数を指定してください。');
              if (Object.hasOwn(v, 'rawScore')) {
                if (instrument.kind !== 'subject' || instrument.scale.kind !== 'percentCorrect' || !Number.isSafeInteger(instrument.rawScoreMaximum) || !Number.isSafeInteger(v.rawScore) || v.rawScore < 0 || v.rawScore > instrument.rawScoreMaximum || !Number.isFinite(v.value) || Math.abs(v.value - 100 * v.rawScore / instrument.rawScoreMaximum) > 1e-9) add(u + '.rawScore', '正答数・満点と平均正答率の対応が一致しません。');
              }
            }
          });
          if (scope.some(id => !cells.has(id))) add(t + '.values', '発行範囲内の空欄もunenteredで明示してください。');
        });
        if (participants.length !== seen.size || !participants.length) add(q + '.records', '調査時点の全対象者を保存してください。');
      });
      const results = array(w.results, p + '.results', limits.results), byId = index(results, p + '.results'), replaced = new Set();
      results.forEach((r, j) => {
        const q = p + '.results[' + j + ']';
        statistic(r, q, false);
        if (!object(r)) return;
        if (w.ownership && w.ownership !== 'unknown' && r.ownership !== w.ownership) add(q + '.ownership', '調査回に固定した自校の設置者と一致しません。');
        if (!selected.includes(r.instrumentId)) add(q + '.instrumentId', 'この調査回に固定した設問・尺度ではありません。');
        if (r.subjectInstrumentId && !selected.includes(r.subjectInstrumentId)) add(q + '.subjectInstrumentId', 'この調査回に固定した教科ではありません。');
        if (Object.hasOwn(r, 'responseSetId')) {
          const set = setsById.get(r.responseSetId);
          if (!set || set.sourceId !== r.sourceId || !set.instrumentIds.includes(r.instrumentId) || (r.subjectInstrumentId && !set.instrumentIds.includes(r.subjectInstrumentId))) add(q + '.responseSetId', '採用した個票版の出典・入力範囲が一致しません。');
        }
        if (r.supersedes === null) { if (r.revision !== 1) add(q + '.revision', '最初の結果版は1です。'); }
        else {
          const previous = byId.get(r.supersedes);
          if (!previous || previous.id === r.id || resultKey(previous) !== resultKey(r) || !Number.isSafeInteger(previous.revision) || r.revision !== previous.revision + 1) add(q + '.supersedes', '同じ調査回・設問・統計型の直前の結果版を指定してください。');
          if (replaced.has(r.supersedes)) add(q + '.supersedes', '同じ結果版を複数の結果が差し替えています。');
          replaced.add(r.supersedes);
        }
      });
      // One active aggregate per statistic; repeated administrations belong in separate waves.
      const active = new Set();
      results.filter(r => object(r) && !replaced.has(r.id)).forEach(r => {
        if (typeof r.instrumentId !== 'string' || typeof r.type !== 'string') return;
        const key = resultKey(r);
        if (active.has(key)) add(p + '.results', '同じ調査回の同じ統計に複数の採用結果があります。差し替え元を指定してください。');
        active.add(key);
      });
    });
    return errors;
  }

  function validate(data) {
    try { return validateSchema(data); }
    catch (_) { return ['調査データに検証できない型または値があります。読み込み・保存を中止してください。']; }
  }

  const observedValue = cell => cell?.status === 'observed' ? cell.value : null;
  function percentage(basis, item, denominator) {
    if (basis === 'percent') return observedValue(item.value);
    if (item.publishedPercent?.status === 'observed') return item.publishedPercent.value;
    return item.value.status === 'observed' && denominator.status === 'observed' && denominator.value > 0 ? 100 * item.value.value / denominator.value : null;
  }
  function difference(code, school, reference, schoolStatus, referenceStatus) {
    const delta = school !== null && reference !== null ? school - reference : null;
    return { code, school, reference, difference: Number.isFinite(delta) ? delta : null,
      schoolStatus: school !== null ? 'observed' : schoolStatus, referenceStatus: reference !== null ? 'observed' : referenceStatus };
  }

  function compare(data, selection) {
    const errors = validate(data);
    if (errors.length) return { status: 'blocked', reasons: [{ code: 'invalidData', message: errors.join('\n') }], notices: [], differences: null };
    const reasons = [], notices = [];
    let status = 'comparable';
    const reason = (level, code, message) => {
      if (level === 'blocked' || status === 'comparable') status = level;
      reasons.push({ code, message });
    };
    const wave = data.waves.find(w => w.id === selection?.waveId), school = wave?.results.find(r => r.id === selection?.resultId),
      reference = data.references.find(r => r.id === selection?.referenceId);
    if (!wave || !school || !reference || !wave.referenceIds.includes(reference.id)) return { status: 'blocked', reasons: [{ code: 'selection', message: 'この調査回に固定した学校結果と比較対象を選んでください。' }], notices: [], differences: null };
    const a = data.instruments.find(v => v.id === school.instrumentId), b = data.instruments.find(v => v.id === reference.instrumentId);
    function match(left, right, code, message, level = 'blocked') {
      if (left === null || right === null || left === 'unknown' || right === 'unknown') reason('referenceOnly', code + 'Unknown', message + 'が未確認です。');
      else if (!same(left, right)) reason(level, code + 'Mismatch', message + 'が一致しません。');
    }
    function definitions(a, b) {
    match(a.year, b.year, 'year', '調査年度');
    match(a.schoolLevel, b.schoolLevel, 'schoolLevel', '学校段階');
    match(a.grade, b.grade, 'grade', '学年');
    match(a.respondent, b.respondent, 'respondent', '回答者');
    match(school.observationUnit, reference.observationUnit, 'observationUnit', '観測単位（学校・生徒）');
    match(a.kind, b.kind, 'instrumentKind', '質問・教科の区分');
    match(a.code, b.code, 'instrumentCode', '設問・教科のコード');
    match(a.text, b.text, 'instrumentText', '設問原文・教科定義');
    const options = v => [...v.options].sort((x, y) => x.code < y.code ? -1 : x.code > y.code ? 1 : 0)
      .map(o => [o.code, o.label, o.responseStatus]);
    if (a.definitionStatus === 'codesOnly' || b.definitionStatus === 'codesOnly') reason('referenceOnly', 'definitionIncomplete', '選択肢の原文を確認できないため参考表示です。');
    else match(options(a), options(b), 'options', '選択肢のコードと意味');
    match(a.scale.kind, b.scale.kind, 'scale', '尺度');
    match(a.scale.unit, b.scale.unit, 'unit', '尺度の単位');
    if (a.scale.step !== b.scale.step) reason('blocked', 'scaleStepMismatch', '尺度の連続・離散の区分または刻み幅が一致しません。');
    if (a.kind === 'subject' || b.kind === 'subject') {
      match(a.subject, b.subject, 'subject', '教科');
      match(a.skills === null ? null : sorted(a.skills), b.skills === null ? null : sorted(b.skills), 'skills', '技能範囲');
      match(a.formId, b.formId, 'form', '試験フォーム（異なるフォームの接続は未対応）');
      match(a.scale.version, b.scale.version, 'scaleVersion', '尺度の版');
      if (a.scale.kind === 'rawScore' || b.scale.kind === 'rawScore') {
        match(a.scale.minimum, b.scale.minimum, 'scaleMinimum', '得点の下限');
        match(a.scale.maximum, b.scale.maximum, 'scaleMaximum', '得点の上限');
      } else if (a.scale.minimum !== b.scale.minimum || a.scale.maximum !== b.scale.maximum) reason('blocked', 'scaleBoundsMismatch', '尺度の数値範囲が一致しません。');
    }
    // Order and property insertion order do not define band meaning; endpoint inclusion does.
    const bands = v => v.scale.bands.map(c => [c.code, c.label, c.lower, c.upper, c.lowerInclusive, c.upperInclusive]);
    match(bands(a), bands(b), 'bands', 'IRTバンド境界と包含条件');
    }
    definitions(a, b);
    if (school.subjectInstrumentId && reference.subjectInstrumentId) definitions(data.instruments.find(v => v.id === school.subjectInstrumentId), data.instruments.find(v => v.id === reference.subjectInstrumentId));
    match(school.type, reference.type, 'statisticType', '統計型');
    match(school.ownership, reference.ownership, 'ownership', '設置者の母集団', 'referenceOnly');
    match(school.population.participation, reference.population.participation, 'participation', '参加対象者');
    match(school.population.definition, reference.population.definition, 'population', '対象条件');
    match(school.denominator.basis, reference.denominator.basis, 'denominatorBasis', '分母の種類');
    match(school.denominator.definition, reference.denominator.definition, 'denominator', '分母の定義');
    if (school.geography.level === 'unknown' || reference.geography.level === 'unknown') reason('referenceOnly', 'geographyUnknown', '対象地域が未確認です。');
    if (wave.administration === 'local') reason('referenceOnly', 'localAdministration', '独自実施の結果です。公式実施と同一条件であることを確認できないため参考表示です。');
    if ((wave.participants || []).some(p => p.grade === null)) reason('referenceOnly', 'participantGradeUnknown', '調査対象者の学年が未確認です。');
    else if (a.grade !== null && (wave.participants || []).some(p => p.grade !== a.grade)) reason('referenceOnly', 'participantGradeMismatch', '調査対象者の学年と比較先の対象学年が一致しません。');
    for (const [label, result] of [['学校', school], ['比較先', reference]]) {
      const count = result.denominator.count;
      if (count.status === 'observed' && count.value === 0) reason('referenceOnly', 'emptyDenominator', label + 'の分母は0人です。');
      if (count.status !== 'observed') notices.push({ code: 'countUnavailable', message: label + 'の対象人数は未掲載または欠測です。' });
      if (result.observationUnit === 'school' && result.geography.level === 'school') reason('referenceOnly', 'singleSchoolResponse', '学校質問の自校回答は、全国の学校割合との数値差を計算しません。');
    }
    if (school.type === 'distribution' && reference.type === 'distribution') {
      match(school.partition, reference.partition, 'partition', '分布の分母に対する集計方法');
      for (const result of [school, reference]) if (result.basis === 'count' && !result.values.some(v => v.publishedPercent?.status === 'observed') && (result.denominator.count.status !== 'observed' || result.denominator.count.value <= 0)) reason('referenceOnly', 'countDenominatorUnavailable', '人数から割合を求めるための正の分母がありません。');
    }
    if (school.type === 'crossTab' && reference.type === 'crossTab') {
      match(school.normalization, reference.normalization, 'normalization', 'クロス表の割合の分母');
      match(school.grouping.scope, reference.grouping.scope, 'groupingScope', '四分位を定義した母集団');
      match(school.grouping.definitionId, reference.grouping.definitionId, 'groupingDefinition', '四分位の定義');
      const groups = r => r.groups.map(g => [g.code, g.label]).sort((x, y) => x[0].localeCompare(y[0]));
      match(groups(school), groups(reference), 'groups', '四分位の層');
      const bounds = r => r.grouping.bands === null ? null : r.grouping.bands.map(g => [g.code, g.lower, g.upper, g.lowerInclusive, g.upperInclusive]).sort((x, y) => x[0].localeCompare(y[0]));
      match(bounds(school), bounds(reference), 'groupThresholds', '四分位の得点境界');
    }
    const answer = { status, reasons, notices, differences: null };
    if (status !== 'comparable') return answer;
    if (school.type === 'summary') {
      if (school.mean.status !== 'observed' || reference.mean.status !== 'observed') {
        answer.status = 'referenceOnly'; answer.reasons.push({ code: 'meanUnavailable', message: '平均が欠測のため差を計算しません。' }); return answer;
      }
      const difference = school.mean.value - reference.mean.value;
      if (!Number.isFinite(difference)) {
        answer.status = 'referenceOnly'; answer.reasons.push({ code: 'numericRange', message: '数値差が計算可能な範囲を超えるため差を表示しません。' }); return answer;
      }
      answer.differences = { type: 'summary', unit: a.scale.kind === 'percentCorrect' ? 'percentagePoint' : a.scale.unit,
        school: school.mean.value, reference: reference.mean.value, difference };
    } else if (school.type === 'distribution') {
      const rate = (r, v) => percentage(r.basis, v, r.denominator.count);
      const values = school.values.map(v => difference(v.code, rate(school, v), rate(reference, reference.values.find(r => r.code === v.code)), v.value.status, reference.values.find(r => r.code === v.code).value.status));
      answer.differences = { type: 'distribution', unit: 'percentagePoint', values };
    } else if (school.type === 'conditionalMean') {
      const subject = data.instruments.find(i => i.id === school.subjectInstrumentId);
      const values = school.values.map(v => { const other = reference.values.find(r => r.code === v.code); return difference(v.code, observedValue(v.mean), observedValue(other.mean), v.mean.status, other.mean.status); });
      answer.differences = { type: 'conditionalMean', unit: subject.scale.kind === 'percentCorrect' ? 'percentagePoint' : subject.scale.unit, values };
    } else {
      const rate = (r, row, v) => percentage(r.basis, v, r.normalization === 'row' ? row.count : r.normalization === 'column' ? r.groups.find(g => g.code === v.code).count : r.denominator.count);
      const rows = school.rows.map(row => {
        const otherRow = reference.rows.find(r => r.code === row.code);
        return { code: row.code, values: row.values.map(v => { const other = otherRow.values.find(c => c.code === v.code); return difference(v.code, rate(school, row, v), rate(reference, otherRow, other), v.value.status, other.value.status); }) };
      });
      answer.differences = { type: 'crossTab', unit: 'percentagePoint', normalization: school.normalization, rows };
    }
    const values = answer.differences.type === 'crossTab' ? answer.differences.rows.flatMap(r => r.values) : answer.differences.values;
    if (values && !values.some(v => v.difference !== null)) {
      answer.status = 'referenceOnly'; answer.reasons.push({ code: 'valuesUnavailable', message: '双方に比較できる値がないため差を計算しません。' }); answer.differences = null;
    }
    return answer;
  }
  return Object.freeze({ limits, statuses, empty, validate, compare, resultKey, isDefinitionCompletion });
});
