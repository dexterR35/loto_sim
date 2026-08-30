import { useEffect, useMemo, useState } from 'react';
import { Calculator, Grid3x3 } from 'lucide-react';
import { HistogramChart } from '../components/charts';
import { AnalysisDetailModal } from '../components/lottery/AnalysisModal';
import { NumberCalculator } from '../components/lottery/Calculator';
import { LotterySimulator } from '../components/lottery/LotterySimulator';
import { TicketStack } from '../components/lottery/CompactTicket';
import { Tabs } from '../components/ui';
import { analysisChartData } from '../lib/activity';

const GENERATOR_TABS = [
  { key: 'play', label: 'Generate', icon: Grid3x3 },
  { key: 'analyze', label: 'Analyze', icon: Calculator }
];

export function GeneratorPage({
  game,
  gameLabel,
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
  generateMeta,
  clearTickets,
  analyzeTicket,
  onOpenTicket,
  onInspectNumber,
  manualNumbers,
  setManualNumbers,
  manualJoker,
  setManualJoker,
  analysis,
  calculateManual,
  analyzeManual,
  analyzeVariant,
  onSimulateTarget,
  calcLoading,
  stats,
  mlData,
  activeTab = 'play',
  onTabChange
}) {
  const [localTab, setLocalTab] = useState(activeTab);
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const selectedTab = onTabChange ? activeTab : localTab;
  const setActiveTab = onTabChange || setLocalTab;
  const charts = useMemo(() => analysisChartData(analysis), [analysis]);

  useEffect(() => {
    if (analysis) setAnalysisModalOpen(true);
  }, [analysis]);

  const handleAnalyzeTicket = async (ticket) => {
    if (onOpenTicket) {
      await onOpenTicket(ticket);
      return;
    }
    await analyzeTicket(ticket);
    setActiveTab('analyze');
  };

  return (
    <article className="page-stack">
      <Tabs items={GENERATOR_TABS} active={selectedTab} onChange={setActiveTab} />

      {selectedTab === 'play' ? (
        <LotterySimulator
          game={game}
          strategy={strategy}
          setStrategy={setStrategy}
          ticketCount={ticketCount}
          setTicketCount={setTicketCount}
          loading={loading}
          generate={generate}
          runGenerateApi={runGenerateApi}
          beginGenerateSession={beginGenerateSession}
          ensureMl={ensureMl}
          cancelGenerate={cancelGenerate}
          tickets={tickets}
          onClearTickets={clearTickets}
          onAnalyzeTicket={handleAnalyzeTicket}
          onAnalyzeVariant={analyzeVariant}
          onSimulateTarget={onSimulateTarget}
          analyzeLoading={calcLoading}
          generateMeta={generateMeta}
          mlData={mlData}
        />
      ) : null}

      {selectedTab === 'analyze' ? (
        <section className="page-analyze">
          <NumberCalculator
            game={game}
            gameLabel={gameLabel}
            manualNumbers={manualNumbers}
            setManualNumbers={setManualNumbers}
            manualJoker={manualJoker}
            setManualJoker={setManualJoker}
            onCalculate={calculateManual}
            onAnalyze={analyzeManual}
            calcLoading={calcLoading}
            analysisLoading={calcLoading}
            result={analysis}
            historyDraws={stats?.draws || 0}
            onViewDetails={() => analysis && setAnalysisModalOpen(true)}
          />
          <aside className="page-analyze-tickets">
            {tickets.length ? (
              <TicketStack tickets={tickets} onNumberClick={onInspectNumber} onOpen={handleAnalyzeTicket} />
            ) : (
              <p className="rounded-2xl border border-dashed border-line bg-field/60 p-6 text-sm text-muted">Generate tickets first — they stay available on every page.</p>
            )}
            {charts.histogram.length ? (
              <section className="chart-card">
                <header className="chart-card__head">
                  <h2>Archive match histogram</h2>
                </header>
                <HistogramChart data={charts.histogram} />
              </section>
            ) : null}
          </aside>
        </section>
      ) : null}

      <AnalysisDetailModal
        open={analysisModalOpen}
        onClose={() => setAnalysisModalOpen(false)}
        result={analysis}
        loading={calcLoading && !analysis}
      />
    </article>
  );
}
