import { useEffect, useState } from 'react';
import { ActivityBoard } from '../components/charts';
import { DrawCard } from '../components/lottery';
import { CompactTicket } from '../components/lottery/CompactTicket';
import { Badge, LoadingBlock } from '../components/ui';
import { api } from '../lib/api';
import { formatEnglishDate, formatEnglishNumber } from '../lib/format';

function RecentDraws({ draws = [], onViewChange }) {
  if (!draws.length) return null;
  return (
    <section className="dash-recent chart-card">
      <header className="chart-card__head chart-card__head--row">
        <h2>Recent official draws</h2>
        <button type="button" onClick={() => onViewChange('archive')} className="rounded-full bg-elevated px-4 py-2 text-xs font-bold text-ink hover:text-primary">
          Full history
        </button>
      </header>
      <ol className="draw-grid">
        {draws.slice(0, 4).map((draw, index) => (
          <li key={`${draw.draw_date_iso}-${index}`}>
            <DrawCard draw={draw} onOpen={() => onViewChange('archive')} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ResearchStrip({ summary, prediction, onViewChange, onInspectNumber }) {
  const nullCompatible = summary?.global_tests?.verdict === 'insufficient_evidence_against_uniform_null';
  return (
    <section className="dash-extra dash-extra--split">
      <CompactTicket
        label="P"
        numbers={prediction.top_6 || []}
        onNumberClick={onInspectNumber}
        badges={<span className="ticket-panel__chip is-ready">Top 6</span>}
        footer={<p className="ticket-summary">Experimental ranking · {formatEnglishDate(prediction.target_draw_date)}</p>}
      />
      <article className="chart-card">
        <header className="chart-card__head chart-card__head--row">
          <h2>Next-draw ranking</h2>
          <Badge tone={prediction.snapshot_status === 'immutable' ? 'teal' : 'gold'}>{prediction.snapshot_status}</Badge>
        </header>
        <p className="text-xs text-muted">Model {prediction.model_version} · confidence {prediction.uncertainty?.prediction_confidence}. Ranking is not a jackpot probability.</p>
        <p className={`rounded-2xl border p-4 ${nullCompatible ? 'border-teal/25 bg-teal/5' : 'border-gold/30 bg-gold/5'}`}>
          <strong className="block text-ink">{nullCompatible ? 'Random-compatible' : 'Review required'}</strong>
          <span className="mt-1 block text-xs text-muted">{summary.global_tests.warning}</span>
        </p>
        <p className="text-xs text-muted">{formatEnglishNumber(summary.draw_count)} validated draws · {formatEnglishDate(summary.date_range.first)} — {formatEnglishDate(summary.date_range.last)}</p>
        <button type="button" onClick={() => onViewChange('statistics', 'prediction')} className="justify-self-start rounded-full bg-primary/10 px-4 py-2 text-xs font-bold text-primary">
          Inspect models
        </button>
      </article>
    </section>
  );
}

export function DashboardPage({ game, stats, recentDraws, tickets = [], onViewChange, onInspectNumber, onOpenTicket }) {
  const [research, setResearch] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (game !== '6din49') {
      setResearch(null);
      return undefined;
    }
    const controller = new AbortController();
    Promise.all([
      api('/api/649/statistics', { signal: controller.signal }),
      api('/api/649/prediction/latest', { signal: controller.signal })
    ])
      .then(([summary, prediction]) => setResearch({ summary, prediction }))
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [game]);

  if (error) return <p className="rounded-2xl border border-coral/20 bg-coral/5 p-5 text-sm font-bold text-coral">{error}</p>;
  if (!stats) return <LoadingBlock rows={8} />;

  return (
    <ActivityBoard
      draws={recentDraws}
      stats={stats}
      tickets={tickets}
      onNumberClick={onInspectNumber}
      onOpenTicket={onOpenTicket}
      extra={research ? <ResearchStrip summary={research.summary} prediction={research.prediction} onViewChange={onViewChange} onInspectNumber={onInspectNumber} /> : null}
      recentSlot={<RecentDraws draws={recentDraws} onViewChange={onViewChange} />}
    />
  );
}

export function Loto649Dashboard(props) {
  return <DashboardPage game="6din49" {...props} />;
}
