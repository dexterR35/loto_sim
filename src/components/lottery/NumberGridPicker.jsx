const QUICK_PICK = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];

const GRID_COLUMNS = {
  5: 'grid-cols-5',
  6: 'grid-cols-6',
  7: 'grid-cols-7',
  8: 'grid-cols-8',
  9: 'grid-cols-9',
  10: 'grid-cols-10'
};

const SIZE_CONFIG = {
  compact: 'text-[10px] sm:text-xs',
  default: 'text-[11px] sm:text-sm',
  large: 'text-xs sm:text-sm xl:text-base'
};

export function NumberGridPicker({
  label,
  selected = [],
  onToggle,
  onQuickPick,
  disabled = false,
  maxPick = 18,
  minPick = 0,
  pool = 49,
  columns = 10,
  showQuickPick = true,
  compact = false,
  size: sizeProp,
  mlHints = [],
  selectedTone = 'primary'
}) {
  const size = sizeProp || (compact ? 'compact' : 'default');
  const sizeClass = SIZE_CONFIG[size] || SIZE_CONFIG.default;
  const columnClass = GRID_COLUMNS[columns] || GRID_COLUMNS[10];
  const selectedSet = new Set(selected);
  const mlHintSet = new Set(mlHints);
  const selectedClass = selectedTone === 'joker'
    ? 'border-grape bg-grape text-field'
    : 'border-primary bg-primary text-field';

  const numberClass = (number) => {
    const isSelected = selectedSet.has(number);
    if (isSelected) return selectedClass;
    if (disabled || selected.length >= maxPick) return 'border-line bg-field text-muted/50';
    if (mlHintSet.has(number)) return 'border-grape/50 bg-grape/10 text-grape hover:bg-grape/20';
    return 'border-line bg-elevated text-ink hover:border-primary/50 hover:text-primary';
  };

  return (
    <div className="grid w-full min-w-0 gap-3">
      <header className="grid grid-cols-[1fr_auto] items-center gap-3">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Combination {label}</span>
        <span className="rounded-full bg-elevated px-3 py-1 text-[10px] font-bold text-muted">{selected.length}/{maxPick}</span>
      </header>

      <div className={`grid ${columnClass} gap-1 sm:gap-1.5`}>
        {Array.from({ length: pool }, (_, index) => index + 1).map((number) => {
          const isSelected = selectedSet.has(number);
          const atLimit = !isSelected && selected.length >= maxPick;
          return (
            <button
              key={number}
              type="button"
              disabled={disabled || atLimit}
              onClick={() => onToggle(number)}
              className={`aspect-square min-w-0 rounded-full border font-bold tabular-nums transition-colors disabled:cursor-not-allowed ${sizeClass} ${numberClass(number)}`}
              aria-pressed={isSelected}
              title={mlHintSet.has(number) ? 'ML suggestion' : undefined}
              aria-label={`Number ${number}`}
            >
              {number}
            </button>
          );
        })}
      </div>

      {showQuickPick ? (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 border-t border-line pt-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Quick fill</span>
          <div className="grid grid-cols-10 gap-1">
            {QUICK_PICK.map((count) => (
              <button
                key={count}
                type="button"
                disabled={disabled}
                onClick={() => onQuickPick?.(count)}
                className="aspect-square rounded-full border border-dashed border-primary/35 bg-primary/5 text-[10px] font-bold text-primary transition-colors hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-40"
                title={count === 0 ? 'Clear' : `Fill with ${count}`}
              >
                {count === 0 ? '×' : count}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {minPick > 0 ? (
        <p className="text-center text-xs font-medium text-muted">
          {selected.length >= minPick ? 'Valid combination' : `Select ${minPick - selected.length} more`}
        </p>
      ) : null}
    </div>
  );
}
