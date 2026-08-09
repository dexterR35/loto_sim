import { useEffect, useState } from 'react';
import { Calculator, Grid3x3 } from 'lucide-react';
import { AnalysisDetailModal } from '../components/lottery/AnalysisModal';
import { NumberCalculator } from '../components/lottery/Calculator';
import { LotterySimulator } from '../components/lottery/LotterySimulator';
import { Tabs } from '../components/ui';

const GENERATOR_TABS = [
  { key: 'play', label: 'Play & Generate', icon: Grid3x3 },
  { key: 'analyze', label: 'Analyze My Numbers', icon: Calculator }
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

  useEffect(() => {
    if (analysis) setAnalysisModalOpen(true);
  }, [analysis]);

  const openAnalysis = () => {
    if (analysis) setAnalysisModalOpen(true);
  };

  const handleAnalyzeTicket = async (ticket) => {
    await analyzeTicket(ticket);
    setActiveTab('analyze');
  };

  return (
    <div className="grid gap-5">
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
        <div className="grid max-w-4xl">
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
            onViewDetails={openAnalysis}
          />
        </div>
      ) : null}

      <AnalysisDetailModal
        open={analysisModalOpen}
        onClose={() => setAnalysisModalOpen(false)}
        result={analysis}
        loading={calcLoading && !analysis}
      />
    </div>
  );
}
