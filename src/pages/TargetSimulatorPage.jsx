import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  FlaskConical,
  Gauge,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Shuffle,
  Target
} from 'lucide-react';
import { NumberGridPicker } from '../components/lottery/NumberGridPicker';
import { NumberRow } from '../components/lottery';
import { Badge, LoadingBlock, Panel } from '../components/ui';
import { api } from '../lib/api';
import { formatEnglishDate, formatEnglishNumber } from '../lib/format';

const ATTEMPT_PRESETS = [
  { value: 100_000, label: '100K' },
  { value: 1_000_000, label: '1M' },
  { value: 5_000_000, label: '5M' },
  { value: 20_000_000, label: '20M' },
  { value: 100_000_000, label: '100M' }
];

const MODEL_OPTIONS = [
  { key: 'random', label: 'Uniform random', family: 'Baseline', defaultOn: true },
  { key: 'balanced', label: 'Balanced archive', family: 'Statistical', defaultOn: true },
  { key: 'hot', label: 'Hot numbers', family: 'Statistical', defaultOn: false },
  { key: 'cold', label: 'Cold numbers', family: 'Statistical', defaultOn: false },
  { key: 'overdue', label: 'Overdue numbers', family: 'Statistical', defaultOn: false },
  { key: 'monte_carlo', label: 'Monte Carlo weights', family: 'Simulation', defaultOn: true },
  { key: 'ml_sklearn', label: 'ML · sklearn', family: 'ML', defaultOn: true },
  { key: 'ml_lstm', label: 'ML · LSTM', family: 'ML', defaultOn: true },
  { key: 'ml_blend', label: 'ML blend', family: 'ML', defaultOn: true },
  { key: 'research_ensemble', label: 'Research ensemble', family: 'Ensemble', defaultOn: true }
];

const DEFAULT_MODELS = MODEL_OPTIONS.filter((model) => model.defaultOn).map((model) => model.key);
const MAX_ATTEMPTS = 1_000_000_000_000;

function parseTarget(value) {
  const raw = (String(value).match(/\d+/g) || []).map(Number);
  const unique = [...new Set(raw)];
  const valid = raw.length === 6
    && unique.length === 6
    && unique.every((number) => Number.isInteger(number) && number >= 1 && number <= 49);
  return {
    raw,
    numbers: unique.filter((number) => number >= 1 && number <= 49).sort((a, b) => a - b),
    valid
  };
}

function formatAttempts(value) {
  return value == null ? 'Never' : formatEnglishNumber(value);
}

function formatCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? formatEnglishNumber(number) : 'Unavailable';
}

function formatExpectedMatches(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  const maximumFractionDigits = number > 0 && number < 0.01 ? 4 : 2;
  return formatEnglishNumber(number, { maximumFractionDigits });
}

function formatChance(value) {
  const percent = Number(value) * 100;
  if (!Number.isFinite(percent)) return '—';
  if (percent > 0 && percent < 0.01) return `${percent.toFixed(4)}%`;
  return `${percent.toFixed(2)}%`;
}

function ResultCard({ result, attemptLimit }) {
  if (!result.available) {
    return (
      <article className="rounded-2xl border border-coral/25 bg-coral/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-black text-ink">{result.label}</div>
          <Badge tone="coral">Unavailable</Badge>
        </div>
        <p className="mt-4 text-xs leading-5 text-coral">{result.error}</p>
      </article>
    );
  }

  const firstHit = result.simulated_first_hit_attempt;
  const validationAuc = Number(
    result.details?.metrics?.roc_auc ?? result.details?.metrics?.val_auc
  );
  const hasValidationAuc = Number.isFinite(validationAuc);
  return (
    <article className={`grid gap-5 rounded-2xl border p-5 ${result.reached ? 'border-teal/30 bg-teal/5' : 'border-line bg-elevated'}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-ink">{result.label}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{result.family.replace('_', ' ')}</div>
        </div>
        <Badge tone={result.reached ? 'teal' : 'gold'}>{result.reached ? 'Seeded run hit' : 'No seeded hit'}</Badge>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-surface p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Model-expected appearances</div>
          <div className="mt-2 break-words text-3xl font-black tracking-[-0.04em] text-primary">{formatExpectedMatches(result.expected_hits_within_limit)}</div>
          <p className="mt-1 text-xs font-semibold text-muted">deterministic expectation across {formatAttempts(attemptLimit)} tickets</p>
        </div>
        <div className="rounded-2xl bg-surface p-4">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Seeded-run appearances</div>
          <div className="mt-2 break-words text-3xl font-black tracking-[-0.04em] text-ink">{formatCount(result.exact_hits_within_limit)}</div>
          <p className="mt-1 text-xs font-semibold text-muted">random observed count; changes with the seed</p>
        </div>
      </div>

      <div className="rounded-2xl bg-surface p-4">
        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Seeded random trial · first exact hit</div>
        <div className="mt-2 break-words text-2xl font-black tracking-[-0.04em] text-ink">{formatAttempts(firstHit)}</div>
        <p className="mt-1 text-xs font-semibold text-muted">
          {result.reached
            ? 'First occurrence inside the selected budget.'
            : 'No occurrence inside the selected budget.'}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-2xl bg-surface p-3">
          <div className="font-bold text-muted">Chance in budget</div>
          <div className="mt-1 text-base font-black text-ink">{formatChance(result.hit_probability_within_limit)}</div>
        </div>
        <div className="rounded-2xl bg-surface p-3">
          <div className="font-bold text-muted">Generator odds</div>
          <div className="mt-1 text-base font-black text-ink">1 in {formatAttempts(result.one_in)}</div>
        </div>
        <div className="rounded-2xl bg-surface p-3">
          <div className="font-bold text-muted">Expected first hit</div>
          <div className="mt-1 text-base font-black text-ink">{formatAttempts(result.expected_attempts)}</div>
        </div>
        <div className="rounded-2xl bg-surface p-3">
          <div className="font-bold text-muted">Observed / million</div>
          <div className="mt-1 text-base font-black text-ink">{formatEnglishNumber(result.exact_hits_per_million, { maximumFractionDigits: 3 })}</div>
        </div>
        <div className="rounded-2xl bg-surface p-3">
          <div className="font-bold text-muted">vs uniform generator</div>
          <div className="mt-1 text-base font-black text-ink">{Number(result.probability_uplift_vs_uniform).toFixed(2)}×</div>
        </div>
      </div>

      {hasValidationAuc ? (
        <div className="rounded-2xl border border-gold/20 bg-gold/5 p-4 text-xs leading-5 text-muted">
          <span className="font-black text-ink">Stored model validation AUC: {validationAuc.toFixed(4)}.</span>{' '}
          {Math.abs(validationAuc - 0.5) < 0.02
            ? 'That is approximately random discrimination; it is not evidence of reliable lottery prediction.'
            : 'Use the zero-leakage walk-forward backtest—not this seeded run—to judge predictive value.'}
        </div>
      ) : null}

      {result.top_numbers?.length ? (
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Highest-weight numbers</div>
          <div className="mt-3"><NumberRow values={result.top_numbers} size="sm" /></div>
          <div className="mt-2 text-xs font-semibold text-muted">Target average model rank: {result.target_average_rank}</div>
        </div>
      ) : null}

      <p className="border-t border-line pt-3 text-[11px] leading-5 text-muted">{result.description}</p>
    </article>
  );
}

export function TargetSimulatorPage({ game, onGameChange, onOpenBacktest, initialNumbers = [] }) {
  const initialTargetText = Array.isArray(initialNumbers) ? initialNumbers.join(' · ') : '';
  const [targetText, setTargetText] = useState(() => parseTarget(initialTargetText).valid ? initialTargetText : '');
  const [latestDraw, setLatestDraw] = useState(null);
  const [attemptLimit, setAttemptLimit] = useState(1_000_000);
  const [selectedModels, setSelectedModels] = useState(DEFAULT_MODELS);
  const [seed, setSeed] = useState('');
  const [result, setResult] = useState(null);
  const [loadingLatest, setLoadingLatest] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [backtestEvidence, setBacktestEvidence] = useState(null);
  const runAbortRef = useRef(null);
  const target = useMemo(() => parseTarget(targetText), [targetText]);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingLatest(true);
    api('/api/649/latest', { signal: controller.signal })
      .then((draw) => {
        const numbers = draw.drawn_numbers || draw.numbers || [];
        setLatestDraw(draw);
        if (!parseTarget(initialTargetText).valid) setTargetText(numbers.join(' · '));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoadingLatest(false));
    return () => controller.abort();
  }, []);

  useEffect(() => () => runAbortRef.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    api('/api/649/backtest', { signal: controller.signal })
      .then(setBacktestEvidence)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const walkForwardModel = backtestEvidence?.strategies?.sklearn_logistic_frozen;
  const randomComparison = backtestEvidence?.random_comparisons?.sklearn_logistic_frozen;
  const backtestPValue = Number(randomComparison?.empirical_p_value);

  const toggleTargetNumber = (number) => {
    const current = target.numbers;
    const next = current.includes(number)
      ? current.filter((value) => value !== number)
      : current.length < 6
        ? [...current, number].sort((a, b) => a - b)
        : current;
    setTargetText(next.join(' · '));
    setResult(null);
  };

  const useLatest = () => {
    const numbers = latestDraw?.drawn_numbers || latestDraw?.numbers || [];
    setTargetText(numbers.join(' · '));
    setResult(null);
  };

  const toggleModel = (key) => {
    setSelectedModels((current) => (
      current.includes(key)
        ? current.filter((model) => model !== key)
        : [...current, key]
    ));
    setResult(null);
  };

  const runSimulation = async () => {
    if (!target.valid || !selectedModels.length || running) return;
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;
    setRunning(true);
    setError('');
    setResult(null);
    try {
      const payload = await api('/api/649/target-simulation', {
        method: 'POST',
        body: JSON.stringify({
          numbers: target.raw,
          attempt_limit: Number(attemptLimit),
          models: selectedModels,
          seed: seed.trim() || null
        }),
        signal: controller.signal
      });
      const responseIsStale = (payload.results || []).some(
        (model) => model.available && model.exact_hits_within_limit == null
      );
      if (responseIsStale) {
        throw new Error('The Python API is still running an older simulator version. Restart npm run dev and try again.');
      }
      setResult(payload);
      setSeed(String(payload.seed));
    } catch (err) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      if (runAbortRef.current === controller) {
        runAbortRef.current = null;
        setRunning(false);
      }
    }
  };

  if (game !== '6din49') {
    return (
      <Panel title="Target simulator · Loto 6/49" icon={Target}>
        <div className="rounded-2xl border border-dashed border-line bg-elevated p-8 text-center">
          <BrainCircuit className="mx-auto text-primary" size={36} />
          <h2 className="mt-4 text-xl font-black text-ink">This experiment is built for Loto 6/49</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Switch to 6/49 to compare an exact six-number target against the random, statistical, sklearn, LSTM, and ensemble generators.</p>
          <button type="button" onClick={() => onGameChange('6din49')} className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-bold text-field hover:bg-primary-light">Switch to Loto 6/49</button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid gap-5">
      <header className="grid gap-6 rounded-2xl border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">Model weights + seeded generator</Badge>
            <Badge>Order does not matter</Badge>
          </div>
          <h2 className="mt-5 max-w-4xl text-3xl font-black leading-tight tracking-[-0.04em] text-ink sm:text-5xl">How often can each generator produce this exact 6/49 line?</h2>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-muted">Each model first produces 49 fixed weights. A seeded random generator then samples six-number tickets from those weights. This measures generator frequency—not future-draw prediction accuracy.</p>
        </div>
        {latestDraw ? (
          <div className="rounded-2xl bg-elevated p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">Latest official · {formatEnglishDate(latestDraw.draw_date_iso || latestDraw.draw_date)}</div>
            <div className="mt-3"><NumberRow values={latestDraw.drawn_numbers || latestDraw.numbers || []} size="sm" /></div>
          </div>
        ) : null}
      </header>

      <Panel
        title="Prediction vs generation"
        icon={BrainCircuit}
        action={onOpenBacktest ? (
          <button type="button" onClick={onOpenBacktest} className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-xs font-bold text-field hover:bg-primary-light">
            <FlaskConical size={14} /> Open real ML backtest
          </button>
        ) : null}
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="rounded-2xl bg-elevated p-4">
            <div className="text-xs font-black text-ink">1 · ML inference</div>
            <p className="mt-2 text-xs leading-5 text-muted">sklearn and LSTM run against the current history and output number weights. They do not predict an attempt index.</p>
          </div>
          <div className="rounded-2xl bg-elevated p-4">
            <div className="text-xs font-black text-ink">2 · Generator simulation</div>
            <p className="mt-2 text-xs leading-5 text-muted">Python uses those frozen weights to sample independent tickets. The observed count and first hit are random; the expected count is the stable model result.</p>
          </div>
          <div className="rounded-2xl bg-elevated p-4">
            <div className="text-xs font-black text-ink">3 · Real predictive evidence</div>
            {walkForwardModel && randomComparison ? (
              <p className="mt-2 text-xs leading-5 text-muted">
                On {formatEnglishNumber(backtestEvidence.evaluated_draws)} unseen historical draws, frozen sklearn averaged <span className="font-black text-ink">{Number(walkForwardModel.hits_at_6).toFixed(3)}</span> top-6 hits versus <span className="font-black text-ink">{Number(randomComparison.random_mean).toFixed(3)}</span> for random. p={Number.isFinite(backtestPValue) ? backtestPValue.toFixed(4) : '—'}; {backtestPValue < 0.05 ? 'the stored test crossed the 5% threshold.' : 'no confirmed edge at the 5% threshold.'}
              </p>
            ) : (
              <p className="mt-2 text-xs leading-5 text-muted">Open the walk-forward report to evaluate predictions made only from data available before each draw.</p>
            )}
          </div>
        </div>
      </Panel>

      {error ? (
        <div className="rounded-2xl border border-coral/25 bg-coral/5 px-5 py-4 text-sm font-bold text-coral">{error}</div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(24rem,.9fr)]">
        <Panel
          title="1 · Target extraction"
          icon={Target}
          action={
            <button type="button" onClick={useLatest} disabled={!latestDraw || running} className="inline-flex items-center gap-2 rounded-full bg-elevated px-3 py-2 text-xs font-bold text-ink hover:text-primary disabled:opacity-40">
              <RefreshCw size={14} /> Use latest
            </button>
          }
        >
          {loadingLatest ? <LoadingBlock rows={5} /> : (
            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="text-xs font-bold text-muted">Paste six numbers with dots, commas, or spaces</span>
                <input
                  value={targetText}
                  onChange={(event) => {
                    setTargetText(event.target.value);
                    setResult(null);
                  }}
                  disabled={running}
                  placeholder="2 · 5 · 12 · 20 · 24 · 40"
                  className={`w-full rounded-2xl border bg-field px-4 py-3 text-base font-black tabular-nums text-ink ${target.valid ? 'border-line focus:border-primary' : 'border-coral/40'}`}
                />
              </label>
              <NumberGridPicker
                label="target"
                selected={target.numbers}
                onToggle={toggleTargetNumber}
                disabled={running}
                maxPick={6}
                minPick={6}
                pool={49}
                columns={7}
                showQuickPick={false}
                compact
              />
              <div className={`rounded-2xl px-4 py-3 text-xs font-bold ${target.valid ? 'bg-teal/10 text-teal' : 'bg-coral/10 text-coral'}`}>
                {target.valid ? 'Valid target · exact unordered combination' : 'Enter exactly six different numbers from 1 to 49.'}
              </div>
            </div>
          )}
        </Panel>

        <Panel title="2 · Experiment setup" icon={Gauge}>
          <div className="grid gap-5">
            <div>
              <div className="text-xs font-bold text-muted">Generated-ticket budget</div>
              <p className="mt-1 text-[11px] leading-5 text-muted">Every selected model receives this many independent six-number ticket attempts.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {ATTEMPT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    disabled={running}
                    onClick={() => {
                      setAttemptLimit(preset.value);
                      setResult(null);
                    }}
                    className={`rounded-full px-3.5 py-2 text-xs font-black ${Number(attemptLimit) === preset.value ? 'bg-primary text-field' : 'bg-elevated text-muted hover:text-ink'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                max={MAX_ATTEMPTS}
                step="1"
                value={attemptLimit}
                disabled={running}
                onChange={(event) => {
                  setAttemptLimit(Math.min(MAX_ATTEMPTS, Math.max(1, Number(event.target.value) || 1)));
                  setResult(null);
                }}
                className="mt-3 w-full rounded-2xl border border-line bg-field px-4 py-3 text-sm font-black tabular-nums text-ink"
              />
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-muted">Generators and models</div>
                <div className="flex gap-2">
                  <button type="button" disabled={running} onClick={() => setSelectedModels(MODEL_OPTIONS.map((model) => model.key))} className="text-[10px] font-black uppercase text-primary">All</button>
                  <button type="button" disabled={running} onClick={() => setSelectedModels([])} className="text-[10px] font-black uppercase text-muted">Clear</button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {MODEL_OPTIONS.map((model) => {
                  const active = selectedModels.includes(model.key);
                  return (
                    <button
                      key={model.key}
                      type="button"
                      aria-pressed={active}
                      disabled={running}
                      onClick={() => toggleModel(model.key)}
                      className={`rounded-2xl border px-3 py-3 text-left transition-colors ${active ? 'border-primary/40 bg-primary/10' : 'border-line bg-elevated opacity-65 hover:opacity-100'}`}
                    >
                      <div className={`text-xs font-black ${active ? 'text-primary' : 'text-ink'}`}>{model.label}</div>
                      <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-muted">{model.family}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="grid gap-2">
              <span className="text-xs font-bold text-muted">Seed <span className="font-medium">(optional; returned after every run)</span></span>
              <input
                inputMode="numeric"
                value={seed}
                disabled={running}
                onChange={(event) => setSeed(event.target.value.replace(/\D/g, ''))}
                placeholder="Automatic random seed"
                className="w-full rounded-2xl border border-line bg-field px-4 py-3 text-sm font-bold tabular-nums text-ink"
              />
            </label>

            <button
              type="button"
              onClick={runSimulation}
              disabled={running || !target.valid || !selectedModels.length}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-black text-field transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? <Loader2 className="animate-spin" size={18} /> : <Shuffle size={18} />}
              {running ? 'Loading models and simulating…' : 'Simulate target frequency'}
            </button>
          </div>
        </Panel>
      </div>

      {running ? (
        <Panel title="Running selected models" icon={BrainCircuit} action={<Badge tone="gold">Working</Badge>}>
          <LoadingBlock rows={5} />
          <p className="mt-4 text-xs leading-5 text-muted">The trained ML artifacts may take a little longer on their first load. Misses are skipped through exact first-hit and hit-count distributions, so millions of ticket generations remain responsive.</p>
        </Panel>
      ) : null}

      {result ? (
        <section className="grid gap-5">
          <Panel
            title="Experiment result"
            icon={ShieldCheck}
            action={<Badge tone={result.target_matches_latest_draw ? 'teal' : 'default'}>{result.target_matches_latest_draw ? 'Latest official target' : 'Custom target'}</Badge>}
          >
            <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:items-center">
              <NumberRow values={result.target_numbers} size="lg" gap="gap-3" />
              <div className="grid gap-2 text-xs text-muted sm:grid-cols-3">
                <div className="rounded-2xl bg-elevated p-3"><span className="font-bold">Seed</span><div className="mt-1 break-all font-black text-ink">{result.seed}</div></div>
                <div className="rounded-2xl bg-elevated p-3"><span className="font-bold">Data through</span><div className="mt-1 font-black text-ink">{formatEnglishDate(result.history_end_date)}</div></div>
                <div className="rounded-2xl bg-elevated p-3"><span className="font-bold">Uniform space</span><div className="mt-1 font-black text-ink">{formatAttempts(result.uniform_baseline.combinations)} lines</div></div>
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">The target is compared only after each current model distribution is frozen; it is not supplied as a hint when weights are calculated. Reusing the same seed reproduces the frequency and first-hit trials.</p>
          </Panel>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.results.map((modelResult) => (
              <ResultCard key={modelResult.key} result={modelResult} attemptLimit={result.attempt_limit} />
            ))}
          </div>

          <div className="rounded-2xl border border-gold/25 bg-gold/5 p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-gold" size={20} />
              <div>
                <div className="text-sm font-black text-ink">How to read this</div>
                <p className="mt-2 text-xs leading-5 text-muted">
                  {result.method.description} These are generator probabilities, not improved physical-lottery odds. {result.target_matches_latest_draw ? 'Because the latest draw is already present in the current dataset, this is a recreation experiment—not a pre-draw backtest. ' : ''}
                  {result.disclaimer}
                </p>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
