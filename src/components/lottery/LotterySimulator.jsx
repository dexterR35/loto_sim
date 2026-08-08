import { Eraser, Loader2, Shuffle, Square } from 'lucide-react';
import { GAMES, STRATEGIES } from '../../lib/constants';
import { getGameConfig } from '../../lib/gameConfig';
import { Loto649Simulator } from './Loto649Simulator';
import { StrategyTicketControls } from './StrategyTicketControls';
import { TicketGrid } from './index';
import { Badge, Panel } from '../ui';

function GenericGamePlay({
  game,
  gameLabel,
  strategy,
  setStrategy,
  ticketCount,
  setTicketCount,
  loading,
  generate,
  cancelGenerate,
  tickets,
  onClearTickets,
  onAnalyzeTicket,
  generateMeta
}) {
  const config = getGameConfig(game);
  const algorithm = generateMeta?.algorithm?.name;

  const handleGenerate = () => generate({ game, strategy, ticketCount });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3 shadow-sm">
        <div>
          <div className="text-sm font-black text-ink">{gameLabel}</div>
          <p className="text-xs text-muted">
            {config.jokerPool
              ? `${config.pick} numere + Joker (1–${config.jokerPool})`
              : `${config.pick} numere din ${config.pool}`}
            {algorithm ? ` · ${algorithm}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClearTickets}
            disabled={!tickets.length || loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-field px-3 py-2 text-xs font-black text-ink hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Eraser size={14} /> Șterge
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
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <Shuffle size={14} />}
            Generează {ticketCount}
          </button>
        </div>
      </div>

      <StrategyTicketControls
        strategies={STRATEGIES}
        strategy={strategy}
        onStrategyChange={setStrategy}
        ticketCount={ticketCount}
        onTicketCountChange={setTicketCount}
        disabled={loading}
      />

      <Panel
        title="Bilete generate"
        icon={Shuffle}
        bodyClassName="p-4"
        action={<Badge tone="primary">{tickets.length} bilete</Badge>}
      >
        <TicketGrid
          tickets={tickets}
          game={game}
          onAnalyze={onAnalyzeTicket}
          emptyLabel="Alege strategia și apasă Generează pentru linii clasificate din arhivă."
        />
      </Panel>
    </>
  );
}

export function LotterySimulator({
  game,
  strategy,
  setStrategy,
  ticketCount,
  setTicketCount,
  loading,
  generate,
  runGenerateApi,
  beginGenerateSession,
  ensureMl,
  cancelGenerate,
  tickets,
  onClearTickets,
  onAnalyzeTicket,
  onAnalyzeVariant,
  analyzeLoading,
  generateMeta,
  mlData
}) {
  const config = getGameConfig(game);
  const gameLabel = GAMES.find((item) => item.key === game)?.full || 'Simulator';

  return (
    <div className="w-full space-y-4">
      {config.hasSlipUI ? (
        <Loto649Simulator
          game={game}
          gameLabel={gameLabel}
          strategy={strategy}
          setStrategy={setStrategy}
          ticketCount={ticketCount}
          setTicketCount={setTicketCount}
          loading={loading}
          runGenerateApi={runGenerateApi}
          onAnalyze={onAnalyzeVariant}
          analyzeLoading={analyzeLoading}
          mlData={mlData}
          beginGenerateSession={beginGenerateSession}
          ensureMl={ensureMl}
          cancelGenerate={cancelGenerate}
        />
      ) : (
        <GenericGamePlay
          game={game}
          gameLabel={gameLabel}
          strategy={strategy}
          setStrategy={setStrategy}
          ticketCount={ticketCount}
          setTicketCount={setTicketCount}
          loading={loading}
          generate={generate}
          cancelGenerate={cancelGenerate}
          tickets={tickets}
          onClearTickets={onClearTickets}
          onAnalyzeTicket={onAnalyzeTicket}
          generateMeta={generateMeta}
        />
      )}
    </div>
  );
}
