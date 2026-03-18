import { CARD_COUNT } from './constants.js';

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildCardList(count = CARD_COUNT) {
  return Array.from({ length: count }, (_, i) =>
    `card_${String(i + 1).padStart(3, '0')}`
  );
}

export class DeckManager {
  constructor(cardCount = CARD_COUNT) {
    // 카드가 부족한 경우 반복 사용 (테스트용 — 카드 84장 이상 시 제거)
    const base   = buildCardList(cardCount);
    const target = Math.max(84, base.length);
    const extended = [];
    while (extended.length < target) extended.push(...base);
    this._drawPile    = shuffle(extended.slice(0, target));
    this._discardPile = [];
  }

  get remaining() { return this._drawPile.length; }

  /** count장 드로우. 부족하면 null 반환. */
  draw(count) {
    if (this._drawPile.length < count) return null;
    return this._drawPile.splice(0, count);
  }

  discard(cards) {
    this._discardPile.push(...cards);
  }

  canDraw(count) {
    return this._drawPile.length >= count;
  }
}
