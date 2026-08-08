import { useMemo, useState } from 'react';
import { ChevronUp, Loader2, Minus, Plus, Search, Ticket } from 'lucide-react';
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
  totalBatchCost,
  totalSlipCost,
  variantCost,
  combinations,
  uniqueSortedNumbers
} from '../../lib/loto649';
import { NumberGridPicker } from './NumberGridPicker';
import { NumberPill, NumberRow } from './index';
import { Badge } from '../ui';

export function Loto649TicketSlip({ gameLabel = 'Loto', title = 'Bilet', subtitle = 'Variante A · B · C', footer, children }) {
  return (
    <div className="loto-slip">
      <div className="relative bg-gradient-to-br from-ink via-slate-800 to-slate-900 px-6 py-5 text-white">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20 backdrop-blur-sm">
            <Ticket size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">{gameLabel}</div>
            <div className="mt-0.5 text-xl font-black tracking-tight sm:text-2xl">{title}</div>
          </div>
          <div className="rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-white/90 ring-1 ring-white/15">
            {subtitle}
          </div>
        </div>
      </div>
      <div className="grid gap-5 bg-gradient-to-b from-field/30 to-white p-5 xl:grid-cols-3 xl:p-6">
        {children}
      </div>
      {footer ? (
        <div className="border-t border-gold/25 bg-gradient-to-r from-gold/10 via-amber-50/80 to-gold/5 px-6 py-5">
          {footer}
        </div>
      ) : null}
    </div>
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
      <div className="rounded-xl border border-dashed border-gold/40 bg-gold/5 px-4 py-4 text-sm text-muted">
        <div className="font-black uppercase tracking-[0.14em] text-gold">Noroc</div>
        <p className="mt-2 leading-6">
          Noroc se joacă doar pe bilete Loto 6/49 cu cel puțin o variantă completă (6 numere).
          Nu este posibil să joci Noroc fără Loto 6/49.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-gold">Noroc · Loto 6/49</div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            La acceptarea biletului, aplicația generează un număr aleator de 7 cifre. Poți juca 1 sau mai multe
            numere consecutive (interval), până la {LOTO_NOROC_MAX_COUNT.toLocaleString('ro-RO')}.
          </p>
        </div>
        <div className="rounded-xl border border-gold/30 bg-white px-4 py-3 text-center shadow-sm">
          <div className="text-[10px] font-bold uppercase text-muted">Număr Noroc</div>
          <div className="mt-1 font-mono text-2xl font-black tracking-[0.2em] text-ink">{base}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black text-muted">Câte numere</span>
          <button
            type="button"
            disabled={disabled || count <= 1}
            onClick={() => onCountChange?.(count - 1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white disabled:opacity-50"
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
            className="w-24 rounded-lg border border-line px-2 py-1.5 text-center text-sm font-black"
          />
          <button
            type="button"
            disabled={disabled || count >= LOTO_NOROC_MAX_COUNT}
            onClick={() => onCountChange?.(count + 1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white disabled:opacity-50"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className="text-sm font-semibold text-muted">
          {count === 1 ? '1 număr Noroc' : `${count.toLocaleString('ro-RO')} numere consecutive`} ·{' '}
          <span className="font-black text-ink">{formatRon(cost)}</span>
          <span className="text-xs"> ({formatRon(LOTO_NOROC_PRICE)}/număr)</span>
        </div>
      </div>

      {count > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black uppercase text-muted">Interval</span>
          {preview.map((num) => (
            <NumberPill key={num} value={num} tone="bonus" size="md" />
          ))}
          {count > preview.length ? (
            <span className="text-xs font-bold text-muted">… +{(count - preview.length).toLocaleString('ro-RO')}</span>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.16em] text-primary">Joker</div>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted">
            Alege cel puțin {jokerMinPick} număr Joker din 1-{jokerPool}. Se folosește aceeași selecție Joker pentru variantele completate pe bilet.
          </p>
        </div>
        <Badge tone={valid ? 'grape' : 'default'}>{valid ? 'Joker ok' : 'Joker lipsă'}</Badge>
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
  const canAnalyze = hasTicket;

  return (
    <TicketSectionShell
      label={label}
      badges={
        <>
          {hasTicket ? <Badge tone="teal">{pick} ok</Badge> : <Badge tone="default">gol</Badge>}
          {badges}
        </>
      }
      actions={
        <>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-black text-muted transition hover:border-primary hover:text-primary"
          >
            Șterge
          </button>
          <button
            type="button"
            onClick={onGenerate}
            className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-black text-white shadow-sm transition hover:bg-secondary-dark"
          >
            Generează {pick}
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
              {count} numere · {lines} variante · <span className="text-ink">{formatRon(cost)}</span>
            </div>
          ) : count > 0 ? (
            <p className="text-center text-sm font-bold text-muted">Mai selectează {pick - count} numere</p>
          ) : (
            <p className="text-center text-sm font-bold text-muted">Alege {pick} numere pe grilă</p>
          )}
          {canAnalyze ? (
            <button
              type="button"
              onClick={() => onAnalyze(label, numbers)}
              disabled={analyzeLoading}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-primary/25 bg-white px-4 py-2.5 text-sm font-black text-primary transition hover:bg-primary/5 disabled:opacity-60"
            >
              {analyzeLoading && analyzingVariant === label ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Search size={14} />
              )}
              Analizează varianta
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
    <section className="loto-variant-panel min-w-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line/60 bg-gradient-to-r from-white to-field/40 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-dark text-xl font-black text-white shadow-md">
            {label}
          </span>
          <div className="flex flex-wrap items-center gap-1.5">{badges}</div>
        </div>
        {actions ? <div className="flex gap-2">{actions}</div> : null}
      </div>
      <div className="w-full min-w-0 p-4 sm:p-5 xl:p-4">{children}</div>
      <div className="shrink-0 space-y-3 border-t border-line/60 bg-field/25 px-5 py-4">{footer}</div>
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
      title={`Bilet #${slipIndex + 1}`}
      subtitle={`${filledCount}/3 variante complete`}
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
            analyzeLoading={analyzeLoading}
            analyzingVariant={analyzingVariant}
            mlHints={mlHints}
            badges={
              <>
                {meta?.score != null ? (
                  <Badge tone="primary">scor {Number(meta.score).toFixed(1)}</Badge>
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
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={disabled}
        onClick={() => onTicketCountChange(Math.max(1, ticketCount - 1))}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Mai puține bilete"
      >
        <Minus size={16} />
      </button>
      <div className="text-center">
        <div className="text-3xl font-black text-ink">{ticketCount}</div>
        <div className="text-[10px] font-bold uppercase tracking-wide text-muted">
          {ticketCount === 1 ? 'bilet' : 'bilete'}
        </div>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onTicketCountChange(Math.min(12, ticketCount + 1))}
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-white hover:border-primary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Mai multe bilete"
      >
        <Plus size={16} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col items-center gap-4 py-2">
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
      <p className="text-center text-xs text-muted">Variante A · B · C (Noroc activ cu variantă completă)</p>
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
    <div className="fixed bottom-4 right-4 z-40 w-[min(calc(100vw-2rem),18rem)]">
      <div className="overflow-hidden rounded-2xl border border-line bg-white shadow-panel ring-1 ring-black/5">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-field/60"
          aria-expanded={open}
        >
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-muted">Cost bilete</div>
            <div className="text-xl font-black text-primary">{formatRon(batch.total)}</div>
          </div>
          <ChevronUp
            size={18}
            className={`shrink-0 text-muted transition ${open ? '' : 'rotate-180'}`}
          />
        </button>

        {open ? (
          <div className="max-h-[min(50vh,22rem)] overflow-y-auto border-t border-line">
            <div className="space-y-2 p-3">
              {slipRows.map(({ slipIndex, costs, filled, variantCosts }) => (
                <div key={`cost-slip-${slipIndex}`} className="rounded-xl bg-field/70 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-black text-ink">Bilet #{slipIndex + 1}</div>
                    <div className="text-sm font-black text-primary">{formatRon(costs.total)}</div>
                  </div>
                  <div className="mt-1 text-[10px] font-semibold text-muted">
                    {filled}/3 variante · {config.bonus === 'joker' ? costs.jokerLines : costs.lines} linii
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {variantCosts.map(({ label, value }) => (
                      <span
                        key={`${slipIndex}-${label}`}
                        className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-muted"
                      >
                        {label}: {value ? formatRon(value) : '—'}
                      </span>
                    ))}
                    {config.bonus === 'noroc' ? (
                      <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-muted">
                        Noroc: {slips[slipIndex]?.norocBase ? `${slips[slipIndex].norocCount}x ${formatRon(costs.noroc / slips[slipIndex].norocCount)}` : '—'}
                      </span>
                    ) : null}
                    {config.bonus === 'joker' ? (
                      <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-muted">
                        Joker: {costs.jokerCount || '—'}
                      </span>
                    ) : null}
                    {costs.form ? (
                      <span className="rounded-md bg-white px-1.5 py-0.5 text-[10px] font-bold text-muted">
                        Form: {formatRon(costs.form)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-line bg-field/40 px-4 py-3">
              <span className="text-xs font-black uppercase text-muted">Total</span>
              <span className="text-lg font-black text-primary">{formatRon(batch.total)}</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
