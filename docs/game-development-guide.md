# 새 게임 추가 가이드 (구현 기준)

## 1. 디렉토리

**멀티플레이어 게임** (호스트 + 모바일)

- `games/<game-id>/host/`
- `games/<game-id>/mobile/`
- 선택: `games/<game-id>/assets/`

**솔로 게임** (단일 페이지, SDK 불필요)

- `games/<game-id>/` (index.html, style.css, \*.js 직접 배치)
- 예: `games/omok/`

## 2. 등록

1. `games/registry.js`에 게임 추가 — `group` 필드 필수
   - 멀티: `group: 'multi'`, `hostPath`, `mobilePath`, `minPlayers`, `maxPlayers`
   - 솔로: `group: 'solo'`, `hostPath`만 지정 (mobilePath 불필요)
2. `vite.config.js` `build.rollupOptions.input`에 엔트리 추가

## 3. 권장 패턴

- 호스트: `HostSDK + HostBaseGame + AppBar`
- 모바일: `MobileSDK + MobileBaseGame`

### AppBar (호스트 공통 상단 바)

모든 멀티플레이어 게임의 호스트 화면은 `AppBar`를 사용합니다.

**HTML** — head에 CSS 추가, body에 컨테이너 배치:

```html
<link rel="stylesheet" href="/platform/client/shared/appbar.css" />
<!-- ... -->
<header id="game-appbar"></header>
```

**JS** — `onSetup`에서 초기화:

```js
import { AppBar } from '../../../platform/client/shared/AppBar.js';

async onSetup({ sessionId }) {
  this._appbar = new AppBar('game-appbar', {
    title: '게임 이름',
    onRestart: () => this.resetSession(),
  });
  // 게임별 정보(라운드, 타이머 등)는 오른쪽 슬롯에 삽입
  // appbar.prependRight(myCustomEl);
}
```

**CSS 테마** — 게임 body 클래스에 변수 정의:

```css
body.my-game-host {
  --appbar-border: #2a3654;
  --appbar-title-color: #f59e0b;
  --appbar-btn-color: #94a3b8;
  --appbar-btn-border: #2a3654;
}
```

자세한 내용: [SDK.md — AppBar](./SDK.md#appbar)

## 4. 최소 체크리스트

- 호스트/모바일 `index.html`, `main.js`
- `onMessage` 타입 매칭 검증
- 준비/리셋/재연결 처리
- `npm run build` 후 엔트리 출력 확인

## 5. 에셋 경로

- 개발/빌드 모두 `/games/<game-id>/assets/...` 사용
- `vite.config.js`의 `gameAssetsPlugin`이 자동 서빙/복사
