'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const scriptPath = path.join(process.env.DASHBOARD_ROOT || path.join(__dirname, '..', 'src', 'files'), 'paired-comparison.js');
const { pairedSummary, groupedSummary, holmAdjust } = require(scriptPath);
const thresholds = { tier2: 70, tier3: 40 };
const fields = ['n', 'beforeMean', 'afterMean', 'meanChange', 'sdChange', 'standardError', 't', 'df', 'p', 'ciLow', 'ciHigh', 'dz', 'status'];
const inference = ['t', 'p', 'ciLow', 'ciHigh', 'dz'];
const pairsFromChanges = changes => changes.map(change => [Math.max(0, -change), Math.max(0, change)]);

function close(actual, expected, label, relative = 2e-11) {
  assert.equal(typeof actual, 'number', label);
  assert.ok(Number.isFinite(actual), `${label}: finite result required`);
  // A relative-only tolerance makes a spurious zero fail for very small p/SD.
  assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected),
    `${label}: expected ${expected}, received ${actual}`);
}

function expectSummary(pairs, expected) {
  const actual = pairedSummary(pairs);
  assert.deepEqual(Object.keys(actual), fields);
  assert.equal(actual.status, 'ok');
  assert.equal(actual.n, pairs.length);
  assert.equal(actual.df, pairs.length - 1);
  for (const [field, value] of Object.entries(expected)) close(actual[field], value, field);
  return actual;
}

// Synthetic fixtures; independent expected values from SciPy 1.17.0:
// scipy.stats.ttest_rel(after, before, alternative='two-sided'),
// result.confidence_interval(confidence_level=0.95), and numpy.std(d, ddof=1).
// https://docs.scipy.org/doc/scipy-1.17.0/reference/generated/scipy.stats.ttest_rel.html
// df=1 is also checked against its exact Cauchy form, and tiny-scale fixtures
// use the same test on unit-scaled differences to avoid reference-side underflow.
const references = [
  {
    name: '自由度1の対応t検定と広い95%CI',
    pairs: [[10, 11], [20, 23]],
    expected: { beforeMean: 15, afterMean: 17, meanChange: 2,
      sdChange: 1.4142135623730951, standardError: 1, t: 2,
      p: 0.2951672353008665, ciLow: -10.706204736174694, ciHigh: 14.706204736174694,
      dz: 1.414213562373095 },
  },
  {
    name: '自由度2で増減が混在する対応t検定',
    pairs: [[50, 49], [50, 52], [50, 54]],
    expected: { beforeMean: 50, afterMean: 51.666666666666664, meanChange: 1.6666666666666667,
      sdChange: 2.516611478423583, standardError: 1.4529663145135578, t: 1.1470786693528088,
      p: 0.37005921165128797, ciLow: -4.584942812709108, ciHigh: 7.918276146042442,
      dz: 0.662266178532522 },
  },
  {
    name: '自由度5の対応t検定と同じ差のSDによるdz',
    pairs: [[10, 11], [20, 22], [30, 33], [40, 44], [50, 55], [60, 66]],
    expected: { beforeMean: 35, afterMean: 38.5, meanChange: 3.5,
      sdChange: 1.8708286933869707, standardError: 0.7637626158259734, t: 4.582575694955841,
      p: 0.005933544517592255, ciLow: 1.5366856930196764, ciHigh: 5.463314306980323,
      dz: 1.8708286933869707 },
  },
  {
    name: '0点を欠測にせず含める',
    pairs: [[0, 0], [0, 10]],
    expected: { beforeMean: 0, afterMean: 5, meanChange: 5,
      sdChange: 7.0710678118654755, standardError: 5, t: 1, p: 0.5000000000000001,
      ciLow: -58.531023680873474, ciHigh: 68.53102368087347, dz: 0.7071067811865475 },
  },
  {
    name: '平均差0でも差の分散があれば検定を計算する',
    pairs: [[1, 0], [0, 0], [0, 1]],
    expected: { beforeMean: 0.3333333333333333, afterMean: 0.3333333333333333, meanChange: 0,
      sdChange: 1, standardError: 0.5773502691896258, t: 0, p: 1,
      ciLow: -2.48413771175033, ciHigh: 2.48413771175033, dz: 0 },
  },
  {
    name: '自由度1の極小tとCauchyの厳密な両側確率',
    pairs: pairsFromChanges([-1, 1 + 2 ** -20]),
    expected: { meanChange: 4.76837158203125e-7, sdChange: 1.4142142367226713,
      standardError: 1.0000004768371582, t: 4.76836930829558e-7,
      p: 0.9999996964361816, ciLow: -12.706210318128093, ciHigh: 12.70621127180241,
      dz: 3.371746273097611e-7 },
  },
  {
    name: '自由度2の極小t',
    pairs: [[1, 0], [0, 1], [0, 2 ** -30]],
    expected: { meanChange: 3.104408582051595e-10, t: 5.376993391566218e-10,
      p: 0.9999999996197891, ciLow: -2.484137711439889, ciHigh: 2.484137712060771 },
  },
  {
    name: '自由度5の極小tで正負の差の桁落ちを避ける',
    pairs: pairsFromChanges([-3, -2, -1, 1, 2, 3].map(value => value + 2 ** -24)),
    expected: { meanChange: 5.960464477539063e-8, sdChange: 2.3664319132398464,
      standardError: 0.966091783079296, t: 6.16966688044984e-8, p: 0.9999999531590635,
      ciLow: -2.483417929536492, ciHigh: 2.4834180487457815, dz: 2.5187559566751616e-8 },
  },
  {
    name: '自由度9999でt分布と未補正95%CIを計算する',
    pairs: pairsFromChanges(Array.from({ length: 10000 }, (_, index) => index % 5 - 2 + 0.04)),
    expected: { beforeMean: 0.584, afterMean: 0.624, meanChange: 0.040000000000000036,
      sdChange: 1.4142842783549565, standardError: 0.014142842783549565, t: 2.828285699854245,
      p: 0.004689110146802766, ciLow: 0.012277181704487987, ciHigh: 0.06772281829551208,
      dz: 0.028282856998542445 },
  },
  {
    name: '1-CDFでは失われる約2e-201のp値を保持する',
    pairs: Array.from({ length: 200 }, (_, index) => [0, 9 + index % 2 * 2]),
    expected: { beforeMean: 0, afterMean: 10, meanChange: 10,
      sdChange: 1.002509414234171, standardError: 0.0708881205008336, t: 141.06735979665885,
      p: 2.1092609917595833e-201, ciLow: 9.860211706868675, ciHigh: 10.139788293131325,
      dz: 9.974968671630002 },
  },
  {
    name: '大きい自由度と約1.5e-152の裾確率',
    pairs: Array.from({ length: 1000 }, (_, index) => [0, index % 2]),
    expected: { meanChange: 0.5, sdChange: 0.5002501876563868, standardError: 0.015819299929208316,
      t: 31.60696125855822, p: 1.5404514447619099e-152, ciLow: 0.4689571318628091,
      ciHigh: 0.5310428681371909, dz: 0.999499874937461 },
  },
  {
    name: '小さい非ゼロ分散を固定閾値で定数扱いしない',
    pairs: Array.from({ length: 4 }, (_, index) => [0, 10 + index * 2 ** -40]),
    expected: { meanChange: 10.000000000001364, sdChange: 1.1741526111434774e-12,
      standardError: 5.870763055717387e-13, t: 17033560893353.75,
      p: 4.462255194205078e-40, ciLow: 9.999999999999496, ciHigh: 10.000000000003233,
      dz: 8516780446676.875 },
  },
  {
    name: '自由度5の非常に大きいtと小さい裾確率',
    pairs: Array.from({ length: 6 }, (_, index) => [0, 10 + index * 2 ** -20]),
    expected: { meanChange: 10.000002384185791, sdChange: 1.7841612752790171e-6,
      standardError: 7.283807905444845e-7, t: 13729085.821594112, p: 3.8913093945556447e-35,
      ciLow: 10.00000051182336, ciHigh: 10.000004256548221, dz: 5604875.816297456 },
  },
];

for (const reference of references) {
  test(reference.name, () => expectSummary(reference.pairs, reference.expected));
}

test('前後を入れ替えるとt・dz・CIの方向だけが反転する', () => {
  for (const { pairs } of references) {
    const positive = pairedSummary(pairs);
    const reversed = pairedSummary(pairs.map(([before, after]) => [after, before]));
    assert.equal(reversed.status, 'ok');
    close(reversed.p, positive.p, 'two-sided p');
    close(reversed.meanChange, -positive.meanChange, 'meanChange');
    close(reversed.t, -positive.t, 't');
    close(reversed.dz, -positive.dz, 'dz');
    close(reversed.ciLow, -positive.ciHigh, 'ciLow');
    close(reversed.ciHigh, -positive.ciLow, 'ciHigh');
  }
});

test('二乗がアンダーフローする微小な非ゼロ分散も尺度調整して計算する', () => {
  const scale = 2 ** -600;
  const result = expectSummary(Array.from({ length: 6 }, (_, index) => [0, (index + 1) * scale]), {
    beforeMean: 0, afterMean: 3.5 * scale, meanChange: 3.5 * scale,
    sdChange: 1.8708286933869707 * scale, standardError: 0.7637626158259734 * scale,
    t: 4.582575694955841, p: 0.005933544517592255,
    ciLow: 1.5366856930196764 * scale, ciHigh: 5.463314306980323 * scale,
    dz: 1.8708286933869707,
  });
  assert.ok(result.sdChange > 0);
  assert.equal(result.sdChange ** 2, 0);
});

test('相殺する大きい変化に混ざる小さい変化を順序に依存せず保持する', () => {
  for (const changes of [[1e-20, -100, 100], [-100, 1e-20, 100], [100, -100, 1e-20]]) {
    const result = expectSummary(pairsFromChanges(changes), {
      meanChange: 3.3333333333333333e-21, sdChange: 100, standardError: 57.73502691896258,
      t: 5.773502691896258e-23, p: 1, dz: 3.3333333333333333e-23,
      ciLow: -248.413771175033, ciHigh: 248.413771175033,
    });
    assert.equal(result.afterMean - result.beforeMean, 0);
    assert.ok(result.meanChange > 0);
  }
});

test('空の対応データは記述値・推測値ともnull', () => {
  assert.deepEqual(pairedSummary([]), { n: 0, beforeMean: null, afterMean: null, meanChange: null,
    sdChange: null, standardError: null, t: null, df: null, p: null,
    ciLow: null, ciHigh: null, dz: null, status: 'empty' });
});

test('1人だけの対応は平均値だけを返し推測しない', () => {
  assert.deepEqual(pairedSummary([[0, 100]]), { n: 1, beforeMean: 0, afterMean: 100, meanChange: 100,
    sdChange: null, standardError: null, t: null, df: null, p: null,
    ciLow: null, ciHigh: null, dz: null, status: 'insufficient' });
});

test('0・正・負の定数差にp=0/1や無限大の効果量を割り当てない', () => {
  for (const pairs of [[[0, 0], [100, 100]], [[0, 5], [10, 15], [95, 100]], [[5, 0], [15, 10]]]) {
    const result = pairedSummary(pairs);
    assert.equal(result.status, 'constant');
    assert.equal(result.sdChange, 0);
    assert.equal(result.standardError, 0);
    assert.equal(result.df, pairs.length - 1);
    assert.equal(result.meanChange, pairs[0][1] - pairs[0][0]);
    for (const key of inference) assert.equal(result[key], null, key);
  }
});

test('丸め精度以下のばらつきは尺度依存ガードで推測を止める', () => {
  for (const scale of [1, 2 ** -600]) {
    const result = pairedSummary([[0.1 * scale, 0.2 * scale], [0.2 * scale, 0.3 * scale]]);
    assert.equal(result.status, 'constant');
    assert.ok(result.sdChange > 0);
    assert.ok(result.standardError > 0);
    for (const key of inference) assert.equal(result[key], null, key);
  }
});

test('配列形状と有限な0〜100の数値を厳格に検証する', () => {
  const invalidShapes = [null, undefined, {}, '', [1, 2], [[1]], [[1, 2, 3]],
    [new Float64Array([1, 2])], new Array(1), [new Array(2)]];
  for (const pairs of invalidShapes) assert.throws(() => pairedSummary(pairs), TypeError);
  for (const invalid of [null, undefined, '', '0', false, true, [], {}, new Number(0),
    NaN, Infinity, -Infinity, -1, 100.0001, 0n, Symbol('score')]) {
    assert.throws(() => pairedSummary([[invalid, 50]]), TypeError);
    assert.throws(() => pairedSummary([[50, invalid]]), TypeError);
  }
  assert.doesNotThrow(() => pairedSummary([[0, 100], [100, 0], [0.25, 99.75]]));
});

test('Holm補正は順位ごとの積に累積最大を取り元の順序へ戻す', () => {
  assert.deepEqual(holmAdjust([0.01, 0.04, 0.03, 0.002]), [0.03, 0.06, 0.06, 0.008]);
  assert.deepEqual(holmAdjust([0.01, 0.01, 0.2, null]), [0.04, 0.04, 0.4, null]);
  assert.deepEqual(holmAdjust([0, 1, 0.6, 1]), [0, 1, 1, 1]);
});

test('未計算pをnullに保ち比較数には含めてHolm補正する', () => {
  assert.deepEqual(holmAdjust([0.01, null, 0.04, null]), [0.04, null, 0.12, null]);
  assert.deepEqual(holmAdjust([0.01, 0.04], 4), [0.04, 0.12]);
  assert.deepEqual(holmAdjust([null, null], 4), [null, null]);
  assert.deepEqual(holmAdjust([]), []);
});

test('Holm補正は不正なp値と比較数を拒否する', () => {
  for (const values of [null, {}, '', new Array(1), [undefined], ['0.01'], [false], [NaN],
    [Infinity], [-0.1], [1.01]]) assert.throws(() => holmAdjust(values), TypeError);
  for (const family of [-1, 0, 1.5, '4', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => holmAdjust([0.01], family), TypeError);
  }
  assert.throws(() => holmAdjust([0.01, null], 1), TypeError);
});

test('全体と比較元Tierの4比較を固定し原p・補正p・個別95%CIを返す', () => {
  const pairs = [[75, 76], [80, 82], [85, 89], [90, 98],
    [45, 48], [50, 54], [55, 60], [60, 66], [5, 3], [10, 10], [20, 22], [30, 38]];
  const actual = groupedSummary(pairs, thresholds);
  const expected = [
    { key: 'all', tier: null, n: 12, meanChange: 3.4166666666666665,
      p: 0.002610509218479542, pAdjusted: 0.010442036873918168,
      ciLow: 1.47321831020347, ciHigh: 5.360115023129863 },
    { key: 'tier1', tier: 1, n: 4, meanChange: 3.75,
      p: 0.09393995513578189, pAdjusted: 0.18787991027156378,
      ciLow: -1.1759430482302928, ciHigh: 8.675943048230293 },
    { key: 'tier2', tier: 2, n: 4, meanChange: 4.5,
      p: 0.006056848795908392, pAdjusted: 0.018170546387725176,
      ciLow: 2.4457397432394794, ciHigh: 6.554260256760521 },
    { key: 'tier3', tier: 3, n: 4, meanChange: 2,
      p: 0.4228262617721025, pAdjusted: 0.4228262617721025,
      ciLow: -4.8748697637166165, ciHigh: 8.874869763716617 },
  ];
  assert.equal(actual.length, 4);
  actual.forEach((summary, index) => {
    assert.equal(summary.status, 'ok');
    for (const [key, value] of Object.entries(expected[index])) {
      if (typeof value === 'number') close(summary[key], value, `${summary.key}.${key}`);
      else assert.equal(summary[key], value);
    }
  });
});

test('事後得点が閾値をまたいでも比較元Tierの所属を変えない', () => {
  const actual = groupedSummary([[0, 100], [39.999, 100], [40, 0], [69.999, 0], [70, 0], [100, 0]], thresholds);
  assert.deepEqual(actual.map(summary => summary.n), [6, 2, 2, 2]);
  close(actual[1].beforeMean, 85, 'Tier1 boundary');
  close(actual[2].beforeMean, 54.9995, 'Tier2 boundary');
  close(actual[3].beforeMean, 19.9995, 'Tier3 boundary');
  assert.deepEqual(actual.slice(1).map(summary => summary.afterMean), [0, 0, 100]);
});

test('空のTierがあっても全体とTierを含む固定4比較を維持する', () => {
  const groups = groupedSummary([[70, 80], [80, 91], [85, 97]], thresholds);
  assert.deepEqual(groups.map(group => group.n), [3, 3, 0, 0]);
  assert.ok(groups[0].p > 0 && groups[0].p < 0.25);
  close(groups[0].pAdjusted, groups[0].p * 4, 'overall adjusted p');
  close(groups[1].pAdjusted, groups[1].p * 4, 'tier adjusted p');
  for (const group of groups.slice(2)) {
    assert.equal(group.status, 'empty');
    assert.equal(group.pAdjusted, null);
  }
  const empty = groupedSummary([], thresholds);
  assert.deepEqual(empty.map(group => group.status), ['empty', 'empty', 'empty', 'empty']);
  assert.deepEqual(empty.map(group => group.pAdjusted), [null, null, null, null]);
});

test('Tier閾値とgroupedSummaryのペアも厳格に検証する', () => {
  for (const invalid of [null, undefined, [], {}, { tier2: 70, tier3: 0 }, { tier2: 100, tier3: 40 },
    { tier2: 40, tier3: 40 }, { tier2: 30, tier3: 40 }, { tier2: '70', tier3: 40 },
    { tier2: 70, tier3: '40' }, { tier2: NaN, tier3: 40 }, { tier2: 70, tier3: Infinity }]) {
    assert.throws(() => groupedSummary([], invalid), TypeError);
  }
  assert.throws(() => groupedSummary([[null, 100]], thresholds), TypeError);
});

test('入力配列・各ペア・閾値・p値を変更しない', () => {
  const pairs = Object.freeze([Object.freeze([0, 3]), Object.freeze([50, 51]), Object.freeze([90, 92])]);
  const cutoffs = Object.freeze({ ...thresholds });
  const probabilities = Object.freeze([0.04, null, 0.01]);
  assert.doesNotThrow(() => pairedSummary(pairs));
  assert.doesNotThrow(() => groupedSummary(pairs, cutoffs));
  assert.deepEqual(holmAdjust(probabilities, 4), [0.12, null, 0.04]);
  assert.deepEqual(pairs, [[0, 3], [50, 51], [90, 92]]);
});

test('外部依存なしのclassic scriptとCommonJSで同じ3関数を公開する', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const browser = { window: {} };
  vm.runInNewContext(source, browser);
  assert.deepEqual(Object.keys(browser.window.GD_PAIRED).sort(), ['groupedSummary', 'holmAdjust', 'pairedSummary']);
  const expected = pairedSummary([[0, 1], [0, 2], [0, 3]]);
  const actual = browser.window.GD_PAIRED.pairedSummary([[0, 1], [0, 2], [0, 3]]);
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
});
