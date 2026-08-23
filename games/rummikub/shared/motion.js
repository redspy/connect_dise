/**
 * motion.js — 모션 상수 + FLIP 트윈 유틸 (§11.4, host/mobile 공유)
 */

export const SNAP_MS = 180;
export const ROLLBACK_MS = 420;
export const STAGGER_MS = 28;
export const DEAL_TILE_MS = 45;
export const DRAW_FLY_MS = 520;   // 더미에서 타일 뽑을 때 날아가는 이펙트 지속시간
export const EASE_SNAP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';   // overshoot
export const EASE_ROLLBACK = 'cubic-bezier(0.6, 0, 0.4, 1)';    // 급가속-감속

/**
 * 정수 시드로부터 [0,1) 결정적 의사난수를 만듭니다(Math.random() 대체).
 * 같은 시드는 항상 같은 값을 반환 — meldId/타일 인덱스처럼 "같은 대상은
 * 재렌더링돼도 흐트러진 모양이 유지돼야 하는" 곳에 사용합니다.
 */
export function seededRandom(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 보드 위 세트를 "불규칙하고 다이나믹하게" 보이도록 meldId 기반 결정적
 * 회전/세로 오프셋을 계산합니다.
 * @param {number} meldId
 */
export function meldJitter(meldId) {
  const r1 = seededRandom(meldId * 2.13);
  const r2 = seededRandom(meldId * 5.71 + 1);
  const r3 = seededRandom(meldId * 3.37 + 5);
  return {
    rot: (r1 - 0.5) * 16,  // -8 ~ 8deg — 흐트러진 테이블 느낌이 확실히 보이도록
    dy: (r2 - 0.5) * 26,   // -13 ~ 13px
    dx: (r3 - 0.5) * 20,   // -10 ~ 10px
  };
}

export function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * FLIP(First-Last-Invert-Play) 트윈. el을 새 위치로 이미 이동시킨 뒤 호출하면,
 * 이전 위치에서 새 위치로 부드럽게 애니메이션됩니다.
 * @param {HTMLElement} el
 * @param {DOMRect} firstRect 이동 전 위치(getBoundingClientRect() 결과)
 * @param {{ ms?: number, ease?: string, delay?: number }} [opts]
 */
export function flipTween(el, firstRect, opts = {}) {
  if (!el || !firstRect) return;
  const ms = opts.ms ?? SNAP_MS;
  const ease = opts.ease ?? EASE_SNAP;
  const delay = opts.delay ?? 0;

  if (reducedMotion()) return; // 저사양/접근성: 즉시 최종 위치로 (애니메이션 생략)

  const last = el.getBoundingClientRect();
  const dx = firstRect.left - last.left;
  const dy = firstRect.top - last.top;
  if (dx === 0 && dy === 0) return;

  el.style.transition = 'none';
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  // 강제 리플로우 후 원위치로 트랜지션
  void el.offsetWidth;
  requestAnimationFrame(() => {
    el.style.transition = `transform ${ms}ms ${ease} ${delay}ms`;
    el.style.transform = '';
  });
  const cleanup = () => { el.style.transition = ''; };
  el.addEventListener('transitionend', cleanup, { once: true });
  setTimeout(cleanup, ms + delay + 60);
}

/**
 * 여러 엘리먼트에 stagger(순차 지연)를 두고 콜백을 실행합니다.
 * @param {HTMLElement[]} elements
 * @param {(el:HTMLElement, index:number) => void} fn
 * @param {number} [gapMs]
 */
export function withStagger(elements, fn, gapMs = STAGGER_MS) {
  const gap = reducedMotion() ? 0 : gapMs;
  elements.forEach((el, i) => {
    if (gap === 0) fn(el, i);
    else setTimeout(() => fn(el, i), i * gap);
  });
}
