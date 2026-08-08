export const GAME_CONFIGS = {
  '6din49': {
    pool: 49,
    pick: 6,
    maxPick: 18,
    columns: 10,
    jokerPool: 0,
    linePrice: 8,
    formPrice: 0.5,
    bonus: 'noroc',
    hasSlipUI: true
  },
  '5din40': {
    pool: 40,
    pick: 6,
    maxPick: 12,
    columns: 10,
    jokerPool: 0,
    linePrice: 6,
    formPrice: 0,
    bonus: null,
    hasSlipUI: true
  },
  joker: {
    pool: 45,
    pick: 5,
    maxPick: 15,
    columns: 9,
    jokerPool: 20,
    jokerMinPick: 1,
    jokerMaxPick: 20,
    linePrice: 5,
    formPrice: 0,
    bonus: 'joker',
    hasSlipUI: true
  }
};

export function getGameConfig(game) {
  return GAME_CONFIGS[game] || GAME_CONFIGS['6din49'];
}
