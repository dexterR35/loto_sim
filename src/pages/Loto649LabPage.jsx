import { useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, BrainCircuit, CalendarDays, FlaskConical, History, Link2, Network, ShieldCheck, Target } from 'lucide-react';
import { api } from '../lib/api';
import { formatEnglishDate, formatEnglishNumber } from '../lib/format';
import { NumberPill, NumberRow } from '../components/lottery';
import { Badge, LoadingBlock, Panel, Tabs } from '../components/ui';

const TABS = [
  { key: 'inference', label: 'Inference', icon: ShieldCheck },
  { key: 'number', label: 'Number Explorer', icon: Target },
  { key: 'relationships', label: 'Relationships', icon: Network },
  { key: 'prediction', label: 'Prediction & Models', icon: BrainCircuit },
  { key: 'backtest', label: 'Backtesting', icon: FlaskConical },
];

function pValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return '—';
  return parsed < 0.0001 ? parsed.toExponential(2) : parsed.toFixed(4);
}

function statusTone(status) {
  if (status === 'statistically_interesting') return 'coral';
  if (status === 'watch' || status === 'unstable') return 'gold';
  if (status === 'weak_signal') return 'primary';
  return 'default';
}

function strategyLabel(name) {
  const labels = {
    monte_carlo: 'MC ticket strategy',
    random_uniform: 'Uniform random baseline',
    frequency_only: 'Frequency-only baseline',
    recent_frequency: 'Recent-frequency baseline',
    statistical_composite: 'Statistical composite',
    sklearn_logistic_frozen: 'Frozen sklearn logistic',
  };
  return labels[name] || String(name).replaceAll('_', ' ');
}

function predictionComponentLabel(name) {
  return name === 'monte_carlo' ? 'MC ranking component' : strategyLabel(name);
}

function Tile({ label, value, detail }) {
  return <article className="rounded-2xl border border-line bg-elevated p-4"><div className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</div><div className="mt-2 text-xl font-bold tracking-tight text-ink">{value}</div>{detail ? <div className="mt-1 text-xs font-medium text-muted">{detail}</div> : null}</article>;
}

function TrendChart({ points = [] }) {
  if (!points.length) return <div className="p-6 text-center text-sm text-muted">No rolling-window points.</div>;
  const width = 620;
  const height = 160;
  const max = Math.max(...points.map((point) => point.rate), 0.15);
  const path = points.map((point, index) => {
    const x = (index / Math.max(1, points.length - 1)) * width;
    const y = height - (point.rate / max) * (height - 16) - 8;
    return `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const expectedY = height - ((6 / 49) / max) * (height - 16) - 8;
  return <div className="overflow-hidden rounded-2xl bg-elevated p-4"><svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full" role="img" aria-label="Rolling frequency"><line x1="0" y1={expectedY} x2={width} y2={expectedY} stroke="#f3c969" strokeDasharray="7 6" /><path d={path} fill="none" stroke="var(--color-primary)" strokeWidth="3" strokeLinejoin="round" /></svg><div className="grid grid-cols-3 text-[10px] font-bold text-muted"><span>{formatEnglishDate(points[0]?.date)}</span><span className="text-center">gold line = 6/49</span><span className="text-right">{formatEnglishDate(points.at(-1)?.date)}</span></div></div>;
}

function ScoreBar({ label, value, weight }) {
  const score = Number(value) || 0;
  return <div className="rounded-2xl bg-elevated p-3"><div className="grid grid-cols-[1fr_auto] gap-3 text-xs font-bold"><span className="text-muted">{label}</span><span className="text-ink">{score.toFixed(3)}{weight != null ? ` · w ${Number(weight).toFixed(2)}` : ''}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-field"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(3, Math.min(100, score * 100))}%` }} /></div></div>;
}

function FeatureContributions({ contributions = {} }) {
  const models = Object.entries(contributions);
  if (!models.length) return null;
  return (
    <div className="mt-4 grid gap-3">
      <div className="text-[10px] font-black uppercase tracking-wide text-muted">Local feature contributions</div>
      {models.map(([model, rows]) => (
        <div key={model} className="rounded-2xl bg-elevated p-3">
          <div className="text-xs font-black text-ink">{model}</div>
          <div className="mt-2 grid gap-1.5">
            {rows.map((row) => (
              <div key={row.feature} className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-muted">{row.feature}</span>
                <span className={row.direction === 'positive' ? 'font-black text-teal' : 'font-black text-coral'}>
                  {row.contribution > 0 ? '+' : ''}{Number(row.contribution).toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NumberSidebar({ rows, selected, onSelect, drawCount }) {
  const selectedRow = rows.find((row) => row.number === selected);

  return (
    <aside className="min-w-0 xl:sticky xl:top-24 xl:self-start">
      <Panel title="Number index" icon={Target} action={<Badge tone="primary">1–49</Badge>} bodyClassName="grid gap-4">
        <p className="text-xs leading-5 text-muted">
          Select a number to update the evidence workspace. Numbers stay in their natural order.
        </p>

        <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Select a lottery number">
          {rows.map((row) => {
            const active = selected === row.number;
            const topRanked = row.prediction_rank && row.prediction_rank <= 6;
            return (
              <button
                key={row.number}
                type="button"
                onClick={() => onSelect(row.number)}
                aria-pressed={active}
                aria-label={`Explore number ${row.number}`}
                title={`Number ${row.number} · experimental rank ${row.prediction_rank || 'unavailable'}`}
                className={`aspect-square min-w-0 rounded-full border text-xs font-bold tabular-nums transition-colors ${
                  active
                    ? 'border-primary bg-primary text-field'
                    : topRanked
                      ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                      : 'border-line bg-elevated text-muted hover:border-primary/40 hover:text-ink'
                }`}
              >
                {row.number}
              </button>
            );
          })}
        </div>

        <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4">
          <div>
            <dt className="text-[9px] font-bold uppercase tracking-wide text-muted">Rank</dt>
            <dd className="mt-1 text-sm font-bold text-ink">#{selectedRow?.prediction_rank || '—'}</dd>
          </div>
          <div>
            <dt className="text-[9px] font-bold uppercase tracking-wide text-muted">Residual</dt>
            <dd className="mt-1 text-sm font-bold text-ink">{Number(selectedRow?.standardized_residual || 0).toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-[9px] font-bold uppercase tracking-wide text-muted">Gap</dt>
            <dd className="mt-1 text-sm font-bold text-ink">{selectedRow?.recency?.current_gap ?? '—'}</dd>
          </div>
        </dl>

        <p className="text-[10px] leading-4 text-muted">
          {formatEnglishNumber(drawCount)} validated draws. Mint outlines mark the current experimental Top 6, not guaranteed picks.
        </p>
      </Panel>
    </aside>
  );
}

function InferenceBody({ tests }) {
  const global = tests.global_tests || {};
  const drift = tests.drift || {};
  const entropy = tests.entropy || {};
  const gaps = tests.gap_tests || {};
  const autocorrelation = tests.autocorrelation || {};
  const simulation = tests.monte_carlo_null || {};
  const patterns = tests.draw_patterns || {};
  const simulationRows = [
    ['Global chi-square', simulation.global_chi_square],
    ['Largest number residual', simulation.maximum_absolute_residual],
    ['Largest pair residual', simulation.maximum_pair_absolute_residual],
    ['Largest current gap', simulation.maximum_current_gap],
  ];
  const compatible = global.verdict === 'insufficient_evidence_against_uniform_null';

  return (
    <div className="grid gap-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Global chi-square" value={Number(global.chi_square).toFixed(3)} detail={`${global.degrees_of_freedom} df · p ${pValue(global.p_value)}`} />
        <Tile label="Temporal drift" value={drift.status || '—'} detail={`period test p ${pValue(drift.p_value)}`} />
        <Tile label="Marginal entropy" value={Number(entropy.normalized_marginal).toFixed(6)} detail="1.000 is the uniform maximum" />
        <Tile label="Adjusted secondary signals" value={`${gaps.adjusted_signals || 0} gap · ${autocorrelation.adjusted_signals || 0} autocorr.`} detail="after multiple-testing correction" />
      </div>

      <Panel title="Global inference verdict" icon={ShieldCheck}>
        <div className={`rounded-2xl border p-5 ${compatible ? 'border-teal/25 bg-teal/5' : 'border-gold/30 bg-gold/5'}`}>
          <div className="text-[10px] font-black uppercase tracking-wide text-muted">Null hypothesis</div>
          <div className="mt-2 text-lg font-black text-ink">{compatible ? 'History remains compatible with a uniform 6/49 draw' : 'The global deviation requires investigation'}</div>
          <p className="mt-2 text-sm leading-6 text-muted">{global.null_hypothesis}</p>
          <p className="mt-2 text-xs font-bold leading-5 text-coral">{global.warning}</p>
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,.85fr)]">
        <Panel title="Uniform-draw null simulation" icon={FlaskConical} action={<Badge tone="teal">inference only</Badge>}>
          <p className="mb-4 text-xs leading-5 text-muted">{formatEnglishNumber(simulation.n_simulations)} simulated histories · {formatEnglishNumber(simulation.draws_per_simulation)} draws each · seed {simulation.random_seed}. This tests historical anomalies; it does not generate tickets.</p>
          <div className="overflow-auto rounded-2xl border border-line">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="bg-field text-[10px] uppercase tracking-wide text-muted"><th className="px-3 py-2">Measurement</th><th className="px-3 py-2">Observed</th><th className="px-3 py-2">Null percentile</th><th className="px-3 py-2">Empirical p</th></tr></thead>
              <tbody>{simulationRows.map(([label, row]) => <tr key={label} className="border-t border-line"><td className="px-3 py-2 font-black text-ink">{label}</td><td className="px-3 py-2">{Number(row?.real).toFixed(3)}</td><td className="px-3 py-2">{row?.percentile_real == null ? '—' : `${(Number(row.percentile_real) * 100).toFixed(1)}%`}</td><td className="px-3 py-2">{pValue(row?.empirical_p_value)}</td></tr>)}</tbody>
            </table>
          </div>
        </Panel>

        <Panel title="Draw-pattern checks" icon={BarChart3}>
          <div className="grid gap-3">
            <Tile label="Odd/even distribution" value={`p ${pValue(patterns.odd_count_uniform_test?.p_value)}`} detail="uniform 6/49 combinatorial null" />
            <Tile label="Low/high distribution" value={`p ${pValue(patterns.low_1_24_uniform_test?.p_value)}`} detail="numbers 1–24 versus 25–49" />
            <Tile label="Mean draw sum" value={Number(patterns.sum?.mean).toFixed(2)} detail={`theoretical ${Number(patterns.sum?.theoretical_mean).toFixed(2)} · p ${pValue(patterns.sum?.mean_p_value)}`} />
            <Tile label="Mean spread" value={Number(patterns.spread?.mean).toFixed(2)} detail={`${patterns.spread?.min} minimum · ${patterns.spread?.max} maximum`} />
          </div>
        </Panel>
      </div>

      <Panel title="Temporal periods" icon={History}>
        <div className="overflow-auto rounded-2xl border border-line">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead><tr className="bg-field text-[10px] uppercase tracking-wide text-muted"><th className="px-3 py-2">Period</th><th className="px-3 py-2">Draws</th><th className="px-3 py-2">Jensen–Shannon vs uniform</th><th className="px-3 py-2">PSI vs uniform</th></tr></thead>
            <tbody>{(drift.periods || []).map((period) => <tr key={period.label} className="border-t border-line"><td className="px-3 py-2 font-black text-ink">{period.label}</td><td className="px-3 py-2">{formatEnglishNumber(period.draws)}</td><td className="px-3 py-2">{Number(period.jensen_shannon_vs_uniform).toFixed(6)}</td><td className="px-3 py-2">{Number(period.psi_vs_uniform).toFixed(6)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">{drift.interpretation}</p>
      </Panel>
    </div>
  );
}

function BacktestBody({ report }) {
  if (!report) return <div className="rounded-2xl border border-dashed border-line bg-field/60 p-8 text-center text-sm text-muted">Load the persisted report for the out-of-sample comparison. Computation runs only through the admin route or CLI.</div>;
  if (!Object.keys(report.strategies || {}).length) return <div className="rounded-2xl border border-dashed border-line bg-field/60 p-8 text-center text-sm text-muted">{report.message || 'No persisted report is available yet.'}</div>;
  return (
    <div className="overflow-auto">
      <div className="mb-4 text-xs font-bold text-muted">{report.evaluated_draws} targets · {formatEnglishDate(report.first_target_date)} — {formatEnglishDate(report.last_target_date)} · seed {report.seed}</div>
      <table className="w-full min-w-[680px] text-left text-sm">
        <thead><tr className="bg-field text-[10px] uppercase text-muted"><th className="px-3 py-2">Strategy</th><th className="px-3 py-2">Hits@6</th><th className="px-3 py-2">NDCG@10</th><th className="px-3 py-2">Brier</th><th className="px-3 py-2">Random percentile</th><th className="px-3 py-2">Empirical p</th></tr></thead>
        <tbody>{Object.entries(report.strategies).map(([name, row]) => { const random = report.random_comparisons?.[name]; return <tr key={name} className="border-t border-line"><td className="px-3 py-2 font-black capitalize">{strategyLabel(name)}</td><td className="px-3 py-2">{row.hits_at_6.toFixed(3)}</td><td className="px-3 py-2">{row.ndcg_at_10.toFixed(3)}</td><td className="px-3 py-2">{row.brier_score.toFixed(4)}</td><td className="px-3 py-2">{random ? `${(random.percentile * 100).toFixed(1)}%` : '—'}</td><td className="px-3 py-2">{pValue(random?.empirical_p_value)}</td></tr>; })}</tbody>
      </table>
      <p className="mt-4 text-xs leading-5 text-muted">{report.conclusion}</p>
    </div>
  );
}

export function Loto649LabPage({ game, onGameChange, activeTab = 'inference', onTabChange }) {
  const [numbersPayload, setNumbersPayload] = useState(null);
  const [tests, setTests] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [models, setModels] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(1);
  const [localTab, setLocalTab] = useState(activeTab);
  const [backtest, setBacktest] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [error, setError] = useState('');
  const tab = onTabChange ? activeTab : localTab;
  const setTab = onTabChange || setLocalTab;

  useEffect(() => {
    if (game !== '6din49') return;
    const controller = new AbortController();
    setError('');
    Promise.all([
      api('/api/649/statistics/numbers', { signal: controller.signal }),
      api('/api/649/statistics/tests', { signal: controller.signal }),
      api('/api/649/prediction/latest', { signal: controller.signal }),
      api('/api/649/models', { signal: controller.signal }),
    ]).then(([numbers, statisticalTests, predicted, registry]) => {
      setNumbersPayload(numbers);
      setTests(statisticalTests);
      setPrediction(predicted);
      setModels(registry);
      setSelected(predicted.ranking?.[0]?.number || 1);
    }).catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [game]);

  useEffect(() => {
    if (game !== '6din49' || !selected) return;
    const controller = new AbortController();
    setDetail(null);
    api(`/api/649/statistics/numbers/${selected}`, { signal: controller.signal })
      .then(setDetail)
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message); });
    return () => controller.abort();
  }, [game, selected]);

  const numbers = useMemo(() => {
    const rows = numbersPayload?.numbers?.slice() || [];
    return rows.sort((a, b) => a.number - b.number);
  }, [numbersPayload]);

  const loadBacktest = () => {
    setBacktestLoading(true);
    api('/api/649/backtest')
      .then(setBacktest)
      .catch((err) => setError(err.message))
      .finally(() => setBacktestLoading(false));
  };

  if (game !== '6din49') return <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center"><FlaskConical className="mx-auto text-primary" size={36} /><h2 className="mt-4 text-xl font-bold text-ink">The lab is limited to Loto 6/49</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">The upgrade does not extrapolate its assumptions or models to 5/40 or Joker.</p><button type="button" onClick={() => onGameChange('6din49')} className="mt-5 rounded-full bg-primary px-5 py-3 text-sm font-bold text-field">Switch to Loto 6/49</button></div>;
  if (error) return <div className="rounded-2xl border border-coral/20 bg-coral/5 p-5 text-sm font-bold text-coral">{error}</div>;
  if (!numbersPayload || !tests || !prediction) return <LoadingBlock rows={10} />;

  return (
    <div className="grid gap-5">
      <header className="grid gap-5 rounded-2xl border border-line bg-surface p-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div><div className="flex flex-wrap gap-2"><Badge tone="teal">zero leakage</Badge><Badge tone="gold">FDR preferred</Badge><Badge>6/49 only</Badge></div><h2 className="mt-4 text-3xl font-bold tracking-[-0.03em] text-ink">Statistical Lab</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Inference, per-number evidence, relationships, prediction explanations, and honest temporal evaluation.</p></div><Tabs items={TABS} active={tab} onChange={setTab} />
      </header>

      {tab === 'inference' ? <InferenceBody tests={tests} /> : null}

      {tab === 'backtest' ? (
        <Panel title="Walk-forward backtesting · expanding window" icon={FlaskConical} action={<button type="button" disabled={backtestLoading} onClick={loadBacktest} className="rounded-full bg-primary px-4 py-2.5 text-xs font-bold text-field disabled:opacity-40">{backtestLoading ? 'Loading…' : backtest ? 'Reload' : 'Load persisted report'}</button>}>
          <p className="mb-4 text-xs leading-5 text-muted">This evaluates strategies only on draws that occur after their training history. Random percentiles here are performance baselines, not the uniform-draw inference simulation.</p>
          {backtestLoading ? <LoadingBlock rows={5} /> : <BacktestBody report={backtest} />}
        </Panel>
      ) : null}

      {['number', 'relationships', 'prediction'].includes(tab) ? (
        <div className="grid gap-5 xl:grid-cols-[21rem_minmax(0,1fr)] xl:items-start">
          <NumberSidebar rows={numbers} selected={selected} onSelect={setSelected} drawCount={numbersPayload.draw_count} />

          {!detail ? <LoadingBlock rows={8} /> : (
            <div className="grid min-w-0 gap-5">
              {tab === 'prediction' ? (
                <Panel title={`Immutable prediction snapshot · ${formatEnglishDate(prediction.target_draw_date)}`} icon={BrainCircuit} action={<Badge tone={prediction.snapshot_status === 'immutable' ? 'teal' : 'gold'}>{prediction.snapshot_status}</Badge>}>
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4"><div className="text-[10px] font-black uppercase tracking-wide text-primary">Top 6 by experimental rank</div><div className="mt-3"><NumberRow values={prediction.top_6} size="lg" /></div><p className="mt-3 text-xs leading-5 text-muted">A ranking snapshot is not a jackpot probability or guarantee.</p></div>
                  <div className="mt-4 overflow-auto rounded-2xl border border-line"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="bg-field text-[10px] uppercase tracking-wide text-muted"><th className="px-3 py-2">Rank</th><th className="px-3 py-2">Number</th><th className="px-3 py-2">Marginal model score</th><th className="px-3 py-2">Primary factor</th></tr></thead><tbody>{prediction.ranking.slice(0, 10).map((row) => <tr key={row.number} className="border-t border-line"><td className="px-3 py-2 font-black">#{row.rank}</td><td className="px-3 py-2"><NumberPill value={row.number} size="sm" /></td><td className="px-3 py-2 font-black text-primary">{(row.modeled_probability * 100).toFixed(2)}%</td><td className="px-3 py-2 text-xs font-semibold text-muted">{row.main_positive_factors?.[0]}</td></tr>)}</tbody></table></div>
                </Panel>
              ) : null}

              {tab === 'number' ? (
                <div className="grid gap-5 2xl:grid-cols-12">
                  <Panel className="2xl:col-span-12" title={`Number ${detail.number} evidence`} icon={Activity} action={<Badge tone={statusTone(detail.status)}>{detail.status}</Badge>}>
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <Tile label="Prediction rank" value={`#${detail.prediction?.rank || '—'}`} detail={`${((detail.prediction?.modeled_probability || 0) * 100).toFixed(2)}% modeled marginal score`} />
                      <Tile label="Observed / expected" value={`${detail.observed} / ${detail.expected.toFixed(1)}`} detail={`Δ ${detail.difference > 0 ? '+' : ''}${detail.difference.toFixed(1)} (${detail.deviation_pct.toFixed(2)}%)`} />
                      <Tile label="Standardized residual" value={detail.standardized_residual.toFixed(3)} detail={`χ² contribution ${detail.chi_contribution.toFixed(3)}`} />
                      <Tile label="FDR-adjusted p" value={pValue(detail.adjusted_p_value)} detail={`raw p ${pValue(detail.raw_p_value)}`} />
                    </div>
                    <p className="mt-4 border-l-2 border-primary bg-field/60 px-4 py-3 text-xs leading-5 text-muted">
                      <strong className="text-ink">95% interval:</strong> rate {(detail.confidence_interval.rate_lower * 100).toFixed(2)}% — {(detail.confidence_interval.rate_upper * 100).toFixed(2)}%. Adjusted significance does not imply a probability of winning.
                    </p>
                  </Panel>

                  <Panel className="2xl:col-span-7" title="Rolling 50-draw frequency" icon={BarChart3}>
                    <TrendChart points={detail.trend.rolling} />
                  </Panel>

                  <Panel className="2xl:col-span-5" title="Recency and gap" icon={CalendarDays}>
                    <div className="grid grid-cols-2 gap-3">
                      <Tile label="Current gap" value={detail.recency.current_gap} />
                      <Tile label="Gap percentile" value={`${(detail.recency.gap_percentile * 100).toFixed(1)}%`} />
                      <Tile label="Mean gap" value={detail.recency.mean_gap?.toFixed(2) || '—'} />
                      <Tile label="Maximum gap" value={detail.recency.max_gap} />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted">{detail.recency.warning}</p>
                  </Panel>

                  <Panel className="2xl:col-span-5" title="Frequency windows" icon={History}>
                    <div className="overflow-auto">
                      <table className="w-full text-left text-xs">
                        <thead><tr className="text-[10px] uppercase text-muted"><th className="pb-2">Window</th><th className="pb-2">Obs.</th><th className="pb-2">Exp.</th><th className="pb-2">Rate</th></tr></thead>
                        <tbody>{Object.entries(detail.windows).map(([window, row]) => <tr key={window} className="border-t border-line"><td className="py-2 font-black">{window}</td><td className="py-2">{row.observed}</td><td className="py-2">{Number(row.expected).toFixed(2)}</td><td className="py-2">{(Number(row.rate) * 100).toFixed(2)}%</td></tr>)}</tbody>
                      </table>
                    </div>
                  </Panel>

                  <Panel className="2xl:col-span-7" title={`Occurrence history · ${detail.history_count}`} icon={History}>
                    <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                      {detail.history.slice(0, 120).map((draw) => <time key={`${draw.id}-${draw.draw_date}`} dateTime={draw.draw_date} className="rounded-xl border border-line bg-elevated px-3 py-2 text-center text-xs font-bold text-muted">{formatEnglishDate(draw.draw_date)}</time>)}
                    </div>
                    {detail.history_count > 120 ? <p className="mt-3 text-xs text-muted">Showing the 120 most recent occurrences out of {detail.history_count}.</p> : null}
                  </Panel>
                </div>
              ) : null}

              {tab === 'relationships' ? <Panel title={`Relationships for number ${detail.number}`} icon={Link2}><div className="overflow-auto"><table className="w-full min-w-[650px] text-left text-sm"><thead><tr className="bg-field text-[10px] uppercase text-muted"><th className="px-3 py-2">Pair</th><th className="px-3 py-2">Obs / exp.</th><th className="px-3 py-2">Lift</th><th className="px-3 py-2">z</th><th className="px-3 py-2">FDR q</th><th className="px-3 py-2">Uniform-null percentile</th></tr></thead><tbody>{detail.relationships.map((pair) => <tr key={pair.pair.join('-')} className="border-t border-line"><td className="px-3 py-2"><NumberRow values={pair.pair} size="sm" /></td><td className="px-3 py-2 font-bold">{pair.observed} / {pair.expected.toFixed(2)}</td><td className="px-3 py-2">{pair.lift.toFixed(2)}</td><td className="px-3 py-2">{pair.standardized_residual.toFixed(2)}</td><td className="px-3 py-2">{pValue(pair.adjusted_p_value)}</td><td className="px-3 py-2">{(pair.monte_carlo_percentile * 100).toFixed(1)}%</td></tr>)}</tbody></table></div></Panel> : null}

              {tab === 'prediction' ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  <Panel title={`Score decomposition · number ${detail.number}`} icon={BrainCircuit}>
                    {Object.entries(detail.prediction?.scores || {}).map(([name, score]) => <ScoreBar key={name} label={predictionComponentLabel(name)} value={score} weight={prediction.active_weights?.[name]} />)}
                    {!Object.keys(detail.prediction?.scores || {}).length ? <p className="text-sm text-muted">No current prediction.</p> : null}
                    <FeatureContributions contributions={detail.prediction?.model_feature_contributions} />
                    <p className="mt-4 rounded-2xl bg-elevated p-4 text-xs leading-5 text-muted">Local contributions explain the model logit and are not causal. Neural contributions remain approximate.</p>
                  </Panel>
                  <Panel title="Champion / Challenger" icon={ShieldCheck}>
                    <div className="grid gap-3">
                      <Tile label="Champion" value={models?.champion?.model_id || 'baseline ensemble'} detail={models?.champion?.status_reason || 'No complex model passed every out-of-sample threshold.'} />
                      <Tile label="Models in registry" value={models?.registered?.length || 0} detail={`${models?.legacy_audits?.length || 0} legacy artifacts audited separately`} />
                      <Tile label="PyTorch experimental" value={models?.pytorch?.available ? 'available' : 'disabled'} detail={models?.pytorch?.reason} />
                    </div>
                  </Panel>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
