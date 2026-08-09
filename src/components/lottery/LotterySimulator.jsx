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
      <header className="grid gap-4 rounded-2xl border border-line bg-surface px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="text-sm font-black text-ink">{gameLabel}</div>
          <p className="text-xs text-muted">
            {config.jokerPool
              ? `${config.pick} numbers + Joker (1–${config.jokerPool})`
              : `${config.pick} numbers from ${config.pool}`}
            {algorithm ? ` · ${algorithm}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onClearTickets}
            disabled={!tickets.length || loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-4 py-2 text-xs font-bold text-ink hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Eraser size={14} /> Clear
          </button>
          {loading ? (
            <button
              type="button"
              onClick={cancelGenerate}
              className="inline-flex items-center gap-1.5 rounded-full bg-elevated px-4 py-2 text-xs font-bold text-ink hover:text-primary"
            >
              <Square size={14} /> Stop
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleGenerate}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-xs font-bold text-field hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? <Loader2 className="animate-spin" size={14} /> : <Shuffle size={14} />}
            Generate {ticketCount}
          </button>
        </div>
      </header>

      <StrategyTicketControls
        strategies={STRATEGIES}
        strategy={strategy}
        onStrategyChange={setStrategy}
        ticketCount={ticketCount}
        onTicketCountChange={setTicketCount}
        disabled={loading}
      />

      <Panel
        title="Generated tickets"
        icon={Shuffle}
        action={<Badge tone="primary">{tickets.length} tickets</Badge>}
      >
        <TicketGrid
          tickets={tickets}
          game={game}
          onAnalyze={onAnalyzeTicket}
          emptyLabel="Choose a strategy and select Generate to create archive-ranked lines."
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
  onSimulateTarget,
  analyzeLoading,
  generateMeta,
  mlData
}) {
  const config = getGameConfig(game);
  const gameLabel = GAMES.find((item) => item.key === game)?.full || 'Simulator';

  return (
    <div className="grid w-full gap-4">
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
          onSimulateTarget={onSimulateTarget}
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
