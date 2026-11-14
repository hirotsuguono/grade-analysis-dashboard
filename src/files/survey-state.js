/* Pure survey transactions. Pending plans and undo tokens stay outside the saved dataset. */
(function (root, factory) {
  'use strict';
  const api = factory(typeof module === 'object' && module.exports ? require('./survey-core.js') : root.GD_SURVEY);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_SURVEY_STATE = api;
})(typeof window !== 'undefined' ? window : globalThis, function (core) {
  'use strict';
  const plans = new WeakSet(), undos = new WeakSet();
  const copy = v => JSON.parse(JSON.stringify(v));
  const canonical = v => JSON.stringify(v, function (_, value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value;
  });
  const requireValue = (condition, message) => { if (!condition) throw new Error(message); };
  const key = core.resultKey;
  function valid(data) { const errors = core.validate(data); requireValue(!errors.length, errors.join('\n')); return data; }
  function input(data) { return valid(data === undefined ? core.empty() : data); }
  function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
  function identifier(prefix) {
    const suffix = typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    return prefix + '-' + suffix;
  }
  function latest(wave) {
    const replaced = new Set(wave.results.map(r => r.supersedes).filter(Boolean));
    return wave.results.filter(r => !replaced.has(r.id));
  }
  function getLatest(data, waveId, selection) {
    data = input(data);
    const wave = data.waves.find(w => w.id === waveId);
    requireValue(wave, '調査回が見つかりません。');
    const values = latest(wave);
    return selection ? values.find(r => key(r) === key(selection)) || null : values;
  }
  function context(data, wave) {
    const { results, responseSets, ...definition } = wave;
    return canonical({ definition, instruments: data.instruments.filter(i => wave.instrumentIds.includes(i.id)),
      references: data.references.filter(r => wave.referenceIds.includes(r.id)) });
  }
  function comparableSource(source) { const { importedAt, ...rest } = source; return rest; }
  function sameSource(a, b) {
    if (a.kind === b.kind && a.fingerprint && b.fingerprint && canonical(a.fingerprint) === canonical(b.fingerprint) && canonical(a.reader) === canonical(b.reader)) return true;
    return canonical(comparableSource(a)) === canonical(comparableSource(b));
  }
  function rewrite(value, sourceMap, instrumentMap) {
    if (Array.isArray(value)) return value.map(v => rewrite(v, sourceMap, instrumentMap));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k,
      k === 'sourceId' ? sourceMap.get(v) || v : k === 'sourceIds' ? v.map(id => sourceMap.get(id) || id) :
        ['instrumentId', 'subjectInstrumentId'].includes(k) ? instrumentMap.get(v) || v : rewrite(v, sourceMap, instrumentMap)]));
  }
  function mergeReferences(data, candidate) {
    valid(candidate); requireValue(!candidate.waves.length, '公式取込候補には自校の調査回を含めないでください。');
    requireValue(candidate.sources.every(s => s.kind === 'official'), '公式取込候補の出典区分が不正です。');
    const next = copy(data), added = { sources: [], instruments: [], references: [] }, sourceMap = new Map(), instrumentMap = new Map();
    const instrumentIdentity = i => { const { id, sourceIds, ...rest } = i; return canonical(rest); };
    const referenceIdentity = r => { const { id, ...rest } = r; return canonical(rest); };
    const instrumentsById = new Map(next.instruments.map(i => [i.id, i])), instrumentIdentities = new Map(next.instruments.map(i => [instrumentIdentity(i), i]));
    const referencesById = new Map(next.references.map(r => [r.id, r])), referenceIdentities = new Map(next.references.map(r => [referenceIdentity(r), r]));
    for (const source of candidate.sources) {
      const existing = next.sources.find(s => s.id === source.id) || next.sources.find(s => source.fingerprint && sameSource(s, source));
      if (existing) { requireValue(sameSource(existing, source), '出典IDが既存の別の資料と衝突しています。修正版には新しいIDが必要です。'); sourceMap.set(source.id, existing.id); }
      else { next.sources.push(copy(source)); added.sources.push(source.id); sourceMap.set(source.id, source.id); }
    }
    for (const raw of candidate.instruments) {
      const instrument = rewrite(raw, sourceMap, instrumentMap), sameId = instrumentsById.get(instrument.id), identity = instrumentIdentity(instrument);
      const existing = sameId || instrumentIdentities.get(identity);
      if (sameId) requireValue(canonical(sameId) === canonical(instrument), '設問・尺度IDの内容が変わっています。過去の定義を更新せず新しい版のIDにしてください。');
      if (existing) instrumentMap.set(instrument.id, existing.id);
      else { next.instruments.push(instrument); instrumentsById.set(instrument.id, instrument); instrumentIdentities.set(identity, instrument); added.instruments.push(instrument.id); instrumentMap.set(instrument.id, instrument.id); }
    }
    for (const raw of candidate.references) {
      const reference = rewrite(raw, sourceMap, instrumentMap), sameId = referencesById.get(reference.id), identity = referenceIdentity(reference);
      const existing = sameId || referenceIdentities.get(identity);
      if (sameId) requireValue(canonical(sameId) === canonical(reference), '公式統計IDの内容が変わっています。訂正資料は新しい版として追加してください。');
      if (!existing) { next.references.push(reference); referencesById.set(reference.id, reference); referenceIdentities.set(identity, reference); added.references.push(reference.id); }
    }
    valid(next);
    return { surveys: next, added, summary: { added: added.references.length, updated: 0, unchanged: candidate.references.length - added.references.length, modeChanges: [] } };
  }
  function prepareReferences(data, candidate) {
    data = input(data); const merged = mergeReferences(data, candidate);
    const plan = freeze({ kind: 'references', candidate: copy(candidate), summary: merged.summary }); plans.add(plan); return plan;
  }
  function createWave(data, spec) {
    data = input(data);
    requireValue(spec && Array.isArray(spec.referenceIds) && spec.referenceIds.length, '比較対象を選んで調査回を作成してください。');
    requireValue(!data.waves.some(w => w.id === spec.id), '同じ調査回IDが既にあります。');
    const refs = spec.referenceIds.map(id => { const ref = data.references.find(r => r.id === id); requireValue(ref, '比較対象が見つかりません。'); return ref; });
    const wave = { id: spec.id, label: spec.label, administeredOn: spec.administeredOn, administration: spec.administration,
      instrumentIds: [...new Set(refs.flatMap(r => [r.instrumentId, r.subjectInstrumentId].filter(Boolean)))], referenceIds: [...spec.referenceIds], results: [],
      ownership: spec.ownership === undefined ? 'unknown' : spec.ownership, schoolLabel: spec.schoolLabel === undefined ? '自校' : spec.schoolLabel };
    if (Object.hasOwn(spec, 'participants')) wave.participants = copy(spec.participants);
    const next = { ...data, waves: [...data.waves, wave] }; valid(next);
    return { surveys: next, waveId: wave.id };
  }
  function payloadValue(r) {
    const { id, revision, supersedes, sourceId, responseSetId, ...value } = r;
    return canonical(value);
  }
  function setValue(set) { if (!set) return null; const { id, sourceId, ...value } = set; return canonical(value); }
  function prepareSchool(data, payload) {
    data = input(data);
    const wave = data.waves.find(w => w.id === payload?.waveId);
    requireValue(wave, '調査回が見つかりません。');
    requireValue(payload.source && ['schoolAggregate', 'schoolIndividual'].includes(payload.source.kind) && Array.isArray(payload.results) && payload.results.length, '学校の出典と入力結果が必要です。');
    valid({ ...core.empty(), sources: [payload.source] });
    requireValue((payload.source.kind === 'schoolIndividual') === !!payload.responseSet, '個票入力は個票版と結果を一緒に保存してください。');
    const source = copy(payload.source), existingSource = data.sources.find(s => s.id === source.id);
    if (existingSource) requireValue(sameSource(existingSource, source), '学校出典IDが別の資料と衝突しています。');
    const responseSet = payload.responseSet ? { ...copy(payload.responseSet), sourceId: source.id } : null;
    const seen = new Set(), scope = [], changes = [], modeChanges = [], current = latest(wave);
    let unchanged = 0;
    for (const raw of payload.results) {
      const previous = current.find(r => key(r) === key(raw)) || null;
      requireValue(!seen.has(key(raw)), '同じ統計が入力候補に重複しています。'); seen.add(key(raw));
      scope.push({ key: key(raw), before: previous ? copy(previous) : null });
      const result = { ...copy(raw), sourceId: source.id, revision: previous ? previous.revision + 1 : 1, supersedes: previous?.id || null };
      delete result.version; delete result.responseSetId;
      if (responseSet) result.responseSetId = responseSet.id;
      const previousMode = previous && data.sources.find(s => s.id === previous.sourceId)?.kind;
      const sameResponses = !responseSet || setValue((wave.responseSets || []).find(s => s.id === previous?.responseSetId)) === setValue(responseSet);
      if (previous && previousMode === source.kind && payloadValue(previous) === payloadValue(result) && sameResponses) { unchanged++; continue; }
      requireValue(!wave.results.some(r => r.id === result.id), '学校結果には新しい版のIDが必要です。');
      if (previous && previousMode !== source.kind) modeChanges.push({ key: key(raw), from: previousMode, to: source.kind });
      changes.push({ key: key(raw), before: previous ? copy(previous) : null, result });
    }
    const plan = { kind: 'school', waveId: wave.id, context: context(data, wave), source, responseSet, scope, changes,
      summary: { added: changes.filter(c => !c.before).length, updated: changes.filter(c => c.before).length, unchanged, modeChanges } };
    // Validate the entire candidate before showing a preview; no partial acceptance.
    schoolCandidate(data, plan, true);
    freeze(plan); plans.add(plan); return plan;
  }
  function schoolCandidate(data, plan, allowModeSwitch) {
    const wave = data.waves.find(w => w.id === plan.waveId);
    requireValue(wave && context(data, wave) === plan.context, '調査回・設問・対象者が変わっています。入力ファイルを読み直してください。');
    requireValue(allowModeSwitch || !plan.summary.modeChanges.length, '集計値と個票の採用元の切替を確認してください。');
    const current = latest(wave);
    for (const item of plan.scope) requireValue(canonical(current.find(r => key(r) === item.key) || null) === canonical(item.before), '入力対象の結果が後で変更されています。プレビューを作り直してください。');
    if (!plan.changes.length) return { surveys: data, addedSource: false, addedSet: false };
    const next = copy(data), target = next.waves.find(w => w.id === wave.id), oldSource = next.sources.find(s => s.id === plan.source.id);
    if (oldSource) requireValue(sameSource(oldSource, plan.source), '出典IDの内容が変わっています。');
    else next.sources.push(copy(plan.source));
    let addedSet = false;
    if (plan.responseSet) {
      target.responseSets ||= [];
      const previous = target.responseSets.find(s => s.id === plan.responseSet.id);
      if (previous) requireValue(canonical(previous) === canonical(plan.responseSet), '個票版のIDが衝突しています。');
      else { target.responseSets.push(copy(plan.responseSet)); addedSet = true; }
    }
    target.results.push(...plan.changes.map(c => copy(c.result))); valid(next);
    return { surveys: next, addedSource: !oldSource, addedSet };
  }
  function apply(data, plan, options = {}) {
    data = input(data); requireValue(plans.has(plan), 'この画面で作成した取込プレビューを使用してください。');
    let result, token;
    if (plan.kind === 'references') {
      result = mergeReferences(data, plan.candidate);
      token = { kind: 'references', added: Object.fromEntries(Object.entries(result.added).map(([k, ids]) => [k, result.surveys[k].filter(v => ids.includes(v.id))])) };
    } else {
      result = schoolCandidate(data, plan, options.allowModeSwitch === true);
      token = { kind: 'school', waveId: plan.waveId, context: plan.context, changes: plan.changes,
        addedSetId: result.addedSet ? plan.responseSet.id : null };
      result.summary = plan.summary;
    }
    freeze(token); undos.add(token);
    return { surveys: result.surveys, undo: token, summary: result.summary };
  }
  function undo(data, token) {
    data = input(data); requireValue(undos.has(token), 'この画面の取消対象が見つかりません。');
    const next = copy(data);
    if (token.kind === 'references') {
      for (const [collection, items] of Object.entries(token.added)) {
        for (const item of items) requireValue(canonical(next[collection].find(v => v.id === item.id)) === canonical(item), '取込後に資料が変更されたため取り消せません。');
        const ids = new Set(items.map(v => v.id)); next[collection] = next[collection].filter(v => !ids.has(v.id));
      }
    } else {
      const wave = next.waves.find(w => w.id === token.waveId);
      requireValue(wave && context(next, wave) === token.context, '調査回の定義が変わったため取り消せません。');
      const current = latest(wave);
      for (const change of token.changes) requireValue(canonical(current.find(r => key(r) === change.key)) === canonical(change.result), '取消対象の結果が後で変更されています。');
      for (const change of token.changes) {
        if (change.before) wave.results.push({ ...copy(change.before), id: identifier('survey-result'), revision: change.result.revision + 1, supersedes: change.result.id });
        else wave.results = wave.results.filter(r => r.id !== change.result.id);
      }
      if (token.addedSetId && !wave.results.some(r => r.responseSetId === token.addedSetId)) wave.responseSets = (wave.responseSets || []).filter(s => s.id !== token.addedSetId);
    }
    valid(next); undos.delete(token); return { surveys: next };
  }

  const observed = (value, decimals = 0) => ({ value, status: 'observed', decimals });
  const missing = (status = 'notProvided') => ({ value: null, status, decimals: null });
  function aggregateResponses(data, waveId, responseSet, options) {
    data = input(data);
    const wave = data.waves.find(w => w.id === waveId);
    requireValue(wave && wave.participants?.length, '個人別入力には調査時点の対象者が必要です。');
    const set = { ...copy(responseSet), sourceId: options.source.id };
    const check = copy(data), target = check.waves.find(w => w.id === waveId);
    if (!check.sources.some(s => s.id === options.source.id)) check.sources.push(copy(options.source));
    target.responseSets = [...(target.responseSets || []).filter(s => s.id !== set.id), set]; valid(check);
    const results = [], warnings = [], records = set.records.map(r => new Map(r.values.map(v => [v.instrumentId, v])));
    const unresolved = c => !c || ['unentered', 'notProvided', 'suppressed', 'unknown'].includes(c.status);
    const missingReason = cells => {
      const reasons = cells.filter(unresolved).map(c => c?.status || 'unentered');
      return reasons.includes('unentered') ? 'unentered' : reasons.length && new Set(reasons).size === 1 ? reasons[0] : 'unknown';
    };
    const questionCode = (cell, instrument) => cell?.status === 'observed' ? cell.value : instrument.options.filter(o => o.responseStatus === cell?.status).length === 1 ? instrument.options.find(o => o.responseStatus === cell.status).code : null;
    const mean = cells => {
      if (cells.some(unresolved)) return { count: missing(missingReason(cells)), mean: missing(missingReason(cells)), standardDeviation: missing() };
      const values = cells.filter(c => c.status === 'observed').map(c => c.value), n = values.length;
      const value = n ? values.reduce((sum, v) => sum + v / n, 0) : null;
      return { count: observed(n), mean: value !== null && Number.isFinite(value) ? observed(value, null) : missing(), standardDeviation: missing() };
    };
    for (const id of options.referenceIds || wave.referenceIds) {
      requireValue(wave.referenceIds.includes(id), 'この調査回に固定していない比較対象です。');
      const ref = data.references.find(r => r.id === id), instrument = data.instruments.find(i => i.id === ref.instrumentId);
      requireValue(instrument.respondent !== 'school', '生徒の個票で学校質問への回答を集計できません。');
      requireValue(set.instrumentIds.includes(ref.instrumentId) && (!ref.subjectInstrumentId || set.instrumentIds.includes(ref.subjectInstrumentId)), '個票の入力範囲と比較する統計が一致しません。');
      if (ref.type === 'crossTab') { warnings.push('四分位クロスは公表された境界と個人の層の対応を確認して入力してください。自動で学校四分位を代用しません。'); continue; }
      const result = { ...copy(ref), id: identifier('survey-result'), sourceId: options.source.id, revision: 1, supersedes: null, responseSetId: set.id,
        observationUnit: 'student', ownership: options.ownership || wave.ownership || 'unknown', geography: { level: 'school', code: wave.id, label: options.schoolLabel || wave.schoolLabel || '自校' }, notes: ['固定した調査対象者の個票から集計。未入力を無回答には変換していません。'] };
      delete result.version; delete result.total;
      if (ref.type === 'distribution') {
        const cells = records.map(r => r.get(instrument.id)), categories = instrument.scale.kind === 'irtBand' ? instrument.scale.bands : instrument.options;
        const code = c => {
          const value = instrument.kind === 'question' ? questionCode(c, instrument) : c.status === 'observed' ? String(c.value) : null;
          return categories.some(o => o.code === value) ? value : null;
        };
        const relevant = cells.filter(c => !['notApplicable', 'notAssigned', 'notParticipating'].includes(c.status));
        const incomplete = relevant.some(c => unresolved(c) || code(c) === null);
        result.basis = 'count'; result.partition = true;
        result.values = categories.map(o => ({ code: o.code, value: incomplete ? missing(missingReason(relevant)) : observed(relevant.filter(c => code(c) === o.code).length) }));
        result.denominator = { ...ref.denominator, count: incomplete ? missing(missingReason(relevant)) : observed(relevant.length) };
        if (ref.population.participation === 'joint' || !['questionParticipants', 'validResponses', 'subjectParticipants'].includes(ref.denominator.basis)) {
          result.population = { participation: 'unknown', definition: null };
          result.denominator = { ...result.denominator, basis: 'unknown', definition: null };
          result.notes.push('この入力範囲だけでは比較先の教科参加条件・分母を確認できません。');
        }
      } else if (ref.type === 'summary') {
        const summary = mean(records.map(r => r.get(instrument.id)));
        result.mean = summary.mean; result.standardDeviation = summary.standardDeviation; result.denominator = { ...ref.denominator, count: summary.count };
      } else {
        const subject = data.instruments.find(i => i.id === ref.subjectInstrumentId);
        requireValue(['percentCorrect', 'rawScore', 'irtScore'].includes(subject.scale.kind), 'バンドから平均を推定できません。');
        const questionCells = records.map(r => r.get(instrument.id)), unknownQuestion = questionCells.some(unresolved);
        result.values = instrument.options.map(o => ({ code: o.code, ...(unknownQuestion ? { count: missing(missingReason(questionCells)), mean: missing(missingReason(questionCells)), standardDeviation: missing() } :
          mean(records.filter(r => questionCode(r.get(instrument.id), instrument) === o.code).map(r => r.get(subject.id)))) }));
        const counts = result.values.map(v => v.count);
        result.denominator = { ...ref.denominator, count: counts.every(c => c.status === 'observed') ? observed(counts.reduce((n, c) => n + c.value, 0)) : missing(missingReason(counts)) };
      }
      if (!results.some(r => key(r) === key(result))) results.push(result);
    }
    return { results, warnings };
  }
  return Object.freeze({ prepareReferences, prepareSchool, apply, createWave, getLatest, undo, aggregateResponses });
});
