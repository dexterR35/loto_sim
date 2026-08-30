import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './lib/api';
import { GAMES } from './lib/constants';
import { applyGameTheme } from './lib/gameTheme';
import { buildAppPath, normalizeStatisticsTab, parseAppRoute } from './lib/routes';
import { isAbortError } from './lib/generation';
import { PageHeader, Sidebar, TicketRail } from './components/layout';
import { ArchivePage } from './pages/ArchivePage';
import { DashboardPage } from './pages/DashboardPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { Loto649LabPage } from './pages/Loto649LabPage';
import { TargetSimulatorPage } from './pages/TargetSimulatorPage';

const DEFAULT_SIMULATIONS = 900;

export default function App() {
  const initialRouteRef = useRef(parseAppRoute());
  const [activeView, setActiveView] = useState(() => initialRouteRef.current.view);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [stats, setStats] = useState(null);
  const [recentDraws, setRecentDraws] = useState([]);
  const [historyPayload, setHistoryPayload] = useState({ draws: [], total: 0, years: [] });
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historyYear, setHistoryYear] = useState('');
  const [rawPreview, setRawPreview] = useState(null);
  const [tickets, setTickets] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [game, setGame] = useState(() => initialRouteRef.current.game);
  const [strategy, setStrategy] = useState('balanced');
  const [ticketCount, setTicketCount] = useState(1);
  const [manualNumbers, setManualNumbers] = useState('1, 2, 3, 4, 5, 6');
  const [manualJoker, setManualJoker] = useState('7');
  const [targetSimulationNumbers, setTargetSimulationNumbers] = useState([]);
  const [generateMeta, setGenerateMeta] = useState(null);
  const [generatorTab, setGeneratorTab] = useState(() => initialRouteRef.current.view === 'generator' ? initialRouteRef.current.tab : 'play');
  const [statisticsTab, setStatisticsTab] = useState(() => initialRouteRef.current.view === 'statistics' ? initialRouteRef.current.tab : 'inference');
  const [labNumber, setLabNumber] = useState(null);
  const [loading, setLoading] = useState(false);
  const [calcLoading, setCalcLoading] = useState(false);
  const [mlData, setMlData] = useState(null);
  const [error, setError] = useState('');

  const generateAbortRef = useRef(null);
  const routeStateRef = useRef({ view: initialRouteRef.current.view, game: initialRouteRef.current.game });
  const gameLabel = useMemo(() => GAMES.find((item) => item.key === game)?.full, [game]);

  useEffect(() => {
    routeStateRef.current = { view: activeView, game };
  }, [activeView, game]);

  const syncBrowserRoute = useCallback((view, gameKey, tab, replace = false) => {
    if (typeof window === 'undefined') return;
    const nextPath = buildAppPath(view, gameKey, tab);
    if (window.location.pathname === nextPath) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', nextPath);
  }, []);

  const cancelGenerate = useCallback(() => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setLoading(false);
  }, []);

  const resetGenerationState = useCallback(() => {
    setTickets([]);
    setGenerateMeta(null);
    setMlData(null);
  }, []);

  const ensureMl = useCallback(async (gameKey, signal, numbers = []) => {
    if (gameKey !== '6din49') return null;
    const params = new URLSearchParams({ game: gameKey });
    const selected = Array.isArray(numbers)
      ? numbers.map(Number).filter((num) => Number.isInteger(num) && num > 0)
      : [];
    if (selected.length) params.set('numbers', selected.join(','));
    const payload = await api(`/api/ml/predict?${params.toString()}`, { signal });
    setMlData(payload);
    return payload;
  }, []);

  const beginGenerateSession = useCallback(async (work) => {
    cancelGenerate();
    const ac = new AbortController();
    generateAbortRef.current = ac;
    setLoading(true);
    setError('');
    try {
      return await work(ac.signal);
    } catch (err) {
      if (!isAbortError(err)) {
        setError(err.message);
        throw err;
      }
      return null;
    } finally {
      if (generateAbortRef.current === ac) {
        generateAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [cancelGenerate]);

  const runGenerateApi = useCallback(async (overrides, signal) => {
    const gameKey = overrides.game || game;
    const strat = overrides.strategy || strategy;
    const count = overrides.ticketCount ?? ticketCount;

    return api('/api/generate', {
      method: 'POST',
      body: JSON.stringify({
        game: gameKey,
        strategy: strat,
        ticket_count: count,
        simulations: DEFAULT_SIMULATIONS
      }),
      signal
    });
  }, [game, strategy, ticketCount]);

  const generate = useCallback(async (overrides = {}) => {
    return beginGenerateSession(async (signal) => {
      const payload = await runGenerateApi(overrides, signal);
      setTickets(payload.tickets || []);
      setGenerateMeta(payload);
      setAnalysis(null);
      return payload;
    });
  }, [beginGenerateSession, runGenerateApi]);

  const changeStrategy = useCallback((next) => {
    if (loading || next === strategy) return;
    cancelGenerate();
    resetGenerationState();
    setStrategy(next);
  }, [cancelGenerate, loading, resetGenerationState, strategy]);

  const changeView = useCallback((nextView, nextTab) => {
    const viewTab = nextView === 'generator'
      ? generatorTab
      : nextView === 'statistics'
        ? normalizeStatisticsTab(nextTab || statisticsTab)
        : null;
    if (nextView === activeView && (nextView !== 'statistics' || viewTab === statisticsTab)) return;
    cancelGenerate();
    if (nextView === 'statistics') setStatisticsTab(viewTab);
    setActiveView(nextView);
    syncBrowserRoute(nextView, game, viewTab);
  }, [activeView, cancelGenerate, game, generatorTab, statisticsTab, syncBrowserRoute]);

  const inspectNumber = useCallback((number) => {
    const next = Number(number);
    if (!Number.isInteger(next) || next < 1) return;
    setLabNumber(next);
    changeView('statistics', 'number');
  }, [changeView]);

  const openTargetSimulator = useCallback((numbers) => {
    const selected = [...new Set(
      (Array.isArray(numbers) ? numbers : [])
        .map(Number)
        .filter((number) => Number.isInteger(number) && number >= 1 && number <= 49)
    )].sort((a, b) => a - b);
    if (selected.length !== 6) {
      setError('Target Simulator needs exactly six unique numbers from 1 to 49.');
      return;
    }
    cancelGenerate();
    setError('');
    setTargetSimulationNumbers(selected);
    setGame('6din49');
    setActiveView('target');
    syncBrowserRoute('target', '6din49', null);
  }, [cancelGenerate, syncBrowserRoute]);


  const changeGeneratorTab = useCallback((nextTab) => {
    if (nextTab === generatorTab && activeView === 'generator') return;
    cancelGenerate();
    setActiveView('generator');
    setGeneratorTab(nextTab);
    syncBrowserRoute('generator', game, nextTab);
  }, [activeView, cancelGenerate, game, generatorTab, syncBrowserRoute]);

  const changeStatisticsTab = useCallback((nextTab) => {
    const normalized = normalizeStatisticsTab(nextTab);
    if (normalized === statisticsTab && activeView === 'statistics') return;
    cancelGenerate();
    setActiveView('statistics');
    setStatisticsTab(normalized);
    syncBrowserRoute('statistics', game, normalized);
  }, [activeView, cancelGenerate, game, statisticsTab, syncBrowserRoute]);

  const changeGame = useCallback((nextGame) => {
    if (loading || nextGame === game) return;
    cancelGenerate();
    resetGenerationState();
    setGame(nextGame);
    setStrategy('balanced');
    setTicketCount(1);
    setHistoryOffset(0);
    setHistoryYear('');
    const activeTab = activeView === 'generator' ? generatorTab : activeView === 'statistics' ? statisticsTab : null;
    syncBrowserRoute(activeView, nextGame, activeTab);
  }, [activeView, cancelGenerate, game, generatorTab, loading, resetGenerationState, statisticsTab, syncBrowserRoute]);

  const changeTicketCount = useCallback((next) => {
    if (loading) return;
    setTicketCount(next);
  }, [loading]);

  const clearTickets = useCallback(() => {
    if (loading) return;
    cancelGenerate();
    resetGenerationState();
  }, [cancelGenerate, loading, resetGenerationState]);

  useEffect(() => {
    const applyRoute = () => {
      const nextRoute = parseAppRoute();
      const previous = routeStateRef.current;
      cancelGenerate();
      setActiveView(nextRoute.view);
      if (nextRoute.view === 'generator') setGeneratorTab(nextRoute.tab);
      if (nextRoute.view === 'statistics') setStatisticsTab(nextRoute.tab);
      if (previous.game !== nextRoute.game) {
        resetGenerationState();
        setAnalysis(null);
        setStrategy('balanced');
        setTicketCount(1);
        setHistoryOffset(0);
        setHistoryYear('');
      }
      setGame(nextRoute.game);
    };

    const activeTab = activeView === 'generator' ? generatorTab : activeView === 'statistics' ? statisticsTab : null;
    syncBrowserRoute(activeView, game, activeTab, true);
    window.addEventListener('popstate', applyRoute);
    return () => window.removeEventListener('popstate', applyRoute);
  }, [activeView, cancelGenerate, game, generatorTab, resetGenerationState, statisticsTab, syncBrowserRoute]);

  useEffect(() => {
    applyGameTheme(game);
  }, [game]);

  useEffect(() => {
    api('/api/summary').then(setSummary).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setStats(null);
    setRecentDraws([]);
    resetGenerationState();
    setAnalysis(null);
    setRawPreview(null);
    setHistoryOffset(0);

    Promise.all([
      api(`/api/stats?game=${game}`, { signal: ac.signal }),
      api(`/api/draws?game=${game}&limit=400`, { signal: ac.signal })
    ])
      .then(([statsPayload, drawsPayload]) => {
        setStats(statsPayload);
        setRecentDraws(drawsPayload.draws || []);
      })
      .catch((err) => {
        if (!isAbortError(err)) setError(err.message);
      });

    return () => ac.abort();
  }, [game, resetGenerationState]);

  useEffect(() => {
    const ac = new AbortController();
    const year = historyYear ? `&year=${encodeURIComponent(historyYear)}` : '';
    api(`/api/draws?game=${game}&limit=${historyLimit}&offset=${historyOffset}${year}`, { signal: ac.signal })
      .then(setHistoryPayload)
      .catch((err) => {
        if (!isAbortError(err)) setError(err.message);
      });
    return () => ac.abort();
  }, [game, historyOffset, historyYear, historyLimit]);

  useEffect(() => {
    if (activeView !== 'generator') cancelGenerate();
  }, [activeView, cancelGenerate]);

  const buildAnalyzePayload = () => {
    const body = { game, numbers: manualNumbers, simulations: DEFAULT_SIMULATIONS };
    if (game === 'joker' && manualJoker.trim()) body.joker = Number(manualJoker);
    return body;
  };

  const calculateManual = async () => {
    setCalcLoading(true);
    setError('');
    try {
      const payload = await api('/api/calculate', {
        method: 'POST',
        body: JSON.stringify(buildAnalyzePayload())
      });
      setAnalysis(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setCalcLoading(false);
    }
  };

  const analyzeTicket = async (ticket) => {
    setCalcLoading(true);
    setError('');
    try {
      const payload = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({
          game,
          numbers: ticket.numbers,
          joker: ticket.joker || null,
          simulations: DEFAULT_SIMULATIONS
        })
      });
      setAnalysis(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setCalcLoading(false);
    }
  };

  const analyzeManual = async () => {
    setCalcLoading(true);
    setError('');
    try {
      const payload = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify(buildAnalyzePayload())
      });
      setAnalysis(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setCalcLoading(false);
    }
  };

  const analyzeVariant = async (numbers, gameKey = game, joker = null) => {
    setCalcLoading(true);
    setError('');
    try {
      const body = { game: gameKey, numbers, simulations: DEFAULT_SIMULATIONS, limit: 120 };
      if (joker != null) body.joker = joker;
      const payload = await api('/api/analyze', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      setAnalysis(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setCalcLoading(false);
    }
  };

  const openTicket = async (ticket) => {
    setManualNumbers((ticket.numbers || []).join(', '));
    if (ticket.joker != null && ticket.joker !== '') setManualJoker(String(ticket.joker));
    changeGeneratorTab('analyze');
    await analyzeTicket(ticket);
  };

  return (
    <div className="app-shell" data-game={game}>
      {mobileNavOpen ? <button type="button" className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation overlay" /> : null}
      <Sidebar
        activeView={activeView}
        onViewChange={changeView}
        summary={summary}
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
      />

      <div className="app-main">
        <PageHeader
          activeView={activeView}
          onMenu={() => setMobileNavOpen(true)}
          game={game}
          onGameChange={changeGame}
          loading={loading}
        />
        <TicketRail tickets={tickets} game={game} onOpen={openTicket} onClear={clearTickets} onNumberClick={inspectNumber} />
        <main className="app-page">
          {error ? (
            <p className="mb-5 grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 text-sm font-bold text-primary">
              <span>{error}</span>
              <button type="button" onClick={() => setError('')} className="rounded-full bg-elevated px-3 py-1.5 text-xs hover:text-ink">Dismiss</button>
            </p>
          ) : null}

          {activeView === 'dashboard' ? (
            <DashboardPage
              game={game}
              stats={stats}
              recentDraws={recentDraws}
              tickets={tickets}
              onViewChange={changeView}
              onInspectNumber={inspectNumber}
              onOpenTicket={openTicket}
            />
          ) : null}

          {activeView === 'statistics' ? (
            <Loto649LabPage
              game={game}
              onGameChange={changeGame}
              activeTab={statisticsTab}
              onTabChange={changeStatisticsTab}
              tickets={tickets}
              recentDraws={recentDraws}
              stats={stats}
              selectedNumber={labNumber}
              onSelectNumber={setLabNumber}
            />
          ) : null}

          {activeView === 'archive' ? (
            <ArchivePage
              historyPayload={historyPayload}
              historyOffset={historyOffset}
              setHistoryOffset={setHistoryOffset}
              historyLimit={historyLimit}
              setHistoryLimit={setHistoryLimit}
              historyYear={historyYear}
              setHistoryYear={setHistoryYear}
              rawPreview={rawPreview}
              setRawPreview={setRawPreview}
              tickets={tickets}
              recentDraws={recentDraws}
              stats={stats}
              onInspectNumber={inspectNumber}
              onOpenTicket={openTicket}
            />
          ) : null}

          {activeView === 'target' ? (
            <TargetSimulatorPage
              game={game}
              onGameChange={changeGame}
              onOpenBacktest={() => changeStatisticsTab('backtest')}
              initialNumbers={targetSimulationNumbers.length ? targetSimulationNumbers : (tickets[0]?.numbers || [])}
            />
          ) : null}

          {activeView === 'generator' ? (
            <GeneratorPage
              game={game}
              gameLabel={gameLabel}
              strategy={strategy}
              setStrategy={changeStrategy}
              ticketCount={ticketCount}
              setTicketCount={changeTicketCount}
              loading={loading}
              generate={generate}
              runGenerateApi={runGenerateApi}
              beginGenerateSession={beginGenerateSession}
              ensureMl={ensureMl}
              cancelGenerate={cancelGenerate}
              tickets={tickets}
              generateMeta={generateMeta}
              clearTickets={clearTickets}
              analyzeTicket={analyzeTicket}
              onOpenTicket={openTicket}
              onInspectNumber={inspectNumber}
              manualNumbers={manualNumbers}
              setManualNumbers={setManualNumbers}
              manualJoker={manualJoker}
              setManualJoker={setManualJoker}
              analysis={analysis}
              calculateManual={calculateManual}
              analyzeManual={analyzeManual}
              analyzeVariant={analyzeVariant}
              onSimulateTarget={openTargetSimulator}
              calcLoading={calcLoading}
              stats={stats}
              mlData={mlData}
              activeTab={generatorTab}
              onTabChange={changeGeneratorTab}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
