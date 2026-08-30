import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BrainCircuit,
  FlaskConical,
  Loader2,
  ShieldCheck,
  Shuffle,
  Target
} from 'lucide-react';
import { NumberPill, NumberRow } from '../components/lottery';
import { ModelCompareChart } from '../components/charts';
import { TicketPickSection } from '../components/lottery/Loto649TicketUI';
import { TicketPasteField, TicketStatus } from '../components/lottery/Ticket';
import { Badge, ChoiceChip, Chip, LoadingBlock, MetricCard, MetricGrid, Panel } from '../components/ui';
import { api } from '../lib/api';
import { modelChartData } from '../lib/activity';
import { formatEnglishDate, formatEnglishNumber } from '../lib/format';
import { completePick, randomPick } from '../lib/loto649';

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

function ResultCard({ result, attemptLimit, targetNumbers = [] }) {
  if (!result.available) {
    return (
      <MetricCard className="metric-card--warn" label={result.family.replace('_', ' ')} value={result.label} detail={result.error} />
    );
  }

  const validationAuc = Number(
    result.details?.metrics?.roc_auc ?? result.details?.metrics?.val_auc
  );
  const hasValidationAuc = Number.isFinite(validationAuc);

  return (
    <MetricCard
      className={result.reached ? 'metric-card--ok' : ''}
      label={result.family.replace('_', ' ')}
      value={formatExpectedMatches(result.expected_hits_within_limit)}
      detail={`${result.label} · expected in ${formatAttempts(attemptLimit)}`}
    >
      <div className="choice-row">
        <Chip active={result.reached}>{result.reached ? 'Hit' : 'Miss'}</Chip>
        <Chip>{formatCount(result.exact_hits_within_limit)} seeded</Chip>
        <Chip>{formatChance(result.hit_probability_within_limit)}</Chip>
        <Chip>1 in {formatAttempts(result.one_in)}</Chip>
        <Chip>{formatAttempts(result.simulated_first_hit_attempt)} first</Chip>
        <Chip>{formatAttempts(result.expected_attempts)} expected</Chip>
        <Chip>{formatEnglishNumber(result.exact_hits_per_million, { maximumFractionDigits: 3 })} / M</Chip>
        <Chip>{Number(result.probability_uplift_vs_uniform).toFixed(2)}× vs uniform</Chip>
      </div>
      {hasValidationAuc ? (
        <span>
          AUC {validationAuc.toFixed(4)}. {Math.abs(validationAuc - 0.5) < 0.02
            ? 'Near-random discrimination, not a jackpot edge.'
            : 'Judge models on the walk-forward backtest, not this seeded run.'}
        </span>
      ) : null}
      {result.top_numbers?.length ? (
        <div>
          <div className="ticket-balls">
            {result.top_numbers.map((number) => (
              <NumberPill
                key={number}
                value={number}
                size="sm"
                tone={targetNumbers.includes(number) ? 'primary' : 'default'}
              />
            ))}
          </div>
          <span>Rank {result.target_average_rank}</span>
        </div>
      ) : null}
      <span>{result.description}</span>
    </MetricCard>
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

  const applyTargetNumbers = (numbers) => {
    setTargetText(numbers.join(' · '));
    setResult(null);
  };

  const toggleTargetNumber = (number) => {
    const current = target.numbers;
    const next = current.includes(number)
      ? current.filter((value) => value !== number)
      : current.length < 6
        ? [...current, number].sort((a, b) => a - b)
        : current;
    applyTargetNumbers(next);
  };

  const useLatest = () => {
    applyTargetNumbers(latestDraw?.drawn_numbers || latestDraw?.numbers || []);
  };

  const clearTarget = () => applyTargetNumbers([]);

  const generateTarget = () => {
    if (running) return;
    if (target.numbers.length >= 6) {
      applyTargetNumbers(randomPick(49, 6));
      return;
    }
    applyTargetNumbers(completePick(target.numbers, [randomPick(49, 6, target.numbers)], 6, 49, 6));
  };

  const quickPickTarget = (digit) => {
    if (running) return;
    if (digit === 0) {
      applyTargetNumbers([]);
      return;
    }
    const count = Math.min(6, Math.max(1, Number(digit) || 6));
    applyTargetNumbers(completePick(target.numbers, [randomPick(49, count, target.numbers)], count, 49, 6));
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
    <article className="page-stack">
      <header className="chart-card chart-card__head--row lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <section>
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone="teal">Generator frequency</Badge>
            <Badge>Order does not matter</Badge>
          </p>
          <h2 className="mt-2 text-lg font-bold tracking-[-0.03em] text-ink">Target simulator</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Compare how often each generator can produce this exact 6/49 line. Ticket numbers carry over from Generate.</p>
        </section>
        {latestDraw ? (
          <MetricCard label="Latest official" value={formatEnglishDate(latestDraw.draw_date_iso || latestDraw.draw_date)}>
            <NumberRow values={latestDraw.drawn_numbers || latestDraw.numbers || []} size="sm" tone="primary" />
          </MetricCard>
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
        <MetricGrid>
          <MetricCard label="1 · ML inference" value="Weights" detail="sklearn and LSTM score numbers. They do not pick an attempt index." />
          <MetricCard label="2 · Generator simulation" value="Tickets" detail="Frozen weights sample independent lines. Expected count is stable; seeded hits vary." />
          <MetricCard
            label="3 · Walk-forward"
            value={walkForwardModel ? Number(walkForwardModel.hits_at_6).toFixed(3) : 'Open report'}
            detail={walkForwardModel && randomComparison
              ? `${formatEnglishNumber(backtestEvidence.evaluated_draws)} draws · random ${Number(randomComparison.random_mean).toFixed(3)} · p ${Number.isFinite(backtestPValue) ? backtestPValue.toFixed(4) : '—'}`
              : 'Evaluate predictions made only from data available before each draw.'}
          />
        </MetricGrid>
      </Panel>

      {error ? (
        <div className="rounded-2xl border border-coral/25 bg-coral/5 px-5 py-4 text-sm font-bold text-coral">{error}</div>
      ) : null}

      <section className="dash-extra dash-extra--split">
        {loadingLatest ? (
          <div className="ticket-stack"><LoadingBlock rows={8} /></div>
        ) : (
          <div className="ticket-stack">
            <TicketPickSection
              label="A"
              numbers={target.numbers}
              pool={49}
              pick={6}
              maxPick={6}
              onToggle={toggleTargetNumber}
              onQuickPick={quickPickTarget}
              onClear={clearTarget}
              onGenerate={generateTarget}
              disabled={running}
              showCost={false}
              footerExtra={
                <>
                  <TicketStatus ok={target.valid}>
                    {target.valid ? 'Valid target · exact unordered combination' : 'Enter exactly six different numbers from 1 to 49.'}
                  </TicketStatus>
                  <TicketPasteField
                    value={targetText}
                    onChange={(event) => {
                      setTargetText(event.target.value);
                      setResult(null);
                    }}
                    disabled={running}
                    valid={target.valid}
                    onUseLatest={useLatest}
                    latestDisabled={!latestDraw}
                  />
                </>
              }
            />
          </div>
        )}

        <section className="chart-card">
          <header className="chart-card__head">
            <h2>Experiment setup</h2>
            <p>Budget, seed, and which generators to run.</p>
          </header>
          <div className="grid gap-4">
            <MetricGrid wide>
              <MetricCard label="Ticket budget" value={formatAttempts(attemptLimit)} detail="Independent attempts per selected model">
                <div className="choice-row">
                  {ATTEMPT_PRESETS.map((preset) => (
                    <ChoiceChip
                      key={preset.value}
                      disabled={running}
                      active={Number(attemptLimit) === preset.value}
                      onClick={() => {
                        setAttemptLimit(preset.value);
                        setResult(null);
                      }}
                    >
                      {preset.label}
                    </ChoiceChip>
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
                  className="w-full rounded-full border border-line bg-field px-3 py-2 text-sm font-bold tabular-nums text-ink"
                />
              </MetricCard>

              <MetricCard label="Seed" value={seed || 'Auto'} detail="Optional; returned after every run">
                <input
                  inputMode="numeric"
                  value={seed}
                  disabled={running}
                  onChange={(event) => setSeed(event.target.value.replace(/\D/g, ''))}
                  placeholder="Automatic random seed"
                  className="w-full rounded-full border border-line bg-field px-3 py-2 text-sm font-bold tabular-nums text-ink"
                />
              </MetricCard>
            </MetricGrid>

            <MetricCard label="Generators" value={`${selectedModels.length} selected`} detail="Toggle which models run against the target">
              <div className="choice-row">
                <ChoiceChip disabled={running} onClick={() => setSelectedModels(MODEL_OPTIONS.map((model) => model.key))}>All</ChoiceChip>
                <ChoiceChip disabled={running} onClick={() => setSelectedModels([])}>Clear</ChoiceChip>
                {MODEL_OPTIONS.map((model) => (
                  <ChoiceChip
                    key={model.key}
                    title={model.family}
                    disabled={running}
                    active={selectedModels.includes(model.key)}
                    onClick={() => toggleModel(model.key)}
                  >
                    {model.label}
                  </ChoiceChip>
                ))}
              </div>
            </MetricCard>

            <button
              type="button"
              onClick={runSimulation}
              disabled={running || !target.valid || !selectedModels.length}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-black text-field transition-colors hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40"
            >
              {running ? <Loader2 className="animate-spin" size={18} /> : <Shuffle size={18} />}
              {running ? 'Loading models and simulating…' : 'Simulate target frequency'}
            </button>
          </div>
        </section>
      </section>

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
            <div className="grid gap-3">
              <NumberRow values={result.target_numbers} size="sm" tone="primary" />
              <MetricGrid>
                <MetricCard label="Seed" value={result.seed} />
                <MetricCard label="Data through" value={formatEnglishDate(result.history_end_date)} />
                <MetricCard label="Uniform space" value={formatAttempts(result.uniform_baseline.combinations)} detail="lines" />
              </MetricGrid>
            </div>
            <p className="mt-4 text-xs leading-5 text-muted">The target is compared only after each current model distribution is frozen; it is not supplied as a hint when weights are calculated. Reusing the same seed reproduces the frequency and first-hit trials.</p>
          </Panel>

          <MetricGrid wide>
            {result.results.map((modelResult) => (
              <ResultCard key={modelResult.key} result={modelResult} attemptLimit={result.attempt_limit} targetNumbers={result.target_numbers} />
            ))}
          </MetricGrid>

          <section className="chart-card">
            <header className="chart-card__head">
              <h2>Expected vs seeded hits</h2>
              <p>Purple is the model-expected count. Blue is the seeded random trial.</p>
            </header>
            <ModelCompareChart data={modelChartData(result.results)} />
          </section>

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
    </article>
  );
}
