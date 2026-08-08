/** Per-game brand colors — applied globally via [data-game] CSS variables. */
export const GAME_THEMES = {
  '6din49': {
    key: '6din49',
    label: 'Loto 6/49',
    primary: '#059669',
    primaryDark: '#047857',
    primaryLight: '#34d399',
    primarySoft: '#ecfdf5',
    switcherActive: 'border-emerald-600 bg-emerald-600 text-white shadow-sm shadow-emerald-600/25',
    switcherIdle: 'border-line bg-white text-muted hover:border-emerald-500/60 hover:bg-emerald-50 hover:text-emerald-800'
  },
  '5din40': {
    key: '5din40',
    label: 'Loto 5/40',
    primary: '#ea580c',
    primaryDark: '#c2410c',
    primaryLight: '#fb923c',
    primarySoft: '#fff7ed',
    switcherActive: 'border-orange-600 bg-orange-600 text-white shadow-sm shadow-orange-600/25',
    switcherIdle: 'border-line bg-white text-muted hover:border-orange-500/60 hover:bg-orange-50 hover:text-orange-800'
  },
  joker: {
    key: 'joker',
    label: 'Joker',
    primary: '#7c3aed',
    primaryDark: '#6d28d9',
    primaryLight: '#a78bfa',
    primarySoft: '#f5f3ff',
    switcherActive: 'border-violet-600 bg-violet-600 text-white shadow-sm shadow-violet-600/25',
    switcherIdle: 'border-line bg-white text-muted hover:border-violet-500/60 hover:bg-violet-50 hover:text-violet-800'
  }
};

export function getGameTheme(game) {
  return GAME_THEMES[game] || GAME_THEMES['6din49'];
}

/** Hex → "r g b" for Tailwind rgb(var / alpha) tokens. */
function hexToRgbParts(hex) {
  const normalized = hex.replace('#', '');
  const value = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  const num = Number.parseInt(value, 16);
  return `${(num >> 16) & 255} ${(num >> 8) & 255} ${num & 255}`;
}

export function applyGameTheme(game) {
  const theme = getGameTheme(game);
  const root = document.documentElement;
  root.dataset.game = game;
  root.style.setProperty('--color-primary', hexToRgbParts(theme.primary));
  root.style.setProperty('--color-primary-dark', hexToRgbParts(theme.primaryDark));
  root.style.setProperty('--color-primary-light', hexToRgbParts(theme.primaryLight));
  root.style.setProperty('--color-primary-soft', hexToRgbParts(theme.primarySoft));
}
