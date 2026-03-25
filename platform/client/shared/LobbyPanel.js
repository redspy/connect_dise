import './lobby.css';

/**
 * LobbyPanel — 게임 호스트 로비 공통 Web Component.
 *
 * ── HTML 사용법 ─────────────────────────────────────────────────────────────
 *  <!-- 기본 (설정/설명 없음) -->
 *  <game-lobby title="게임이름" min-players="2"></game-lobby>
 *
 *  <!-- 게임 설명 / 설정 슬롯 (자식 요소 → QR 옆 사이드 영역으로 자동 이동) -->
 *  <game-lobby title="Dobble" min-players="2">
 *    <div class="my-rules">...</div>
 *    <select id="sel-mode">...</select>
 *  </game-lobby>
 *
 *  <!-- 배너 이미지 (선택적) -->
 *  <game-lobby title="눈치 10단" min-players="2" banner="/games/nunchi-ten/assets/main.png">
 *  </game-lobby>
 *
 * ── JS API ──────────────────────────────────────────────────────────────────
 *  const lobby = document.querySelector('game-lobby');
 *  lobby.onStart = () => game._startGame();
 *  lobby.setSession(sessionId, qrUrl);    // 방 코드 + URL 표시
 *  lobby.renderPlayers(playersMap, profilesMap);
 *  lobby.setReady(readyCount, total);
 *  lobby.updateStartButton(readyCount, total);
 *  lobby.qrContainer                      // QR 렌더링용 <div>
 *
 * ── 테마 CSS 변수 (body 또는 :root에 정의) ──────────────────────────────────
 *  --lobby-panel-bg, --lobby-panel2-bg, --lobby-border,
 *  --lobby-accent, --lobby-accent-dim, --lobby-text, --lobby-sub,
 *  --lobby-avatar-size
 */
export class LobbyPanel extends HTMLElement {
  connectedCallback() {
    const sideChildren = [...this.children];
    this._minPlayers = Number(this.getAttribute('min-players') || 2);
    const title = this.getAttribute('title') || '';
    const banner = this.getAttribute('banner') || '';

    this.innerHTML = `
      <div class="lobby-panel">
        <div class="lobby-panel-top">
          <a href="/" class="lobby-back-btn">← 게임 선택</a>
        </div>
        ${banner ? `
        <div class="lobby-banner-wrap">
          <img src="${banner}" alt="${title}" class="lobby-banner-img">
        </div>` : ''}
        <div class="lobby-cards-row">
          <div class="lobby-card lobby-qr-card">
            <div class="lobby-qr-box"></div>
            <div class="lobby-session-info">
              방 코드 <strong class="lobby-session-code">------</strong>
            </div>
            <div class="lobby-qr-url"></div>
          </div>
          <div class="lobby-card lobby-side-card">
            <div class="lobby-side-slot"></div>
          </div>
        </div>
        <div class="lobby-players-wrap">
          <div class="lobby-players-label">참가자</div>
          <div class="lobby-players-grid"></div>
        </div>
        <div class="lobby-footer">
          <div class="lobby-ready-status">플레이어를 기다리는 중...</div>
          <button class="lobby-start-btn" disabled>최소 ${this._minPlayers}명 필요</button>
        </div>
      </div>
    `;

    // 자식 요소(게임 설명/설정)를 사이드 슬롯으로 이동
    const slot = this.querySelector('.lobby-side-slot');
    const sideCard = this.querySelector('.lobby-side-card');
    if (sideChildren.length > 0) {
      sideChildren.forEach(el => slot.appendChild(el));
    } else {
      sideCard.classList.add('hidden');
    }

    this._startBtn = this.querySelector('.lobby-start-btn');

    // connectedCallback 이전에 onStart가 설정된 경우 적용
    if (this._pendingOnStart) {
      this._startBtn.addEventListener('click', this._pendingOnStart);
      this._onStartFn = this._pendingOnStart;
      this._pendingOnStart = null;
    }
  }

  // ─── 공개 API ─────────────────────────────────────────────────────────────

  /** QR 렌더링용 컨테이너 div */
  get qrContainer() {
    return this.querySelector('.lobby-qr-box');
  }

  /**
   * 방 코드와 접속 URL을 표시합니다.
   * @param {string} sessionId
   * @param {string} [qrUrl]
   */
  setSession(sessionId, qrUrl = '') {
    const codeEl = this.querySelector('.lobby-session-code');
    if (codeEl) codeEl.textContent = sessionId;
    const urlEl = this.querySelector('.lobby-qr-url');
    if (urlEl) urlEl.textContent = qrUrl;
  }

  /**
   * 플레이어 카드 목록을 렌더링합니다.
   * @param {Map<string, {id:string, color:string}>} playersMap
   * @param {Map<string, {nickname?:string, avatarUrl?:string}>|null} [profilesMap]
   */
  renderPlayers(playersMap, profilesMap = null) {
    const grid = this.querySelector('.lobby-players-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const [id, player] of playersMap) {
      const profile = profilesMap?.get(id) ?? null;
      const avatarUrl = profile?.avatarUrl ?? null;
      const avatarEmoji = profile?.avatarEmoji ?? null;
      const initial = (profile?.nickname ?? '?').charAt(0).toUpperCase();
      const card = document.createElement('div');
      card.className = 'lobby-player-card';
      card.dataset.playerId = id;
      card.innerHTML = `
        <div class="lp-avatar-wrap">
          <div class="lp-avatar" style="border-color:${player.color}">
            ${avatarEmoji
              ? `<span class="lp-emoji">${avatarEmoji}</span>`
              : avatarUrl
              ? `<img src="${avatarUrl}" alt="">`
              : `<span class="lp-initial" style="color:${player.color}">${initial}</span>`
            }
          </div>
          <button class="lp-kick-btn" data-player-id="${id}" title="강퇴">✕</button>
        </div>
        <div class="lp-name">${profile?.nickname ?? '대기 중...'}</div>
      `;
      grid.appendChild(card);

      // 강퇴 버튼 클릭 이벤트
      const kickBtn = card.querySelector('.lp-kick-btn');
      kickBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._onKickFn) this._onKickFn(id);
      });
    }
  }

  /**
   * 준비 상태 텍스트를 업데이트합니다.
   * @param {number} readyCount
   * @param {number} total
   */
  setReady(readyCount, total) {
    const el = this.querySelector('.lobby-ready-status');
    if (!el) return;
    el.textContent = total === 0
      ? '플레이어를 기다리는 중...'
      : `${readyCount}/${total}명 준비완료`;
  }

  /**
   * 시작 버튼 상태와 텍스트를 업데이트합니다.
   * @param {number} readyCount
   * @param {number} total
   * @returns {boolean} canStart
   */
  updateStartButton(readyCount, total) {
    const btn = this._startBtn;
    if (!btn) return false;
    const can = total >= this._minPlayers && readyCount === total && total > 0;
    btn.disabled = !can;
    if (total < this._minPlayers) {
      btn.textContent = `최소 ${this._minPlayers}명 필요 (현재 ${total}명)`;
    } else if (readyCount < total) {
      btn.textContent = `${readyCount}/${total}명 준비 중...`;
    } else {
      btn.textContent = '게임 시작!';
    }
    return can;
  }

  /**
   * 시작 버튼 클릭 콜백을 설정합니다.
   * @param {Function} fn
   */
  set onStart(fn) {
    if (this._onStartFn && this._startBtn) {
      this._startBtn.removeEventListener('click', this._onStartFn);
    }
    this._onStartFn = fn;
    if (this._startBtn) {
      this._startBtn.addEventListener('click', fn);
    } else {
      this._pendingOnStart = fn;
    }
  }

  /**
   * 강퇴 버튼 클릭 콜백을 설정합니다.
   * @param {Function} fn (playerId: string) => void
   */
  set onKick(fn) {
    this._onKickFn = fn;
  }
}

customElements.define('game-lobby', LobbyPanel);
