# 회의록 (Meeting Minutes) — Revision 11

*   **일시**: 2026년 6월 30일
*   **참석자**: PMOrchestrator(PM), GameScout(기획/트렌드), OnlineGameProducer(멀티플레이어), KidsBoardGameExpert(아동 전문가), UIUXDesigner(디자인), TechAnalyst(기술 아키텍트), SeniorGameDev(시니어 개발)
*   **주제**: 스프린트 8 (Cycle 12) 기존 장르(베팅/그리기) 전면 탈피 및 타이밍 액션 장르 '리듬 잼' 기획 및 의사결정 회의

---

## 💬 11라운드 토론 및 의사결정 기록

### 1라운드: 오프닝 및 완전 신장르 탐색 (Opening & Proposals)
*   **PMOrchestrator**: 팀원 여러분, 반갑습니다. 베팅 및 그리기가 기존 게임들과 겹친다는 피드백을 수용하여, **저장소 내에 아예 존재하지 않는 리듬/Rhythm, 피지컬/타이밍 장르**를 기획하겠습니다.
*   **GameScout**: 텍스트나 숫자 머리싸움이 없고, 오직 청각과 리듬 감각에 의존하는 3가지 대안을 제시합니다.
    1.  **리듬 잼 (Rhythm Jam)**: 협동 리듬 타이밍 게임. 호스트 화면에는 3개의 네온 컨베이어 벨트 라인(베이스드럼 둥둥 / 스네어드럼 탁탁 / 하이햇 챙챙)이 가로지르고, 리듬 노드가 우측에서 좌측 비트 판정선으로 흘러갑니다. 플레이어는 각각 모바일 폰에 할당된 거대 네온 터치 패드를 타이밍에 맞춰 두드려 합주를 완성합니다. 판정(Perfect / Good / Miss)에 따라 스코어와 콤보가 누적되고, 신나는 합성음 오디오가 실시간 재생됩니다.
    2.  **기억력 레이저 (Memory Laser)**: 뱅크 금고 타일 기억력 테스트.
    3.  **헥사곤 영토전 (Hexagon Claimer)**: 턴제 육각형 격자 타일 확장 땅따먹기.

---

### 2라운드: 실시간 웹 오디오 및 레이턴시 분석 (Technical Feasibility)
*   **TechAnalyst**: **리듬 잼**은 실시간 전송이 필요하지만, 판정 판단을 호스트 화면(로컬 60fps 캔버스 루프)의 판정선 진입 시점과 모바일 탭 소켓 도착 시점의 오차범위 보정(Lag Compensation) 기법으로 단순화할 수 있습니다. 100ms 내외의 레이턴시 보정 윈도우를 주면 웹 환경에서도 완벽히 쾌적하게 콤보를 이어갈 수 있습니다.

---

### 3라운드: 직관적 터치 레이아웃 및 사운드 UX (UI/UX Design)
*   **UIUXDesigner**: 모바일 화면에는 키보드나 미세 텍스트가 일체 없으며, 화면 전체를 덮는 **거대한 네온 컬러 드럼 드럼 패드(드래그 불필요, 탭만 가능)**가 출력됩니다. 탭할 때마다 폰에 강한 햅틱 진동이 울리고 호스트에서 다이나믹하게 일렉트로닉 킥/스네어 음이 터져 나오므로 연주하는 짜릿함이 극대화됩니다.

---

### 4라운드: 아동 및 전 세대 직관성 분석 (Kids Playability)
*   **KidsBoardGameExpert**: 글자를 읽지 못하는 유아부터 리듬 게임을 선호하는 초등학생, 어른까지 '박자에 맞춰 누른다'는 룰은 전 세계 공통입니다. 복잡한 지능형 브레인 게임 피로를 완전히 날려주는 원초적이고 신나는 파티 연출입니다.

---

### 5라운드: 1차 의결 투표 (Round 1 Vote - Split)
*   **PMOrchestrator**: 1차 투표를 실시합니다.
    *   **리듬 잼 (3표)**: TechAnalyst, UIUXDesigner, KidsBoardGameExpert
    *   **기억력 레이저 (2표)**: SeniorGameDev, GameScout
    *   **헥사곤 영토전 (1표)**: OnlineGameProducer
*   **결과**: 합의 실패로 추가 의견 조율을 진행합니다.

---

### 6라운드: 턴제 땅따먹기의 한계 검토 (Hexagon Claimer Pitfalls)
*   **OnlineGameProducer**: **헥사곤 영토전**은 기존 오목(`omok`)과 전략적 영역이 겹쳐서 신선함이 떨어집니다. 반면 **리듬 잼**은 파티룸 전체에 음악과 비트 소리가 울려 퍼지는 오감 자극형 게임이라 분위기를 띄우는 데 최고입니다.

---

### 7라운드: 피버 모드 및 콤보 텐션 가미 (Fever Mode Feature)
*   **OnlineGameProducer**: 연주의 집중력을 높이기 위해 10콤보를 달성할 때마다 호스트 화면 전체가 사이키델릭 네온 컬러로 점멸하며 점수가 2배로 상승하는 **'피버 모드(Fever Mode)'** 기믹을 추가합시다. 노드 낙하 속도가 빨라지며 협동 텐션이 폭발할 것입니다.
*   **GameScout**: 대박 기획이네요! 관객들도 함께 어깨를 들썩일 기획입니다. 찬성합니다.

---

### 8라운드: 2차 의결 투표 (Round 2 Vote - Split 4:2)
*   **PMOrchestrator**: 피버 모드 기획 통합 후 2차 표결을 실시합니다.
    *   **리듬 잼 (4표)**: Tech, UIUX, Kids, Producer
    *   **기억력 레이저 (2표)**: Dev, Scout (이견 존재)
*   **결과**: 합의 과반 달성하였으나 조율을 계속합니다.

---

### 9라운드: 웹 오디오 합성음 및 악기 데이터 무부하 검증 (Web Audio API)
*   **TechAnalyst**: 외부 무거운 MP3 에셋 없이 HTML5 내장 **Web Audio API Oscillator**를 사용해 킥(60Hz sine wave), 스네어(white noise burst), 하이햇(bandpass-filtered noise) 소리를 실시간으로 합성해 재생합니다. 에셋 다운로드 지연이 전혀 없고 네트워크 로드도 0B에 가깝습니다.

---

### 10라운드: 모듈식 타이머 및 60fps 렌더 재사용 (Code Reusability)
*   **SeniorGameDev**: 디멘션 위버(`dimension-weaver`)에서 검증한 60fps `requestAnimationFrame` 컨베이어 스크롤 로직을 그대로 재사용하여 리듬 노드 흐름을 구현할 수 있습니다. Web Audio API 역시 짧은 헬퍼 함수로 해결되므로 3일이면 E2E 검증까지 거뜬히 마칠 수 있습니다. 리듬 잼에 합의하겠습니다.

---

### 11라운드: 최종 의결 투표 및 컨센서스 성립 (Round 3 Vote - Consensus)
*   **PMOrchestrator**: 최종 만장일치 표결을 진행하겠습니다.
    *   **리듬 잼 (6표 전원 만장일치 찬성)**: PMOrchestrator, GameScout, OnlineGameProducer, KidsBoardGameExpert, UIUXDesigner, TechAnalyst, SeniorGameDev
*   **최종 결정**: 만장일치 컨센서스에 의거, 차기 개발작은 **'리듬 잼 (Rhythm Jam)'**으로 확정하고 상세 기술 설계를 가동합니다.
