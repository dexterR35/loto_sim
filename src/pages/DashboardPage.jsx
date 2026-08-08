import { Activity, Archive, Wand2 } from 'lucide-react';
import { DrawCard, FrequencyBars, OverdueList } from '../components/lottery';
import { LoadingBlock, Panel } from '../components/ui';

export function DashboardPage({ stats, recentDraws, onViewChange }) {
  return (
    <div className="space-y-6">
      <Panel
        title="Recent draws"
        icon={Archive}
        action={
          <button type="button" onClick={() => onViewChange('archive')} className="rounded-xl bg-ink px-3 py-2 text-sm font-black text-white hover:bg-slate-800">
            Full history
          </button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {recentDraws.slice(0, 4).map((draw, index) => (
            <DrawCard key={`${draw.draw_date_iso}-${index}`} draw={draw} onOpen={() => onViewChange('archive')} />
          ))}
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Hot numbers" icon={Activity}>
          {stats ? <FrequencyBars items={stats.hot} tone="hot" /> : <LoadingBlock />}
        </Panel>
        <Panel title="Cold numbers" icon={Wand2}>
          {stats ? <FrequencyBars items={stats.cold} tone="cold" /> : <LoadingBlock />}
        </Panel>
        <Panel title="Long-time-not-seen" icon={Activity}>
          {stats ? <OverdueList items={stats.overdue} /> : <LoadingBlock rows={6} />}
        </Panel>
      </div>
    </div>
  );
}
