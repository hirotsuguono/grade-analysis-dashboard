/* Independent classifications of the same scored items. Scores are stored once. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_CLASSIFICATION = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const perspectives = Object.freeze([
    Object.freeze({ key: 'knowledge', label: '知識・技能' }),
    Object.freeze({ key: 'thinking', label: '思考・判断・表現' }),
    Object.freeze({ key: '', label: '未設定' }),
  ]);
  const validPerspective = value => value == null || perspectives.some(p => p.key === value);
  const perspectiveLabel = value => perspectives.find(p => p.key === (value || ''))?.label || '未設定';
  function groups(test, axis = 'domain') {
    const questions = Array.isArray(test?.questions) ? test.questions : [];
    if (axis === 'perspective') return perspectives.map(p => {
      const items = questions.filter(q => (q.perspective || '') === p.key);
      return { ...p, questions: items, max: items.reduce((sum, q) => sum + q.max, 0) };
    }).filter(p => p.questions.length);
    const labels = new Map((test?.domains || []).map(d => [d.key, d.label]));
    const result = new Map();
    for (const q of questions) {
      const key = q.domain || '';
      if (!result.has(key)) result.set(key, { key, label: labels.get(key) || key || '未設定', questions: [], max: 0 });
      const group = result.get(key); group.questions.push(q); group.max += q.max;
    }
    return [...result.values()];
  }
  function score(rec, group) {
    if (!rec || rec.absent || !group.questions.length) return null;
    let total = 0;
    for (const q of group.questions) {
      if (!Object.hasOwn(rec.questions || {}, q.key)) return null;
      const value = rec.questions[q.key];
      if (!Number.isFinite(value) || value < 0 || value > q.max) return null;
      total += value;
    }
    return total;
  }
  function summarize(test, records, axis) {
    return groups(test, axis).map(group => {
      const values = records.map(rec => score(rec, group)).filter(v => v != null);
      return { key: group.key, label: group.label, max: group.max, count: group.questions.length, n: values.length,
        rate: values.length && group.max > 0 ? values.reduce((sum, v) => sum + v / group.max * 100, 0) / values.length : null };
    });
  }
  return Object.freeze({ perspectives, validPerspective, perspectiveLabel, groups, score, summarize });
});
