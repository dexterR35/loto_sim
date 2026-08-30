import { useMemo, useState } from 'react';
import { BarChart3, BrainCircuit, Calculator, ChevronDown, ChevronRight, Database, Hash, Search, Sparkles, Trophy } from 'lucide-react';
import {
  LineProfileStats,
  MatchHistogram,
  NumberBreakdownTable,
  ScoreBreakdown
} from './Calculator';
import { NumberPill, NumberRow } from './index';
import { Modal, Tabs, DataTable } from '../ui';
import { formatDrawDate, formatEnglishDate } from '../../lib/format';

const DETAIL_TABS = [
  { key: 'archive', label: 'Archive analysis', icon: BarChart3 },
  { key: 'ml', label: 'ML predictions', icon: BrainCircuit },
  { key: 'rag', label: 'Similar draws', icon: Database },
  { key: 'overview', label: 'Combination score', icon: Sparkles },
  { key: 'numbers', label: 'Numbers', icon: Hash }
];

function formatCategoryValue(value) {
  if (value == null || value === '' || value === 'REPORT') return value || '—';
  const num = Number(String(value).replace(/\./g, '').replace(',', '.'));
  if (Number.isNaN(num)) return value;
  return num.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MatchSummary({ histogram = [], totalDraws }) {
  const byCount = {};
  histogram.forEach((item) => {
    const key = String(item.match).replace('+J', '');
    if (!byCount[key]) byCount[key] = 0;
    byCount[key] += item.count;
  });

  const rows = [1, 2, 3, 4, 5, 6].map((n) => ({
    match: n,
    count: byCount[String(n)] || 0
  }));

  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-black text-ink">What would the historical archive have returned for these numbers?</h3>
      <ul className="grid gap-1.5 text-sm">
        {rows.map(({ match, count }) => (
          <li key={match} className="grid gap-2 rounded-2xl bg-elevated px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-baseline">
            <span className="text-muted">
              Exactly <span className="font-black text-ink">{match}</span> of the selected{' '}
              {match === 1 ? 'number appeared' : 'numbers appeared'} in{' '}
              <span className="font-black text-primary">{count}</span> draws
            </span>
            {count > 0 && match >= 2 ? (
              <span className="text-xs font-bold text-secondary">(details below)</span>
            ) : null}
          </li>
        ))}
      </ul>
      {totalDraws ? (
        <p className="text-xs text-muted">Based on {totalDraws.toLocaleString('en-GB')} archive draws (1993–present).</p>
      ) : null}
    </div>
  );
}

function NumberFrequencyList({ rows = [] }) {
  const columns = useMemo(() => [
    {
      accessorKey: 'number',
      header: 'Number',
      cell: ({ row, getValue }) => <NumberPill value={getValue()} tone={row.original.signal || 'default'} size="sm" />
    },
    { accessorKey: 'count', header: 'Draws' },
    {
      accessorKey: 'last_draw_date_iso',
      header: 'Last seen',
      cell: ({ getValue }) => (getValue() ? formatEnglishDate(getValue()) : '—')
    },
    { accessorKey: 'signal', header: 'Signal' }
  ], []);
  if (!rows.length) return null;
  return (
    <DataTable
      data={rows}
      columns={columns}
      empty="No per-number archive counts."
      getRowId={(row) => String(row.number)}
    />
  );
}

function DrawMatchTable({ title, draws = [], selectedNumbers = [] }) {
  const [expanded, setExpanded] = useState(true);
  const selectedSet = useMemo(() => new Set(selectedNumbers), [selectedNumbers]);
  const columns = useMemo(() => [
    {
      accessorKey: 'draw_date_iso',
      header: 'Draw date',
      cell: ({ row }) => <span className="whitespace-nowrap font-bold text-ink">{formatDrawDate(row.original)}</span>
    },
    {
      id: 'drawn',
      header: 'Drawn numbers',
      enableSorting: false,
      cell: ({ row }) => {
        const drawn = (row.original.drawn_numbers || []).slice(0, 6);
        return (
          <div className="flex flex-wrap gap-1">
            {drawn.map((n) => (
              <span
                key={n}
                className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-black ${
                  selectedSet.has(Number(n)) ? 'bg-primary text-field' : 'bg-elevated text-muted'
                }`}
              >
                {n}
              </span>
            ))}
          </div>
        );
      }
    },
    {
      id: 'matches',
      header: 'Matches',
      enableSorting: false,
      cell: ({ row }) => {
        const drawn = (row.original.drawn_numbers || []).slice(0, 6);
        const matched = row.original.matched_numbers || drawn.filter((n) => selectedSet.has(Number(n)));
        return (
          <div className="flex flex-wrap gap-1">
            {matched.map((n) => <NumberPill key={n} value={n} tone="hot" size="sm" />)}
          </div>
        );
      }
    },
    {
      id: 'cat1',
      header: 'Cat. I',
      accessorFn: (draw) => draw.category_data?.I?.numar_castiguri,
      cell: ({ row }) => {
        const cat = row.original.category_data?.I || {};
        return <><span className="text-muted">{cat.numar_castiguri ?? '—'}</span><br /><span className="font-bold">{formatCategoryValue(cat.valoare_castig)}</span></>;
      }
    },
    {
      id: 'cat2',
      header: 'Cat. II',
      accessorFn: (draw) => draw.category_data?.II?.numar_castiguri,
      cell: ({ row }) => {
        const cat = row.original.category_data?.II || {};
        return <><span className="text-muted">{cat.numar_castiguri ?? '—'}</span><br /><span className="font-bold">{formatCategoryValue(cat.valoare_castig)}</span></>;
      }
    },
    {
      id: 'cat3',
      header: 'Cat. III',
      accessorFn: (draw) => draw.category_data?.III?.numar_castiguri,
      cell: ({ row }) => {
        const cat = row.original.category_data?.III || {};
        return <><span className="text-muted">{cat.numar_castiguri ?? '—'}</span><br /><span className="font-bold">{formatCategoryValue(cat.valoare_castig)}</span></>;
      }
    }
  ], [selectedSet]);

  if (!draws.length) return null;

  return (
    <div className="grid gap-3 rounded-2xl border border-line p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="grid w-full grid-cols-[1fr_auto] items-center gap-2 text-left text-sm font-bold text-ink"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2 text-xs font-bold text-muted">
          {draws.length} draws
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      {expanded ? (
        <DataTable
          data={draws}
          columns={columns}
          getRowId={(row, index) => row.draw_date_iso || row.draw_date_raw || String(index)}
        />
      ) : null}
    </div>
  );
}

function ArchiveAnalysis({ result }) {
  const matchesByCount = result.matches_by_count || {};
  const selected = result.numbers || [];

  return (
    <div className="grid gap-5">
      <div className="rounded-2xl bg-primary/5 p-5">
        <div className="text-xs font-black uppercase tracking-wide text-primary">Numbers submitted for analysis</div>
        <div className="mt-3">
          <NumberRow values={selected} size="md" />
        </div>
      </div>

      <p className="text-xs leading-6 text-muted">
        The information below shows when and in which combinations your selected numbers appeared in previous
        draws, from 1993 to the present.
      </p>

      <MatchSummary histogram={result.histogram} totalDraws={result.total_draws} />
      <NumberFrequencyList rows={result.number_breakdown} />

      {[6, 5, 4, 3, 2].map((level) => {
        const draws = matchesByCount[String(level)] || [];
        if (!draws.length) return null;
        return (
          <DrawMatchTable
            key={level}
            title={`Draws containing ${level} winning numbers from the submitted selection`}
            draws={draws}
            selectedNumbers={selected}
          />
        );
      })}

      {result.best_match ? (
        <div className="rounded-2xl border border-secondary/20 bg-secondary/5 p-4">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-secondary">
            <Trophy size={14} /> Best archive match
          </div>
          <div className="mt-2 text-sm font-black text-ink">
            {result.best_match.match_count} matches on {formatDrawDate(result.best_match.draw)}
          </div>
          <div className="mt-3">
            <NumberRow values={result.best_match.matched_numbers} size="sm" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AnalysisOverview({ result }) {
  return (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-elevated p-5">
        <div className="text-xs font-black uppercase tracking-wide text-muted">Analyzed line</div>
        <div className="mt-3">
          {result.code ? (
            <div className="font-mono text-3xl font-black tracking-[0.3em] text-ink">{result.code}</div>
          ) : (
            <NumberRow values={result.numbers} joker={result.joker} size="md" />
          )}
        </div>
      </div>
      <ScoreBreakdown components={result.components} score={result.score} backtest={result.backtest} />
      {result.profile?.sum != null ? <LineProfileStats profile={result.profile} /> : null}
      {result.histogram?.length ? (
        <MatchHistogram histogram={result.histogram} totalDraws={result.total_draws} />
      ) : null}
    </div>
  );
}

function SimilarDrawsTable({ draws }) {
  const columns = useMemo(() => [
    { accessorKey: 'draw_date_iso', header: 'Date', cell: ({ row }) => <span className="whitespace-nowrap font-bold text-ink">{formatDrawDate(row.original)}</span> },
    { id: 'numbers', header: 'Numbers', enableSorting: false, cell: ({ row }) => <span className="font-mono text-xs">{(row.original.drawn_numbers || []).join(', ')}</span> },
    { accessorKey: 'similarity', header: 'Similarity', cell: ({ getValue }) => `${(Number(getValue()) * 100).toFixed(1)}%` }
  ], []);
  return <DataTable data={draws} columns={columns} getRowId={(row, index) => row.draw_date_iso || row.draw_date_raw || String(index)} />;
}

function AnalysisRAG({ result }) {
  const rag = result?.rag;
  if (!rag) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-field/70 px-4 py-8 text-center text-sm text-muted">
        RAG retrieval is unavailable for this analysis.
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="rounded-2xl bg-secondary/5 p-5 text-sm">
        <div className="font-black text-secondary">Vector index</div>
        <p className="mt-1 text-muted">{rag.method}</p>
        <p className="mt-1 text-xs font-bold text-ink">{rag.indexed_draws?.toLocaleString('en-GB')} draws indexed locally</p>
      </div>

      {rag.retrieval_top_numbers?.length ? (
        <div>
          <div className="mb-2 text-sm font-black text-ink">Numbers from similar draws (RAG)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {rag.retrieval_top_numbers.map((item) => (
              <div key={item.number} className="grid grid-cols-[auto_1fr] items-center gap-1.5 rounded-full bg-elevated px-2 py-1">
                <NumberPill value={item.number} tone="cold" size="sm" />
                <span className="text-[10px] font-black text-secondary">{(item.weight * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {rag.similar_draws?.length ? (
        <SimilarDrawsTable draws={rag.similar_draws} />
      ) : null}
    </div>
  );
}

function MlNumberTable({ rows }) {
  const columns = useMemo(() => [
    { accessorKey: 'number', header: 'Number', cell: ({ getValue }) => <NumberPill value={getValue()} tone="hot" size="sm" /> },
    { accessorKey: 'rank', header: 'Rank ML', cell: ({ getValue }) => `#${getValue()}` },
    { accessorKey: 'probability_blend', header: 'Prob. blend', cell: ({ getValue }) => <span className="font-bold text-grape">{(Number(getValue()) * 100).toFixed(1)}%</span> },
    { accessorKey: 'archive_count', header: 'Archive', cell: ({ getValue }) => `${getValue()}×` }
  ], []);
  return <DataTable data={rows} columns={columns} getRowId={(row) => String(row.number)} />;
}

function AnalysisML({ result }) {
  const ml = result?.ml;
  if (!ml) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-field/70 px-4 py-8 text-center text-sm text-muted">
        ML predictions are unavailable for this analysis.
      </div>
    );
  }

  const line = ml.line_score || {};
  const models = ml.models || {};

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-grape/20 bg-grape/5 p-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-grape">ML line score</div>
          <div className="mt-1 text-3xl font-black text-ink">{line.ml_line_score ?? '—'}</div>
          <div className="text-xs text-muted">mean probability × 100</div>
        </div>
        <div className="rounded-2xl bg-elevated p-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-muted">sklearn AUC</div>
          <div className="mt-1 text-xl font-black text-ink">
            {models.sklearn?.metrics?.roc_auc != null
              ? Number(models.sklearn.metrics.roc_auc).toFixed(3)
              : '—'}
          </div>
        </div>
        <div className="rounded-2xl bg-elevated p-4">
          <div className="text-[10px] font-black uppercase tracking-wide text-muted">LSTM AUC</div>
          <div className="mt-1 text-xl font-black text-ink">
            {models.lstm?.metrics?.val_auc != null
              ? Number(models.lstm.metrics.val_auc).toFixed(3)
              : '—'}
          </div>
        </div>
      </div>

      {ml.training_note ? (
        <p className="text-xs text-secondary font-bold">{ml.training_note}</p>
      ) : null}

      {line.per_number?.length ? (
        <MlNumberTable rows={line.per_number} />
      ) : null}

      {ml.top_numbers?.length ? (
        <div>
          <div className="mb-2 text-sm font-black text-ink">Top 12 global predictions (full archive)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {ml.top_numbers.map((item) => (
              <div key={item.number} className="grid grid-cols-[auto_1fr] items-center gap-1.5 rounded-full bg-elevated px-2 py-1">
                <NumberPill value={item.number} tone="default" size="sm" />
                <span className="text-[10px] font-black text-grape">{(item.probability_blend * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {ml.features?.length ? (
        <ul className="grid gap-1 text-xs text-muted">
          {ml.features.map((f) => (
            <li key={f}>· {f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AnalysisDetailModal({ open, onClose, result, loading = false }) {
  const [activeTab, setActiveTab] = useState('archive');

  const title = result?.code
    ? `Noroc analysis ${result.code}`
    : 'Number analysis for a simple or multiple Loto 6/49 combination';
  const description = result?.numbers?.length
    ? `Numbers: ${result.numbers.join(', ')}`
    : 'Statistical information from the draw archive';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      icon={Search}
      size="full"
    >
      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm font-bold text-muted">Analyzing the archive…</div>
      ) : result ? (
        <div className="grid gap-4">
          <Tabs items={DETAIL_TABS} active={activeTab} onChange={setActiveTab} />
          <div className="pt-1">
            {activeTab === 'archive' ? <ArchiveAnalysis result={result} /> : null}
            {activeTab === 'ml' ? <AnalysisML result={result} /> : null}
            {activeTab === 'rag' ? <AnalysisRAG result={result} /> : null}
            {activeTab === 'overview' ? <AnalysisOverview result={result} /> : null}
            {activeTab === 'numbers' ? <NumberBreakdownTable rows={result.number_breakdown} /> : null}
          </div>
        </div>
      ) : (
        <div className="flex min-h-48 flex-col items-center justify-center text-center">
          <Calculator className="mb-2 text-primary" size={22} />
          <div className="text-sm font-black text-ink">No analysis yet</div>
          <p className="mt-2 max-w-md text-sm text-muted">Select numbers and choose “Analyze combination”.</p>
        </div>
      )}
    </Modal>
  );
}
