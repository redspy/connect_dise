export const MIN_PLAYERS  = 3;
export const MAX_PLAYERS  = 8;
export const WIN_SCORE    = 30;
export const CARD_COUNT   = 158;

export function getHandSize(playerCount) {
  return playerCount === 3 ? 7 : 6;
}
