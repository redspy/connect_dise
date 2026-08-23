/**
 * motion.js — 모션 상수 + FLIP 트윈 유틸 (§11.4, host/mobile 공유)
 */

export const FLIP_MS = 450;
export const DRUMROLL_MS = 1000;
export const DRUMROLL_MS_REDUCED = 300; // prefers-reduced-motion
export const INSERT_MS = 320;
export const DEAL_STAGGER_MS = 30;
export const DRAW_FLY_MS = 480;
export const EASE_POP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
export const EASE_SNAP = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

export function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

export function drumrollMs() {
  return reducedMotion() ? DRUMROLL_MS_REDUCED : DRUMROLL_MS;
}

/**
 * FLIP(First-Last-Invert-Play) 트윈. el을 새 위치로 이미 이동시킨 뒤 호출하면,
 * 이전 위치에서 새 위치로 부드럽게 애니메이션됩니다.
 * @param {HTMLElement} el
 * @param {DOMRect} firstRect
 * @param {{ ms?: number, ease?: string, delay?: number }} [opts]
 */
export function flipTween(el, firstRect, opts = {}) {
  if (!el || !firstRect) return;
  const ms = opts.ms ?? FLIP_MS;
  const ease = opts.ease ?? EASE_SNAP;
  const delay = opts.delay ?? 0;
  if (reducedMotion()) return;

  const last = el.getBoundingClientRect();
  const dx = firstRect.left - last.left;
  const dy = firstRect.top - last.top;
  if (dx === 0 && dy === 0) return;

  el.style.transition = 'none';
  el.style.transform = `translate(${dx}px, ${dy}px)`;
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
export function withStagger(elements, fn, gapMs = DEAL_STAGGER_MS) {
  const gap = reducedMotion() ? 0 : gapMs;
  elements.forEach((el, i) => {
    if (gap === 0) fn(el, i);
    else setTimeout(() => fn(el, i), i * gap);
  });
}
