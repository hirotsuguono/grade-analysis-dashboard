(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GD_CLASSIFICATION_EDITOR = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  function requireValue(condition, text) { if (!condition) throw new Error(text); }
  function text(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }
  function fingerprint(test) { return JSON.stringify(test); }
  function plan(test, domainRows, assignments) {
    requireValue(test && Array.isArray(test.questions) && test.questions.length, '問題ごとの配点がないため分類を編集できません。');
    requireValue(Array.isArray(domainRows) && Array.isArray(assignments), '分類の編集内容が不正です。');
    const domains = new Map(), labels = new Set();
    for (const d of domainRows) {
      requireValue(d && text(d.key) && text(d.label) && !domains.has(d.key), '分野の識別子・名前が空欄、または重複しています。');
      const label = d.label.trim();
      requireValue(!labels.has(label), '分野名が重複しています。同じ分野にまとめる場合は、問題の分野を選び直してください。');
      labels.add(label); domains.set(d.key, { key: d.key, label, max: 0 });
    }
    const existingKeys = new Set();
    for (const q of test.questions) {
      requireValue(q && text(q.key) && !existingKeys.has(q.key) && Number.isFinite(q.max) && q.max > 0, '元の問題の識別子・配点が不正です。');
      existingKeys.add(q.key);
    }
    requireValue(assignments.length === test.questions.length, '問題数が変わっています。編集画面を開き直してください。');
    const byKey = new Map();
    for (const a of assignments) {
      requireValue(a && text(a.key) && existingKeys.has(a.key) && !byKey.has(a.key), '問題の識別子が不正、または重複しています。');
      requireValue(typeof a.domain === 'string' && (!a.domain || domains.has(a.domain)), '問題の分野を一覧から選んでください。');
      requireValue(['', 'knowledge', 'thinking'].includes(a.perspective), '評価の観点は一覧から選んでください。');
      requireValue(Object.keys(a).every(key => ['key', 'domain', 'perspective'].includes(key)), '点数・問題名・配点はこの画面では変更できません。');
      byKey.set(a.key, a);
    }
    const oldDomains = new Map((test.domains || []).map(d => [d.key, d]));
    const changes = [];
    for (const d of domains.values()) {
      const old = oldDomains.get(d.key);
      if (old && old.label !== d.label) changes.push({ type: 'rename', key: d.key, before: old.label, after: d.label, count: test.questions.filter(q => q.domain === d.key).length });
    }
    const questions = test.questions.map(q => {
      const a = byKey.get(q.key);
      const next = { ...q };
      if (a.domain) { next.domain = a.domain; domains.get(a.domain).max += q.max; } else delete next.domain;
      if (a.perspective) next.perspective = a.perspective; else delete next.perspective;
      if ((q.domain || '') !== a.domain || (q.perspective || '') !== a.perspective) {
        changes.push({ type: 'assignment', key: q.key, label: q.label || q.key, max: q.max,
          beforeDomain: oldDomains.get(q.domain)?.label || q.domain || '未設定', afterDomain: domains.get(a.domain)?.label || '未設定',
          beforePerspective: q.perspective || '', afterPerspective: a.perspective });
      }
      return next;
    });
    return { nextTest: { ...test, questions, domains: [...domains.values()].filter(d => d.max > 0) }, changes };
  }
  function domainScores(rec, test) {
    const grouped = new Map();
    for (const q of test.questions || []) if (q.domain) {
      if (!grouped.has(q.domain)) grouped.set(q.domain, []);
      grouped.get(q.domain).push(q);
    }
    return Object.fromEntries([...grouped].filter(([, qs]) => qs.every(q => Object.hasOwn(rec.questions || {}, q.key) && Number.isFinite(rec.questions[q.key])))
      .map(([key, qs]) => [key, qs.reduce((sum, q) => sum + rec.questions[q.key], 0)]));
  }
  function checkSourceScores(dataset, test) {
    for (const rec of dataset.scores) if (rec.testId === test.id) {
      for (const [key, value] of Object.entries(rec.domains || {})) if (value != null) {
        const questions = test.questions.filter(q => q.domain === key);
        requireValue(questions.length && questions.every(q => Object.hasOwn(rec.questions || {}, q.key) && Number.isFinite(rec.questions[q.key])),
          '問題ごとの得点がない分野別記録があるため、分類を変更できません。元のExcelで小問または採点する内訳をご確認ください。');
      }
    }
  }
  function candidate(dataset, testId, prepared) {
    const test = dataset.tests.find(t => t.id === testId);
    requireValue(test, '対象のテストが見つかりません。');
    requireValue(prepared?.nextTest?.id === testId, '分類の反映先が不正です。');
    checkSourceScores(dataset, test);
    return { ...dataset, tests: dataset.tests.map(t => t.id === testId ? prepared.nextTest : t),
      scores: dataset.scores.map(rec => rec.testId === testId ? { ...rec, domains: domainScores(rec, prepared.nextTest) } : rec) };
  }
  return Object.freeze({ plan, candidate, fingerprint, checkSourceScores });
});
