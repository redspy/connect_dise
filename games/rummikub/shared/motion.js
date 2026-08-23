/**
 * motion.js — 모션 상수 + FLIP 트윈 유틸 (§11.4, host/mobile 공유)
 */

export const SNAP_MS = 180;
export const ROLLBACK_MS = 420;
export const STAGGER_MS = 28;
export const DEAL_TILE_MS = 45;
export const EASE_SNAP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';   // overshoot
export const EASE_ROLLBACK = 'cubic-bezier(0.6, 0, 0.4, 1)';    // 급가속-감속

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
