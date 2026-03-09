export class NunchiDevPanel {
  /**
   * @param {{ onJumpToRound: (round: number) => void }} callbacks
   */
  constructor({ onJumpToRound }) {
    this._onJumpToRound = onJumpToRound;
    this._build();
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'nunchi-dev-panel';
    panel.innerHTML = `
      <div class="ndp-title">🛠 Dev</div>
      <div class="ndp-section-label">라운드 점프</div>
      <button class="ndp-btn" data-round="9">Round 9로 이동</button>
      <button class="ndp-btn" data-round="10">Round 10으로 이동</button>
    `;
    document.body.appendChild(panel);

    panel.querySelectorAll('.ndp-btn[data-round]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._onJumpToRound(Number(btn.dataset.round));
      });
    });
  }
}
