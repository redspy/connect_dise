export const MIN_PLAYERS  = 3;
export const MAX_PLAYERS  = 8;
export const WIN_SCORE    = 30;
export const CARD_COUNT   = 14; // 카드 추가 시 업데이트

export function getHandSize(playerCount) {
  return playerCount === 3 ? 7 : 6;
}
