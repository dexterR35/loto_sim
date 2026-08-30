import { useEffect, useMemo, useState } from 'react';
import { BrainCircuit, FlaskConical, Network, ShieldCheck, Target } from 'lucide-react';
import { DashGrid } from '../components/charts';
import { api } from '../lib/api';
import {
  buildActivity,
  gapToBars,
  numberTicket,
  pairsToBars,
  pairsToMix,
  periodsToMonths,
  rankingToBars,
  rollingToMonths,
  scoresToMix,
  ticketNumberSet,
  windowsToMix
} from '../lib/activity';
import { formatEnglishDate, formatEnglishNumber } from '../lib/format';
import { NumberRow } from '../components/lottery';
import { CompactTicket, TicketStack } from '../components/lottery/CompactTicket';
import { Badge, DataTable, LoadingBlock, Tabs } from '../components/ui';

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

function LabTickets({ tickets, selected, onSelect, numbers, children, footer }) {
  const hints = (numbers || [])
    .filter((row) => row.prediction_rank && row.prediction_rank <= 6)
    .map((row) => row.number);

  return (
    <TicketStack
      tickets={tickets}
      fallbackNumbers={[selected]}
      active={selected}
      hints={hints}
      onNumberClick={onSelect}
      footer={footer}
    >
      {children}
    </TicketStack>
  );
}

function LabExtra({ tickets, selected, onSelect, numbers, footer, stackExtra, children }) {
  return (
    <section className="dash-extra dash-extra--split">
      <LabTickets tickets={tickets} selected={selected} onSelect={onSelect} numbers={numbers} footer={footer}>
        {stackExtra}
      </LabTickets>
      {children}
    </section>
  );
}

function OccurrenceTable({ history }) {
  const columns = useMemo(() => [
    {
      accessorKey: 'draw_date_iso',
      header: 'Date',
      cell: ({ row, getValue }) => (
        <time dateTime={getValue()} className="whitespace-nowrap font-bold text-ink">
          {formatEnglishDate(getValue() || row.original.draw_date)}
        </time>
      )
    },
    {
      id: 'numbers',
      header: 'Numbers',
      enableSorting: false,
      cell: ({ row }) => <NumberRow values={row.original.drawn_numbers || row.original.numbers || []} size="sm" />
    }
  ], []);
  return (
    <DataTable
      data={history}
      columns={columns}
      empty="No occurrences for this number."
      getRowId={(row, index) => String(row.id ?? row.draw_date_iso ?? index)}
    />
  );
}

function InferenceTable({ rows }) {
  const data = useMemo(() => rows.map(([label, row]) => ({
    label,
    observed: Number(row?.real).toFixed(3),
    percentile: row?.percentile_real == null ? '—' : `${(Number(row.percentile_real) * 100).toFixed(1)}%`,
    p: pValue(row?.empirical_p_value)
  })), [rows]);
  const columns = useMemo(() => [
    { accessorKey: 'label', header: 'Measurement', cell: ({ getValue }) => <span className="font-bold text-ink">{getValue()}</span> },
    { accessorKey: 'observed', header: 'Observed' },
    { accessorKey: 'percentile', header: 'Null percentile' },
    { accessorKey: 'p', header: 'Empirical p' }
  ], []);
  return <DataTable data={data} columns={columns} empty="No simulation rows." />;
}

function RelationshipsTable({ pairs }) {
  const columns = useMemo(() => [
    {
      id: 'pair',
      header: 'Pair',
      accessorFn: (pair) => (pair.pair || []).join('-'),
      cell: ({ row }) => <NumberRow values={row.original.pair} size="sm" />
    },
    {
      id: 'obs',
      header: 'Obs / exp.',
      accessorFn: (pair) => pair.observed,
      cell: ({ row }) => <span className="font-bold">{row.original.observed} / {Number(row.original.expected).toFixed(2)}</span>
    },
    { accessorKey: 'lift', header: 'Lift', cell: ({ getValue }) => Number(getValue()).toFixed(2) },
    { accessorKey: 'standardized_residual', header: 'z', cell: ({ getValue }) => Number(getValue()).toFixed(2) },
    { accessorKey: 'adjusted_p_value', header: 'FDR q', cell: ({ getValue }) => pValue(getValue()) }
  ], []);
  return <DataTable data={pairs} columns={columns} empty="No pair relationships." getRowId={(row) => (row.pair || []).join('-')} />;
}

function BacktestTable({ report }) {
  const data = useMemo(() => Object.entries(report.strategies || {}).map(([name, row]) => {
    const comparison = report.random_comparisons?.[name];
    return {
      name,
      label: strategyLabel(name),
      hits: row.hits_at_6,
      ndcg: row.ndcg_at_10,
      brier: row.brier_score,
      percentile: comparison?.percentile,
      p: comparison?.empirical_p_value
    };
  }), [report]);
  const columns = useMemo(() => [
    { accessorKey: 'label', header: 'Strategy', cell: ({ getValue }) => <span className="font-bold capitalize">{getValue()}</span> },
    { accessorKey: 'hits', header: 'Hits@6', cell: ({ getValue }) => Number(getValue()).toFixed(3) },
    { accessorKey: 'ndcg', header: 'NDCG@10', cell: ({ getValue }) => Number(getValue()).toFixed(3) },
    { accessorKey: 'brier', header: 'Brier', cell: ({ getValue }) => Number(getValue()).toFixed(4) },
    { accessorKey: 'percentile', header: 'Random percentile', cell: ({ getValue }) => (getValue() == null ? '—' : `${(Number(getValue()) * 100).toFixed(1)}%`) },
    { accessorKey: 'p', header: 'Empirical p', cell: ({ getValue }) => pValue(getValue()) }
  ], []);
  return <DataTable data={data} columns={columns} empty="No strategy rows." getRowId={(row) => row.name} />;
}

function InferenceBody({ tests, draws, stats, tickets, onInspectNumber }) {
  const global = tests.global_tests || {};
  const drift = tests.drift || {};
  const entropy = tests.entropy || {};
  const gaps = tests.gap_tests || {};
  const autocorrelation = tests.autocorrelation || {};
  const simulation = tests.monte_carlo_null || {};
  const patterns = tests.draw_patterns || {};
  const activity = buildActivity(draws, stats, tickets);
  const compatible = global.verdict === 'insufficient_evidence_against_uniform_null';
  const periodMonths = periodsToMonths(drift.periods);
  const simulationRows = [
    ['Chi-square', simulation.global_chi_square],
    ['Number residual', simulation.maximum_absolute_residual],
    ['Pair residual', simulation.maximum_pair_absolute_residual],
    ['Current gap', simulation.maximum_current_gap]
  ];

  return (
    <DashGrid
      weeks={activity.weeks}
      heatmapTitle="Inference activity"
      heatmapDetail="Official draw days. Ticket numbers overlay hits when a line is active."
      metrics={[
        { label: 'Chi-square', value: Number(global.chi_square).toFixed(2), detail: `${global.degrees_of_freedom} df` },
        { label: 'Global p', value: pValue(global.p_value), detail: compatible ? 'random-compatible' : 'review' },
        { label: 'Temporal drift', value: drift.status || '—', detail: `p ${pValue(drift.p_value)}` },
        { label: 'Entropy', value: Number(entropy.normalized_marginal).toFixed(4), detail: '1.000 is uniform max' },
        { label: 'Gap signals', value: gaps.adjusted_signals || 0, detail: 'FDR-adjusted' },
        { label: 'Autocorr. signals', value: autocorrelation.adjusted_signals || 0, detail: 'FDR-adjusted' },
        { label: 'Odd / even p', value: pValue(patterns.odd_count_uniform_test?.p_value), detail: 'combinatorial null' },
        { label: 'Mean draw sum', value: Number(patterns.sum?.mean).toFixed(1), detail: `theory ${Number(patterns.sum?.theoretical_mean).toFixed(1)}` }
      ]}
      weekday={activity.weekday}
      weekdayRight={activity.selected.length ? 'Avg hits' : 'Avg sum'}
      months={periodMonths.length ? periodMonths : activity.months}
      monthTitle={periodMonths.length ? 'Temporal periods' : '12-month activity'}
      monthLeft={periodMonths.length ? 'JS ×1000' : 'Draws'}
      monthRight={periodMonths.length ? 'PSI ×100' : (activity.selected.length ? 'Ticket hits' : 'Avg sum')}
      mix={activity.mix}
      mixTitle="Draw mix"
      bars={activity.numbers}
      barsTitle="Numbers vs expected"
      extra={(
        <section className="dash-extra dash-extra--split">
          <TicketStack tickets={tickets} onNumberClick={onInspectNumber} />
          <section className="chart-card">
            <header className="chart-card__head">
              <h2>Global inference verdict</h2>
              <p>{compatible ? 'History remains compatible with a uniform 6/49 draw.' : 'The global deviation requires investigation.'}</p>
            </header>
            <p className={`rounded-2xl border p-4 text-sm ${compatible ? 'border-teal/25 bg-teal/5' : 'border-gold/30 bg-gold/5'}`}>
              {global.null_hypothesis} <span className="text-coral">{global.warning}</span>
            </p>
            <InferenceTable rows={simulationRows} />
            <p className="text-xs text-muted">{drift.interpretation}</p>
          </section>
        </section>
      )}
    />
  );
}

function NumberExplorerGrid({ detail, draws, stats, numbers, selected, onSelect, tickets, drawCount }) {
  const activity = buildActivity(draws, stats, numberTicket(detail.number));
  return (
    <DashGrid
      weeks={activity.weeks}
      heatmapTitle={`History · number ${detail.number}`}
      heatmapDetail="Green cells are official days when this number was drawn."
      metrics={[
        { label: 'Rank', value: `#${detail.prediction?.rank || '—'}`, detail: `${((detail.prediction?.modeled_probability || 0) * 100).toFixed(2)}% model score` },
        { label: 'Observed / expected', value: `${detail.observed} / ${Number(detail.expected).toFixed(1)}`, detail: `Δ ${detail.difference > 0 ? '+' : ''}${Number(detail.difference).toFixed(1)}` },
        { label: 'Residual', value: Number(detail.standardized_residual).toFixed(2), detail: `χ² ${Number(detail.chi_contribution).toFixed(2)}` },
        { label: 'FDR p', value: pValue(detail.adjusted_p_value), detail: `raw ${pValue(detail.raw_p_value)}` },
        { label: 'Current gap', value: detail.recency?.current_gap ?? '—', detail: detail.recency?.warning },
        { label: 'Gap percentile', value: `${(Number(detail.recency?.gap_percentile) * 100).toFixed(1)}%`, detail: 'among completed gaps' },
        { label: 'Mean gap', value: Number(detail.recency?.mean_gap || 0).toFixed(1), detail: `expected ${Number(detail.recency?.expected_mean_gap || 0).toFixed(1)}` },
        { label: 'Max gap', value: detail.recency?.max_gap ?? '—', detail: `last ${formatEnglishDate(detail.recency?.last_appearance)}` }
      ]}
      weekday={activity.weekday}
      weekdayTitle="Appearances by weekday"
      weekdayDetail="Draws vs average hits of this number."
      weekdayRight="Avg hits"
      months={rollingToMonths(detail.trend?.rolling)}
      monthTitle="Rolling 50-draw history"
      monthLeft="Rate %"
      monthRight="Uniform 6/49"
      mix={windowsToMix(detail.windows)}
      mixTitle="Frequency windows"
      mixCaption="hits"
      bars={gapToBars(detail.recency)}
      barsTitle="Gap vs expected"
      extra={(
        <LabExtra
          tickets={tickets}
          selected={selected}
          onSelect={onSelect}
          numbers={numbers}
          footer={<p className="ticket-summary">{formatEnglishNumber(drawCount)} draws · click any number</p>}
        >
          <section className="chart-card">
            <header className="chart-card__head">
              <h2>Occurrence history · {detail.history_count}</h2>
              <p>{detail.confidence_interval ? `95% rate ${(detail.confidence_interval.rate_lower * 100).toFixed(2)}% — ${(detail.confidence_interval.rate_upper * 100).toFixed(2)}%.` : null}</p>
            </header>
            <OccurrenceTable history={detail.history || []} />
          </section>
        </LabExtra>
      )}
    />
  );
}

function RelationshipsGrid({ detail, draws, stats, numbers, selected, onSelect, tickets, ticketSet, drawCount }) {
  const activity = buildActivity(draws, stats, numberTicket(detail.number));
  const lead = detail.relationships?.[0] || {};
  return (
    <DashGrid
      weeks={activity.weeks}
      heatmapTitle={`Pairs · number ${detail.number}`}
      heatmapDetail="History of the selected number. Bars compare co-occurring partners."
      metrics={[
        { label: 'Pairs listed', value: detail.relationships?.length || 0, detail: 'strongest partners first' },
        { label: 'Top lift', value: Number(lead.lift || 0).toFixed(2), detail: (lead.pair || []).join(' · ') },
        { label: 'Top z', value: Number(lead.standardized_residual || 0).toFixed(2), detail: 'standardized residual' },
        { label: 'FDR q', value: pValue(lead.adjusted_p_value), detail: 'leading pair' },
        { label: 'Observed', value: lead.observed ?? '—', detail: `expected ${Number(lead.expected || 0).toFixed(1)}` },
        { label: 'Null percentile', value: `${(Number(lead.monte_carlo_percentile || 0) * 100).toFixed(1)}%`, detail: 'uniform-draw simulation' },
        { label: 'Current gap', value: detail.recency?.current_gap ?? '—', detail: `number ${detail.number}` },
        { label: 'In ticket', value: ticketSet.has(detail.number) ? 'Yes' : 'No', detail: 'active generated line' }
      ]}
      weekday={activity.weekday}
      weekdayRight="Avg hits"
      months={rollingToMonths(detail.trend?.rolling)}
      monthTitle="Rolling history"
      monthLeft="Rate %"
      monthRight="Uniform 6/49"
      mix={pairsToMix(detail.relationships)}
      mixTitle="Pair significance"
      mixCaption="pairs"
      bars={pairsToBars(detail.relationships)}
      barsTitle="Partners vs expected"
      extra={(
        <LabExtra
          tickets={tickets}
          selected={selected}
          onSelect={onSelect}
          numbers={numbers}
          footer={<p className="ticket-summary">{formatEnglishNumber(drawCount)} draws · click any number</p>}
        >
          <section className="chart-card">
            <header className="chart-card__head">
              <h2>Relationship table</h2>
            </header>
            <RelationshipsTable pairs={detail.relationships || []} />
          </section>
        </LabExtra>
      )}
    />
  );
}

function PredictionGrid({ detail, draws, stats, numbers, selected, onSelect, tickets, drawCount, prediction, models }) {
  const activity = buildActivity(draws, stats, [{ numbers: prediction.top_6 || [] }]);
  return (
    <DashGrid
      weeks={activity.weeks}
      heatmapTitle={`Prediction · ${formatEnglishDate(prediction.target_draw_date)}`}
      heatmapDetail="Heatmap overlays the experimental Top 6."
      metrics={[
        { label: 'Snapshot', value: prediction.snapshot_status, detail: prediction.model_version },
        { label: 'Selected rank', value: `#${detail.prediction?.rank || '—'}`, detail: `number ${detail.number}` },
        { label: 'Model score', value: `${((detail.prediction?.modeled_probability || 0) * 100).toFixed(2)}%`, detail: 'marginal' },
        { label: 'Confidence', value: prediction.uncertainty?.prediction_confidence ?? '—', detail: 'stability, not jackpot odds' },
        { label: 'Disagreement', value: prediction.uncertainty?.ensemble_disagreement ?? '—', detail: 'ensemble spread' },
        { label: 'Champion', value: models?.champion?.model_id || 'ensemble', detail: models?.champion?.status_reason || 'baseline' },
        { label: 'Registry', value: models?.registered?.length || 0, detail: `${models?.legacy_audits?.length || 0} legacy` },
        { label: 'PyTorch', value: models?.pytorch?.available ? 'On' : 'Off', detail: models?.pytorch?.reason || 'experimental' }
      ]}
      weekday={activity.weekday}
      weekdayRight="Avg hits"
      months={rollingToMonths(detail.trend?.rolling)}
      monthTitle="Selected-number trend"
      monthLeft="Rate %"
      monthRight="Uniform 6/49"
      mix={scoresToMix(detail.prediction?.scores)}
      mixTitle="Score mix"
      mixCaption="weight"
      bars={rankingToBars(prediction.ranking)}
      barsTitle="Top ranks vs uniform"
      extra={(
        <LabExtra
          tickets={tickets}
          selected={selected}
          onSelect={onSelect}
          numbers={numbers}
          footer={<p className="ticket-summary">{formatEnglishNumber(drawCount)} draws · click any number</p>}
          stackExtra={(
            <CompactTicket
              label="P"
              numbers={prediction.top_6 || []}
              active={selected}
              onNumberClick={onSelect}
              badges={<span className="ticket-panel__chip is-ready">Top 6</span>}
              footer={<p className="ticket-summary">Experimental ranking · {formatEnglishDate(prediction.target_draw_date)}</p>}
            />
          )}
        >
          <section className="chart-card">
            <header className="chart-card__head chart-card__head--row">
              <h2>Model scores</h2>
              <Badge tone={prediction.snapshot_status === 'immutable' ? 'teal' : 'gold'}>{prediction.snapshot_status}</Badge>
            </header>
            {Object.entries(detail.prediction?.scores || {}).map(([name, score]) => (
              <ScoreBar key={name} label={predictionComponentLabel(name)} value={score} weight={prediction.active_weights?.[name]} />
            ))}
            <FeatureContributions contributions={detail.prediction?.model_feature_contributions} />
          </section>
        </LabExtra>
      )}
    />
  );
}

function backtestBars(report) {
  return Object.entries(report.strategies || {}).slice(0, 8).map(([name, row]) => ({
    label: strategyLabel(name).replace(' baseline', '').slice(0, 14),
    observed: Number(Number(row.hits_at_6).toFixed(3)),
    expected: Number(Number(report.random_comparisons?.[name]?.random_mean || 0.735).toFixed(3))
  }));
}

function backtestMix(report) {
  let beat = 0;
  let watch = 0;
  let rest = 0;
  for (const row of Object.values(report.random_comparisons || {})) {
    const p = Number(row.empirical_p_value);
    if (p < 0.05) beat += 1;
    else if (p < 0.2) watch += 1;
    else rest += 1;
  }
  const total = beat + watch + rest || 1;
  return [
    { key: 'beat', label: 'p < 0.05', value: beat, share: beat / total, color: 'var(--color-chart-pink)' },
    { key: 'watch', label: 'Watch', value: watch, share: watch / total, color: 'var(--color-chart-orange)' },
    { key: 'rest', label: 'Null-like', value: rest, share: rest / total, color: 'var(--color-chart-blue)' }
  ];
}

function backtestMonths(report) {
  const series = report.year_stability?.statistics || report.year_stability?.random_uniform || [];
  const randomMean = Number(Object.values(report.random_comparisons || {})[0]?.random_mean || 0.735);
  return series.map((row) => ({
    label: String(row.year),
    draws: Number((Number(row.hits_at_6) * 100).toFixed(2)),
    secondary: Number((randomMean * 100).toFixed(2))
  }));
}

function BacktestBody({ report, draws, stats, tickets }) {
  if (!report) return <div className="rounded-2xl border border-dashed border-line bg-field/60 p-8 text-center text-sm text-muted">Load the persisted report for the out-of-sample comparison. Computation runs only through the admin route or CLI.</div>;
  if (!Object.keys(report.strategies || {}).length) return <div className="rounded-2xl border border-dashed border-line bg-field/60 p-8 text-center text-sm text-muted">{report.message || 'No persisted report is available yet.'}</div>;

  const activity = buildActivity(draws, stats, tickets);
  const ranked = Object.entries(report.strategies || {}).sort((a, b) => Number(b[1].hits_at_6) - Number(a[1].hits_at_6));
  const best = ranked[0] || ['—', {}];
  const random = report.random_comparisons?.[best[0]] || {};
  const yearMonths = backtestMonths(report);

  return (
    <DashGrid
      weeks={activity.weeks}
      heatmapTitle="Walk-forward activity"
      heatmapDetail={`${report.evaluated_draws} targets · ${formatEnglishDate(report.first_target_date)} — ${formatEnglishDate(report.last_target_date)}`}
      metrics={[
        { label: 'Targets', value: report.evaluated_draws, detail: `seed ${report.seed}` },
        { label: 'Best Hits@6', value: Number(best[1].hits_at_6 || 0).toFixed(3), detail: strategyLabel(best[0]) },
        { label: 'Random mean', value: Number(random.random_mean || 0).toFixed(3), detail: 'uniform tickets' },
        { label: 'Best p', value: pValue(random.empirical_p_value), detail: `${((random.percentile || 0) * 100).toFixed(1)} percentile` },
        { label: 'Best NDCG@10', value: Number(best[1].ndcg_at_10 || 0).toFixed(3), detail: 'ranking quality' },
        { label: 'Best Brier', value: Number(best[1].brier_score || 0).toFixed(4), detail: 'lower is better' },
        { label: 'Strategies', value: Object.keys(report.strategies).length, detail: 'walk-forward' },
        { label: 'Mode', value: 'Expanding', detail: report.mode?.replaceAll('_', ' ') || 'draw by draw' }
      ]}
      weekday={activity.weekday}
      weekdayRight={activity.selected.length ? 'Avg hits' : 'Avg sum'}
      months={yearMonths.length ? yearMonths : activity.months}
      monthTitle={yearMonths.length ? 'Year Hits@6' : '12-month activity'}
      monthLeft={yearMonths.length ? 'Hits@6 %' : 'Draws'}
      monthRight={yearMonths.length ? 'Random %' : (activity.selected.length ? 'Ticket hits' : 'Avg sum')}
      mix={backtestMix(report)}
      mixTitle="Vs random"
      mixCaption="strategies"
      bars={backtestBars(report)}
      barsTitle="Hits@6 vs random"
      extra={(
        <section className="dash-extra chart-card">
          <header className="chart-card__head">
            <h2>Strategy table</h2>
            <p>{report.conclusion}</p>
          </header>
          <BacktestTable report={report} />
        </section>
      )}
    />
  );
}

export function Loto649LabPage({ game, onGameChange, activeTab = 'inference', onTabChange, tickets = [], recentDraws = [], stats = null, selectedNumber, onSelectNumber }) {
  const [numbersPayload, setNumbersPayload] = useState(null);
  const [tests, setTests] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [models, setModels] = useState(null);
  const [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(selectedNumber || 0);
  const [localTab, setLocalTab] = useState(activeTab);
  const [backtest, setBacktest] = useState(null);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [error, setError] = useState('');
  const tab = onTabChange ? activeTab : localTab;
  const setTab = onTabChange || setLocalTab;

  useEffect(() => {
    if (selectedNumber) setSelected(selectedNumber);
  }, [selectedNumber]);

  const selectNumber = (number) => {
    setSelected(number);
    onSelectNumber?.(number);
  };

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
      setSelected((current) => current || predicted.ranking?.[0]?.number || 1);
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
  const ticketSet = useMemo(() => ticketNumberSet(tickets), [tickets]);

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
    <article className="page-stack">
      <header className="chart-card chart-card__head--row lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <section>
          <p className="flex flex-wrap gap-2"><Badge tone="teal">zero leakage</Badge><Badge tone="gold">FDR preferred</Badge><Badge>6/49 only</Badge></p>
          <h2 className="mt-3 text-2xl font-bold tracking-[-0.03em] text-ink">Statistical Lab</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Inference, per-number evidence, relationships, and walk-forward evaluation. Ticket numbers stay highlighted when you have an active line.</p>
        </section>
        <Tabs items={TABS} active={tab} onChange={setTab} />
      </header>

      {tab === 'inference' ? <InferenceBody tests={tests} draws={recentDraws} stats={stats} tickets={tickets} onInspectNumber={selectNumber} /> : null}

      {tab === 'backtest' ? (
        <>
          <section className="chart-card chart-card__head--row lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <h2 className="text-lg font-bold text-ink">Walk-forward backtesting</h2>
              <p className="mt-1 text-xs leading-5 text-muted">Strategies are scored only on draws after their training history. Random percentiles are performance baselines, not the uniform-draw inference simulation.</p>
            </div>
            <button type="button" disabled={backtestLoading} onClick={loadBacktest} className="rounded-full bg-primary px-4 py-2.5 text-xs font-bold text-field disabled:opacity-40">{backtestLoading ? 'Loading…' : backtest ? 'Reload' : 'Load persisted report'}</button>
          </section>
          {backtestLoading ? <LoadingBlock rows={8} /> : <BacktestBody report={backtest} draws={recentDraws} stats={stats} tickets={tickets} />}
        </>
      ) : null}

      {['number', 'relationships', 'prediction'].includes(tab) ? (
        !detail ? <LoadingBlock rows={8} /> : tab === 'number' ? (
          <NumberExplorerGrid detail={detail} draws={recentDraws} stats={stats} numbers={numbers} selected={selected} onSelect={selectNumber} tickets={tickets} drawCount={numbersPayload.draw_count} />
        ) : tab === 'relationships' ? (
          <RelationshipsGrid detail={detail} draws={recentDraws} stats={stats} numbers={numbers} selected={selected} onSelect={selectNumber} tickets={tickets} ticketSet={ticketSet} drawCount={numbersPayload.draw_count} />
        ) : (
          <PredictionGrid detail={detail} draws={recentDraws} stats={stats} numbers={numbers} selected={selected} onSelect={selectNumber} tickets={tickets} drawCount={numbersPayload.draw_count} prediction={prediction} models={models} />
        )
      ) : null}
    </article>
  );
}
