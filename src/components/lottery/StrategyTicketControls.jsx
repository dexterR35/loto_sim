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
    <div className={`grid gap-4 lg:grid-cols-2 ${disabled ? 'pointer-events-none opacity-60' : ''}`}>
      <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted">
          <Wand2 size={14} className="text-primary" /> Strategie
        </div>
        <div className="grid grid-cols-3 gap-2">
          {strategies.map(({ key, label, icon: Icon, description }) => (
            <button
              key={key}
              type="button"
              disabled={disabled}
              onClick={() => onStrategyChange(key)}
              title={description}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2.5 transition disabled:cursor-not-allowed ${
                strategy === key
                  ? 'border-primary bg-primary text-white shadow-sm'
                  : 'border-line bg-field/40 text-ink hover:border-primary/40 hover:bg-primary/5'
              }`}
            >
              <Icon size={15} className={strategy === key ? 'text-white' : 'text-primary'} />
              <span className="text-center text-[10px] font-black leading-tight">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-muted">
          <Sparkles size={14} className="text-primary" /> Număr bilete
        </div>
        <TicketCountControls
          ticketCount={ticketCount}
          onTicketCountChange={onTicketCountChange}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
