import { Sparkles, Wand2 } from 'lucide-react';
import { TicketCountControls } from './Loto649TicketUI';

export function StrategyTicketControls({
  strategies,
  strategy,
  onStrategyChange,
  ticketCount,
  onTicketCountChange,
  disabled = false
}) {
  return (
    <div className={`grid gap-4 lg:grid-cols-2 ${disabled ? 'pointer-events-none opacity-50' : ''}`}>
      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted">
          <Wand2 size={14} className="text-primary" /> Strategy
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {strategies.map(({ key, label, icon: Icon, description }) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onStrategyChange(key)}
              title={description}
              className={`grid min-h-12 grid-cols-[auto_1fr] items-center gap-2 rounded-full border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed ${
                strategy === key
                  ? 'border-primary bg-primary text-field'
                  : 'border-line bg-elevated text-ink hover:border-primary/40 hover:text-primary'
              }`}
            >
              <Icon size={15} className={strategy === key ? 'text-field' : 'text-primary'} />
              <span className="text-[10px] font-bold leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-3 rounded-2xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted">
          <Sparkles size={14} className="text-primary" /> Ticket count
        </div>
        <TicketCountControls
          ticketCount={ticketCount}
          onTicketCountChange={onTicketCountChange}
          disabled={disabled}
        />
      </section>
    </div>
  );
}
