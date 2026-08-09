import { GAMES, VIEWS } from './constants';

export const GENERATOR_TABS = ['play', 'analyze'];
export const STATISTICS_TABS = ['inference', 'number', 'relationships', 'prediction', 'backtest'];

const DEFAULT_VIEW = 'dashboard';
const DEFAULT_GAME = '6din49';
const DEFAULT_GENERATOR_TAB = 'play';
const DEFAULT_STATISTICS_TAB = 'inference';
const GAME_KEYS = new Set(GAMES.map((item) => item.key));
const VIEW_KEYS = new Set(VIEWS.map((item) => item.key));
const GENERATOR_TAB_KEYS = new Set(GENERATOR_TABS);
const STATISTICS_TAB_KEYS = new Set(STATISTICS_TABS);

function cleanPart(part) {
  try {
    return decodeURIComponent(part || '');
  } catch {
    return part || '';
  }
}

export function normalizeGame(value) {
  return GAME_KEYS.has(value) ? value : DEFAULT_GAME;
}

export function normalizeView(value) {
  return VIEW_KEYS.has(value) ? value : DEFAULT_VIEW;
}

export function normalizeGeneratorTab(value) {
  return GENERATOR_TAB_KEYS.has(value) ? value : DEFAULT_GENERATOR_TAB;
}

export function normalizeStatisticsTab(value) {
  return STATISTICS_TAB_KEYS.has(value) ? value : DEFAULT_STATISTICS_TAB;
}

export function buildAppPath(view, game, tab) {
  const safeView = normalizeView(view);
  const safeGame = normalizeGame(game);
  if (safeView === 'generator') {
    return `/generator/${safeGame}/${normalizeGeneratorTab(tab)}`;
  }
  if (safeView === 'statistics') {
    return `/statistics/${safeGame}/${normalizeStatisticsTab(tab)}`;
  }
  return `/${safeView}/${safeGame}`;
}

export function parseAppRoute(pathname = typeof window !== 'undefined' ? window.location.pathname : '/') {
  const parts = String(pathname).split('/').filter(Boolean).map(cleanPart);
  const view = normalizeView(parts[0]);
  const game = normalizeGame(parts[1]);
  const tab = view === 'generator'
    ? normalizeGeneratorTab(parts[2])
    : view === 'statistics'
      ? normalizeStatisticsTab(parts[2])
      : null;
  return {
    view,
    game,
    tab,
    path: buildAppPath(view, game, tab),
  };
}
