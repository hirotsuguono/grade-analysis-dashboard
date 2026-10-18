'use strict';

module.exports = function retainedAbsenceDataset() {
  const students = ['A', 'B', 'C'].map((name, i) => ({
    id: `retained-${name.toLowerCase()}`, name: `架空生徒${name}`, className: '架空組', number: i + 1,
  }));
  const tests = ['英語', '数学'].map((subject, i) => ({
    id: `retained-test-${i}`, name: '架空中間', subject, date: '2026-05-20', gradeYear: 1, maxScore: 100,
    domains: [{ key: 'd1', label: '架空分野', max: 100 }],
    questions: [{ key: 'q1', label: '架空設問', domain: 'd1', max: 100 }],
  }));
  const points = [[100, 0, 80], [60, 0, 40]];
  return {
    version: 3, name: '架空の保持得点JSON', students, tests,
    scores: tests.flatMap((test, i) => students.map((student, j) => ({
      studentId: student.id, testId: test.id, total: points[i][j],
      domains: { d1: points[i][j] }, questions: { q1: points[i][j] },
      ...(j === 0 ? { absent: true } : {}),
    }))),
    metrics: [], interventions: [], settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
  };
};
