import { NumberGridPicker } from './NumberGridPicker';
import { TicketPanel } from './Ticket';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function ticketLetter(index = 0) {
  return LETTERS[index] || String(index + 1);
}

export function CompactTicket({
  index = 0,
  label,
  numbers = [],
  joker,
  active,
  hints = [],
  pool = 49,
  pick = 6,
  badges,
  footer,
  onNumberClick,
  onOpen
}) {
  const letter = label || ticketLetter(index);
  const marked = [...new Set([...(numbers || []), active].filter((number) => number != null))];
  const ready = (numbers || []).length >= pick;
  const hintList = (hints || []).filter((number) => !marked.includes(number));

  return (
    <TicketPanel
      compact
      label={letter}
      badges={badges ?? <span className={`ticket-panel__chip${ready ? ' is-ready' : ''}`}>{ready ? `${pick} ready` : 'empty'}</span>}
      actions={
        onOpen ? (
          <button type="button" className="ticket-btn ticket-btn--ghost" onClick={() => onOpen({ numbers, joker })}>
            Open
          </button>
        ) : null
      }
      footer={
        footer ?? (
          <p className="ticket-summary">
            {ready
              ? `${numbers.length} numbers selected`
              : marked.length
                ? `Select ${Math.max(0, pick - marked.length)} more`
                : `Choose ${pick} numbers on the grid`}
            {joker != null && joker !== '' ? ` · Joker ${joker}` : ''}
          </p>
        )
      }
    >
      <NumberGridPicker
        label={letter}
        pool={pool}
        columns={7}
        selected={marked}
        onToggle={onNumberClick}
        maxPick={pool}
        minPick={0}
        showQuickPick={false}
        compact
        lockAtLimit={false}
        mlHints={hintList}
      />
    </TicketPanel>
  );
}

export function TicketStack({
  tickets = [],
  fallbackNumbers,
  active,
  hints = [],
  pool = 49,
  pick = 6,
  onNumberClick,
  onOpen,
  footer,
  children
}) {
  const rows = tickets.length
    ? tickets
    : fallbackNumbers != null
      ? [{ numbers: fallbackNumbers }]
      : [];

  if (!rows.length && !children) return null;

  return (
    <div className="ticket-stack">
      {rows.map((ticket, index) => (
        <CompactTicket
          key={`${index}-${(ticket.numbers || []).join('-')}`}
          index={index}
          numbers={ticket.numbers || []}
          joker={ticket.joker}
          active={active}
          hints={hints}
          pool={pool}
          pick={pick}
          onNumberClick={onNumberClick}
          onOpen={onOpen ? () => onOpen(ticket) : undefined}
          footer={footer}
        />
      ))}
      {children}
    </div>
  );
}
