import { useCallback, useEffect, useState } from 'react';
import { Eraser, Loader2, Shuffle, Square, Ticket } from 'lucide-react';
import { STRATEGIES } from '../../lib/constants';
import {
  JOKER_JOKER_MAX,
  JOKER_JOKER_MIN,
  JOKER_JOKER_POOL,
  JOKER_MAIN_MAX,
  JOKER_MAIN_PICK,
  JOKER_MAIN_POOL,
  JOKER_WIN_CATEGORIES,
  createEmptyJokerSlip,
  formatRon,
  jokerTicketCost,
  jokerTicketLines,
  randomJokerSlip,
  slipFromApiTicket
} from '../../lib/joker';
import { NumberGridPicker } from './NumberGridPicker';
import { NumberPill, NumberRow } from './index';
import { StrategyTicketControls } from './StrategyTicketControls';
import { Badge } from '../ui';

function emptySlips(count) {
  return Array.from({ length: count }, () => createEmptyJokerSlip());
}

function resizeSlips(prev, ticketCount) {
  if (prev.length === ticketCount) return prev;
  if (prev.length < ticketCount) {
    return [...prev, ...emptySlips(ticketCount - prev.length)];
  }
  return prev.slice(0, ticketCount);
}

function JokerSlipCard({ slipIndex, slip, onMainToggle, onJokerToggle, onMainQuickPick, disabled }) {
  const lines = jokerTicketLines(slip.main.length, slip.joker.length);
  const cost = jokerTicketCost(slip.main.length, slip.joker.length);
  const valid = slip.main.length >= JOKER_MAIN_PICK && slip.joker.length >= JOKER_JOKER_MIN;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-gradient-to-r from-violet-700 to-violet-900 px-5 py-4 text-white">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10">
            <Ticket size={22} />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wide text-white/70">Joker</div>
            <div className="text-lg font-black">Bilet #{slipIndex + 1}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {valid ? <Badge tone="grape">valid</Badge> : <Badge tone="default">incomplet</Badge>}
          {lines > 0 ? <Badge tone="gold">{lines} linii · {formatRon(cost)}</Badge> : null}
        </div>
      </div>

      <div className="space-y-5 p-5">
        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">
            Set principal · 5+ numere din 1–{JOKER_MAIN_POOL}
          </div>
          <NumberGridPicker
            label="J"
            pool={JOKER_MAIN_POOL}
            columns={9}
            selected={slip.main}
            onToggle={(num) => onMainToggle(slipIndex, num)}
            onQuickPick={(qp) => onMainQuickPick(slipIndex, qp)}
            maxPick={JOKER_MAIN_MAX}
            minPick={JOKER_MAIN_PICK}
            disabled={disabled}
            size="large"
          />
        </div>

        <div>
          <div className="mb-2 text-xs font-black uppercase tracking-wide text-violet-700">
            Joker · 1+ numere din 1–{JOKER_JOKER_POOL}
          </div>
          <NumberGridPicker
            label="★"
            pool={JOKER_JOKER_POOL}
            columns={10}
            selected={slip.joker}
            onToggle={(num) => onJokerToggle(slipIndex, num)}
            maxPick={JOKER_JOKER_MAX}
            minPick={JOKER_JOKER_MIN}
            showQuickPick={false}
            disabled={disabled}
            size="default"
            selectedTone="joker"
          />
        </div>

        {valid ? (
          <div className="rounded-xl bg-field/70 px-4 py-3">
            <div className="text-center text-xs font-bold uppercase text-muted">Selecție</div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
              <NumberRow values={slip.main} size="lg" />
              <div className="flex flex-wrap items-center gap-1.5">
                {slip.joker.map((num) => (
                  <NumberPill key={num} value={num} tone="joker" size="md" />
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function JokerSimulator({
  strategy,
  setStrategy,
  ticketCount,
  setTicketCount,
  loading,
  runGenerateApi,
  beginGenerateSession,
  cancelGenerate
}) {
  const [slips, setSlips] = useState(() => emptySlips(1));

  useEffect(() => {
    setSlips((prev) => resizeSlips(prev, ticketCount));
  }, [ticketCount]);

  useEffect(() => {
    setSlips(emptySlips(ticketCount));
  }, [strategy, ticketCount]);

  const updateSlip = useCallback((slipIndex, updater) => {
    setSlips((prev) => prev.map((slip, i) => (i === slipIndex ? updater(slip) : slip)));
  }, []);

  const toggleMain = (slipIndex, num) => {
    if (loading) return;
    updateSlip(slipIndex, (slip) => {
      const main = [...slip.main];
      const idx = main.indexOf(num);
      if (idx >= 0) main.splice(idx, 1);
      else if (main.length < JOKER_MAIN_MAX) {
        main.push(num);
        main.sort((a, b) => a - b);
      }
      return { ...slip, main };
    });
  };

  const toggleJoker = (slipIndex, num) => {
    if (loading) return;
    updateSlip(slipIndex, (slip) => {
      const joker = [...slip.joker];
      const idx = joker.indexOf(num);
      if (idx >= 0) joker.splice(idx, 1);
      else if (joker.length < JOKER_JOKER_MAX) {
        joker.push(num);
        joker.sort((a, b) => a - b);
      }
      return { ...slip, joker };
    });
  };

  const quickPickMain = (slipIndex, digit) => {
    if (loading) return;
    updateSlip(slipIndex, (slip) => {
      if (digit === 0) return { ...slip, main: [] };
      const count = Math.min(digit, JOKER_MAIN_PICK);
      const pool = Array.from({ length: JOKER_MAIN_POOL }, (_, i) => i + 1);
      const picked = [];
      while (picked.length < count && pool.length) {
        const idx = Math.floor(Math.random() * pool.length);
        picked.push(pool.splice(idx, 1)[0]);
      }
      return { ...slip, main: picked.sort((a, b) => a - b) };
    });
  };

  const generateAll = () => {
    beginGenerateSession(async (signal) => {
      const payload = await runGenerateApi?.({ game: 'joker', strategy, ticketCount }, signal);
      if (payload?.tickets?.length) {
        setSlips(payload.tickets.map(slipFromApiTicket));
      }
    });
  };

  const clearAll = () => {
    if (loading) return;
    setSlips(emptySlips(ticketCount));
  };

  const fillRandom = () => {
    if (loading) return;
    setSlips(Array.from({ length: ticketCount }, () => randomJokerSlip()));
  };

  const batchLines = slips.reduce((sum, slip) => sum + jokerTicketLines(slip.main.length, slip.joker.length), 0);
  const batchCost = slips.reduce((sum, slip) => sum + jokerTicketCost(slip.main.length, slip.joker.length), 0);

  return (
    <div className="w-full space-y-4">
      <div className="rounded-xl border border-violet-200 bg-violet-50/80 px-4 py-3 text-sm text-violet-950">
        <div className="font-black">Joker · Loto România</div>
        <p className="mt-1 leading-6 text-violet-900/90">
          Alegi <strong>5 sau mai multe</strong> numere din 1–45 și <strong>unul sau mai multe</strong> Joker din 1–20.
          Tragerea extrage 5+1 numere — ambele seturi formează varianta câștigătoare.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={clearAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-field px-3 py-2 text-xs font-black disabled:opacity-50"
        >
          <Eraser size={14} /> Șterge tot
        </button>
        <button
          type="button"
          onClick={fillRandom}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-xs font-black disabled:opacity-50"
        >
          <Shuffle size={14} /> Aleator local
        </button>
        {loading ? (
          <button type="button" onClick={cancelGenerate} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-xs font-black">
            <Square size={14} /> Oprește
          </button>
        ) : null}
        <button
          type="button"
          onClick={generateAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-black text-white shadow-sm disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={14} /> : <Shuffle size={14} />}
          Generează din arhivă
        </button>
      </div>

      <StrategyTicketControls
        strategies={STRATEGIES}
        strategy={strategy}
        onStrategyChange={setStrategy}
        ticketCount={ticketCount}
        onTicketCountChange={setTicketCount}
        disabled={loading}
      />

      <div className={`space-y-5 ${loading ? 'pointer-events-none opacity-70' : ''}`}>
        {slips.map((slip, slipIndex) => (
          <JokerSlipCard
            key={`joker-slip-${slipIndex}`}
            slipIndex={slipIndex}
            slip={slip}
            onMainToggle={toggleMain}
            onJokerToggle={toggleJoker}
            onMainQuickPick={quickPickMain}
            disabled={loading}
          />
        ))}
      </div>

      {batchLines > 0 ? (
        <div className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
          <span className="font-black text-ink">{batchLines} linii Joker</span>
          <span className="text-muted"> · cost estimat </span>
          <span className="font-black text-primary">{formatRon(batchCost)}</span>
        </div>
      ) : null}

      <details className="rounded-xl border border-line bg-white px-4 py-3 text-sm">
        <summary className="cursor-pointer font-black text-ink">Categorii de câștig Joker</summary>
        <ul className="mt-3 space-y-1.5 text-muted">
          {JOKER_WIN_CATEGORIES.map((item) => (
            <li key={item}>• {item}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
