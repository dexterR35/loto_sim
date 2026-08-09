/** Per-game brand colors — applied globally via [data-game] CSS variables. */
export const GAME_THEMES = {
  '6din49': {
    key: '6din49',
    label: 'Loto 6/49',
    switcherActive: 'bg-primary text-field',
    switcherIdle: 'text-muted hover:bg-elevated hover:text-ink'
  },
  '5din40': {
    key: '5din40',
    label: 'Loto 5/40',
    switcherActive: 'bg-primary text-field',
    switcherIdle: 'text-muted hover:bg-elevated hover:text-ink'
  },
  joker: {
    key: 'joker',
    label: 'Joker',
    switcherActive: 'bg-primary text-field',
    switcherIdle: 'text-muted hover:bg-elevated hover:text-ink'
  }
};

export function getGameTheme(game) {
  return GAME_THEMES[game] || GAME_THEMES['6din49'];
}

export function applyGameTheme(game) {
  document.documentElement.dataset.game = getGameTheme(game).key;
}
