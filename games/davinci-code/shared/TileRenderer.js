/**
 * TileRenderer.js — 타일 1장 DOM 렌더 유틸 (host/mobile 공유)
 *
 * 표시 여부는 `revealed`가 아니라 "이 tile 객체에 number/joker 필드가 실려
 * 있는가"로 결정한다. 상대방·TV에서 보는 타일은 항상 DavinciEngine.publicTile()의
 * 출력(§9)이라 hidden이면 그 필드 자체가 없어 자동으로 안 보이지만, **소유자
 * 본인의 타일판은 공개 여부와 무관하게 항상 숫자를 알아야 한다**(plan §11.2 —
 * "내 타일은 항상 숫자가 보임"). 그래서 모바일 클라이언트는 자기 타일을 그릴 때
 * revealed:false여도 로컬에 기억해둔 진짜 값을 채워서 넘긴다(§9 유출과는 무관 —
 * 소유자 자신의 화면에만 그리는 것). `revealed`는 오직 "이 값을 남들도 이미
 * 아는가"를 나타내는 시각적 마킹(`dv-tile-public`)에만 쓰인다.
 *
 * @param {{uid:string,color:'B'|'W',revealed:boolean,number?:number,joker?:boolean}} tile
 * @param {{ existing?: HTMLElement, size?: 'sm'|'md'|'lg'|'xl', dim?: boolean, selected?: boolean }} [opts]
 */
export function renderTile(tile, opts = {}) {
  const el = opts.existing || document.createElement('div');
  const known = tile.joker || Number.isInteger(tile.number);
  el.className = `dv-tile dv-tile-${opts.size || 'md'} dv-tile-${tile.color === 'B' ? 'black' : 'white'}`;
  el.dataset.tileId = tile.uid;
  el.classList.toggle('dv-tile-back', !known);
  el.classList.toggle('dv-tile-face', known);
  el.classList.toggle('dv-tile-public', !!tile.revealed);
  el.classList.toggle('dv-tile-dim', !!opts.dim);
  el.classList.toggle('dv-tile-selected', !!opts.selected);

  if (known) {
    el.classList.toggle('dv-tile-joker', !!tile.joker);
    el.textContent = tile.joker ? '★' : String(tile.number);
  } else {
    el.classList.remove('dv-tile-joker');
    el.textContent = '';
  }
  return el;
}

/** 숫자 패드용 표시 라벨(빈 값 없이 항상 문자열) */
export function guessLabel(value) {
  return value === 'joker' ? '★' : String(value);
}
