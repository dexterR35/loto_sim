import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarDays, Hash, Loader2, Search, Trophy } from 'lucide-react';
import { api } from '../lib/api';
import { NumberPill, NumberRow } from '../components/lottery';
import { LoadingBlock, Panel } from '../components/ui';

function signalTone(signal) {
  if (signal === 'hot') return 'hot';
  if (signal === 'cold') return 'cold';
  if (signal === 'overdue') return 'overdue';
  return 'default';
}

function StatTile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-line bg-field/70 p-4">
      <div className="text-[10px] font-black uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-black text-ink">{value}</div>
      {sub ? <div className="mt-1 text-xs font-bold text-muted">{sub}</div> : null}
    </div>
  );
}

function PercentRow({ label, value, tone = 'primary' }) {
  const pct = Number(value) || 0;
  const color =
    tone === 'secondary'
      ? 'from-secondary to-teal'
      : tone === 'gold'
        ? 'from-gold to-primary'
        : 'from-primary to-secondary';

  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs font-black text-muted">
        <span>{label}</span>
        <span className="text-ink">{pct.toFixed(1)}%</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full bg-gradient-to-r ${color}`} style={{ width: `${Math.min(100, Math.max(4, pct))}%` }} />
      </div>
    </div>
  );
}

function buildDistribution(payload) {
  const rows = payload?.numbers || [];
  const pool = Number(payload?.pool) || 49;
  const total = rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0) || 1;
  const split = Math.ceil(pool / 2);
  const even = rows.filter((item) => item.number % 2 === 0).reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const low = rows.filter((item) => item.number <= split).reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const decades = Array.from({ length: Math.ceil(pool / 10) }, (_, index) => {
    const start = index * 10 + 1;
    const end = Math.min((index + 1) * 10, pool);
    const count = rows
      .filter((item) => item.number >= start && item.number <= end)
      .reduce((sum, item) => sum + (Number(item.count) || 0), 0);

    return { label: `${start}-${end}`, pct: (count / total) * 100 };
  });

  return {
    parity: [
      { label: 'Pare', pct: (even / total) * 100 },
      { label: 'Impare', pct: ((total - even) / total) * 100 },
    ],
    size: [
      { label: `Mari (>${split})`, pct: ((total - low) / total) * 100 },
      { label: `Mici (≤${split})`, pct: (low / total) * 100 },
    ],
    decades,
  };
}

function DistributionPanel({ payload }) {
  const distribution = buildDistribution(payload);

  return (
    <Panel title="Distribuție" icon={BarChart3} bodyClassName="p-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Pare / Impare</div>
          <div className="space-y-2">
            {distribution.parity.map((item, index) => (
              <PercentRow key={item.label} label={item.label} value={item.pct} tone={index ? 'secondary' : 'primary'} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Mari / Mici</div>
          <div className="space-y-2">
            {distribution.size.map((item, index) => (
              <PercentRow key={item.label} label={item.label} value={item.pct} tone={index ? 'secondary' : 'gold'} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Pe decade</div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {distribution.decades.map((item) => (
              <PercentRow key={item.label} label={item.label} value={item.pct} tone="gold" />
            ))}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function MonthGrid({ rows = [] }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div key={row.month} className="rounded-lg border border-line bg-white px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs font-black uppercase text-muted">
            <span>{row.label}</span>
            <span className="text-ink">{row.count}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-secondary" style={{ width: `${Math.max(5, (row.count / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function YearTable({ rows = [] }) {
  const visible = rows.filter((row) => row.count > 0).slice(0, 18);
  if (!visible.length) return <div className="rounded-xl border border-dashed border-line bg-field/60 p-6 text-center text-sm text-muted">Fără apariții în arhivă.</div>;
  const max = Math.max(...visible.map((row) => row.count), 1);
  return (
    <div className="overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[420px] text-left text-sm">
        <thead>
          <tr className="bg-field text-[10px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2">An</th>
            <th className="px-3 py-2">Apariții</th>
            <th className="px-3 py-2">Scor anual</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.year} className="border-t border-line">
              <td className="px-3 py-2 font-black text-ink">{row.year}</td>
              <td className="px-3 py-2 font-bold text-muted">{row.count}</td>
              <td className="px-3 py-2">
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-gold to-primary" style={{ width: `${Math.max(6, (row.count / max) * 100)}%` }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberCard({ item, active, onSelect }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.number)}
      className={`rounded-xl border p-3 text-left transition ${
        active ? 'border-primary bg-primary/5 shadow-sm' : 'border-line bg-white hover:border-primary/40 hover:bg-field/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <NumberPill value={item.number} tone={signalTone(item.signal)} size="md" />
        <span className="text-xs font-black text-primary">{Number(item.score).toFixed(1)}</span>
      </div>
      <div className="mt-2 text-[10px] font-bold uppercase text-muted">{item.count} apariții</div>
    </button>
  );
}

export function NumberAnalysisPage({ game, gameLabel }) {
  const [payload, setPayload] = useState(null);
  const [selected, setSelected] = useState(null);
  const [sortMode, setSortMode] = useState('score');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError('');
    setPayload(null);
    setSelected(null);
    api(`/api/number-analysis?game=${encodeURIComponent(game)}`, { signal: ac.signal })
      .then((data) => {
        setPayload(data);
        setSelected(data.numbers?.[0]?.number || null);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [game]);

  const numbers = useMemo(() => {
    const rows = payload?.numbers || [];
    if (sortMode === 'number') return rows.slice().sort((a, b) => a.number - b.number);
    if (sortMode === 'cold') return rows.slice().sort((a, b) => a.count - b.count || a.number - b.number);
    if (sortMode === 'overdue') return rows.slice().sort((a, b) => b.draws_since_seen - a.draws_since_seen || a.number - b.number);
    return rows.slice().sort((a, b) => b.score - a.score || a.number - b.number);
  }, [payload, sortMode]);

  const current = numbers.find((item) => item.number === selected) || numbers[0];

  if (loading) {
    return <LoadingBlock rows={8} />;
  }

  if (error) {
    return <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm font-black text-primary">{error}</div>;
  }

  if (!payload || !current) {
    return <div className="rounded-xl border border-dashed border-line bg-field/70 px-4 py-8 text-center text-sm text-muted">Nu există date pentru analiză.</div>;
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
      <Panel
        title="Analiză numere"
        icon={Hash}
        bodyClassName="p-4"
        action={
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value)}
            className="h-9 rounded-lg border border-line bg-white px-2 text-xs font-black text-ink outline-none"
          >
            <option value="score">Scor</option>
            <option value="number">Număr</option>
            <option value="cold">Rece</option>
            <option value="overdue">Întârziat</option>
          </select>
        }
      >
        <div className="mb-3 text-xs font-bold text-muted">{gameLabel} · {payload.draws.toLocaleString('ro-RO')} extrageri</div>
        <div className="grid max-h-[38rem] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 xl:grid-cols-3">
          {numbers.map((item) => (
            <NumberCard key={item.number} item={item} active={item.number === current.number} onSelect={setSelected} />
          ))}
        </div>
      </Panel>

      <div className="space-y-5">
        <Panel
          title={`Numărul ${current.number}`}
          icon={Search}
          bodyClassName="p-4"
          action={<NumberPill value={current.number} tone={signalTone(current.signal)} size="md" />}
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Scor" value={Number(current.score).toFixed(1)} sub={current.signal} />
            <StatTile label="Apariții" value={current.count} sub={`${current.share}% din extrageri`} />
            <StatTile label="Recent" value={current.recent_count} sub="în ultimele 50" />
            <StatTile label="Pauză" value={current.draws_since_seen} sub="extrageri de la ultima apariție" />
          </div>

          {current.last_draw ? (
            <div className="mt-4 rounded-xl border border-secondary/20 bg-secondary/5 p-4">
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-secondary">
                <Trophy size={14} /> Ultima extragere
              </div>
              <div className="mt-2 text-sm font-black text-ink">{current.last_draw.draw_date_raw}</div>
              <div className="mt-3"><NumberRow values={current.last_draw.drawn_numbers || []} joker={current.last_draw.joker_number} size="sm" /></div>
            </div>
          ) : null}
        </Panel>

        <DistributionPanel payload={payload} />

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Pe luni" icon={CalendarDays} bodyClassName="p-4">
            <MonthGrid rows={current.by_month} />
          </Panel>
          <Panel title="Pe ani" icon={BarChart3} bodyClassName="p-4">
            <YearTable rows={current.by_year} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
