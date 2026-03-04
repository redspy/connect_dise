# Connect Dice (주사위 게임) 🎲

브라우저 기반 메인 보드와 모바일 컨트롤러 기기를 실시간으로 연결하여 즐기는 3D 주사위 롤링 게임 프로젝트입니다. 모바일 기기의 모션 센서(가속도계/자이로스코프) 및 터치 제스처를 사용하여 PC 화면에 원격으로 주사위를 굴릴 수 있습니다.

![game-preview](https://img.shields.io/badge/Status-Beta-brightgreen)
![tech-stack](https://img.shields.io/badge/Tech-Vite%20%7C%20Socket.io%20%7C%20Node.js-blue)

---

## 🌟 주요 기능 (Features)
* **스마트폰이 주사위로 변신!**: QR코드를 스캔하여 게임 방(Room)에 쉽게 입장하세요.
* **센서 및 더블 탭 연동**: 모바일 기기를 흔들거나 더블 탭(`Double Tap`)하면, 디바이스 내 주사위가 위로 던져지는 슈팅 액션과 함께, 실시간으로 PC 보드 화면(Host)에서 3D 주사위가 바닥으로 떨어져 구르는 물리 엔진 연출이 재생됩니다.
* **초저지연 실시간 통신**: Socket.io를 활용한 `PC Host` <-> `Mobile Controller` 간의 이벤트 브로드캐스팅.
* **경량화 3D 게임 엔진**: `@3d-dice/dice-box`를 활용하여 브라우저 리소스를 최소화하며 멋진 3D 투척 효과를 연출합니다.

## 🛠️ 기술 스택 (Tech Stack)
* **Frontend**: Vanilla JS, Vite, `@vitejs/plugin-basic-ssl`
* **Backend**: Node.js, Express, Socket.io
* **3D & Utils**: `@3d-dice/dice-box`, `qrcode` 

---

## 🚀 실행 및 테스트 방법 (How to Play)

### 1단계: 서버 구동
서버 구동을 위해서는 Node.js(권장 v20 이상) 환경이 필요합니다.

```bash
# 1. 의존성 설치
npm install

# 2. 로컬 개발 서버 시작 (Express & Vite 병렬 실행)
npm run dev
```

### 2단계: 메인 보드 (PC 브라우저) 열기
터미널에 출력된 `Network` 또는 `Local` 주소를 PC 브라우저에 입력하여 엽니다.  
(**주의**: 모바일 기기의 센서를 사용하기 위해 반드시 **`https://`** 로 시작하는 주소를 사용해야 합니다.)

```text
➜  Local:   https://localhost:5173/
➜  Network: https://192.168.x.x:5173/
```
접속하시면 카지노 보드판처럼 디자인된 **녹색 배경**과 함께 **사방에 4개의 QR코드**가 나타납니다. 해당 QR 코드를 통해 참가 플레이어들이 해당 Session(게임 방)으로 접속할 수 있습니다.

### 3단계: 모바일 컨트롤러 연결 및 플레이
1. 스마트폰 카메라 앱을 열어 모니터 4방위에 떠 있는 **QR코드 중 하나를 스캔**합니다. (PC와 동일한 Wi-Fi 네트워크에 연결되어 있어야 합니다.)
2. `https://` 적용에 따른 자체 서명 인증서 이슈로 **"안전하지 않은 웹 페이지(Your connection is not private)"** 경고창이 브라우저에 표시됩니다.
   - **'고급(Advanced)' -> '안전하지 않음으로 이동 (Proceed to 192.168...)'** 을 눌러 접속을 강행해 주세요.
3. 모바일 화면에서 **"Grant Permission & Play"** 버튼을 눌러 디바이스 **모션 센서 권한을 허용**해 줍니다. (위 HTTPS 우회 접속을 하지 않으면 이 단계에서 권한 획득이 거절될 수 있습니다!)
4. 좌측 상단의 상태 아이콘이 **녹색 (연결됨)** 으로 표시되면 준비 완료입니다.
5. **스마트폰을 흔들건(방향 틀기)나 화면을 더블 터치(Double Tap)** 하시면, PC 화면의 메인 보드판 위로 주사위가 던져져 굴러가는 모습을 볼 수 있습니다!

---

## 📁 프로젝트 구조 및 산출물 (Documentation)

자세한 내부 구현 플로우 및 개발 작업 목록은 다음 첨부된 문서들을 참고해 주세요. 
이 문서들은 프로젝트 루트 경로에 위치해 있습니다.

* [`implementation_plan.md`](implementation_plan.md) - 에이전트 다중 역할 분담 및 기술 구성 관련 구현 계획서 
* [`task.md`](task.md) - 설계 > 구현 > 검증 7개 Phase 전체 개발 Work Breakdown 작업 목록
* [`walkthrough.md`](walkthrough.md) - 기능 명세 및 동작 안내 가이드
