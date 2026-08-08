import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Calculator,
  Grid3x3,
  Hash
} from 'lucide-react';
import { AnalysisDetailModal } from '../components/lottery/AnalysisModal';
import { NumberCalculator } from '../components/lottery/Calculator';
import { LotterySimulator } from '../components/lottery/LotterySimulator';
import { NumberAnalysisPage } from './NumberAnalysisPage';
import { FrequencyBars, NumberPill, OverdueList } from '../components/lottery';
import { LoadingBlock, Panel } from '../components/ui';

const GENERATOR_TABS = [
  { key: 'play', label: 'Simulator', icon: Grid3x3 },
  { key: 'analyze', label: 'Analiză variantă', icon: Calculator },
  { key: 'numbers', label: 'Analiză numere', icon: Hash },
  { key: 'signals', label: 'Semnale', icon: BarChart3 }
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
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {GENERATOR_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`generator-tab ${selectedTab === key ? 'generator-tab-active' : 'generator-tab-idle'}`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

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
          analyzeLoading={calcLoading}
          generateMeta={generateMeta}
          mlData={mlData}
        />
      ) : null}

      {selectedTab === 'analyze' ? (
        <div className="max-w-3xl">
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


      {selectedTab === 'numbers' ? (
        <NumberAnalysisPage game={game} gameLabel={gameLabel} />
      ) : null}

      {selectedTab === 'signals' ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel title="Panou semnale" icon={BarChart3} bodyClassName="p-4">
            <div className="grid gap-4">
              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Numere calde</div>
                <div className="flex flex-wrap gap-2">
                  {(stats?.hot || []).slice(0, 8).map((item) => <NumberPill key={item.number} value={item.number} tone="hot" size="sm" />)}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Numere reci</div>
                <div className="flex flex-wrap gap-2">
                  {(stats?.cold || []).slice(0, 8).map((item) => <NumberPill key={item.number} value={item.number} tone="cold" size="sm" />)}
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Întârziate</div>
                {stats ? <OverdueList items={stats.overdue?.slice(0, 5)} /> : <LoadingBlock rows={5} />}
              </div>
            </div>
          </Panel>
          <Panel title="Frecvență caldă" icon={Activity} bodyClassName="p-4">
            {stats ? <FrequencyBars items={stats.hot} tone="hot" /> : <LoadingBlock />}
          </Panel>
          <Panel title="Frecvență rece" icon={BarChart3} bodyClassName="p-4">
            {stats ? <FrequencyBars items={stats.cold} tone="cold" /> : <LoadingBlock />}
          </Panel>
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
