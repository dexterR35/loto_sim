import { Archive, History, X } from 'lucide-react';
import { DrawTable, NumberPill } from '../components/lottery';
import { formatDrawDate } from '../lib/format';
import { IconButton, Panel } from '../components/ui';

function Pagination({ offset, limit, total, onPrev, onNext }) {
  const start = total ? offset + 1 : 0;
  const end = Math.min(offset + limit, total || 0);
  return (
    <nav className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-line pt-4 text-sm font-bold text-muted">
      <span>{start}-{end} of {total || 0}</span>
      <div className="flex gap-2">
        <button type="button" onClick={onPrev} disabled={offset <= 0} className="rounded-full bg-elevated px-4 py-2 disabled:opacity-40">Prev</button>
        <button type="button" onClick={onNext} disabled={offset + limit >= (total || 0)} className="rounded-full bg-elevated px-4 py-2 disabled:opacity-40">Next</button>
      </div>
    </nav>
  );
}

function RawArchivePreview({ draw, onClose }) {
  if (!draw) return null;
  const categories = Object.entries(draw.category_data || {});
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
      <div className="mt-5 overflow-auto rounded-2xl border border-line">
        <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-muted">
              <th className="border-b border-line px-3 py-3">Category</th>
              <th className="border-b border-line px-3 py-3">Wins</th>
              <th className="border-b border-line px-3 py-3">Report</th>
              <th className="border-b border-line px-3 py-3">Prize</th>
            </tr>
          </thead>
          <tbody>
            {categories.map(([category, values]) => (
              <tr key={category} className="hover:bg-field">
                <td className="border-b border-line px-3 py-3 font-black text-ink">{category}</td>
                <td className="border-b border-line px-3 py-3 text-muted">{values.numar_castiguri || '-'}</td>
                <td className="border-b border-line px-3 py-3 text-muted">{values.report || '-'}</td>
                <td className="border-b border-line px-3 py-3 text-muted">{values.valoare_castig || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function ArchivePage({ historyPayload, historyOffset, setHistoryOffset, historyLimit, historyYear, setHistoryYear, rawPreview, setRawPreview }) {
  const years = historyPayload?.years || [];
  const draws = historyPayload?.draws || [];
  const total = historyPayload?.total || 0;

  return (
    <div className="grid gap-5">
      {rawPreview ? <RawArchivePreview draw={rawPreview} onClose={() => setRawPreview(null)} /> : null}

      <Panel title="Draw archive" icon={History} action={<><label className="sr-only" htmlFor="archiveYear">Filter by year</label><select id="archiveYear" value={historyYear} onChange={(event) => { setHistoryYear(event.target.value); setHistoryOffset(0); }} className="rounded-full border border-line bg-elevated px-4 py-2 text-xs font-bold outline-none"><option value="">All years</option>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></>}>
        <DrawTable draws={draws} onOpenRaw={setRawPreview} />
        <Pagination
          offset={historyOffset}
          limit={historyLimit}
          total={total}
          onPrev={() => setHistoryOffset(Math.max(0, historyOffset - historyLimit))}
          onNext={() => setHistoryOffset(historyOffset + historyLimit)}
        />
      </Panel>
    </div>
  );
}
