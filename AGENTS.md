# 개요

이 프로젝트는 TV/Tablet과 같은 공용기기에 게임화면을 띄우고, 사용자는 개인 모바일 폰으로 게임에 접속하여 게임을 즐길 수 있는 플랫폼과 그 콘텐츠를 개발합니다.

공용 화면에 있는 게임화면을 통해 서로의 시선을 교환해가며 콘텐츠를 즐기게 하여 같은 공간에서 보드게임을 하는 듯한 효과를 주는 것이 목적입니다.

# 기술 스택

- **런타임**: Node.js (ES Module)
- **서버**: Express + Socket.IO
- **클라이언트**: Vite + Vanilla JS
- **3D**: Three.js (일부 게임)
- **통신**: Socket.IO + WebRTC P2P (자동 폴백)

# 프로젝트 구조

```
├── platform/                  # 플랫폼 SDK (게임 무관)
│   ├── client/
│   │   ├── HostSDK.js         # 호스트용 SDK
│   │   ├── MobileSDK.js       # 모바일용 SDK
│   │   ├── HostBaseGame.js    # 호스트 베이스 클래스
│   │   ├── MobileBaseGame.js  # 모바일 베이스 클래스
│   │   ├── P2PManager.js      # WebRTC P2P 매니저
│   │   └── shared/            # 공유 컴포넌트 (QRDisplay, QRScanner, SensorManager, LevelIndicator)
│   └── server/
│       └── SessionManager.js  # 서버 세션/플레이어 관리
├── server/
│   └── index.js               # Express + Socket.IO 서버
├── games/                     # 게임 콘텐츠
│   ├── registry.js            # 게임 목록
│   └── <game-id>/
│       ├── host/              # 호스트 (index.html, main.js)
│       ├── mobile/            # 모바일 (index.html, main.js)
│       └── assets/            # 에셋 (자동 서빙)
├── src/
│   ├── lobby.js               # 로비 페이지
│   └── style.css              # 공통 CSS
├── docs/                      # 문서
│   ├── games/<game-id>/       # 게임별 기획/구현 문서
│   └── ...
├── vite.config.js             # 멀티 엔트리 빌드 + 에셋 플러그인
└── index.html                 # 로비 진입점
```

# 핵심 아키텍처

플랫폼(인프라)과 게임(콘텐츠)을 완전히 분리합니다. 서버는 게임 내용을 전혀 알지 못하고, 메시지를 투명하게 중계할 뿐입니다.

- **플랫폼**: 세션 생성, 플레이어 입장/퇴장, 준비 상태, 메시지 라우팅, P2P 시그널링
- **게임**: 플랫폼 SDK를 통해 통신하고, 게임 로직만 구현

상세 아키텍처는 `ARCHITECTURE.md`를 참조하세요.

# 문서 안내

| 문서                             | 내용                                            |
| -------------------------------- | ----------------------------------------------- |
| `ARCHITECTURE.md`                | 전체 구조, 디렉토리, 세션 라이프사이클          |
| `SDK.md`                         | HostSDK, MobileSDK, BaseGame, 공유 컴포넌트 API |
| `PROTOCOL.md`                    | Socket.IO 이벤트 프로토콜 (platform/game/p2p)   |
| `DESIGN.md`                      | 화면 UI 개발 시 지켜야할 가이드                 |
| `docs/game-development-guide.md` | 새 게임 추가 가이드                             |
| `docs/games/<game-id>/`          | 게임별 기획/구현 문서                           |

# 게임 개발 규칙

## 권장 패턴

게임은 BaseGame 클래스를 상속하여 구현합니다:

- 호스트: `HostSDK` + `HostBaseGame`
- 모바일: `MobileSDK` + `MobileBaseGame`

```js
// 호스트 예시
class MyGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'my-overlay', qrContainerId: 'qr-box' });
  }
  async onSetup({ sessionId }) {
    this.setPhase('lobby');
  }
  onPlayerJoin(player) {
    /* UI 업데이트 */
  }
  onAllReady() {
    this.setPhase('game');
  }
  onReset() {
    this.setPhase('lobby');
  }
}
```

```js
// 모바일 예시
class MyMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'my-screen' });
  }
  onJoin(player) {
    this.showScreen('waiting');
  }
  onAllReady() {
    this.showScreen('game');
  }
  onReset() {
    this.showScreen('waiting');
  }
}
```

## 오버레이/화면 전환 컨벤션

호스트는 `setPhase(name)` + `data-phase` 속성, 모바일은 `showScreen(name)` + `data-screen` 속성으로 UI를 전환합니다.

```html
<!-- 호스트: setPhase('lobby') 호출 시 이것만 표시 -->
<div class="my-overlay" data-phase="lobby">...</div>
<div class="my-overlay hidden" data-phase="game">...</div>

<!-- 모바일: showScreen('waiting') 호출 시 이것만 표시 -->
<div class="my-screen" data-screen="waiting">...</div>
<div class="my-screen hidden" data-screen="game">...</div>
```

## 새 게임 추가 시

1. `games/<game-id>/host/`, `games/<game-id>/mobile/` 디렉토리 생성
2. `games/registry.js`에 게임 등록 (`group: 'multi'` 또는 `'solo'`)
3. `vite.config.js`의 `build.rollupOptions.input`에 엔트리 추가
4. 에셋은 `games/<game-id>/assets/`에 배치 (자동 서빙)
5. 게임 문서는 `docs/games/<game-id>/`에 작성

## 필수 처리 사항

- `onMessage` 타입 매칭 (호스트↔모바일 간 type 문자열 일치)
- 준비(`ready`) / 리셋(`onReset`) / 재연결(`onPlayerRejoin`, `onRejoin`) 처리
  - **로비 재연결 프리징 가드**: 모바일 클라이언트가 `onRejoin` 발생 시 복구 중 화면(예: "연결 복구 중...")을 띄우고 호스트의 응답을 대기하는 구조라면, 호스트는 `lobby` 혹은 `loading` 단계에서 재접속(`onPlayerRejoin`)을 받더라도 무시하지 말고 반드시 로비 상태 동기화 패킷(예: `lobbyState`)을 응답하여 모바일 화면이 로비 대기 화면이나 프로필 설정 화면으로 정상 전환되도록 해야 합니다.
- 플레이어 퇴장 시 게임 상태 정리
- **공통 `.hidden` CSS 클래스 정의**: 호스트 및 모바일 개별 CSS 파일에 `.hidden { display: none !important; }` 스타일을 상시 포함하여, `classList.toggle('hidden')`이나 `showScreen()`을 통한 화면 전환 시 레이아웃 겹침이나 화면 노출 오류가 생기지 않도록 방지해야 합니다.
- **호스트 메인 컨테이너 z-index 및 포지셔닝 필수 지정**: 호스트 화면의 카지노 Felt 백그라운드(`body.host-board::before`, `::after`)는 `z-index: 0` 및 `1`로 렌더링되므로, 호스트 콘텐츠 메인 컨테이너(예: `.pp-host-container` 등)가 배경 뒤로 숨겨지거나 가려져 투명화되는 버그를 피하기 위해 호스트 스타일시트에 반드시 **`position: relative; z-index: 10;`**을 정의해야 합니다.
- **호스트 화면 데모 모드 구현 필수**: 모든 게임 개발 시, 여러 기기에서 동시 접속하지 않고도 게임의 핵심 루프와 연출을 한눈에 검증할 수 있는 **데모 시뮬레이션 모드(Attract Mode)**를 반드시 함께 개발해야 합니다. 호스트 로비 화면에 "🤖 데모 플레이 실행" 버튼과 중단 배너를 구현하고, 별도 `DemoSimulator.js` 파일을 생성하여 가상 봇 입장, 준비 완료, 라운드 진행 및 결과 도출 시뮬레이션을 차례대로 구동한 뒤 원상태로 복구(onReset)되도록 구현해야 합니다.

## 메시지 전송

- `sendToPlayer(id, type, payload)`: 특정 플레이어에게
- `broadcast(type, payload)`: 전체 플레이어에게
- `sendToHost(type, payload)`: 호스트에게

P2P DataChannel이 열려 있으면 자동으로 P2P 우선 전송하고, 실패 시 Socket.IO로 폴백합니다. 게임 코드에서 전송 경로를 신경 쓸 필요 없습니다.

# 개발 환경

```bash
npm install
npm run dev        # 서버(:3000) + Vite(:5173) 동시 실행
npm run build      # 프로덕션 빌드
```

개발 시 `https://localhost:5173`으로 접속합니다 (HTTPS — 모바일 센서/카메라 권한에 필요).
Socket.IO 요청은 Vite proxy를 통해 `:3000`으로 전달됩니다.

# 테스트

자동화된 테스트 스크립트는 없습니다. 수동 검증 절차:

1. 로비에서 멀티/솔로 탭과 게임 카드 표시 확인
2. 게임 진입 후 세션 생성/QR 표시 확인
3. 모바일 입장 → 준비 → 게임 시작 → 리셋 확인
4. 플레이어 재연결 (브라우저 새로고침) 확인
5. P2P 연결 확인: 콘솔에 `[P2P] ... 직접 연결됨` 로그

프로덕션 빌드 테스트:

```bash
npm run build
node server/index.js
# http://<server-ip>:3000 접속
```
