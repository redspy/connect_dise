/**
 * TileRenderer.js — 타일 1장 DOM 렌더 유틸 (host/mobile 공유)
 */
import { parseTileId } from './RummikubEngine.js';

const COLOR_HEX = { r: '#e5484d', b: '#3b82f6', y: '#eab308', k: '#1c1c1c' };

/**
 * 타일 DOM 엘리먼트를 생성(또는 재사용)해 반환합니다.
 * @param {string} tileId
 * @param {{ existing?: HTMLElement, size?: 'sm'|'md'|'lg' }} [opts]
 */
export function renderTile(tileId, opts = {}) {
  const t = parseTileId(tileId);
  const el = opts.existing || document.createElement('div');
  el.className = `rk-tile rk-tile-${opts.size || 'md'}`;
  el.dataset.tileId = tileId;

  if (t.isJoker) {
    el.classList.add('rk-tile-joker');
    el.style.color = '#e5484d';
    el.textContent = '★';
  } else {
    el.classList.remove('rk-tile-joker');
    el.style.color = COLOR_HEX[t.color] || '#000';
    el.textContent = String(t.num);
  }
  return el;
}

export function tileColorHex(tileId) {
  const t = parseTileId(tileId);
  return t.isJoker ? '#e5484d' : (COLOR_HEX[t.color] || '#000');
}

export { COLOR_HEX };
