const BOWL_RADIUS = 46; // px — usable radius inside the bowl

export class LevelIndicator {
  constructor({ bubble, betaEl, gammaEl }) {
    this.bubble = bubble;
    this.betaEl = betaEl;
    this.gammaEl = gammaEl;
  }

  update(beta, gamma) {
    const cb = Math.max(-45, Math.min(45, beta ?? 0));
    const cg = Math.max(-45, Math.min(45, gamma ?? 0));

    // Map ±45° → ±BOWL_RADIUS px. Bubble moves opposite to tilt (like real bubble)
    const x = (-cg / 45) * BOWL_RADIUS;
    const y = (-cb / 45) * BOWL_RADIUS;

    this.bubble.style.left = `calc(50% + ${x.toFixed(1)}px)`;
    this.bubble.style.top = `calc(50% + ${y.toFixed(1)}px)`;

    const dist = Math.sqrt(x * x + y * y);
    this.bubble.classList.toggle('tilted', dist > BOWL_RADIUS * 0.4);

    if (this.betaEl) this.betaEl.textContent = `β: ${(beta ?? 0).toFixed(1)}°`;
    if (this.gammaEl) this.gammaEl.textContent = `γ: ${(gamma ?? 0).toFixed(1)}°`;
  }
}
