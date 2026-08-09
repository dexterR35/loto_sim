import { useMemo, useState } from 'react';
import { ChevronUp, Loader2, Minus, Plus, Search, Target, Ticket } from 'lucide-react';
import {
  LOTO_649_PICK,
  LOTO_649_LINE_PRICE,
  LOTO_NOROC_MAX_COUNT,
  LOTO_NOROC_PRICE,
  VARIANT_LABELS,
  formatRon,
  lineMlScore,
  norocCost,
  norocInterval,
  slipHas649Variant,
  totalSlipCost,
  combinations,
  uniqueSortedNumbers
} from '../../lib/loto649';
import { NumberGridPicker } from './NumberGridPicker';
import { NumberPill, NumberRow } from './index';
import { Badge } from '../ui';

export function Loto649TicketSlip({ gameLabel = 'Loto', title = 'Ticket', subtitle = 'Combinations A · B · C', footer, children }) {
  return (
    <article className="grid overflow-hidden rounded-2xl border border-line bg-surface">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-line bg-elevated px-6 py-5">
          <Ticket size={22} className="text-primary" />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">{gameLabel}</div>
            <div className="mt-0.5 text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</div>
          </div>
          <div className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-bold text-muted">
            {subtitle}
          </div>
      </header>
      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-3">
        {children}
      </div>
      {footer ? (
        <footer className="border-t border-line bg-primary/5 px-6 py-5">
          {footer}
        </footer>
      ) : null}
    </article>
  );
}

export function NorocPanel({ slip, onCountChange, disabled = false }) {
  const eligible = slipHas649Variant(slip?.variants);
  const base = slip?.norocBase;
  const count = slip?.norocCount || 1;
  const preview = norocInterval(base, count, 4);
  const cost = norocCost(base, count);

  if (!eligible) {
    return (
      <div className="rounded-2xl border border-dashed border-gold/30 bg-gold/5 px-5 py-4 text-sm text-muted">
        <div className="font-black uppercase tracking-[0.14em] text-gold">Noroc</div>
        <p className="mt-2 leading-6">
          Noroc can only be played on Loto 6/49 tickets with at least one complete combination (6 numbers).
          Noroc cannot be played without Loto 6/49.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-gold">Noroc · Loto 6/49</div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            When the ticket is accepted, the app generates a random 7-digit number. You can play one or more
            consecutive numbers, up to {LOTO_NOROC_MAX_COUNT.toLocaleString('en-GB')}.
          </p>
        </div>
        <div className="rounded-2xl border border-gold/30 bg-elevated px-4 py-3 text-center">
          <div className="text-[10px] font-bold uppercase text-muted">Noroc number</div>
          <div className="mt-1 font-mono text-2xl font-black tracking-[0.2em] text-ink">{base}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-muted">Number count</span>
          <button
            type="button"
            disabled={disabled || count <= 1}
            onClick={() => onCountChange?.(count - 1)}
            className="inline-grid h-9 w-9 place-items-center rounded-full border border-line bg-elevated disabled:opacity-40"
          >
            <Minus size={14} />
          </button>
          <input
            type="number"
            min={1}
            max={LOTO_NOROC_MAX_COUNT}
            value={count}
            disabled={disabled}
            onChange={(e) => onCountChange?.(Number(e.target.value))}
            className="w-24 rounded-full border border-line bg-elevated px-3 py-2 text-center text-sm font-bold"
          />
          <button
            type="button"
            disabled={disabled || count >= LOTO_NOROC_MAX_COUNT}
            onClick={() => onCountChange?.(count + 1)}
            className="inline-grid h-9 w-9 place-items-center rounded-full border border-line bg-elevated disabled:opacity-40"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="text-sm font-semibold text-muted">
          {count === 1 ? '1 Noroc number' : `${count.toLocaleString('en-GB')} consecutive numbers`} ·{' '}
          <span className="font-black text-ink">{formatRon(cost)}</span>
          <span className="text-xs"> ({formatRon(LOTO_NOROC_PRICE)}/number)</span>
        </div>
      </div>

      {count > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black uppercase text-muted">Interval</span>
          {preview.map((num) => (
            <NumberPill key={num} value={num} tone="bonus" size="md" />
          ))}
          {count > preview.length ? (
            <span className="text-xs font-bold text-muted">… +{(count - preview.length).toLocaleString('en-GB')}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function JokerPanel({
  slip,
  jokerPool = 20,
  jokerMinPick = 1,
  jokerMaxPick = 20,
  onToggle,
  disabled = false
}) {
  const selected = uniqueSortedNumbers(slip?.jokerNumbers || [], jokerPool, jokerMaxPick);
  const hasMainVariant = (slip?.variants || []).some((numbers) => uniqueSortedNumbers(numbers).length > 0);
  const valid = selected.length >= jokerMinPick;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-primary">Joker</div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            Choose at least {jokerMinPick} Joker number from 1–{jokerPool}. The same Joker selection applies to every completed combination on the ticket.
          </p>
        </div>
        <Badge tone={valid ? 'grape' : 'default'}>{valid ? 'Joker ready' : 'Joker missing'}</Badge>
      </div>

      <NumberGridPicker
        label="J"
        pool={jokerPool}
        columns={10}
        selected={selected}
        onToggle={onToggle}
        maxPick={jokerMaxPick}
        minPick={jokerMinPick}
        showQuickPick={false}
        disabled={disabled || !hasMainVariant}
        size="default"
        selectedTone="joker"
      />
    </div>
  );
}

/** Interactive pick section for a reusable lottery slip variant. */
export function TicketPickSection({
  label,
  numbers = [],
  pool = 49,
  pick = LOTO_649_PICK,
  maxPick = 18,
  columns = 10,
  linePrice = LOTO_649_LINE_PRICE,
  onToggle,
  onQuickPick,
  onClear,
  onGenerate,
  onAnalyze,
  onSimulateTarget,
  analyzeLoading,
  analyzingVariant,
  mlHints,
  badges,
  footerExtra
}) {
  const count = numbers.length;
  const lines = count >= pick ? combinations(count, pick) : 0;
  const cost = lines * linePrice;
  const hasTicket = count >= pick;
  const canSimulateTarget = count === pick && typeof onSimulateTarget === 'function';
  const canAnalyze = hasTicket;

  return (
    <TicketSectionShell
      label={label}
      badges={
        <>
          {hasTicket ? <Badge tone="teal">{pick} ready</Badge> : <Badge tone="default">empty</Badge>}
          {badges}
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={onClear}
            className="rounded-full bg-elevated px-3 py-2 text-xs font-bold text-muted transition-colors hover:text-primary"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-full bg-primary px-3 py-2 text-xs font-bold text-field transition-colors hover:bg-primary-light"
          >
            Generate {pick}
          </button>
        </>
      }
      footer={
        <>
          {count > 0 ? (
            <div className="flex justify-center py-2">
              <NumberRow values={numbers} size="lg" gap="gap-2" />
            </div>
          ) : null}
          {hasTicket ? (
            <div className="text-center text-sm font-bold text-muted">
              {count} numbers · {lines} combinations · <span className="text-ink">{formatRon(cost)}</span>
            </div>
          ) : count > 0 ? (
            <p className="text-center text-sm font-bold text-muted">Select {pick - count} more numbers</p>
          ) : (
            <p className="text-center text-sm font-bold text-muted">Choose {pick} numbers on the grid</p>
          )}
          {canAnalyze ? (
            <button
              type="button"
              onClick={() => onAnalyze(label, numbers)}
              disabled={analyzeLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-primary/25 bg-primary/5 px-4 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/10 disabled:opacity-40"
            >
              {analyzeLoading && analyzingVariant === label ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Search size={14} />
              )}
              Analyze combination
            </button>
          ) : null}
          {canSimulateTarget ? (
            <button
              type="button"
              onClick={() => onSimulateTarget(numbers)}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-grape/25 bg-grape/5 px-4 py-2.5 text-sm font-bold text-grape transition-colors hover:bg-grape/10"
            >
              <Target size={14} />
              Simulate exact target
            </button>
          ) : null}
          {footerExtra}
        </>
      }
    >
      <NumberGridPicker
        label={label}
        pool={pool}
        columns={columns}
        selected={numbers}
        onToggle={onToggle}
        onQuickPick={onQuickPick}
        maxPick={maxPick}
        minPick={pick}
        size="large"
        mlHints={mlHints}
      />
    </TicketSectionShell>
  );
}

function TicketSectionShell({ label, badges, actions, children, footer }) {
  return (
    <section className="grid min-w-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-2xl border border-line bg-field">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-grid h-11 w-11 place-items-center rounded-full bg-primary text-lg font-bold text-field">
            {label}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </header>
      <div className="w-full min-w-0 p-4 sm:p-5 xl:p-4">{children}</div>
      <footer className="grid shrink-0 gap-3 border-t border-line bg-surface/40 px-5 py-4">{footer}</footer>
    </section>
  );
}

/** Full ticket slip card — reusable A/B/C grids + Noroc footer. */
export function Loto649SlipCard({
  slipIndex = 0,
  slip,
  gameLabel = 'Loto',
  pool = 49,
  pick = LOTO_649_PICK,
  maxPick = 18,
  columns = 10,
  linePrice = LOTO_649_LINE_PRICE,
  footer,
  mlHints = [],
  onVariantToggle,
  onVariantQuickPick,
  onVariantClear,
  onVariantGenerate,
  onAnalyze,
  onSimulateTarget,
  analyzeLoading,
  analyzingVariant,
  genSource,
  predictions = [],
  disabled = false
}) {
  const { variants, variantMeta } = slip;
  const filledCount = variants.filter((v) => uniqueSortedNumbers(v, pool).length >= pick).length;

  return (
    <Loto649TicketSlip
      gameLabel={gameLabel}
      title={`Ticket #${slipIndex + 1}`}
      subtitle={`${filledCount}/3 complete combinations`}
      footer={footer}
    >
      {VARIANT_LABELS.map((label, variantIndex) => {
        const numbers = uniqueSortedNumbers(variants[variantIndex] || [], pool);
        const meta = variantMeta[variantIndex];
        const lineScore = numbers.length >= pick ? lineMlScore(numbers, predictions) : null;
        const analyzeKey = `${slipIndex}-${label}`;

        return (
          <TicketPickSection
            key={label}
            label={label}
            numbers={numbers}
            pool={pool}
            pick={pick}
            maxPick={maxPick}
            columns={columns}
            linePrice={linePrice}
            onToggle={(num) => onVariantToggle?.(slipIndex, variantIndex, num)}
            onQuickPick={(qp) => onVariantQuickPick?.(slipIndex, variantIndex, qp)}
            onClear={() => onVariantClear?.(slipIndex, variantIndex)}
            onGenerate={() => onVariantGenerate?.(slipIndex, variantIndex)}
            onAnalyze={(lbl, nums) => onAnalyze?.(analyzeKey, nums)}
            onSimulateTarget={(nums) => onSimulateTarget?.(nums)}
            analyzeLoading={analyzeLoading}
            analyzingVariant={analyzingVariant}
            mlHints={mlHints}
            badges={
              <>
                {meta?.score != null ? (
                  <Badge tone="primary">score {Number(meta.score).toFixed(1)}</Badge>
                ) : null}
                {meta?.strategy ? <Badge tone="grape">{meta.strategy}</Badge> : null}
                {lineScore ? <Badge tone="grape">ML {lineScore.score}</Badge> : null}
                {genSource?.slipIndex === slipIndex && genSource?.variantIndex === variantIndex ? (
                  <Badge tone="gold">gen</Badge>
                ) : null}
              </>
            }
          />
        );
      })}
    </Loto649TicketSlip>
  );
}

export function TicketCountControls({ ticketCount, onTicketCountChange, disabled = false }) {
  const stepper = (
    <div className="grid auto-cols-max grid-flow-col items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onTicketCountChange(Math.max(1, ticketCount - 1))}
        className="inline-grid h-10 w-10 place-items-center rounded-full border border-line bg-elevated hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Fewer tickets"
      >
        <Minus size={16} />
      </button>
      <div className="text-center">
        <div className="text-3xl font-black text-ink">{ticketCount}</div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {ticketCount === 1 ? 'ticket' : 'tickets'}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onTicketCountChange(Math.min(12, ticketCount + 1))}
        className="inline-grid h-10 w-10 place-items-center rounded-full border border-line bg-elevated hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="More tickets"
      >
        <Plus size={16} />
      </button>
    </div>
  );

  return (
    <div className="grid place-items-center gap-4 py-2">
      {stepper}
      <input
        type="range"
        min="1"
        max="12"
        value={ticketCount}
        disabled={disabled}
        onChange={(e) => onTicketCountChange(Number(e.target.value))}
        className="w-full max-w-xs accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <p className="text-center text-xs text-muted">Combinations A · B · C (Noroc activates with a complete combination)</p>
    </div>
  );
}

function slipCostForGame(slip, config = {}) {
  const pick = config.pick || LOTO_649_PICK;
  const linePrice = config.linePrice || LOTO_649_LINE_PRICE;
  if (config.bonus === 'noroc') {
    const costs = totalSlipCost(slip.variants, slip.norocBase, slip.norocCount);
    const lines = slip.variants.reduce((sum, nums) => sum + (nums.length >= pick ? combinations(nums.length, pick) : 0), 0);
    return { ...costs, lines, jokerLines: 0, jokerCount: 0 };
  }

  const variantLines = slip.variants.reduce((sum, nums) => sum + (nums.length >= pick ? combinations(nums.length, pick) : 0), 0);
  const jokerCount = config.bonus === 'joker' ? uniqueSortedNumbers(slip.jokerNumbers || [], config.jokerPool || 20).length : 0;
  const payableLines = config.bonus === 'joker' ? variantLines * jokerCount : variantLines;
  const total = payableLines * linePrice;
  return { variants: total, form: 0, noroc: 0, total, lines: variantLines, jokerLines: payableLines, jokerCount };
}

export function TicketCostDock({ slips = [], config = {} }) {
  const [open, setOpen] = useState(false);
  const batch = useMemo(
    () => slips.reduce((acc, slip) => ({ total: acc.total + slipCostForGame(slip, config).total }), { total: 0 }),
    [slips, config]
  );
  const slipRows = useMemo(
    () =>
      slips.map((slip, slipIndex) => {
        const costs = slipCostForGame(slip, config);
        const pick = config.pick || LOTO_649_PICK;
        const linePrice = config.linePrice || LOTO_649_LINE_PRICE;
        const filled = slip.variants.filter((v) => uniqueSortedNumbers(v, config.pool || 49).length >= pick).length;
        const variantCosts = VARIANT_LABELS.map((label, index) => {
          const count = uniqueSortedNumbers(slip.variants[index] || [], config.pool || 49).length;
          const lines = count >= pick ? combinations(count, pick) : 0;
          const multiplier = config.bonus === 'joker' ? costs.jokerCount : 1;
          return { label, value: lines * multiplier * linePrice };
        });
        return { slipIndex, costs, filled, variantCosts };
      }),
    [slips, config]
  );

  return (
    <div className={`fixed bottom-3 right-3 z-40 transition-[width] sm:bottom-4 sm:right-4 ${open ? 'w-[min(calc(100vw-1.5rem),18rem)]' : 'w-auto'}`}>
      <div className="overflow-hidden rounded-2xl border border-line bg-surface">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-elevated"
          aria-expanded={open}
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Ticket cost</div>
            <div className="text-xl font-black text-primary">{formatRon(batch.total)}</div>
          </div>
          <ChevronUp
            size={18}
            className={`shrink-0 text-muted transition ${open ? '' : 'rotate-180'}`}
          />
        </button>

        {open ? (
          <div className="max-h-[min(50vh,22rem)] overflow-y-auto border-t border-line">
            <div className="grid gap-2 p-3">
              {slipRows.map(({ slipIndex, costs, filled, variantCosts }) => (
                <div key={`cost-slip-${slipIndex}`} className="rounded-2xl bg-elevated px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-black text-ink">Ticket #{slipIndex + 1}</div>
                    <div className="text-sm font-black text-primary">{formatRon(costs.total)}</div>
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-muted">
                    {filled}/3 combinations · {config.bonus === 'joker' ? costs.jokerLines : costs.lines} lines
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {variantCosts.map(({ label, value }) => (
                      <span
                        key={`${slipIndex}-${label}`}
                        className="rounded-full bg-surface px-2 py-1 text-[10px] font-bold text-muted"
                      >
                        {label}: {value ? formatRon(value) : '—'}
                      </span>
                    ))}
                    {config.bonus === 'noroc' ? (
                      <span className="rounded-full bg-surface px-2 py-1 text-[10px] font-bold text-muted">
                        Noroc: {slips[slipIndex]?.norocBase ? `${slips[slipIndex].norocCount}x ${formatRon(costs.noroc / slips[slipIndex].norocCount)}` : '—'}
                      </span>
                    ) : null}
                    {config.bonus === 'joker' ? (
                      <span className="rounded-full bg-surface px-2 py-1 text-[10px] font-bold text-muted">
                        Joker: {costs.jokerCount || '—'}
                      </span>
                    ) : null}
                    {costs.form ? (
                      <span className="rounded-full bg-surface px-2 py-1 text-[10px] font-bold text-muted">
                        Form: {formatRon(costs.form)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-line bg-elevated px-4 py-3">
              <span className="text-xs font-black uppercase text-muted">Total</span>
              <span className="text-lg font-black text-primary">{formatRon(batch.total)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
