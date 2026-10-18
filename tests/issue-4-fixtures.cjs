'use strict';

// Synthetic percentages; rows are classmates and columns are independent test terms.
module.exports = function progressDataset(classRates, subject = '英語', baseline = 60) {
  const tests = classRates[0].map((_, i) => ({
    id: `t${i}`, name: `架空第${i + 1}回`, subject: '英語', maxScore: 100, questions: [],
  }));
  const students = classRates.map((_, i) => ({
    id: `s${i}`, name: `架空生徒${i + 1}`, className: '架空A組', number: i + 1,
  }));
  return {
    version: 3, name: '架空の支援推移', tests, students,
    scores: classRates.flatMap((rates, s) => rates.flatMap((total, t) => total == null ? [] : [{
      studentId: students[s].id, testId: tests[t].id, total, questions: {}, domains: {},
    }])),
    metrics: [],
    interventions: [{
      id: 'iv', studentId: 's0', title: '架空の支援', subject, baseline,
      startDate: '2026-05-20', status: 'active', note: '',
    }],
    settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
  };
};
