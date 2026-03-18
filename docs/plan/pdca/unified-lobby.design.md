# Design: 게임 로비 공통화 (unified-lobby) — v2

> 작성일: 2026-03-17 (v2: 시각적 통일 포함)
> Plan 참조: `docs/plan/pdca/unified-lobby.plan.md`

---

## 1. 설계 목표 (변경)

~~JS 로직 중복 제거~~ → **AppBar처럼 `<game-lobby>` Web Component를 만들어 로비 자체를 공통화**.
각 게임 index.html에서 커스텀 로비 HTML을 제거하고 `<game-lobby>` 하나로 대체한다.

---

## 2. 참조 패턴: AppBar

AppBar가 이미 같은 패턴:
```html
<!-- 게임 HTML -->
<game-appbar title="Dobble"></game-appbar>
```
```js
// 게임 JS
const appbar = document.querySelector('game-appbar');
appbar.onRestart = () => this.resetSession();
appbar.prependRight(timerEl);
```

`<game-lobby>`도 동일한 방식으로 설계한다.

---

## 3. 신규 파일

### `platform/client/shared/LobbyPanel.js` + `lobby.css`

---

## 4. `<game-lobby>` 레이아웃 (고정)

```
┌─────────────────────────────────────────────────────┐
│  [← 로비]   게임 타이틀                              │
├────────────────────────┬────────────────────────────┤
│                        │                            │
│   QR 코드              │   게임 설정 슬롯            │
│   세션 코드             │   (setSettings()로 주입)   │
│                        │   없으면 숨김              │
│                        │                            │
├────────────────────────┴────────────────────────────┤
│  참가자                                              │
│  [ 카드 ] [ 카드 ] [ 카드 ] ...                      │
├─────────────────────────────────────────────────────┤
│  N/M명 준비완료              [ 게임 시작! ]           │
└─────────────────────────────────────────────────────┘
```

---

## 5. HTML 사용법

`<game-lobby>`의 자식 요소들은 `connectedCallback`에서 내부 `.lobby-side-slot`(QR 옆 영역)으로 자동 이동된다.
설정(select, checkbox)이든 게임 설명(규칙 ul)이든 게임별 콘텐츠 전부 여기에 넣으면 된다.
자식이 없으면 슬롯 영역 자체가 숨겨진다.

### 슬롯 없는 경우 (digit-puzzle)
```html
<game-lobby title="슬라이딩 퍼즐" min-players="2"></game-lobby>
```

### 게임 설명만 있는 경우 (nunchi-ten)
```html
<game-lobby title="눈치 10단" min-players="2">
  <div class="nunchi-rules">
    <div class="rules-title">게임 방법</div>
    <ul>
      <li>숫자 카드 1~10 중 하나를 선택</li>
      <li>겹치는 숫자가 없으면 생존!</li>
      <li>10라운드 후 최고 점수 플레이어 승리</li>
    </ul>
  </div>
</game-lobby>
```

### 게임 설정 + 설명 둘 다 있는 경우 (dobble)
```html
<game-lobby title="Dobble" min-players="2">
  <div class="db-setting-group">
    <label>심볼 모드</label>
    <select id="sel-mode">
      <option value="image">그림</option>
      <option value="hanja">한자</option>
    </select>
  </div>
  <div class="db-setting-group">
    <label>목표 점수</label>
    <select id="sel-winscore">
      <option value="5">5점</option>
      <option value="10" selected>10점</option>
    </select>
  </div>
  <div class="db-rules">
    <div class="db-rules-title">게임 방법</div>
    <ul>
      <li>중앙 카드와 내 카드에서 같은 심볼을 찾아 탭!</li>
      <li>오답 시 3초 패널티</li>
      <li>목표 점수를 먼저 달성한 플레이어 승리</li>
    </ul>
  </div>
</game-lobby>
```

---

## 6. JS API

```js
const lobby = document.querySelector('game-lobby');

// ─── 읽기 전용 ──────────────────────────────────────
lobby.qrContainer          // QR 렌더링용 <div> 반환

// ─── 세션 정보 ──────────────────────────────────────
lobby.setSession(sessionId)  // 세션 코드 표시

// ─── 플레이어 ───────────────────────────────────────
// profilesMap: Map<id, { nickname?, avatarUrl? }>
// options: { cardClass? }
lobby.renderPlayers(playersMap, profilesMap, options)

// ─── 준비 / 시작 버튼 ───────────────────────────────
lobby.setReady(readyCount, total)            // 준비 텍스트 업데이트
lobby.updateStartButton(readyCount, total)   // 버튼 활성화 + 텍스트

// ─── 이벤트 ────────────────────────────────────────
lobby.onStart = () => game._startGame()     // 시작 버튼 콜백
```

---

## 7. `LobbyPanel.js` 구현 스케치

```js
import './lobby.css';

class LobbyPanel extends HTMLElement {
  connectedCallback() {
    // 자식 요소(게임 설정) 저장 후 내부로 이동
    const settingsChildren = [...this.children];

    this.innerHTML = `
      <div class="lobby-panel">
        <div class="lobby-header">
          <a href="/" class="lobby-back-btn">← 로비</a>
          <h1 class="lobby-title">${this.getAttribute('title') || '게임'}</h1>
        </div>
        <div class="lobby-main">
          <div class="lobby-qr-section">
            <div class="lobby-qr-box"></div>
            <div class="lobby-session-code"></div>
          </div>
          <div class="lobby-side-slot"></div>
        </div>
        <div class="lobby-players-section">
          <div class="lobby-players-label">참가자</div>
          <div class="lobby-players-grid"></div>
        </div>
        <div class="lobby-footer">
          <div class="lobby-ready-status">플레이어를 기다리는 중...</div>
          <button class="lobby-start-btn" disabled>
            최소 ${this.getAttribute('min-players') || 2}명 필요
          </button>
        </div>
      </div>
    `;

    // 게임별 자식 요소(설정, 설명 등)를 사이드 슬롯으로 이동
    const slot = this.querySelector('.lobby-side-slot');
    if (settingsChildren.length > 0) {
      settingsChildren.forEach(el => slot.appendChild(el));
    } else {
      slot.classList.add('hidden');
    }

    // 시작 버튼 내부 리스너 준비
    this._startBtn = this.querySelector('.lobby-start-btn');
    this._minPlayers = Number(this.getAttribute('min-players') || 2);
  }

  // ─── 공개 API ─────────────────────────────────────

  get qrContainer() {
    return this.querySelector('.lobby-qr-box');
  }

  setSession(sessionId) {
    const el = this.querySelector('.lobby-session-code');
    if (el) el.textContent = sessionId;
  }

  renderPlayers(playersMap, profilesMap = null, { cardClass = 'lobby-player-card' } = {}) {
    const grid = this.querySelector('.lobby-players-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const [id, player] of playersMap) {
      const profile = profilesMap?.get(id) ?? null;
      const card = document.createElement('div');
      card.className = cardClass;
      card.dataset.playerId = id;
      const avatarUrl = profile?.avatarUrl;
      const initial = (profile?.nickname ?? '?').charAt(0).toUpperCase();
      card.innerHTML = `
        <div class="lp-avatar" style="border-color:${player.color}">
          ${avatarUrl
            ? `<img src="${avatarUrl}" alt="">`
            : `<span class="lp-initial" style="color:${player.color}">${initial}</span>`
          }
        </div>
        <div class="lp-name">${profile?.nickname ?? '대기 중...'}</div>
      `;
      grid.appendChild(card);
    }
  }

  setReady(readyCount, total) {
    const el = this.querySelector('.lobby-ready-status');
    if (!el) return;
    el.textContent = total === 0
      ? '플레이어를 기다리는 중...'
      : `${readyCount}/${total}명 준비완료`;
  }

  updateStartButton(readyCount, total) {
    const btn = this._startBtn;
    if (!btn) return;
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

  set onStart(fn) {
    this._startBtn?.removeEventListener('click', this._onStartFn);
    this._onStartFn = fn;
    this._startBtn?.addEventListener('click', fn);
  }
}

customElements.define('game-lobby', LobbyPanel);
```

---

## 8. `HostBaseGame` 연동

`qrContainerId` 옵션 대신 `<game-lobby>` 자동 감지:

```js
// _wireSDK() 내부 sessionReady 처리
this.sdk.on('sessionReady', async ({ qrUrl, sessionId }) => {
  this._lobbyEl = document.querySelector('game-lobby');
  if (this._lobbyEl) {
    await renderQR(this._lobbyEl.qrContainer, qrUrl, { width: 200 });
    this._lobbyEl.setSession(sessionId);
  } else if (this._qrContainerId) {
    // 기존 방식 fallback
    const el = document.getElementById(this._qrContainerId);
    if (el) await renderQR(el, qrUrl, { width: 200 });
  }
  await this.onSetup({ qrUrl, sessionId });
});
```

헬퍼 메서드 추가:
```js
// profilesMap: Map<id, { nickname?, avatarUrl? }>
renderLobbyPlayers(profilesMap = null, options = {}) {
  this._lobbyEl?.renderPlayers(this._players, profilesMap, options);
}

updateLobbyReady(readyCount) {
  this._lobbyEl?.setReady(readyCount, this._players.size);
  this._lobbyEl?.updateStartButton(readyCount, this._players.size);
}
```

---

## 9. 각 게임 변경 사항

### index.html 변경량

| 게임 | 기존 로비 HTML | 변경 후 |
|------|--------------|---------|
| dobble | ~55줄 | `<game-lobby title="Dobble" min-players="2">` + 설정 select 2개 |
| nunchi-ten | ~60줄 | `<game-lobby title="눈치 10단" min-players="2">` |
| digit-puzzle | ~40줄 | `<game-lobby title="슬라이딩 퍼즐" min-players="2">` |
| give-you-fire | ~50줄 | `<game-lobby title="Give You Fire" min-players="2">` + 체크박스 1개 |
| relay-drawing | ~45줄 | `<game-lobby title="그림 릴레이" min-players="2">` + select 2개 |

### JS 변경량 (게임당)

**제거:**
- `_renderLobby()` 메서드 전체
- `_updateStartBtn()` 메서드 전체
- `_canStart()` 메서드 전체

**추가/변경:**
```js
// onPlayerJoin
onPlayerJoin(player) {
  this.renderLobbyPlayers(this._profiles);
}

// onReadyUpdate
onReadyUpdate({ readyCount, total }) {
  this._readyCount = readyCount;
  this.updateLobbyReady(readyCount);
}

// onReset
onReset() {
  // 상태 초기화 ...
  this.renderLobbyPlayers(this._profiles);
  this.setPhase('lobby');
}

// onSetup - 시작 버튼 콜백만
async onSetup({ sessionId, qrUrl }) {
  const lobby = document.querySelector('game-lobby');
  lobby.onStart = () => this._startGame();
  // 게임 설정 리스너 (기존 유지)
  document.getElementById('sel-mode')?.addEventListener('change', ...);
  this.setPhase('lobby');
}
```

---

## 10. `lobby.css` 공통 스타일

```css
game-lobby {
  display: contents; /* 레이아웃에 영향 없음 */
}

.lobby-panel {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: #0f0f1a;
  color: #e2e8f0;
  padding: 24px;
  gap: 20px;
  overflow-y: auto;
}

.lobby-header {
  display: flex;
  align-items: center;
  gap: 16px;
}

.lobby-back-btn {
  color: #94a3b8;
  text-decoration: none;
  font-size: 0.9rem;
}

.lobby-title {
  font-size: 1.6rem;
  font-weight: 700;
  color: #f59e0b;
  margin: 0;
}

.lobby-main {
  display: flex;
  gap: 32px;
  align-items: flex-start;
}

.lobby-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.lobby-session-code {
  font-size: 1.1rem;
  font-weight: 600;
  letter-spacing: 0.15em;
  color: #94a3b8;
}

.lobby-side-slot {
  display: flex;
  flex-direction: column;
  gap: 12px;
  flex: 1;
}

.lobby-side-slot.hidden { display: none; }

.lobby-players-section {
  flex: 1;
}

.lobby-players-label {
  font-size: 0.85rem;
  color: #64748b;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.lobby-players-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.lobby-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255,255,255,0.08);
}

.lobby-ready-status {
  color: #94a3b8;
  font-size: 0.95rem;
}

.lobby-start-btn {
  padding: 12px 32px;
  background: #f59e0b;
  color: #0f0f1a;
  border: none;
  border-radius: 8px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s;
}
.lobby-start-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 플레이어 카드 공통 */
.lobby-player-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 70px;
}
.lp-avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid currentColor;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #1e1e2e;
}
.lp-avatar img { width: 100%; height: 100%; object-fit: cover; }
.lp-initial { font-size: 1.3rem; font-weight: 700; }
.lp-name {
  font-size: 0.8rem;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  color: #cbd5e1;
}
```

---

## 11. 구현 순서

1. `platform/client/shared/lobby.css` 생성
2. `platform/client/shared/LobbyPanel.js` 생성 (Web Component)
3. `platform/client/HostBaseGame.js` 수정
   - `<game-lobby>` 자동 감지 + QR/세션 연동
   - `renderLobbyPlayers()`, `updateLobbyReady()` 헬퍼 추가
4. **dobble** 마이그레이션 (설정 있는 케이스 검증)
5. **digit-puzzle** 마이그레이션 (단순 케이스)
6. **nunchi-ten** 마이그레이션 (avatarUrl 처리)
7. **give-you-fire** 마이그레이션
8. **relay-drawing** 마이그레이션

---

## 12. 비적용

- **spin-battle**: Three.js 캔버스가 배경이라 별도 처리 유지
- **dice**: HostBaseGame 미사용
- 게임별 설정 select/checkbox HTML 및 JS 로직: 변경 없음
