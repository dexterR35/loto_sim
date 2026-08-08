/** Strategies that require ML predictions before picking numbers. */
export const ML_STRATEGIES = new Set(['ml_sklearn', 'ml_lstm', 'ml_blend', 'ml_rag']);

export function needsMlStrategy(strategy) {
  return ML_STRATEGIES.has(strategy);
}

export function isAbortError(err) {
  return err?.name === 'AbortError';
}
