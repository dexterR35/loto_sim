import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BrainCircuit,
  Database,
  Eraser,
  Loader2,
  Shuffle,
  Square,
  TrendingUp
} from 'lucide-react';
import { STRATEGIES } from '../../lib/constants';
import { getGameConfig } from '../../lib/gameConfig';
import { isAbortError, needsMlStrategy } from '../../lib/generation';
import {
  LOTO_649_PICK,
  LOTO_NOROC_MAX_COUNT,
  completePick,
  pick649ByStrategy,
  syncSlipNoroc,
  uniqueSortedNumbers
} from '../../lib/loto649';
import { JokerPanel, Loto649SlipCard, NorocPanel, TicketCostDock } from './Loto649TicketUI';
import { StrategyTicketControls } from './StrategyTicketControls';

const LOCAL_STRATEGIES = [
  { key: 'random', label: 'Aleator', icon: TrendingUp, description: 'Numere aleatoare pe grilă.' },
  { key: 'ml_blend', label: 'Blend ML', icon: BrainCircuit, description: 'Blend sklearn + LSTM din predicțiile locale.' },
  { key: 'ml_rag', label: 'RAG+ML', icon: Database, description: 'Predicții blend cu extrageri similare (vector RAG).' }
];

const ALL_STRATEGIES = [...STRATEGIES, ...LOCAL_STRATEGIES];
const API_STRATEGIES = new Set(STRATEGIES.map((s) => s.key));
const ML_HINT_STRATEGIES = new Set(['ml_blend', 'ml_rag', 'ml_sklearn', 'ml_lstm']);
function baseSlip() {
  return {
    variants: ['A', 'B', 'C'].map(() => []),
    variantMeta: ['A', 'B', 'C'].map(() => null),
    jokerNumbers: [],
    norocBase: null,
    norocCount: 1
  };
}

function syncGameSlip(slip, config) {
  const normalized = {
    ...slip,
    variants: (slip.variants || []).map((variant) => uniqueSortedNumbers(variant, config.pool, config.maxPick || 18)),
    variantMeta: slip.variantMeta || ['A', 'B', 'C'].map(() => null),
    jokerNumbers: uniqueSortedNumbers(slip.jokerNumbers || [], config.jokerPool || 20, config.jokerMaxPick || 20)
  };
  if (config.bonus === 'noroc') return syncSlipNoroc(normalized);
  if (config.bonus !== 'joker') return { ...normalized, norocBase: null, norocCount: 1, jokerNumbers: [] };
  return { ...normalized, norocBase: null, norocCount: 1 };
}

function emptySlips(count, config) {
  return Array.from({ length: count }, () => syncGameSlip(baseSlip(), config));
}

function resizeSlips(prev, ticketCount, config) {
  if (prev.length === ticketCount) return prev.map((slip) => syncGameSlip(slip, config));
  if (prev.length < ticketCount) {
    return [...prev.map((slip) => syncGameSlip(slip, config)), ...emptySlips(ticketCount - prev.length, config)];
  }
  return prev.slice(0, ticketCount).map((slip) => syncGameSlip(slip, config));
}

function sameNumbers(left = [], right = [], pool = 49) {
  const a = uniqueSortedNumbers(left, pool);
  const b = uniqueSortedNumbers(right, pool);
  return a.length === b.length && a.every((num, index) => num === b[index]);
}

function variantMetaForCompletion(numbers, strategy, ticket, source, manualCount, pool = 49) {
  const ticketNumbers = uniqueSortedNumbers(ticket?.numbers || [], pool);
  const exactTicket = ticketNumbers.length > 0 && sameNumbers(numbers, ticketNumbers, pool);
  return {
    ...(exactTicket ? ticket : {}),
    numbers,
    strategy: ticket?.strategy || strategy,
    score: exactTicket ? ticket?.score ?? null : null,
    source,
    manual_count: manualCount
  };
}

function incompleteVariantCount(slips = [], config) {
  return slips.reduce((total, slip) => {
    return total + (slip.variants || []).filter((variant) => uniqueSortedNumbers(variant, config.pool).length < config.pick).length;
  }, 0);
}

export function Loto649Simulator({
  game = '6din49',
  gameLabel = 'Loto 6/49',
  strategy,
  setStrategy,
  ticketCount,
  setTicketCount,
  loading,
  runGenerateApi,
  onAnalyze,
  analyzeLoading,
  mlData,
  beginGenerateSession,
  ensureMl,
  cancelGenerate
}) {
  const config = getGameConfig(game);
  const [slips, setSlips] = useState(() => emptySlips(1, config));
  const [analyzingVariant, setAnalyzingVariant] = useState(null);
  const [genSource, setGenSource] = useState(null);

  const predictions = mlData?.predictions || [];
  const mlHints = useMemo(() => {
    if (!ML_HINT_STRATEGIES.has(strategy) || !predictions.length) return [];
    return (mlData?.top_numbers || []).slice(0, 15).map((item) => item.number);
  }, [mlData, predictions.length, strategy]);

  useEffect(() => {
    setSlips((prev) => resizeSlips(prev, ticketCount, config));
  }, [ticketCount, game]);

  useEffect(() => {
    setSlips((prev) =>
      prev.map((slip) => ({
        ...slip,
        variants: slip.variants.map((variant) => uniqueSortedNumbers(variant, config.pool, config.maxPick || 18)),
        variantMeta: slip.variantMeta.map(() => null)
      }))
    );
    setGenSource(null);
  }, [strategy, game]);

  const pickLocal = useCallback(
    (mode, count = config.pick, exclude = []) => pick649ByStrategy(mode, predictions, count, exclude, config.pool),
    [config.pick, config.pool, predictions]
  );

  const updateSlip = useCallback((slipIndex, updater) => {
    setSlips((prev) =>
      prev.map((slip, i) => (i === slipIndex ? syncGameSlip(updater(slip), config) : slip))
    );
  }, [config]);

  const generateViaApi = useCallback(
    async (lineCount, signal) => {
      const tickets = [];
      while (tickets.length < lineCount) {
        const batchSize = Math.min(20, lineCount - tickets.length);
        const payload = await runGenerateApi?.({ game, strategy, ticketCount: batchSize }, signal);
        if (!payload?.tickets?.length) break;
        tickets.push(...payload.tickets);
        if (payload.tickets.length < batchSize) break;
      }
      return tickets;
    },
    [game, runGenerateApi, strategy]
  );

  const generateAll = () => {
    beginGenerateSession(async (signal) => {
      const currentSlips = resizeSlips(slips, ticketCount, config);
      const manualContext = uniqueSortedNumbers(currentSlips.flatMap((slip) => slip.variants.flat()), config.pool);
      const incompleteCount = incompleteVariantCount(currentSlips, config);
      const needsLocalMl = needsMlStrategy(strategy) && !API_STRATEGIES.has(strategy);

      let generationPredictions = predictions;
      if (needsLocalMl) {
        const mlPayload = await ensureMl(game, signal, manualContext);
        generationPredictions = mlPayload?.predictions || predictions;
      }
      const pickForCompletion = (count, exclude) => pick649ByStrategy(strategy, generationPredictions, count, exclude, config.pool);

      let apiTickets = [];
      if (API_STRATEGIES.has(strategy) && incompleteCount > 0) {
        try {
          apiTickets = await generateViaApi(Math.max(incompleteCount, incompleteCount * 2), signal);
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }

      let ticketIndex = 0;
      const source = apiTickets.length ? 'api' : 'local';
      const completed = currentSlips.map((slip) => {
        const variants = [];
        const variantMeta = [];

        slip.variants.forEach((variant, variantIndex) => {
          const base = uniqueSortedNumbers(variant, config.pool, config.maxPick || 18);
          if (base.length >= config.pick) {
            variants.push(base);
            variantMeta.push(slip.variantMeta?.[variantIndex] || null);
            return;
          }

          const ticketsForVariant = [];
          while (ticketIndex < apiTickets.length && ticketsForVariant.length < 2) {
            ticketsForVariant.push(apiTickets[ticketIndex]);
            ticketIndex += 1;
          }
          const localCandidates = [
            pickForCompletion(config.pick, base),
            pickForCompletion(config.pick, base)
          ];
          const numbers = completePick(
            base,
            [...ticketsForVariant.map((ticket) => ticket?.numbers || []), ...localCandidates],
            config.pick,
            config.pool,
            config.maxPick || 18
          );
          const ticket = ticketsForVariant.find((item) => item?.numbers?.length);
          variants.push(numbers);
          variantMeta.push(
            numbers.length >= config.pick
              ? variantMetaForCompletion(numbers, strategy, ticket, source, base.length, config.pool)
              : null
          );
        });

        const jokerNumbers = config.bonus === 'joker'
          ? completePick(
              slip.jokerNumbers || [],
              [
                apiTickets.map((ticket) => (ticket?.joker ? ticket.joker : null)).filter(Boolean),
                pick649ByStrategy('random', [], config.jokerMinPick || 1, slip.jokerNumbers || [], config.jokerPool || 20)
              ],
              config.jokerMinPick || 1,
              config.jokerPool || 20,
              config.jokerMaxPick || 20
            )
          : slip.jokerNumbers;
        return syncGameSlip({ ...slip, variants, variantMeta, jokerNumbers }, config);
      });

      setSlips(completed);
      setGenSource({ mode: strategy, source });
    });
  };

  const clearAll = () => {
    if (loading) return;
    setSlips(emptySlips(ticketCount, config));
    setGenSource(null);
  };

  const toggleNumber = (slipIndex, variantIndex, num) => {
    if (loading) return;
    updateSlip(slipIndex, (slip) => {
      const variants = slip.variants.map((v) => uniqueSortedNumbers(v, config.pool, config.maxPick || 18));
      const current = variants[variantIndex];
      const idx = current.indexOf(num);
      if (idx >= 0) current.splice(idx, 1);
      else if (current.length < (config.maxPick || 18)) {
        current.push(num);
        current.sort((a, b) => a - b);
      }
      const variantMeta = slip.variantMeta.map((m, i) => (i === variantIndex ? null : m));
      return { ...slip, variants, variantMeta };
    });
    setGenSource(null);
  };

  const handleQuickPick = (slipIndex, variantIndex, digit) => {
    if (loading) return;
    updateSlip(slipIndex, (slip) => {
      const variants = slip.variants.map((v) => uniqueSortedNumbers(v, config.pool, config.maxPick || 18));
      const variantMeta = slip.variantMeta.map((m) => m);
      if (digit === 0) {
        variants[variantIndex] = [];
        variantMeta[variantIndex] = null;
      } else {
        const target = Math.min(config.maxPick || 18, Math.max(1, Number(digit) || config.pick));
        const base = variants[variantIndex];
        variants[variantIndex] = completePick(
          base,
          [pickLocal(strategy, target, base), pickLocal(strategy, target, base)],
          target,
          config.pool,
          config.maxPick || 18
        );
        variantMeta[variantIndex] = null;
      }
      return { ...slip, variants, variantMeta };
    });
  };

  const clearVariant = (slipIndex, variantIndex) => {
    if (loading) return;
    updateSlip(slipIndex, (slip) => ({
      ...slip,
      variants: slip.variants.map((v, i) => (i === variantIndex ? [] : v)),
      variantMeta: slip.variantMeta.map((m, i) => (i === variantIndex ? null : m))
    }));
  };

  const generateVariant = (slipIndex, variantIndex) => {
    const selected = uniqueSortedNumbers(slips[slipIndex]?.variants?.[variantIndex] || [], config.pool, config.maxPick || 18);
    const selectedJokers = uniqueSortedNumbers(slips[slipIndex]?.jokerNumbers || [], config.jokerPool || 20, config.jokerMaxPick || 20);
    const jokerComplete = config.bonus !== 'joker' || selectedJokers.length >= (config.jokerMinPick || 1);

    beginGenerateSession(async (signal) => {
      if (selected.length >= config.pick && jokerComplete) {
        updateSlip(slipIndex, (slip) => {
          const variants = slip.variants.map((v) => uniqueSortedNumbers(v, config.pool, config.maxPick || 18));
          const variantMeta = slip.variantMeta.map((m) => m);
          variants[variantIndex] = selected;
          return { ...slip, variants, variantMeta };
        });
        setGenSource({ mode: strategy, slipIndex, variantIndex, source: 'manual' });
        return;
      }

      let ticketsForVariant = [];
      let source = 'local';
      if (API_STRATEGIES.has(strategy)) {
        try {
          ticketsForVariant = await generateViaApi(4, signal);
          if (ticketsForVariant.length) source = 'api';
        } catch (err) {
          if (isAbortError(err)) throw err;
        }
      }

      let generationPredictions = predictions;
      if (needsMlStrategy(strategy) && !API_STRATEGIES.has(strategy)) {
        const mlPayload = await ensureMl(game, signal, selected);
        generationPredictions = mlPayload?.predictions || predictions;
      }
      const pickForCompletion = (count, exclude) => pick649ByStrategy(strategy, generationPredictions, count, exclude, config.pool);

      updateSlip(slipIndex, (slip) => {
        const variants = slip.variants.map((v) => uniqueSortedNumbers(v, config.pool, config.maxPick || 18));
        const variantMeta = slip.variantMeta.map((m) => m);
        const base = variants[variantIndex];
        const numbers = completePick(
          base,
          [
            ...ticketsForVariant.map((ticket) => ticket?.numbers || []),
            pickForCompletion(config.pick, base),
            pickForCompletion(config.pick, base)
          ],
          config.pick,
          config.pool,
          config.maxPick || 18
        );
        const ticket = ticketsForVariant.find((item) => item?.numbers?.length);
        variants[variantIndex] = numbers;
        variantMeta[variantIndex] = numbers.length >= config.pick
          ? variantMetaForCompletion(numbers, strategy, ticket, source, base.length, config.pool)
          : null;
        const jokerNumbers = config.bonus === 'joker'
          ? completePick(
              slip.jokerNumbers || [],
              [
                ticketsForVariant.map((item) => (item?.joker ? item.joker : null)).filter(Boolean),
                pick649ByStrategy('random', [], config.jokerMinPick || 1, slip.jokerNumbers || [], config.jokerPool || 20)
              ],
              config.jokerMinPick || 1,
              config.jokerPool || 20,
              config.jokerMaxPick || 20
            )
          : slip.jokerNumbers;
        return { ...slip, variants, variantMeta, jokerNumbers };
      });
      setGenSource({ mode: strategy, slipIndex, variantIndex, source });
    });
  };

  const handleNorocCountChange = (slipIndex, count) => {
    if (loading) return;
    const next = Math.min(LOTO_NOROC_MAX_COUNT, Math.max(1, Number(count) || 1));
    updateSlip(slipIndex, (slip) => ({ ...slip, norocCount: next }));
  };

  const toggleJokerNumber = (slipIndex, num) => {
    if (loading || config.bonus !== 'joker') return;
    updateSlip(slipIndex, (slip) => {
      const jokerNumbers = uniqueSortedNumbers(slip.jokerNumbers || [], config.jokerPool || 20, config.jokerMaxPick || 20);
      const idx = jokerNumbers.indexOf(num);
      if (idx >= 0) jokerNumbers.splice(idx, 1);
      else if (jokerNumbers.length < (config.jokerMaxPick || 20)) {
        jokerNumbers.push(num);
        jokerNumbers.sort((a, b) => a - b);
      }
      return { ...slip, jokerNumbers };
    });
  };

  const handleAnalyze = async (analyzeKey, numbers, slipIndex) => {
    setAnalyzingVariant(analyzeKey);
    try {
      const joker = config.bonus === 'joker' ? uniqueSortedNumbers(slips[slipIndex]?.jokerNumbers || [], config.jokerPool || 20)[0] : null;
      await onAnalyze(numbers, game, joker);
    } finally {
      setAnalyzingVariant(null);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2 rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
        <button
          type="button"
          onClick={clearAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-field px-3 py-2 text-xs font-black text-ink hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Eraser size={14} /> Șterge tot
        </button>
        {loading ? (
          <button
            type="button"
            onClick={cancelGenerate}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-4 py-2 text-xs font-black text-ink hover:border-primary hover:text-primary"
          >
            <Square size={14} /> Oprește
          </button>
        ) : null}
        <button
          type="button"
          onClick={generateAll}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <Loader2 className="animate-spin" size={14} /> : <Shuffle size={14} />}
          Generează {ticketCount} {ticketCount === 1 ? 'bilet' : 'bilete'}
        </button>
      </div>

      <StrategyTicketControls
        strategies={ALL_STRATEGIES}
        strategy={strategy}
        onStrategyChange={setStrategy}
        ticketCount={ticketCount}
        onTicketCountChange={setTicketCount}
        disabled={loading}
      />

      <div className={`space-y-6 ${loading ? 'pointer-events-none opacity-70' : ''}`}>
        {slips.map((slip, slipIndex) => {
          const footer = config.bonus === 'noroc' ? (
            <NorocPanel
              slip={slip}
              disabled={loading}
              onCountChange={(count) => handleNorocCountChange(slipIndex, count)}
            />
          ) : config.bonus === 'joker' ? (
            <JokerPanel
              slip={slip}
              jokerPool={config.jokerPool}
              jokerMinPick={config.jokerMinPick}
              jokerMaxPick={config.jokerMaxPick}
              disabled={loading}
              onToggle={(num) => toggleJokerNumber(slipIndex, num)}
            />
          ) : null;

          return (
            <Loto649SlipCard
              key={`slip-${slipIndex}`}
              slipIndex={slipIndex}
              slip={slip}
              gameLabel={gameLabel}
              pool={config.pool}
              pick={config.pick}
              maxPick={config.maxPick}
              columns={config.columns}
              linePrice={config.linePrice}
              footer={footer}
              mlHints={mlHints}
              predictions={predictions}
              onVariantToggle={toggleNumber}
              onVariantQuickPick={handleQuickPick}
              onVariantClear={clearVariant}
              onVariantGenerate={generateVariant}
              onAnalyze={(analyzeKey, numbers) => handleAnalyze(analyzeKey, numbers, slipIndex)}
              analyzeLoading={analyzeLoading}
              analyzingVariant={analyzingVariant}
              genSource={genSource}
              disabled={loading}
            />
          );
        })}
      </div>

      <TicketCostDock slips={slips} game={game} config={config} />
    </div>
  );
}
