import { combinations } from './loto649';

export const JOKER_MAIN_POOL = 45;
export const JOKER_MAIN_PICK = 5;
export const JOKER_MAIN_MAX = 15;
export const JOKER_JOKER_POOL = 20;
export const JOKER_JOKER_MIN = 1;
export const JOKER_JOKER_MAX = 20;
export const JOKER_LINE_PRICE = 5;

export function jokerMainLines(mainCount) {
  if (mainCount < JOKER_MAIN_PICK) return 0;
  return combinations(mainCount, JOKER_MAIN_PICK);
}

export function jokerTicketLines(mainCount, jokerCount) {
  if (mainCount < JOKER_MAIN_PICK || jokerCount < JOKER_JOKER_MIN) return 0;
  return jokerMainLines(mainCount) * jokerCount;
}

export function jokerTicketCost(mainCount, jokerCount) {
  return jokerTicketLines(mainCount, jokerCount) * JOKER_LINE_PRICE;
}

export function formatRon(value) {
  return `${Number(value).toLocaleString('ro-RO', { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })} ron`;
}

export function createEmptyJokerSlip() {
  return { main: [], joker: [] };
}

export function randomJokerSlip() {
  const mainPool = Array.from({ length: JOKER_MAIN_POOL }, (_, i) => i + 1);
  const main = [];
  while (main.length < JOKER_MAIN_PICK) {
    const idx = Math.floor(Math.random() * mainPool.length);
    main.push(mainPool.splice(idx, 1)[0]);
  }
  const joker = [Math.floor(Math.random() * JOKER_JOKER_POOL) + 1];
  return { main: main.sort((a, b) => a - b), joker };
}

export function slipFromApiTicket(ticket) {
  return {
    main: ticket?.numbers || [],
    joker: ticket?.joker != null ? [ticket.joker] : []
  };
}

export const JOKER_WIN_CATEGORIES = [
  'Cat. 1 — toate cele 5 numere + Joker',
  'Cat. 2 — toate cele 5 numere',
  'Cat. 3 — 4 numere + Joker',
  'Cat. 4 — 4 numere',
  'Cat. 5 — 3 numere + Joker',
  'Cat. 6 — 3 numere',
  'Cat. 7 — 2 numere + Joker',
  'Cat. 8 — 1 număr + Joker'
];
