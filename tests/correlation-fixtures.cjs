'use strict';

function fixture(counts, label = '架空アンケート') {
  const students = [], scores = [], values = {};
  counts.forEach((row, i) => row.forEach((n, j) => {
    for (let k = 0; k < n; k++) {
      const id = 'fictional-' + (students.length + 1);
      students.push({ id, name: '架空生徒' + id, number: students.length + 1, className: '1年1組' });
      scores.push({ studentId: id, testId: 'fictional-test', total: j === 0 ? 30 : 90 });
      values[id] = i + 1;
    }
  }));
  return {
    version: 3,
    students, scores,
    tests: [{ id: 'fictional-test', name: '架空テスト', subject: '英語', maxScore: 100 }],
    metrics: [{ id: 'fictional-scale', label, type: 'scale', values }],
    interventions: [],
    settings: { rti: { tier2: 60, tier3: 40 }, adminPinHash: null },
  };
}

const noAxes = {
  ...fixture([[1]], '別の架空アンケート'),
  students: [{ id: 'new-fictional-1', name: '別の架空生徒', number: 1, className: '2年2組' }],
  metrics: [], tests: [], scores: [],
};

module.exports = { fixture, noAxes };
