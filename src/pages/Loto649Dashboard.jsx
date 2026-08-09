import { useEffect, useState } from 'react';
import { Archive, ShieldCheck, Target } from 'lucide-react';
import { api } from '../lib/api';
import { formatDrawDate, formatEnglishDate, formatEnglishNumber } from '../lib/format';
import { DrawCard, NumberRow } from '../components/lottery';
import { Badge, LoadingBlock, Panel } from '../components/ui';

function Metric({ label, value, detail, tone = 'default' }) {
  const palette = tone === 'watch' ? 'border-gold/30 bg-gold/5' : tone === 'good' ? 'border-teal/25 bg-teal/5' : 'border-line bg-surface';
  return (
    <article className={`rounded-2xl border p-5 ${palette}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className="mt-3 text-2xl font-bold tracking-tight text-ink">{value ?? '—'}</div>
      <div className="mt-1 text-xs font-semibold leading-5 text-muted">{detail}</div>
    </article>
  );
}

function formatP(value) {
  if (value == null) return '—';
  const number = Number(value);
  return number < 0.0001 ? number.toExponential(2) : number.toFixed(4);
}

export function Loto649Dashboard({ recentDraws, onViewChange }) {
  const [summary, setSummary] = useState(null);
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api('/api/649/statistics', { signal: controller.signal }),
      api('/api/649/prediction/latest', { signal: controller.signal }),
    ])
      .then(([statistics, predicted]) => {
        setSummary(statistics);
        setPrediction(predicted);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, []);

  const verdict = summary?.global_tests?.verdict;
  const nullCompatible = verdict === 'insufficient_evidence_against_uniform_null';

  if (error) return <div className="rounded-2xl border border-coral/20 bg-coral/5 p-5 text-sm font-bold text-coral">{error}</div>;
  if (!summary || !prediction) return <LoadingBlock rows={8} />;

  return (
    <div className="grid gap-5">
      <header className="grid gap-6 rounded-2xl border border-line bg-surface p-6 sm:p-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="teal">6/49 overview</Badge>
              <span className="text-xs font-bold text-muted">dataset {summary.dataset_version?.slice(0, 10)}</span>
            </div>
            <h2 className="mt-5 max-w-3xl text-3xl font-bold leading-tight tracking-[-0.035em] text-ink sm:text-5xl">Lottery research,<br className="hidden sm:block" /> without the noise.</h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">Latest official result, a transparent research verdict, and the next-draw experiment. Detailed evidence stays in the Lab.</p>
          </div>
          <button type="button" onClick={() => onViewChange('statistics', 'inference')} className="rounded-full bg-primary px-5 py-3 text-sm font-bold text-field transition-colors hover:bg-primary-light">
            Open Statistical Lab
          </button>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Validated draws" value={formatEnglishNumber(summary.draw_count)} detail={`${formatEnglishDate(summary.date_range.first)} — ${formatEnglishDate(summary.date_range.last)}`} />
        <Metric label="Latest official draw" value={formatDrawDate(recentDraws?.[0])} detail={(recentDraws?.[0]?.drawn_numbers || []).join(' · ')} />
        <Metric label="Research verdict" value={nullCompatible ? 'Random-compatible' : 'Review required'} detail={`global test p ${formatP(summary.global_tests.p_value)}`} tone={nullCompatible ? 'good' : 'watch'} />
        <Metric label="Next official check" value={formatEnglishDate(summary.next_scheduled_update)} detail="Thursday/Sunday updater · unpublished results are a clean no-op" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(22rem,.85fr)]">
        <Panel title={`Experimental ranking · ${formatEnglishDate(prediction.target_draw_date)}`} icon={Target} action={<Badge tone={prediction.snapshot_status === 'immutable' ? 'teal' : 'gold'}>{prediction.snapshot_status}</Badge>}>
          <div className="rounded-2xl bg-elevated p-5">
            <div className="text-[10px] font-black uppercase tracking-wider text-primary">Top 6 by rank</div>
            <div className="mt-4"><NumberRow values={prediction.top_6} size="lg" gap="gap-3" /></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div><div className="text-[10px] font-black uppercase text-muted">Model</div><div className="mt-1 text-sm font-bold text-ink">{prediction.model_version}</div></div>
              <div><div className="text-[10px] font-black uppercase text-muted">Disagreement</div><div className="mt-1 text-sm font-bold text-ink">{prediction.uncertainty?.ensemble_disagreement}</div></div>
              <div><div className="text-[10px] font-black uppercase text-muted">Confidence</div><div className="mt-1 text-sm font-bold text-ink">{prediction.uncertainty?.prediction_confidence}</div></div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted">Confidence describes model stability and agreement; it is not a ticket's probability of winning.</p>
          <button type="button" onClick={() => onViewChange('statistics', 'prediction')} className="mt-4 rounded-full bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary hover:bg-primary/15">Inspect prediction and models</button>
        </Panel>

        <Panel title="Research status" icon={ShieldCheck}>
          <div className={`rounded-2xl border p-5 ${nullCompatible ? 'border-teal/25 bg-teal/5' : 'border-gold/30 bg-gold/5'}`}>
            <div className="text-xs font-black uppercase tracking-wide text-muted">H₀: uniform 6/49 mechanism</div>
            <div className="mt-2 text-lg font-black text-ink">{nullCompatible ? 'Insufficient evidence against H₀' : 'Global deviation requires investigation'}</div>
            <p className="mt-2 text-xs leading-5 text-muted">{summary.global_tests.warning}</p>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted">The dashboard shows only the verdict. Chi-square, FDR, entropy, drift, and uniform-draw simulations live in the Lab.</p>
          <button type="button" onClick={() => onViewChange('statistics', 'inference')} className="mt-4 rounded-full bg-elevated px-4 py-2.5 text-xs font-bold text-ink hover:text-primary">Open detailed inference</button>
        </Panel>
      </div>

      <Panel title="Recent official draws" icon={Archive} action={<button type="button" onClick={() => onViewChange('archive')} className="rounded-full bg-elevated px-4 py-2 text-xs font-bold text-ink hover:text-primary">Full history</button>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{recentDraws.slice(0, 4).map((draw, index) => <DrawCard key={`${draw.draw_date_iso}-${index}`} draw={draw} onOpen={() => onViewChange('archive')} />)}</div>
      </Panel>

    </div>
  );
}
