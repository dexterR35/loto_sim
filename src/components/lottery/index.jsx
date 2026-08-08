import { Search, Sparkles } from 'lucide-react';
import { GAMES } from '../../lib/constants';
import { getGameTheme } from '../../lib/gameTheme';
import { Badge } from '../ui';

const BALL_SIZES = {
  sm: 'h-8 min-w-8 text-xs',
  md: 'h-10 min-w-10 text-sm',
  lg: 'h-12 min-w-12 text-base',
  xl: 'h-14 min-w-14 text-lg'
};

const BALL_TONES = {
  default: 'bg-gradient-to-b from-white to-slate-100 text-ink ring-1 ring-line',
  hot: 'bg-gradient-to-b from-coral to-[#e31c5f] text-white',
  cold: 'bg-gradient-to-b from-teal to-secondary-dark text-white',
  overdue: 'bg-gradient-to-b from-gold to-[#b87f12] text-ink',
  joker: 'bg-gradient-to-b from-violet-600 to-violet-800 text-white',
  bonus: 'bg-gradient-to-b from-ink to-slate-700 text-white'
};

export function NumberPill({ value, tone = 'default', size = 'md' }) {
  return (
    <span className={`lottery-ball px-2 ${BALL_SIZES[size]} ${BALL_TONES[tone]}`}>
      {value}
    </span>
  );
}

export function NumberRow({ values = [], joker, size = 'md', gap = 'gap-2' }) {
  return (
    <div className={`flex flex-wrap items-center ${gap}`}>
      {values.map((number, index) => (
        <NumberPill key={`${number}-${index}`} value={number} size={size} />
      ))}
      {joker ? (
        <div className="flex items-center gap-1.5 pl-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Joker</span>
          <NumberPill value={joker} tone="joker" size={size} />
        </div>
      ) : null}
    </div>
  );
}

export function GameSwitcher({ game, onGameChange, disabled = false }) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${disabled ? 'pointer-events-none opacity-60' : ''}`} role="group" aria-label="Select game">
      {GAMES.map((item) => {
        const theme = getGameTheme(item.key);
        const isActive = game === item.key;
        return (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            onClick={() => onGameChange(item.key)}
            aria-pressed={isActive}
            className={`rounded-lg border px-3 py-1.5 text-xs font-black transition sm:px-3.5 sm:py-2 sm:text-sm ${
              isActive ? theme.switcherActive : theme.switcherIdle
            }`}
          >
            {item.full}
          </button>
        );
      })}
    </div>
  );
}

export function FrequencyBars({ items = [], tone = 'hot' }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  const barColor =
    tone === 'hot'
      ? 'bg-gradient-to-r from-coral to-[#ff5a5f]'
      : tone === 'cold'
        ? 'bg-gradient-to-r from-teal to-[#14a89c]'
        : 'bg-gradient-to-r from-gold to-[#e8b04a]';
  return (
    <div className="space-y-3">
      {items.slice(0, 10).map((item, index) => (
        <div key={item.number} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-3 text-sm">
          <div className="text-xs font-black text-slate-400">#{index + 1}</div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <NumberPill value={item.number} tone={tone} size="sm" />
              <span className="text-xs font-bold text-slate-500">{item.count} draws</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} />
            </div>
          </div>
          <div className="text-right text-xs font-black text-slate-600">
            {item.share != null ? Math.round(item.share * 100) : Math.round((item.count / max) * 100)}%
          </div>
        </div>
      ))}
    </div>
  );
}

function ScoreMeter({ score, max = 100 }) {
  const pct = Math.min(100, Math.max(8, ((Number(score) || 0) / max) * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-slate-500">
        <span>Signal score</span>
        <span className="text-ink">{Number(score).toFixed(2)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-gradient-to-r from-secondary to-gold" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function NorocDigits({ code, score }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-2">
      {String(code).split('').map((digit, index) => (
        <div key={`${digit}-${index}`} className="flex flex-col items-center gap-1">
          <span className="text-[10px] font-bold uppercase text-slate-400">P{index + 1}</span>
          <NumberPill value={digit} tone="bonus" size="lg" />
        </div>
      ))}
      <div className="ml-2">
        <Badge tone="gold">score {Number(score).toFixed(2)}</Badge>
      </div>
    </div>
  );
}

export function Ticket({ ticket, game, onAnalyze, index = 0 }) {
  if (ticket.code) {
    return (
      <article className="ticket-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Ticket #{String(index + 1).padStart(2, '0')}</div>
          <Badge tone="grape">Noroc</Badge>
        </div>
        <NorocDigits code={ticket.code} score={ticket.score} />
      </article>
    );
  }

  const maxScore = 100;
  const componentRows = ticket.components
    ? [
        { label: 'Hot', value: ticket.components.hot },
        { label: 'Overdue', value: ticket.components.overdue },
        { label: 'Pairs', value: ticket.components.pair_strength }
      ]
    : [];

  return (
    <article className="ticket-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">Ticket #{String(index + 1).padStart(2, '0')}</div>
        <Badge tone="primary">score {Number(ticket.score).toFixed(2)}</Badge>
      </div>
      <div className="flex justify-center py-2">
        <NumberRow values={ticket.numbers} joker={game === 'joker' ? ticket.joker : null} size="lg" gap="gap-2.5" />
      </div>
      <div className="mt-4 space-y-3 border-t border-line pt-4">
        <ScoreMeter score={ticket.score} max={maxScore} />
        {ticket.backtest_score != null ? (
          <div className="flex items-center justify-between rounded-lg bg-field px-3 py-2 text-xs font-bold text-slate-600">
            <span>MC backtest yield</span>
            <span className="font-black text-secondary">{ticket.backtest_score}</span>
          </div>
        ) : null}
        {componentRows.length ? (
          <div className="grid grid-cols-3 gap-2">
            {componentRows.map((row) => (
              <div key={row.label} className="rounded-lg bg-field px-2 py-2 text-center">
                <div className="text-[10px] font-black uppercase text-slate-500">{row.label}</div>
                <div className="text-sm font-black text-ink">{Number(row.value).toFixed(0)}</div>
              </div>
            ))}
          </div>
        ) : null}
        {onAnalyze ? (
          <button
            type="button"
            onClick={() => onAnalyze(ticket)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-field px-3 py-2.5 text-xs font-black text-ink transition hover:border-primary hover:bg-primary/5 hover:text-primary"
          >
            <Search size={14} /> Analyze against archive
          </button>
        ) : null}
      </div>
    </article>
  );
}

export function TicketGrid({ tickets = [], game, onAnalyze, emptyLabel = 'Generate tickets to see picks here.' }) {
  if (!tickets.length) {
    return (
      <div className="flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-field/70 px-6 py-10 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-primary shadow-sm">
          <Sparkles size={22} />
        </div>
        <div className="text-sm font-black text-ink">No tickets yet</div>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
      {tickets.map((ticket, index) => (
        <Ticket key={`${index}-${ticket.code || ticket.numbers?.join('-')}`} ticket={ticket} game={game} onAnalyze={onAnalyze} index={index} />
      ))}
    </div>
  );
}

export function DrawCard({ draw, onOpen }) {
  return (
    <article className="rounded-xl border border-line bg-white p-4 shadow-card transition hover:border-primary/30 hover:shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-ink">{draw.draw_date_raw}</div>
          <div className="mt-1 text-xs font-bold text-slate-500">{draw.draw_date_iso} · {draw.year}</div>
        </div>
        {onOpen ? (
          <button type="button" onClick={() => onOpen(draw)} className="rounded-lg border border-line bg-field px-2.5 py-1 text-xs font-black text-ink hover:border-primary hover:text-primary">
            Details
          </button>
        ) : null}
      </div>
      <div className="mt-4">
        <NumberRow values={draw.drawn_numbers || []} joker={draw.joker_number} size="md" />
      </div>
      <div className="mt-3 text-xs font-semibold text-slate-500">
        {draw.fond_castiguri || draw.category_data?.I?.report || draw.category_data?.['1']?.report || 'No report data'}
      </div>
    </article>
  );
}

export function DrawTable({ draws, onOpenRaw }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            <th className="border-b border-line px-3 py-3">Date</th>
            <th className="border-b border-line px-3 py-3">Numbers</th>
            <th className="border-b border-line px-3 py-3">Report/Fond</th>
            <th className="border-b border-line px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {draws.map((draw, rowIndex) => (
            <tr key={`${draw.game}-${draw.draw_date_iso}-${rowIndex}`} className="transition hover:bg-field/80">
              <td className="border-b border-line px-3 py-3 font-black text-ink">
                <div>{draw.draw_date_raw}</div>
                <div className="mt-1 text-xs font-bold text-slate-500">{draw.year}</div>
              </td>
              <td className="border-b border-line px-3 py-3">
                <NumberRow values={draw.drawn_numbers || []} joker={draw.joker_number} size="sm" />
              </td>
              <td className="border-b border-line px-3 py-3 text-slate-600">
                {draw.fond_castiguri || draw.category_data?.I?.report || draw.category_data?.['1']?.report || '-'}
              </td>
              <td className="border-b border-line px-3 py-3">
                {onOpenRaw ? (
                  <button type="button" onClick={() => onOpenRaw(draw)} className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-black text-ink hover:border-primary hover:text-primary">
                    Details
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverdueList({ items = [] }) {
  return (
    <div className="space-y-2">
      {items.slice(0, 10).map((item, index) => (
        <div key={item.number} className="flex items-center gap-3 rounded-xl border border-line bg-field px-3 py-2.5">
          <div className="text-xs font-black text-slate-400">#{index + 1}</div>
          <NumberPill value={item.number} tone="overdue" size="sm" />
          <div className="ml-auto text-right">
            <div className="text-sm font-black text-ink">{item.draws_since_seen}</div>
            <div className="text-[10px] font-bold uppercase text-slate-500">draws out</div>
          </div>
        </div>
      ))}
    </div>
  );
}
