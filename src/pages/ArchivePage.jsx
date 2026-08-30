import { useMemo } from 'react';
import { Archive, X } from 'lucide-react';
import { ActivityBoard } from '../components/charts';
import { DrawTable, NumberPill } from '../components/lottery';
import { formatDrawDate } from '../lib/format';
import { DataTable, IconButton, Panel } from '../components/ui';

function RawArchivePreview({ draw, onClose }) {
  if (!draw) return null;
  const rows = Object.entries(draw.category_data || {}).map(([category, values]) => ({
    category,
    wins: values.numar_castiguri || '—',
    report: values.report || '—',
    prize: values.valoare_castig || '—'
  }));

  return (
    <Panel title={`${draw.game_label || draw.game} draw details`} icon={Archive} action={<IconButton label="Close details" icon={X} onClick={onClose} />}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="text-sm font-black text-ink">{formatDrawDate(draw)}</div>
          <div className="mt-1 text-xs font-bold text-muted">{draw.draw_date_iso} · {draw.year}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(draw.drawn_numbers || []).map((number, index) => <NumberPill key={`${number}-${index}`} value={number} />)}
            {draw.joker_number ? <NumberPill value={draw.joker_number} tone="joker" /> : null}
          </div>
        </div>
        <div className="rounded-2xl bg-elevated p-4 text-sm">
          <div className="font-black text-ink">Structured archive data</div>
          <div className="mt-2 text-xs font-bold text-muted">Category breakdown from extracted archive records.</div>
        </div>
      </div>
      <div className="mt-5">
        <CategoryTable rows={rows} />
      </div>
    </Panel>
  );
}

function CategoryTable({ rows }) {
  const columns = useMemo(() => [
    { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => <span className="font-bold text-ink">{getValue()}</span> },
    { accessorKey: 'wins', header: 'Wins' },
    { accessorKey: 'report', header: 'Report' },
    { accessorKey: 'prize', header: 'Prize' }
  ], []);

  return <DataTable data={rows} columns={columns} empty="No category rows for this draw." />;
}

export function ArchivePage({
  historyPayload,
  historyOffset,
  setHistoryOffset,
  historyLimit,
  setHistoryLimit,
  historyYear,
  setHistoryYear,
  rawPreview,
  setRawPreview,
  tickets = [],
  recentDraws = [],
  stats = null,
  onInspectNumber,
  onOpenTicket
}) {
  const years = historyPayload?.years || [];
  const draws = historyPayload?.draws || [];
  const total = historyPayload?.total || 0;

  return (
    <article className="page-stack">
      {rawPreview ? <RawArchivePreview draw={rawPreview} onClose={() => setRawPreview(null)} /> : null}

      <ActivityBoard
        draws={recentDraws}
        stats={stats}
        tickets={tickets}
        onNumberClick={onInspectNumber}
        onOpenTicket={onOpenTicket}
        extra={(
          <section className="dash-extra chart-card">
            <header className="chart-card__head chart-card__head--row">
              <div>
                <h2>Draw archive</h2>
                <p>Official history for the selected game. Tickets overlay the same heatmap as Dashboard.</p>
              </div>
              <label className="sr-only" htmlFor="archiveYear">Filter by year</label>
              <select
                id="archiveYear"
                value={historyYear}
                onChange={(event) => {
                  setHistoryYear(event.target.value);
                  setHistoryOffset(0);
                }}
                className="rounded-full border border-line bg-elevated px-4 py-2 text-xs font-bold outline-none"
              >
                <option value="">All years</option>
                {years.map((year) => <option key={year} value={year}>{year}</option>)}
              </select>
            </header>
            <DrawTable
              draws={draws}
              onOpenRaw={setRawPreview}
              total={total}
              offset={historyOffset}
              limit={historyLimit}
              onPageChange={(offset, limit) => {
                setHistoryOffset(offset);
                setHistoryLimit?.(limit);
              }}
            />
          </section>
        )}
      />
    </article>
  );
}
