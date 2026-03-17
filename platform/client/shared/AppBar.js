import './appbar.css';

/**
 * AppBar — 게임 호스트 화면 공통 상단 바 Web Component.
 *
 * ── HTML 사용법 ──────────────────────────────────────────────────────────────
 *  <game-appbar title="게임이름"></game-appbar>
 *  <game-appbar title="게임이름" back-url="/" back-label="← 로비"></game-appbar>
 *
 * ── JS API ───────────────────────────────────────────────────────────────────
 *  const appbar = document.querySelector('game-appbar');
 *  appbar.onRestart = () => game.resetSession();   // 다시하기 버튼 등록
 *  appbar.prependRight(el);                        // 오른쪽 슬롯에 요소 삽입
 *  appbar.setTitle('새 타이틀');                    // 타이틀 변경
 *
 * ── 테마 CSS 변수 (body 또는 :root에 정의) ──────────────────────────────────
 *  --appbar-border           기본: rgba(255,255,255,0.1)
 *  --appbar-title-color      기본: #f59e0b
 *  --appbar-btn-color        기본: #94a3b8
 *  --appbar-btn-border       기본: rgba(255,255,255,0.15)
 *  --appbar-btn-hover-border 기본: --appbar-title-color 값
 *  --appbar-btn-hover-color  기본: --appbar-title-color 값
 */
export class AppBar extends HTMLElement {
  connectedCallback() {
    this.classList.add('platform-appbar');
    this._rightSlot = null;
    this._titleEl = null;
    this._restartBtn = null;
    this._render();
  }

  _render() {
    const title = this.getAttribute('title') || '';
    const backUrl = this.getAttribute('back-url') || '/';
    const backLabel = this.getAttribute('back-label') || '← 로비';

    this.innerHTML = '';

    const left = document.createElement('div');
    left.className = 'appbar-left';

    const backBtn = document.createElement('a');
    backBtn.className = 'appbar-btn';
    backBtn.href = backUrl;
    backBtn.textContent = backLabel;

    this._titleEl = document.createElement('div');
    this._titleEl.className = 'appbar-title';
    this._titleEl.textContent = title;

    left.append(backBtn, this._titleEl);

    this._rightSlot = document.createElement('div');
    this._rightSlot.className = 'appbar-right';

    // connectedCallback 이전에 onRestart가 설정된 경우 복원
    if (this._onRestart) {
      this._addRestartBtn(this._onRestart);
    }

    // prependRight 호출이 connectedCallback 이전에 있었던 경우 복원
    if (this._pendingRight) {
      this._pendingRight.forEach(el => this._rightSlot.insertBefore(el, this._rightSlot.firstChild));
      this._pendingRight = null;
    }

    this.append(left, this._rightSlot);
  }

  _addRestartBtn(fn) {
    this._restartBtn = document.createElement('button');
    this._restartBtn.className = 'appbar-btn appbar-btn-restart';
    this._restartBtn.textContent = '다시하기';
    this._restartBtn.addEventListener('click', fn);
    this._rightSlot.appendChild(this._restartBtn);
  }

  // ─── 공개 API ─────────────────────────────────────────────────────────────

  /**
   * 다시하기 버튼 클릭 콜백을 설정합니다. 버튼이 없으면 자동 생성됩니다.
   * @param {Function} fn
   */
  set onRestart(fn) {
    this._onRestart = fn;
    if (this._rightSlot && !this._restartBtn) {
      this._addRestartBtn(fn);
    }
  }

  /**
   * 게임 타이틀 텍스트를 변경합니다.
   * @param {string} text
   */
  setTitle(text) {
    if (this._titleEl) this._titleEl.textContent = text;
  }

  /**
   * 오른쪽 슬롯 맨 앞에 요소를 삽입합니다 (다시하기 버튼 왼쪽).
   * @param {HTMLElement} el
   */
  prependRight(el) {
    if (this._rightSlot) {
      this._rightSlot.insertBefore(el, this._rightSlot.firstChild);
    } else {
      if (!this._pendingRight) this._pendingRight = [];
      this._pendingRight.unshift(el);
    }
  }

  /** 다시하기 버튼 요소. onRestart 미설정 시 null. */
  get restartBtn() { return this._restartBtn; }

  /** 오른쪽 슬롯 div. */
  get rightSlot() { return this._rightSlot; }
}

customElements.define('game-appbar', AppBar);
