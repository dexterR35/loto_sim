import { Archive, History, X } from 'lucide-react';
import { DrawTable, NumberPill } from '../components/lottery';
import { IconButton, Panel } from '../components/ui';

function Pagination({ offset, limit, total, onPrev, onNext }) {
  const start = total ? offset + 1 : 0;
  const end = Math.min(offset + limit, total || 0);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm font-bold text-slate-600">
      <span>{start}-{end} of {total || 0}</span>
      <div className="flex gap-2">
        <button type="button" onClick={onPrev} disabled={offset <= 0} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">Prev</button>
        <button type="button" onClick={onNext} disabled={offset + limit >= (total || 0)} className="rounded-md border border-line px-3 py-1 disabled:opacity-50">Next</button>
      </div>
    </div>
  );
}

function RawArchivePreview({ draw, onClose }) {
  if (!draw) return null;
  const categories = Object.entries(draw.category_data || {});
  return (
    <Panel title={`${draw.game_label || draw.game} draw details`} icon={Archive} action={<IconButton label="Close details" icon={X} onClick={onClose} />} bodyClassName="p-0">
      <div className="grid gap-4 border-b border-line p-4 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="text-sm font-black text-ink">{draw.draw_date_raw}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">{draw.draw_date_iso} · {draw.year}</div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(draw.drawn_numbers || []).map((number, index) => <NumberPill key={`${number}-${index}`} value={number} />)}
            {draw.joker_number ? <NumberPill value={draw.joker_number} tone="joker" /> : null}
          </div>
        </div>
        <div className="rounded-lg border border-line bg-field p-3 text-sm">
          <div className="font-black text-ink">Structured archive data</div>
          <div className="mt-2 text-xs font-bold text-slate-500">Category breakdown from extracted archive records.</div>
        </div>
      </div>
      <div className="overflow-auto p-4">
        <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr className="text-xs uppercase text-slate-500">
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
                <td className="border-b border-line px-3 py-3 text-slate-600">{values.numar_castiguri || '-'}</td>
                <td className="border-b border-line px-3 py-3 text-slate-600">{values.report || '-'}</td>
                <td className="border-b border-line px-3 py-3 text-slate-600">{values.valoare_castig || '-'}</td>
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
    <div className="space-y-5">
      <Panel title="Archive controls" icon={Archive}>
        <div className="max-w-xs">
          <label className="mb-2 block text-xs font-black uppercase text-slate-500" htmlFor="archiveYear">Year</label>
          <select id="archiveYear" value={historyYear} onChange={(event) => { setHistoryYear(event.target.value); setHistoryOffset(0); }} className="h-11 w-full rounded-md border border-line bg-white px-3 text-sm font-black outline-none focus:border-teal">
            <option value="">All years</option>
            {years.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </div>
      </Panel>

      {rawPreview ? <RawArchivePreview draw={rawPreview} onClose={() => setRawPreview(null)} /> : null}

      <Panel title="Full draw history" icon={History} bodyClassName="p-0">
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
