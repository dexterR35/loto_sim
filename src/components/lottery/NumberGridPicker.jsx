const DEFAULT_ROWS = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  [21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  [31, 32, 33, 34, 35, 36, 37, 38, 39, 40],
  [41, 42, 43, 44, 45, 46, 47, 48, 49, null]
];

const QUICK_PICK = [
  [1, 6],
  [2, 7],
  [3, 8],
  [4, 9],
  [5, 0]
];

const SIZE_CONFIG = {
  compact: {
    cell: 'text-[10px] sm:text-[11px]',
    label: 'text-sm',
    gap: 'p-px'
  },
  default: {
    cell: 'text-xs sm:text-sm',
    label: 'text-lg sm:text-xl',
    gap: 'p-0.5'
  },
  large: {
    cell: 'text-sm sm:text-base xl:text-lg',
    label: 'text-xl sm:text-2xl xl:text-3xl',
    gap: 'p-0.5 sm:p-1'
  }
};

function buildGridRows(pool, columns) {
  const rows = [];
  let row = [];
  for (let n = 1; n <= pool; n += 1) {
    row.push(n);
    if (row.length === columns) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) {
    while (row.length < columns) row.push(null);
    rows.push(row);
  }
  return rows;
}

function GridCell({ className, ...props }) {
  return (
    <button
      type="button"
      className={`loto-grid-cell aspect-square w-full min-w-0 ${className}`}
      {...props}
    />
  );
}

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
  const config = SIZE_CONFIG[size] || SIZE_CONFIG.default;
  const rows = pool === 49 && columns === 10 ? DEFAULT_ROWS : buildGridRows(pool, columns);
  const selectedSet = new Set(selected);
  const mlHintSet = new Set(mlHints);

  const selectedCellClass =
    selectedTone === 'joker'
      ? 'border-2 border-violet-600 bg-gradient-to-b from-violet-600 to-violet-800 text-white shadow-md ring-2 ring-violet-400/25 cursor-pointer hover:brightness-105'
      : 'border-2 border-primary bg-gradient-to-b from-primary to-primary-dark text-white shadow-md ring-2 ring-primary/20 cursor-pointer hover:brightness-105';

  const cellClass = (num, isSelected) => {
    const base = config.cell;
    if (!num) return `${base} border-transparent bg-transparent pointer-events-none`;
    if (disabled) {
      if (isSelected) {
        return `${base} border-2 border-primary bg-primary text-white shadow-md cursor-default`;
      }
      return `${base} border-2 border-line/60 bg-field/60 text-muted/80 cursor-not-allowed`;
    }
    if (isSelected) return `${base} ${selectedCellClass}`;
    if (mlHintSet.has(num)) {
      return `${base} border-2 border-grape bg-grape/15 text-grape shadow-sm ring-2 ring-grape/25 cursor-pointer hover:border-grape hover:bg-grape/25`;
    }
    return `${base} border-2 border-slate-200 bg-white text-ink shadow-sm cursor-pointer hover:border-primary hover:bg-primary/5 hover:shadow-md`;
  };

  const quickPickClass = `${config.cell} border-2 border-dashed border-secondary/60 bg-secondary/10 font-black text-secondary shadow-sm hover:border-secondary hover:bg-secondary/20`;

  return (
    <div className="w-full min-w-0">
      <table className="w-full table-fixed border-collapse text-center">
        <colgroup>
          <col className="w-[6%]" />
          {Array.from({ length: columns }, (_, i) => (
            <col key={`n-${i}`} className="w-[7%]" />
          ))}
          {showQuickPick ? (
            <>
              <col className="w-[6%]" />
              <col className="w-[6%]" />
            </>
          ) : null}
        </colgroup>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {rowIndex === 0 ? (
                <td rowSpan={rows.length} className={`${config.gap} align-middle font-black text-primary ${config.label}`}>
                  {label}
                </td>
              ) : null}
              {row.map((num) => (
                <td key={num ?? `empty-${rowIndex}`} className={config.gap}>
                  {num ? (
                    <GridCell
                      disabled={disabled || (!selectedSet.has(num) && selected.length >= maxPick)}
                      onClick={() => onToggle(num)}
                      className={cellClass(num, selectedSet.has(num))}
                      aria-pressed={selectedSet.has(num)}
                      title={mlHintSet.has(num) ? 'Sugestie ML' : undefined}
                      aria-label={`Numărul ${num}`}
                    >
                      {num}
                    </GridCell>
                  ) : (
                    <span className={`loto-grid-cell inline-block aspect-square w-full ${cellClass(null)}`} />
                  )}
                </td>
              ))}
              {showQuickPick
                ? QUICK_PICK[Math.min(rowIndex, QUICK_PICK.length - 1)].map((qp) => (
                    <td key={`qp-${rowIndex}-${qp}`} className={config.gap}>
                      <GridCell
                        disabled={disabled}
                        onClick={() => onQuickPick?.(qp)}
                        className={quickPickClass}
                        title={qp === 0 ? 'Golește' : `Completează cu ${qp}`}
                      >
                        {qp}
                      </GridCell>
                    </td>
                  ))
                : null}
            </tr>
          ))}
        </tbody>
      </table>
      {minPick > 0 ? (
        <p className="mt-2 text-center text-xs font-semibold text-muted">
          {selected.length}/{minPick}+ selectate
          {selected.length >= minPick ? ' · variantă validă' : ` · mai selectează ${minPick - selected.length}`}
        </p>
      ) : null}
    </div>
  );
}
