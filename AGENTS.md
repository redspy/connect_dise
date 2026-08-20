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

상세 아키텍처는 `docs/architecture.md`를 참조하세요.

# 문서 안내

| 문서                             | 내용                                            |
| -------------------------------- | ----------------------------------------------- |
| `docs/architecture.md`           | 전체 구조, 디렉토리, 세션 라이프사이클          |
| `docs/SDK.md`                    | HostSDK, MobileSDK, BaseGame, 공유 컴포넌트 API |
| `docs/protocol.md`               | Socket.IO 이벤트 프로토콜 (platform/game/p2p)   |
| `docs/DESIGN.md`                 | 화면 UI 개발 시 지켜야할 가이드                 |
| `docs/game-development-guide.md` | 새 게임 추가 가이드                             |
| `docs/game-audit-guide.md`       | 기존 게임 전수 검수(워크플로우/반응형/겹침·짤림) 절차 |
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
- **데모 시뮬레이터의 `stopDemo()`류는 "비활성 상태 호출"에 안전(no-op)해야 함**: `onReset()`이 안전망 차원에서 `stopDemo()`를 무조건 호출하는 패턴을 쓴다면, 그 함수 내부에서 다시 `resetSession()`류를 호출할 경우 반드시 (a) 데모가 실제로 활성 상태일 때만 진행하는 가드, (b) 리셋 요청 자체를 다시 트리거할지 여부를 파라미터로 분리 — 이 두 가지를 함께 갖춰야 합니다. 안 그러면 `onReset ↔ stopDemo ↔ resetSession`이 서로를 반복 호출하는 무한루프에 빠질 수 있습니다(dobble에서 재대결 1회로 reset 이벤트가 37,000회 이상 폭주한 사례로 실측 확인됨).
- **데모 봇 등 타이머 기반 반복 행동은 "행위자 단위 재스케줄"로 구현**: 아무 봇이나 행동할 때마다 전체 타이머를 `clearAll` 후 일괄 재예약하면, 가장 느린 봇/에이전트가 더 빠른 상대 때문에 영원히 차례를 못 받는 "타이머 기아" 버그가 생깁니다. 각 봇은 자기 자신의 타이머만 재예약해야 합니다.
- **가변 참가자 수(min~maxPlayers)에 따라 커지는 목록 컨테이너는 항상 `max-height` + `overflow-y: auto`를 갖출 것**: 결과 랭킹, 점수판 등. 크기도 고정 `vh` 계산식이 아니라 실제 flex 잔여 공간(`max-width`/`max-height` + `aspect-ratio`, 또는 `flex: 1; min-height: 0`)에서 유도되도록 해야 합니다. `registry.js`의 `maxPlayers` 값을 실제로 채워 눈으로 확인하지 않으면 정적 코드 리뷰만으로는 이런 겹침/짤림 버그를 절대 못 잡습니다 — 반드시 실제 브라우저로 인원 스트레스 테스트를 해야 합니다.
- **커스텀 프리픽스 클래스(`.xx-lobby-panel` 등)로 로비를 직접 구현하지 말 것**: `docs/DESIGN.md`가 강제하는 공통 `<game-lobby>` 컴포넌트가 이미 그 역할을 전담하므로, 게임별 커스텀 로비 CSS는 높은 확률로 죽은 코드가 됩니다.
- **데모 스냅샷 복원 시 `HostBaseGame`의 getter-only 프로퍼티(`this.players`, `this.phase`, `this.playerCount` 등)에 직접 대입하지 말 것**: `get players() { return this._players; }`처럼 setter가 없는 접근자라 `this.players = ...` 형태로 대입하면 ES 모듈(항상 strict mode)에서 즉시 `TypeError`가 던져지고, 그 뒤에 이어지는 정리 로직(배너 숨김, 봇 제거, 로비 복원 등)이 전혀 실행되지 않습니다. 스냅샷을 복원하거나 데이터를 갈아끼워야 한다면 내부 필드(`this._players` 등)를 직접 `.clear()`/`.set()`하거나, 필요한 항목만 골라서 추가·삭제해야 합니다 — 특히 데모 도중 실제 플레이어가 join한 경우 봇 시작 이전 스냅샷으로 통째로 덮어쓰면 그 실제 플레이어까지 함께 사라지므로, 가급적 "전체 교체"보다 "봇 id만 골라 추가/제거"하는 방식을 우선 고려해야 합니다(눈치10단 검수에서 실측 확인된 Critical 버그).
- **데모 중 실제 플레이어 접속 시 반드시 데모부터 중단하고 세션을 리셋할 것**: `onPlayerJoin`에서 데모 활성 중이라고 그냥 `return`만 하고 넘어가면, 그 플레이어는 플랫폼 레벨(`this.players`)엔 들어가지만 게임 로직상 봇 전용으로 나가는 브로드캐스트(라운드 배정 등)에 휩쓸려 들어가 화면이 게임 진행 상태로 끌려간 뒤, 데모가 끝나 리셋돼도 그 화면에 고립되는 버그가 생깁니다(relay-drawing 검수에서 실측 확인). 반드시 `this._demoSimulator.stopDemo(); this.resetSession();`으로 처리해 정상 로비로 복귀시켜야 합니다. 이때 모바일 쪽 `onReset()`이 "닉네임을 아직 제출 안 한 상태(setup 화면)"인데도 무조건 `waiting` 화면으로 넘기지 않는지도 함께 확인할 것 — 저장된 닉네임이 있을 때만 waiting, 없으면 setup을 유지해야 합니다.
- **`position:fixed`인 데모 중단 배너는 실제 렌더 높이를 측정해 콘텐츠 상단 여백으로 되돌려줄 것**: 배너를 그냥 `document.body`에 fixed로 붙이기만 하면 문서 흐름을 차지하지 않아 각 페이즈의 헤더/제목이 배너 밑에 깔려 가려지는 버그가 여러 게임에서 반복 확인됐습니다(dobble 검수 때 처음 발견했지만 "플랫폼 차원 결정 필요"로 보류했던 항목 — relay-drawing 검수에서 실제로 고쳐서 검증 완료). 배너 생성 시 `requestAnimationFrame`으로 `banner.offsetHeight`를 측정해 `document.documentElement.style.setProperty('--demo-banner-h', ...)` 같은 CSS 변수로 넘기고, 콘텐츠 컨테이너의 `padding-top: calc(기존값 + var(--demo-banner-h, 0px))`로 받아 밀어내야 합니다. 배너 제거 시 `removeProperty`도 잊지 말 것. 반응형 미디어쿼리에서 같은 컨테이너에 `padding: Xrem !important;` 같은 shorthand 규칙이 이미 있다면, 그 규칙도 같은 CSS 변수를 포함한 `padding-top: ... !important;` longhand로 함께 갱신해야 좁은 화면에서도 무력화되지 않습니다.
- **`setTimeout`/`setInterval` 체인으로 게임 진행을 이어가는 함수(라운드 전환, 인트로 카운트다운 등)는 예외 없이 인스턴스 필드에 핸들을 저장하고 `onReset()`에서 전부 `clear`할 것**: 로컬 변수나 미저장 타이머는 리셋 시점에 취소가 불가능해, 이미 리셋된 세션에 뒤늦게 발화해 다음 라운드를 멋대로 시작시키거나 막 재접속한 플레이어의 화면을 갑자기 튀게 만듭니다(relay-drawing의 `_finishRound`/인트로 카운트다운에서 실측 확인).
- **데모 시뮬레이터의 QR 차단(블러) 가드는 `.lobby-qr-box` 셀렉터를 쓸 것**: `<game-lobby>` 공통 컴포넌트(`LobbyPanel.js`)의 QR 요소 클래스는 `.lobby-qr-box`입니다. 구버전 수동 QR 패턴의 잔재인 `.qr-container`는 `<game-lobby>`를 쓰는 DOM에 존재하지 않아 `querySelector`가 항상 `null`을 반환하고, "데모 중 신규 접속 불가" 블러 가드가 에러 없이 조용히 무력화됩니다. `|| document.querySelector('game-lobby')?.parentNode` 같은 폴백을 붙여도 QR박스가 아닌 로비 패널 전체(설정/규칙 텍스트 포함)를 블러 처리하는 과잉 동작이 됩니다. dixit 검수에서 발견 후 dobble/nunchi-ten/give-you-fire/digit-puzzle/spectrum-mind/trading-battle 6개 게임에 동일 패턴이 있어 함께 수정했습니다(2026-08-19) — 새 게임을 `DemoSimulator.js` 템플릿에서 복사해 만들 때 이 셀렉터를 그대로 베끼지 않도록 주의할 것.
- **`body`에 게임 고유 `--lobby-accent`(및 `--lobby-accent-dim`)를 반드시 오버라이드할 것**: `docs/DESIGN.md`가 요구하는 규칙이지만 실제로 빠뜨리기 쉽습니다 — `platform/client/shared/lobby.css`의 `:root`에 플랫폼 기본값(`#f59e0b`, 골드)이 정의돼 있어서, 게임이 오버라이드를 안 해도 에러 없이 조용히 그 기본 골드로 폴백됩니다. 게임의 실제 테마색이 우연히 골드면 안 드러나지만(dobble이 그랬음), 다른 색이면 `<game-lobby>` 내장 시작 버튼 등이 게임 고유색과 어긋난 골드로 렌더링되는 게 실제로 발생합니다(dixit·relay-drawing에서 agy 비주얼 검증으로 실측 발견, 2026-08-20). `body.<game>-host { --lobby-accent: var(--xx-accent); --lobby-accent-dim: ...; }` 형태로 게임 CSS의 실제 강조색 변수를 반드시 연결하고, 데모 버튼처럼 인라인 스타일로 강조색을 쓰는 요소도 게임 고유 변수를 참조하는지(플랫폼 기본 골드를 베껴 쓰지 않았는지) 함께 확인할 것.
- **`position:fixed`인 데모 배너는 appbar의 `다시하기` 버튼과 같은 상단 영역에서 겹칠 수 있음**: 배너 배경이 완전 불투명(`opacity:1`/`rgba(...,1)`)이 아니면(예: `rgba(239,68,68,0.95)`) 그 틈으로 밑에 깔린 `game-appbar`의 `다시하기` 버튼이 유령처럼 비쳐 보입니다(agy 비주얼 검증으로 dobble에서 실측 발견, 2026-08-20). 데모 중엔 정식 "데모 중단" 버튼이 그 역할을 대신하므로, 배너를 띄우는 동안 `.appbar-btn-restart`에 `.hidden`을 추가했다가 배너를 내릴 때 제거하는 방식으로 처리할 것.

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

자동화된 E2E 테스트 및 단위 테스트가 구성되어 있습니다.

자동화 테스트 실행:
```bash
npm run test         # 전체 Playwright E2E 테스트 실행
npm run test:unit    # 단위 테스트 실행
```

수동 검증 절차:

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

# 코드 리뷰 및 문서 싱크 준수 규칙

게임 기획 및 개발이 완료되면 스테이징(Stage) 및 커밋(Commit)하기 전에 반드시 다음 로컬 CLI 도구를 **헤드리스(비대화형) 모드**로 구동하여 소스 품질과 문서 정합성을 정밀 검증해야 합니다.

### 1. Claude CLI를 통한 소스 코드 리뷰 (Headless)
*   **실행 명령어**:
    ```bash
    git diff | /Users/soul/.local/bin/claude -p "아키텍처 결함, 소켓 지터, 메모리 누수 및 SDK 규칙 준수 여부 리뷰" --allowedTools "Read"
    ```
*   **주요 원칙**:
    - `-p` (or `--print`) 플래그를 반드시 지정하여 대화형 TUI 셸 진입 없이 결과를 `stdout`으로 받아와야 합니다.
    - 소켓 지터나 스레드 안전성 등의 아키텍처 결함 리뷰 결과를 파싱하여 치명적 경고 발생 시 커밋을 즉시 중단하고 보강 코드를 작성해야 합니다.

### 2. Codex CLI를 통한 문서 정합성 싱크 검사 (Headless)
*   **실행 명령어**:
    ```bash
    codex exec "설계 문서(AGENTS.md, docs/architecture.md)와 이번 소스 코드 변경점 간의 구현 명세 정합성 감사 및 요약"
    ```
*   **수정 권한 부여 시**:
    ```bash
    codex exec --sandbox workspace-write "요구사항과 구현 코드의 불일치 분석 및 자동 문서 갱신 수행"
    ```
*   **주요 원칙**:
    - `codex exec` 헤드리스 방식을 사용하여 비대화형 자동화를 전개합니다.
    - 문서(Markdown)와 실제 코드(Vite/JS) 간의 API 스펙, 파라미터 구조, 클래스 명세를 대조하여 싱크 불일치 요소를 사전 교정합니다.

### 3. 가상 전문가 회의 피드백 반영 및 릴리즈
*   도출된 두 보고서의 이슈에 대하여 가상 전문가 회의(Revision 16 등)를 거쳐 코드의 오작동 요소를 즉시 보강 수정한 뒤에 비로소 릴리즈 커밋 및 원격 저장소 푸쉬를 수행합니다.
*   **원격 푸쉬 필수 규칙**: 모든 구현 및 E2E 테스트/리뷰 검증이 완료되면, 작업을 그냥 종료하지 말고 반드시 `git add`, `git commit` 및 `git push` 명령을 차례대로 수행하여 최종 변경점을 원격 저장소에 완벽히 동기화해야 합니다.
*   로컬 셸 프로필(API Key, OAuth Token) 환경 변수 로드가 필요한 경우, 비대화형 셸 환경에서는 `zsh -l -c "command"` 형태로 명령을 랩핑하여 환경 변수 누락을 방지합니다.

### 4. 4대 개발 프로세스 라이프사이클 결합 (Full Pipeline Integration)

이 프로젝트는 개발 프로세스의 모든 단계에서 두 CLI의 정적 리뷰를 강제 탑재하여 무결성을 보존합니다.

1.  **로컬 Git 커밋 예방 단계 (Pre-commit Hook)**
    *   커밋(`git commit`) 호출 시, `.git/hooks/pre-commit` 스크립트가 자동으로 트리거되어 스테이징된 변경 코드와 문서 정합성을 헤드리스 진단 후 결과를 화면에 보여줍니다.
2.  **원격 서버 CI/CD 정밀 단계 (GitHub Actions CI)**
    *   원격 브랜치 푸쉬 및 PR(Pull Request) 병합 검수 시, `.github/workflows/review-ci.yml` 액션 파일에 의해 서버사이드에서 클라우드 키 기반 에이전트 품질 리뷰가 자동 가동됩니다.
3.  **실시간 변경 모니터링 단계 (NPM Scripts & Watcher)**
    *   `npm run review:watch`: 파일 저장 시마다 실시간으로 로컬 소스와 아키텍처 문서의 스펙 충돌 유무를 감시합니다.
    *   `npm run review:code` / `npm run review:docs`: 수동으로 1회성 코드 아키텍처 결함 및 명세 대조 리포트를 생성할 때 사용합니다.
4.  **릴리즈 자동 문서 동기화 단계 (Auto-Docs Generation)**
    *   `npm run review:write` 명령을 실행하여 릴리즈 전 변경 사안들을 `walkthrough.md`나 아키텍처 기록부에 자동으로 기재 및 동기화합니다.

# 에이전트 협업 및 역할 준수 규칙

*   **역할 정의서 준수**: 모든 에이전트(메인, 서브, 가상 페르소나 및 CLI 도구)는 [docs/agents/roles.md](file:///Users/soul/Source/connect_dise/docs/agents/roles.md)에 기술된 역할 정의와 가이드라인을 엄격히 준수하여 동작해야 합니다.
*   **브라우저 서브에이전트 활용 규칙**: 코드를 구현하거나 수정한 후, 시각적인 UI 검증, 반응성, 마이크로 연출 확인이 필요할 때는 반드시 `browser_subagent` 도구를 실행해 Chrome 상에서의 동작 상태를 입증하고 기록을 아티팩트에 저장해야 합니다.

# 버그 분석 및 해결 프로세스 규칙 (Bug Analysis & Resolution Pipeline)

버그 분석 업무 또는 오작동 신고가 주어지면, 반드시 아래 4단계 파이프라인을 거쳐 작업을 완수해야 합니다.

1.  **1단계: 버그 상세 정의 및 재현 계획 수립**
    *   어떤 현상으로 인해 오작동이 발생하는지 명확히 한계선을 긋고, 이를 재현하여 수정 전/후를 검증할 구체적인 테스트 계획(테스트 좌표, 종횡비, 시나리오 등)을 상세히 정리합니다.
2.  **2단계: 실제 병렬 CLI 분석 기동 (Parallel Multi-CLI Analysis)**
    *   버그 원인분석은 정답이 있는 검증 작업이므로 **가상 페르소나로 대체하지 않고**, [docs/agents/roles.md](file:///Users/soul/Source/connect_dise/docs/agents/roles.md) §0/§3에 정의된 3개의 독립 CLI 프로세스(Claude CLI, Codex CLI, Antigravity CLI `agy`)를 Bash 서브프로세스로 직접 기동해 원인 파악을 개별 수행합니다.
    *   구현을 진행 중인 이 세션과 컨텍스트가 섞이지 않도록, 검증용 Claude 호출은 반드시 별도 `--session-id`로 실행합니다(자기검증 편향 방지).
    *   UI/레이아웃성 버그는 `browser_subagent`로 스크린샷을 캡처한 뒤 `agy -p`(Antigravity CLI)에 첨부해 `docs/DESIGN.md` 가이드라인과의 편차를 대조합니다.
3.  **3단계: 분석 결과 취합 및 다각도 해결 설계 (Aggregation & Multi-perspective Design)**
    *   각 CLI가 반환한 개별 리포트(stdout/JSON)를 한곳에 합쳐 종합하고, 서로 다른 모델이 제시한 수정 설계안의 장단점을 대조 형태로 도출합니다.
4.  **4단계: 최종 수정 방향 확정 및 구현**
    *   교차검증을 거쳐 가장 아키텍처적으로 건전하고 안전한 단 하나의 해결 방향을 확정한 뒤에야 비로소 실물 소스 코드를 편집하고 E2E 검증을 적용합니다.



