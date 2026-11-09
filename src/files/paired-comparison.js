/* Paired changes are after minus before, in percentage points. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GD_PAIRED = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function validatePairs(pairs) {
    if (!Array.isArray(pairs)) throw new TypeError('Pairs must be an array.');
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!Array.isArray(pair) || pair.length !== 2) throw new TypeError('Each pair must contain two rates.');
      for (let j = 0; j < 2; j++) {
        if (typeof pair[j] !== 'number' || !Number.isFinite(pair[j]) || pair[j] < 0 || pair[j] > 100) {
          throw new TypeError('Rates must be finite numbers from 0 to 100.');
        }
      }
    }
  }

  // Neumaier summation preserves small terms when positive and negative changes cancel.
  function compensatedSum(length, valueAt) {
    let sum = 0, correction = 0;
    for (let i = 0; i < length; i++) {
      const value = valueAt(i), next = sum + value;
      correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
      sum = next;
    }
    return sum + correction;
  }

  // log B(a, 1/2), avoiding subtraction of two large log-gamma values.
  // Gamma recurrence and the Stirling series: https://dlmf.nist.gov/5.11.E1
  function logBetaHalf(a) {
    let recurrence = 0;
    while (a < 16) {
      recurrence += Math.log1p(0.5 / a);
      a += 1;
    }
    function correction(x) {
      const inverse = 1 / x, square = inverse * inverse;
      return inverse * (1 / 12 + square * (-1 / 360 + square * (1 / 1260
        + square * (-1 / 1680 + square * (1 / 1188 - square * 691 / 360360)))));
    }
    return recurrence + 0.5 * Math.log(Math.PI) - 0.5 * Math.log(a)
      - a * Math.log1p(0.5 / a) + 0.5 + correction(a) - correction(a + 0.5);
  }

  // Incomplete beta continued fraction, evaluated with the modified Lentz method.
  // Coefficients and symmetry: https://dlmf.nist.gov/8.17.E22 and 8.17.E4.
  function betaFraction(a, b, x) {
    const tiny = 1e-300;
    const protect = value => Math.abs(value) < tiny ? (value < 0 ? -tiny : tiny) : value;
    let c = 1, d = 1 / protect(1 - (a + b) * x / (a + 1)), result = d;
    for (let m = 1; m <= 10000; m++) {
      const twice = 2 * m;
      let coefficient = m * (b - m) * x / ((a + twice - 1) * (a + twice));
      d = 1 / protect(1 + coefficient * d);
      c = protect(1 + coefficient / c);
      result *= d * c;
      coefficient = -(a + m) * (a + b + m) * x / ((a + twice) * (a + twice + 1));
      d = 1 / protect(1 + coefficient * d);
      c = protect(1 + coefficient / c);
      const change = d * c;
      result *= change;
      if (Math.abs(change - 1) <= 4 * Number.EPSILON) return result;
    }
    throw new Error('Student t probability did not converge.');
  }

  // 2 * SF(|t|) = I_{df/(df+t*t)}(df/2, 1/2). Evaluate the small tail
  // directly, rather than subtracting a rounded CDF from one.
  // Distribution specification: https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.t.html
  function twoSidedP(t, df, logBeta) {
    const magnitude = Math.abs(t);
    if (magnitude === 0) return 1;
    if (df === 1) return 2 * Math.atan(1 / magnitude) / Math.PI;
    if (df === 2) {
      const hypotenuse = Math.hypot(magnitude, Math.SQRT2);
      return magnitude < 1 ? 1 - magnitude / hypotenuse
        : (2 / hypotenuse) / (hypotenuse + magnitude);
    }
    const ratio = magnitude / Math.sqrt(df), square = ratio * ratio;
    const x = 1 / (1 + square), complement = square / (1 + square);
    const a = df / 2, b = 0.5;
    const logX = -Math.log1p(square), logComplement = 2 * Math.log(ratio) - Math.log1p(square);
    const front = a * logX + b * logComplement - logBeta;
    let probability;
    // In the central region p >= 0.0026, the complementary form also avoids
    // rounding x to (almost) one at large df without losing a small tail.
    if (magnitude > 3 && x < (a + 1) / (a + b + 2)) {
      probability = Math.exp(front + Math.log(betaFraction(a, b, x)) - Math.log(a));
    } else {
      probability = 1 - Math.exp(front + Math.log(betaFraction(b, a, complement)) - Math.log(b));
    }
    return Math.max(0, Math.min(1, probability));
  }

  function critical95(df, logBeta) {
    // For every integer df >= 1, the 97.5th percentile is inside (0, 16).
    let low = 0, high = 16;
    for (let i = 0; i < 56; i++) {
      const middle = (low + high) / 2;
      if (middle === low || middle === high) break;
      if (twoSidedP(middle, df, logBeta) > 0.05) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function summarize(pairs) {
    const n = pairs.length;
    const summary = { n, beforeMean: null, afterMean: null, meanChange: null,
      sdChange: null, standardError: null, t: null, df: null, p: null,
      ciLow: null, ciHigh: null, dz: null, status: 'empty' };
    if (n === 0) return summary;

    const changes = new Array(n);
    for (let i = 0; i < n; i++) changes[i] = pairs[i][1] - pairs[i][0];
    // Rates are bounded by 100, so even the largest possible JS array cannot
    // overflow these sums. Summing before scaling preserves cancellation terms.
    const changeSum = compensatedSum(n, i => changes[i]);
    summary.beforeMean = compensatedSum(n, i => pairs[i][0]) / n;
    summary.afterMean = compensatedSum(n, i => pairs[i][1]) / n;
    summary.meanChange = changeSum / n;
    summary.status = 'insufficient';
    if (n === 1) return summary;

    summary.df = n - 1;
    // Center before squaring and scale before summing; tiny, nonzero spreads
    // must not disappear through cancellation or underflow in squared changes.
    const origin = changes[0];
    let spread = 0;
    for (const change of changes) spread = Math.max(spread, Math.abs(change - origin));
    summary.status = 'constant';
    summary.sdChange = 0;
    summary.standardError = 0;
    if (spread === 0) return summary;
    const centeredMean = compensatedSum(n, i => (changes[i] - origin) / spread) / n;
    const squared = compensatedSum(n, i => {
      const residual = (changes[i] - origin) / spread - centeredMean;
      return residual * residual;
    });
    const normalizedSd = Math.sqrt(squared / (n - 1)), rootN = Math.sqrt(n);
    const normalizedError = normalizedSd / rootN;
    const meanInSpreadUnits = (changeSum / spread) / n;
    summary.sdChange = spread * normalizedSd;
    summary.standardError = spread * normalizedError;
    // Match R's scale-relative "essentially constant" safeguard; there is no
    // fixed score/variance cutoff. https://stat.ethz.ch/R-manual/R-devel/library/stats/html/t.test.html
    if (normalizedError < 10 * Number.EPSILON * Math.abs(meanInSpreadUnits)
        || summary.standardError === 0) return summary;

    summary.dz = meanInSpreadUnits / normalizedSd;
    summary.t = meanInSpreadUnits / normalizedError;
    const logBeta = logBetaHalf(summary.df / 2);
    summary.p = twoSidedP(summary.t, summary.df, logBeta);
    const margin = spread * (critical95(summary.df, logBeta) * normalizedError);
    summary.ciLow = summary.meanChange - margin;
    summary.ciHigh = summary.meanChange + margin;
    summary.status = 'ok';
    return summary;
  }

  function pairedSummary(pairs) {
    validatePairs(pairs);
    return summarize(pairs);
  }

  function holmAdjust(pValues, familySize) {
    if (!Array.isArray(pValues)) throw new TypeError('P values must be an array.');
    if (familySize === undefined) familySize = pValues.length;
    if (!Number.isSafeInteger(familySize) || familySize < pValues.length) {
      throw new TypeError('Family size must be an integer at least as large as the input.');
    }
    const ranked = [], adjusted = new Array(pValues.length).fill(null);
    for (let i = 0; i < pValues.length; i++) {
      const p = pValues[i];
      if (p === null) continue;
      if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
        throw new TypeError('P values must be numbers from 0 to 1, or null.');
      }
      ranked.push({ p, index: i });
    }
    ranked.sort((left, right) => left.p - right.p);
    let runningMaximum = 0;
    for (let i = 0; i < ranked.length; i++) {
      runningMaximum = Math.max(runningMaximum, Math.min(1, (familySize - i) * ranked[i].p));
      adjusted[ranked[i].index] = runningMaximum;
    }
    return adjusted;
  }

  function groupedSummary(pairs, thresholds) {
    validatePairs(pairs);
    if (!thresholds || typeof thresholds !== 'object' || Array.isArray(thresholds)) {
      throw new TypeError('Tier thresholds are required.');
    }
    const { tier2, tier3 } = thresholds;
    if (typeof tier2 !== 'number' || typeof tier3 !== 'number'
        || !Number.isFinite(tier2) || !Number.isFinite(tier3)
        || !(0 < tier3 && tier3 < tier2 && tier2 < 100)) {
      throw new TypeError('Tier thresholds must satisfy 0 < tier3 < tier2 < 100.');
    }
    const groups = [pairs, [], [], []];
    for (const pair of pairs) groups[pair[0] < tier3 ? 3 : pair[0] < tier2 ? 2 : 1].push(pair);
    const summaries = groups.map((group, index) => ({ key: index === 0 ? 'all' : 'tier' + index,
      tier: index === 0 ? null : index, ...summarize(group) }));
    // The family always contains the overall comparison and three baseline tiers.
    // Unavailable tests remain null but do not shrink this family of four.
    const adjusted = holmAdjust(summaries.map(summary => summary.p), 4);
    return summaries.map((summary, index) => ({ ...summary, pAdjusted: adjusted[index] }));
  }

  return { pairedSummary, groupedSummary, holmAdjust };
});
