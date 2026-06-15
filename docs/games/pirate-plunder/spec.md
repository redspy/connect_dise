# Lobby Rejoin Screen Freeze and Connection UI Visibility Bugfix

## Goal

Resolve the issue where mobile clients refreshed during the lobby phase of multiplayer games get stuck on the "Restoring connection..." screen, and update development rules to ensure proper lobby rejoin handling.

---

## Root Cause

1. **Rejoin Sync Loop Hole**: When a mobile client refreshes, `MobileSDK` automatically hides the generic reconnection UI (`#_sdk-reconnect-ui`) and triggers the `rejoin` event on `MobileBaseGame`. In games like `Pirate's Plunder` and `Hidden Agent`, the mobile `onRejoin()` handler transitions the screen to a "Restoring connection..." waiting page and waits for a state synchronization payload from the host. However, during the lobby/loading phase, the host historically did not send any state synchronization payload upon receiving a rejoin event. As a result, the mobile client remains stuck on the "Restoring connection..." screen indefinitely.
2. **Missing `.hidden` CSS Rule**: Some stylesheets lacked a global `.hidden` class selector, making dynamic class toggles (e.g. `classList.toggle('hidden')`) fail unless specific class overrides were provided.

---

## Proposed Changes

### 1. Game Content Bugfix

#### [MODIFY] [games/hidden-agent/host/main.js](file:///Users/soul/Source/connect_dise/games/hidden-agent/host/main.js)
- Modify `onPlayerRejoin` to send a `lobbyState` synchronization payload when the game is in the lobby phase:
  ```javascript
  onPlayerRejoin(player) {
    if (this._isDemoActive) return;
    if (this.phase !== 'lobby' && this.phase !== 'loading') {
      // ... existing code ...
    } else {
      this._updateLobby();
      const hasName = this._profiles.has(player.id);
      this.sendToPlayer(player.id, 'lobbyState', {
        phase: 'lobby',
        hasName: hasName,
        nickname: hasName ? (this._profiles.get(player.id)?.nickname || '익명') : null,
      });
    }
  }
  ```

#### [MODIFY] [games/hidden-agent/mobile/main.js](file:///Users/soul/Source/connect_dise/games/hidden-agent/mobile/main.js)
- Register a handler for the `lobbyState` message inside `_wireMessages()` to properly transition the mobile screen:
  ```javascript
  this.onMessage('lobbyState', (data) => {
    if (!data.hasName) {
      this.showScreen('setup-profile');
    } else {
      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '준비 완료!';
      document.getElementById('waiting-desc').textContent = '다른 플레이어들이 다 모이면 방장이 게임을 시작합니다.';
    }
  });
  ```

---

### 2. Platform Guidelines Update

#### [MODIFY] [AGENTS.md](file:///Users/soul/Source/connect_dise/AGENTS.md)
- Add the **"Lobby Rejoin Rules (로비 단계 재연결 처리 규칙)"** to the `AGENTS.md` rules.

#### [MODIFY] [docs/multi-agent-process-guide.md](file:///Users/soul/Source/connect_dise/docs/multi-agent-process-guide.md) (or equivalent process doc if exists)
- Update guidelines to specify this class of bugs and their prevention.

---

## Verification Plan

### Automated Tests
- Run Playwright E2E tests for the modified games:
  - `npx playwright test tests/pirate-plunder/game.spec.js`
  - `npx playwright test tests/hidden-agent/game.spec.js`

### Manual Verification
- Start the server using `npm run dev`.
- Join a game as a mobile client.
- Enter a nickname and enter the lobby.
- Refresh the mobile client browser tab during the lobby phase.
- Verify that the mobile client returns to the waiting screen with the message "준비 완료!" instead of getting stuck on "세션 연결 복구 중...".
