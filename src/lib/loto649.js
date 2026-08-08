/** Loto 6/49 pricing & combination helpers (Romanian lottery simulator). */

export const LOTO_649_POOL = 49;
export const LOTO_649_PICK = 6;
export const LOTO_649_LINE_PRICE = 8;
export const LOTO_649_FORM_PRICE = 0.5;
export const LOTO_NOROC_PRICE = 5;
export const LOTO_NOROC_MAX_COUNT = 64000;

export const VARIANT_LABELS = ['A', 'B', 'C'];

export function combinations(n, k = LOTO_649_PICK) {
  if (k < 0 || n < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i += 1) {
    result = (result * (n - k + i)) / i;
  }
  return Math.round(result);
}

export function variantCost(count) {
  if (count < LOTO_649_PICK) return 0;
  const lines = combinations(count, LOTO_649_PICK);
  return lines * LOTO_649_LINE_PRICE;
}

export function formatRon(value) {
  return `${Number(value).toLocaleString('ro-RO', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })} ron`;
}

export function uniqueSortedNumbers(numbers = [], pool = LOTO_649_POOL, max = Number.POSITIVE_INFINITY) {
  const seen = new Set();
  const out = [];
  for (const value of numbers) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > pool || seen.has(number)) continue;
    seen.add(number);
    out.push(number);
    if (out.length >= max) break;
  }
  return out.sort((a, b) => a - b);
}

export function randomPick(pool = LOTO_649_POOL, count = LOTO_649_PICK, exclude = []) {
  const excluded = new Set(exclude.map(Number));
  const nums = Array.from({ length: pool }, (_, i) => i + 1).filter((num) => !excluded.has(num));
  const picked = [];
  while (picked.length < count && nums.length) {
    const idx = Math.floor(Math.random() * nums.length);
    picked.push(nums.splice(idx, 1)[0]);
  }
  return picked.sort((a, b) => a - b);
}

export function completePick(existing = [], candidateGroups = [], target = LOTO_649_PICK, pool = LOTO_649_POOL, max = 18) {
  const selected = uniqueSortedNumbers(existing, pool, max);
  if (selected.length >= target) return selected;

  const next = [...selected];
  const seen = new Set(next);
  const groups = Array.isArray(candidateGroups[0]) ? candidateGroups : [candidateGroups];
  for (const group of groups) {
    for (const value of group || []) {
      const number = Number(value);
      if (!Number.isInteger(number) || number < 1 || number > pool || seen.has(number)) continue;
      seen.add(number);
      next.push(number);
      if (next.length >= target || next.length >= max) return next.sort((a, b) => a - b);
    }
  }
  return next.sort((a, b) => a - b);
}

/** Random 7-digit Noroc number (0000000–9999999). */
export function randomNorocCode(length = 7) {
  return Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
}

export function slipHas649Variant(variants = []) {
  return variants.some((nums) => nums.length >= LOTO_649_PICK);
}

/** Noroc is only valid on slips with at least one complete 6/49 variant. */
export function syncSlipNoroc(slip) {
  if (!slipHas649Variant(slip.variants)) {
    return { ...slip, norocBase: null, norocCount: 1 };
  }
  if (!slip.norocBase) {
    return { ...slip, norocBase: randomNorocCode(7), norocCount: slip.norocCount || 1 };
  }
  return {
    ...slip,
    norocCount: Math.min(LOTO_NOROC_MAX_COUNT, Math.max(1, slip.norocCount || 1))
  };
}

/** Consecutive Noroc numbers starting from base (preview limited). */
export function norocInterval(base, count, previewLimit = 5) {
  if (!base || count < 1) return [];
  const start = BigInt(base);
  const limit = Math.min(count, previewLimit);
  return Array.from({ length: limit }, (_, i) => String(start + BigInt(i)).padStart(7, '0').slice(-7));
}

export function norocCost(norocBase, norocCount = 1) {
  if (!norocBase || norocCount < 1) return 0;
  return norocCount * LOTO_NOROC_PRICE;
}

/** Weighted sample of `count` unique numbers using ML blend probabilities. */
export function mlWeightedPick(predictions = [], count = LOTO_649_PICK, exclude = [], numberPool = LOTO_649_POOL) {
  const excluded = new Set(exclude.map(Number));
  const ranked = predictions
    .slice()
    .filter((item) => !excluded.has(Number(item.number)))
    .sort((a, b) => b.probability_blend - a.probability_blend);
  if (!ranked.length) return randomPick(numberPool, count, exclude);

  const picked = [];
  const available = [...ranked];
  while (picked.length < count && available.length) {
    const total = available.reduce((sum, item) => sum + (item.probability_blend || 0.001), 0);
    let target = Math.random() * total;
    let chosenIndex = available.length - 1;
    for (let i = 0; i < available.length; i += 1) {
      target -= available[i].probability_blend || 0.001;
      if (target <= 0) {
        chosenIndex = i;
        break;
      }
    }
    const chosen = available.splice(chosenIndex, 1)[0];
    picked.push(chosen.number);
  }
  return picked.sort((a, b) => a - b);
}

/** Pick 6/49 numbers for a simulator strategy (local fallback when API unavailable). */
export function pick649ByStrategy(strategy, predictions = [], count = LOTO_649_PICK, exclude = [], pool = LOTO_649_POOL) {
  if (strategy === 'random' || !predictions.length) return randomPick(pool, count, exclude);

  if (strategy === 'ml_sklearn') {
    const sorted = predictions
      .slice()
      .sort((a, b) => (b.probability_sklearn || 0) - (a.probability_sklearn || 0));
    return mlWeightedPick(sorted.map((p) => ({ ...p, probability_blend: p.probability_sklearn })), count, exclude, pool);
  }

  if (strategy === 'ml_lstm') {
    const sorted = predictions
      .slice()
      .filter((p) => p.probability_lstm != null)
      .sort((a, b) => (b.probability_lstm || 0) - (a.probability_lstm || 0));
    if (!sorted.length) return randomPick(pool, count, exclude);
    return mlWeightedPick(sorted.map((p) => ({ ...p, probability_blend: p.probability_lstm })), count, exclude, pool);
  }

  if (strategy === 'ml_rag') {
    return mlWeightedPick(
      predictions.map((p) => ({
        ...p,
        probability_blend: p.probability_final ?? p.probability_blend
      })),
      count,
      exclude,
      pool
    );
  }

  return mlWeightedPick(predictions, count, exclude, pool);
}

export function lineMlScore(numbers, predictions = []) {
  const byNumber = Object.fromEntries(predictions.map((p) => [p.number, p]));
  const probs = numbers.map((n) => byNumber[n]?.probability_blend).filter(Boolean);
  if (!probs.length) return null;
  const avg = probs.reduce((a, b) => a + b, 0) / probs.length;
  return { avg, score: Math.round(avg * 1000) / 10 };
}

export function totalSlipCost(variants, norocBase = null, norocCount = 1) {
  const variantTotal = variants.reduce((sum, nums) => sum + variantCost(nums.length), 0);
  const hasVariant = slipHas649Variant(variants);
  const formCost = hasVariant ? LOTO_649_FORM_PRICE : 0;
  const noroc = norocCost(norocBase, norocCount);
  return {
    variants: variantTotal,
    form: formCost,
    noroc,
    total: variantTotal + formCost + noroc
  };
}

/** One physical ticket slip: 3 variants (A,B,C) + optional Noroc interval. */
export function createEmptySlip() {
  return syncSlipNoroc({
    variants: VARIANT_LABELS.map(() => []),
    variantMeta: VARIANT_LABELS.map(() => null),
    norocBase: null,
    norocCount: 1
  });
}

export function createLocalSlip(pickFn, strategy = 'random') {
  const variants = VARIANT_LABELS.map(() => pickFn());
  return syncSlipNoroc({
    variants,
    variantMeta: variants.map((numbers) => ({ numbers, strategy, score: null })),
    norocBase: null,
    norocCount: 1
  });
}

/** Group flat API line tickets into full slips (3 lines + Noroc when eligible). */
export function groupLinesIntoSlips(lineTickets = [], slipCount = 1) {
  const slips = [];
  for (let i = 0; i < slipCount; i += 1) {
    const chunk = lineTickets.slice(i * 3, i * 3 + 3);
    slips.push(
      syncSlipNoroc({
        variants: VARIANT_LABELS.map((_, j) => chunk[j]?.numbers || []),
        variantMeta: VARIANT_LABELS.map((_, j) => chunk[j] || null),
        norocBase: null,
        norocCount: 1
      })
    );
  }
  return slips;
}

export function totalBatchCost(slips = []) {
  return slips.reduce(
    (acc, slip) => {
      const slipCost = totalSlipCost(slip.variants, slip.norocBase, slip.norocCount);
      return {
        variants: acc.variants + slipCost.variants,
        form: acc.form + slipCost.form,
        noroc: acc.noroc + slipCost.noroc,
        total: acc.total + slipCost.total,
        slipCount: acc.slipCount + (slipHas649Variant(slip.variants) ? 1 : 0)
      };
    },
    { variants: 0, form: 0, noroc: 0, total: 0, slipCount: 0 }
  );
}
