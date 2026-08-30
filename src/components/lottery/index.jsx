import { useMemo } from 'react';
import { Search, Sparkles } from 'lucide-react';
import { GAMES } from '../../lib/constants';
import { formatDrawDate } from '../../lib/format';
import { getGameTheme } from '../../lib/gameTheme';
import { Badge, DataTable, DEFAULT_PAGE_SIZE } from '../ui';
import { TicketBall } from './Ticket';

export function NumberPill({ value, tone = 'default', size = 'md' }) {
  return <TicketBall value={value} tone={tone} size={size} />;
}

export function NumberRow({ values = [], joker, size = 'md', tone = 'default' }) {
  return (
    <div className={`ticket-balls${size === 'lg' || size === 'xl' ? ' ticket-balls--lg' : ''}`}>
      {values.map((number, index) => (
        <NumberPill key={`${number}-${index}`} value={number} size={size} tone={tone} />
      ))}
      {joker ? (
        <div className="ticket-joker">
          <span className="ticket-joker__label">Joker</span>
          <NumberPill value={joker} tone="joker" size={size} />
        </div>
      ) : null}
    </div>
  );
}

export function GameSwitcher({ game, onGameChange, disabled = false }) {
  return (
    <div className={`grid grid-cols-3 gap-1 rounded-full border border-line bg-surface p-1 ${disabled ? 'pointer-events-none opacity-50' : ''}`} role="group" aria-label="Select game">
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
            className={`rounded-full px-3 py-2 text-xs font-bold transition-colors ${
              isActive ? theme.switcherActive : theme.switcherIdle
            }`}
          >
            <span className="hidden sm:inline">{item.full}</span><span className="sm:hidden">{item.label}</span>
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
      ? 'bg-coral'
      : tone === 'cold'
        ? 'bg-teal'
        : 'bg-gold';
  return (
    <div className="grid gap-3">
      {items.slice(0, 10).map((item, index) => (
        <div key={item.number} className="grid grid-cols-[2.5rem_1fr_3rem] items-center gap-3 text-sm">
          <div className="text-xs font-black text-muted">#{index + 1}</div>
          <div className="min-w-0">
            <div className="mb-1 flex items-center justify-between gap-2">
              <NumberPill value={item.number} tone={tone} size="sm" />
              <span className="text-xs font-bold text-muted">{item.count} draws</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.max(8, (item.count / max) * 100)}%` }} />
            </div>
          </div>
          <div className="text-right text-xs font-bold text-muted">
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
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-wide text-muted">
        <span>Signal score</span>
        <span className="text-ink">{Number(score).toFixed(2)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function NorocDigits({ code, score }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 py-2">
      {String(code).split('').map((digit, index) => (
        <div key={`${digit}-${index}`} className="flex flex-col items-center gap-1">
          <span className="text-[10px] font-bold uppercase text-muted">P{index + 1}</span>
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
      <article className="rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-muted">Ticket #{String(index + 1).padStart(2, '0')}</div>
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
    <article className="rounded-2xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="text-xs font-black uppercase tracking-[0.18em] text-muted">Ticket #{String(index + 1).padStart(2, '0')}</div>
        <Badge tone="primary">score {Number(ticket.score).toFixed(2)}</Badge>
      </div>
      <div className="flex justify-center py-2">
        <NumberRow values={ticket.numbers} joker={game === 'joker' ? ticket.joker : null} size="lg" />
      </div>
      <div className="mt-4 grid gap-3 border-t border-line pt-4">
        <ScoreMeter score={ticket.score} max={maxScore} />
        {ticket.backtest_score != null ? (
          <div className="flex items-center justify-between rounded-2xl bg-elevated px-3 py-2 text-xs font-bold text-muted">
            <span>MC backtest yield</span>
            <span className="font-black text-secondary">{ticket.backtest_score}</span>
          </div>
        ) : null}
        {componentRows.length ? (
          <div className="grid grid-cols-3 gap-2">
            {componentRows.map((row) => (
              <div key={row.label} className="rounded-2xl bg-elevated px-2 py-2 text-center">
                <div className="text-[10px] font-black uppercase text-muted">{row.label}</div>
                <div className="text-sm font-black text-ink">{Number(row.value).toFixed(0)}</div>
              </div>
            ))}
          </div>
        ) : null}
        {onAnalyze ? (
          <button
            type="button"
            onClick={() => onAnalyze(ticket)}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line bg-elevated px-4 py-2.5 text-xs font-bold text-ink transition-colors hover:border-primary/40 hover:text-primary"
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
      <div className="grid min-h-56 place-items-center rounded-2xl border border-dashed border-line bg-field px-6 py-10 text-center">
        <div><Sparkles className="mx-auto mb-3 text-primary" size={22} />
        <div className="text-sm font-black text-ink">No tickets yet</div>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted">{emptyLabel}</p>
        </div>
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
    <article className="rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-primary/30">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-black text-ink">{formatDrawDate(draw)}</div>
          <div className="mt-1 text-xs font-bold text-muted">{draw.draw_date_iso} · {draw.year}</div>
        </div>
        {onOpen ? (
          <button type="button" onClick={() => onOpen(draw)} className="rounded-full bg-elevated px-3 py-1.5 text-xs font-bold text-muted hover:text-primary">
            Details
          </button>
        ) : null}
      </div>
      <div className="mt-4">
        <NumberRow values={draw.drawn_numbers || []} joker={draw.joker_number} size="md" />
      </div>
      <div className="mt-3 text-xs font-semibold text-muted">
        {draw.fond_castiguri || draw.category_data?.I?.report || draw.category_data?.['1']?.report || 'No report data'}
      </div>
    </article>
  );
}

export function DrawTable({
  draws = [],
  onOpenRaw,
  total,
  offset = 0,
  limit = DEFAULT_PAGE_SIZE,
  onPageChange
}) {
  const columns = useMemo(() => [
    {
      accessorKey: 'draw_date_iso',
      header: 'Date',
      cell: ({ row }) => (
        <>
          <div className="font-bold text-ink">{formatDrawDate(row.original)}</div>
          <div className="mt-1 text-xs font-bold text-muted">{row.original.year}</div>
        </>
      )
    },
    {
      id: 'numbers',
      header: 'Numbers',
      enableSorting: false,
      cell: ({ row }) => (
        <NumberRow values={row.original.drawn_numbers || []} joker={row.original.joker_number} size="sm" />
      )
    },
    {
      id: 'report',
      header: 'Report / fond',
      accessorFn: (draw) => draw.fond_castiguri || draw.category_data?.I?.report || draw.category_data?.['1']?.report || '—'
    },
    {
      id: 'actions',
      header: 'Actions',
      enableSorting: false,
      cell: ({ row }) => (onOpenRaw ? (
        <button type="button" onClick={() => onOpenRaw(row.original)} className="rounded-full bg-elevated px-3 py-1.5 text-xs font-bold text-muted hover:text-primary">
          Details
        </button>
      ) : null)
    }
  ], [onOpenRaw]);

  const server = typeof total === 'number' && typeof onPageChange === 'function';
  const pageSize = Math.max(1, limit);
  const pagination = server
    ? { pageIndex: Math.floor((offset || 0) / pageSize), pageSize }
    : undefined;

  return (
    <DataTable
      data={draws}
      columns={columns}
      pageSize={pageSize}
      empty="No draws in this range."
      getRowId={(row, index) => `${row.game}-${row.draw_date_iso}-${index}`}
      manualPagination={server}
      rowCount={server ? total : undefined}
      pagination={pagination}
      onPaginationChange={server ? (updater) => {
        const current = { pageIndex: Math.floor((offset || 0) / pageSize), pageSize };
        const next = typeof updater === 'function' ? updater(current) : updater;
        const size = next.pageSize;
        const index = size !== pageSize ? 0 : next.pageIndex;
        onPageChange(index * size, size);
      } : undefined}
    />
  );
}

export function OverdueList({ items = [] }) {
  return (
    <div className="grid gap-2">
      {items.slice(0, 10).map((item, index) => (
        <div key={item.number} className="flex items-center gap-3 rounded-2xl border border-line bg-elevated px-3 py-2.5">
          <div className="text-xs font-black text-muted">#{index + 1}</div>
          <NumberPill value={item.number} tone="overdue" size="sm" />
          <div className="ml-auto text-right">
            <div className="text-sm font-black text-ink">{item.draws_since_seen}</div>
            <div className="text-[10px] font-bold uppercase text-muted">draws out</div>
          </div>
        </div>
      ))}
    </div>
  );
}
