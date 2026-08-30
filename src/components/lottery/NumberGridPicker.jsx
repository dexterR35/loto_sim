import { TicketBall } from './Ticket';

const QUICK_PICK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

export function NumberGridPicker({
  label,
  selected = [],
  onToggle,
  onQuickPick,
  disabled = false,
  maxPick = 18,
  minPick = 0,
  pool = 49,
  columns = 7,
  showQuickPick = true,
  compact = false,
  lockAtLimit = true,
  size: sizeProp,
  mlHints = [],
  selectedTone = 'primary'
}) {
  const size = sizeProp || (compact ? 'compact' : 'default');
  const selectedSet = new Set(selected);
  const mlHintSet = new Set(mlHints);
  const countLabel = maxPick >= pool ? selected.length : `${selected.length}/${maxPick}`;

  return (
    <div className="ticket-picker">
      <header className="ticket-picker__head">
        <span className="ticket-picker__label">Combination {label}</span>
        <span className="ticket-count">{countLabel}</span>
      </header>

      <div className="ticket-grid" style={{ '--ticket-cols': columns }}>
        {Array.from({ length: pool }, (_, index) => index + 1).map((number) => {
          const isSelected = selectedSet.has(number);
          const atLimit = lockAtLimit && !isSelected && selected.length >= maxPick;
          return (
            <TicketBall
              key={number}
              value={number}
              size={size}
              grid
              tone={selectedTone}
              selected={isSelected}
              hint={!isSelected && mlHintSet.has(number)}
              locked={disabled || atLimit}
              disabled={disabled || atLimit}
              onClick={() => onToggle?.(number)}
              title={mlHintSet.has(number) ? 'ML suggestion' : `Number ${number}`}
              aria-label={`Number ${number}`}
              aria-pressed={isSelected}
            />
          );
        })}
      </div>

      {showQuickPick ? (
        <div className="ticket-quickfill">
          <span className="ticket-quickfill__label">Quick fill</span>
          <div className="ticket-quickfill__row">
            {QUICK_PICK.map((count) => (
              <button
                key={count}
                type="button"
                disabled={disabled}
                onClick={() => onQuickPick?.(count)}
                className="ticket-quickfill__btn"
                title={count === 0 ? 'Clear' : `Fill with ${count}`}
              >
                {count === 0 ? '×' : count}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {minPick > 0 ? (
        <p className="ticket-hint">
          {selected.length >= minPick ? 'Valid combination' : `Select ${minPick - selected.length} more`}
        </p>
      ) : null}
    </div>
  );
}
