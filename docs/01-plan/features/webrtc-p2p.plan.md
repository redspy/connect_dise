# Plan: WebRTC P2P 로컬 네트워크 직접 통신

> 기능 ID: webrtc-p2p
> 작성일: 2026-03-10
> 브랜치: feature/webrtc-p2p

---

## 1. 배경 및 문제 정의

### 현재 구조

```
[모바일폰] ──센서데이터──▶ [원격 서버] ──▶ [호스트 화면]
                           (인터넷 경유)
```

가속도 센서 입력은 초당 30~60회 전송되며, 원격 서버를 경유하면 왕복 지연(RTT)이
**50~200ms** 이상 발생해 실시간 조작감이 크게 저하됨.

### 핵심 코드 분석

기존 코드를 분석한 결과, **로컬 네트워크 지원이 이미 부분적으로 구현**되어 있음:

| 파일 | 관련 코드 | 현황 |
|------|----------|------|
| `SessionManager.js` | `getLocalIp()` — 서버 LAN IP 감지 | ✅ 구현됨 |
| `HostSDK.js:22-27` | QR URL을 `localIp`로 생성 | ✅ 구현됨 |
| `server/index.js:142` | `0.0.0.0:3000` 바인딩 | ✅ 구현됨 |

---

## 2. 기술적 실현 가능성 검토

### Option A: 로컬 서버 모드 (간단, 즉시 가능)

```
[모바일폰] ──센서데이터──▶ [호스트 PC의 Socket.io 서버] ──▶ [호스트 화면]
                           (LAN 내부, 1~5ms)
```

- **호스트 PC에서 `node server/index.js` 실행** 시 이미 동작함
- `getLocalIp()`이 호스트 PC의 LAN IP를 반환 → QR코드가 `http://192.168.x.x:3000/...`으로 생성
- 모바일폰이 QR 스캔 → 호스트 PC 서버에 직접 연결 → **모든 통신이 LAN 내에서 처리**
- **현재 코드 변경 없이** 로컬 실행만으로 달성 가능

**제약사항**: 호스트 PC에 Node.js 설치 필요, 방화벽 설정 필요

### Option B: WebRTC P2P DataChannel (완전 P2P, 이 기능의 목표)

```
[모바일폰 A] ─── DataChannel ───┐
[모바일폰 B] ─── DataChannel ───┤──▶ [호스트 브라우저]
[모바일폰 C] ─── DataChannel ───┘
                (LAN 직접, <5ms)

[원격 서버] : 시그널링 전용 (연결 설정 시 1회, 이후 불필요)
```

- WebRTC는 브라우저 네이티브 지원 (플러그인 불필요)
- 같은 LAN에서는 ICE 후보가 로컬 IP로 해석 → 서버 무관하게 LAN 직접 통신
- **원격 서버는 시그널링(offer/answer/ICE 교환)에만 사용** → 게임 데이터는 P2P
- 호스트 브라우저가 플레이어 수만큼 RTCPeerConnection 생성 (1:N 연결)

### Option C: 하이브리드 (권장)

```
Socket.io (원격 서버):
  - 세션 관리 (입장, 준비, 리셋)
  - WebRTC 시그널링 (offer/answer/ICE — 연결 시 소량)

WebRTC DataChannel (LAN 직접):
  - 센서 데이터 (가속도, 자이로) — 고빈도, 레이턴시 중요
  - 게임 액션 — 실시간 조작 입력
```

---

## 3. 옵션 비교

| 항목 | Option A (로컬서버) | Option B (WebRTC P2P) | Option C (하이브리드) |
|------|---------------------|-----------------------|-----------------------|
| 레이턴시 | 1~5ms (LAN) | <5ms (직접) | <5ms (직접) |
| 구현 복잡도 | ★☆☆ (이미 됨) | ★★★ | ★★☆ |
| Node.js 설치 필요 | ✅ 필요 | ❌ 불필요 | ❌ 불필요 |
| 원격 서버 없이 가능 | ❌ | ❌ (시그널링 필요) | ❌ (시그널링 필요) |
| 모바일 → 호스트 직접 | ❌ (서버 경유) | ✅ 직접 P2P | ✅ 직접 P2P |
| 폴백 지원 | ✅ (항상 동작) | ❌ (WebRTC 실패 가능) | ✅ (Socket.io 폴백) |
| SDK 변경 범위 | 없음 | HostSDK + MobileSDK 전면 | HostSDK + MobileSDK 일부 |

**결정: Option C (하이브리드) 구현**

이유:
1. 세션 관리는 기존 Socket.io 구조 유지 (안정성)
2. 센서/게임 데이터는 WebRTC DataChannel로 LAN 직접 전송
3. WebRTC 연결 실패 시 Socket.io 폴백 가능 (원격 환경에서도 동작)
4. SDK 인터페이스 변경 최소화 → 기존 게임 코드 수정 불필요

---

## 4. 구현 범위

### 새 컴포넌트

```
platform/client/
  P2PManager.js          — WebRTC 연결 생성/관리, 시그널링 처리
  HostP2PChannel.js      — 호스트 측 P2P 채널 (N개 RTCPeerConnection 관리)
  MobileP2PChannel.js    — 모바일 측 P2P 채널 (1개 RTCPeerConnection)
```

### 변경 컴포넌트

```
platform/client/
  HostSDK.js             — P2P 채널 초기화, sendToPlayer/broadcast P2P 우선 사용
  MobileSDK.js           — P2P 채널 초기화, sendToHost P2P 우선 사용

platform/server/
  (변경 없음 — 시그널링은 기존 Socket.io 이벤트에 추가)

server/index.js
  — WebRTC 시그널링 이벤트 추가 (p2p:offer, p2p:answer, p2p:ice)
```

### SDK API (변경 없음)

게임 코드는 기존 API 그대로 사용:
```js
sdk.sendToHost('sensor', data);       // 내부적으로 P2P DataChannel 사용
sdk.broadcast('gameState', state);    // 내부적으로 P2P DataChannel 사용
sdk.onMessage('sensor', handler);     // 소스 투명 (P2P or Socket.io 동일)
```

---

## 5. WebRTC 작동 원리 (같은 LAN의 경우)

```
1. 호스트 브라우저 → 서버: "플레이어 A와 P2P 시작"
2. 서버: 시그널링 relay 역할
3. 호스트 브라우저 → 서버 → 모바일A: RTCSessionDescription (offer)
4. 모바일A → 서버 → 호스트: RTCSessionDescription (answer)
5. ICE 후보 교환: 브라우저들이 가능한 연결 경로 나열
   → 같은 LAN이면 로컬 IP (192.168.x.x) 후보가 선택됨
6. 직접 P2P 연결 수립 완료 → DataChannel open
7. 이후 센서/게임 데이터: 서버 bypass, LAN 직접 전송
```

---

## 6. 예상 레이턴시 개선

| 경로 | RTT |
|------|-----|
| 현재 (원격 서버 경유) | 50~200ms |
| Option A (로컬 서버) | 1~5ms |
| Option C (WebRTC LAN) | 1~3ms |

센서 데이터 60fps 기준: **원격 16.7ms 간격 → 실제 67~217ms 지연** vs **P2P 17~18ms 지연**

---

## 7. 위험 요소

| 위험 | 가능성 | 완화 방법 |
|------|--------|-----------|
| iOS Safari WebRTC 제한 | 중 | 최신 iOS 14.5+에서 DataChannel 지원 확인됨 |
| 방화벽으로 P2P 차단 | 중 | STUN 서버로 NAT 통과; 실패 시 Socket.io 폴백 |
| 호스트가 1:N 연결 부하 | 저 | 6명 이하 → RTCPeerConnection 6개 = 문제없음 |
| 시그널링 타이밍 이슈 | 저 | 기존 platform:joined 이벤트 흐름 후 시그널링 시작 |

---

## 8. 구현 단계 (Do 페이즈용)

1. `P2PManager.js` 작성 — WebRTC 연결 생성, ICE 처리, DataChannel 관리
2. `server/index.js` — 시그널링 이벤트 3개 추가 (p2p:offer, p2p:answer, p2p:ice)
3. `HostSDK.js` — P2PManager 통합, sendToPlayer/broadcast 오버라이드
4. `MobileSDK.js` — P2PManager 통합, sendToHost 오버라이드
5. 기존 게임 (spin-battle, nunchi-ten) — SDK API 변경 없으므로 코드 수정 불필요
6. 연결 상태 UI — P2P 연결 여부 표시 (선택)

---

## 9. 성공 기준

- [ ] 같은 LAN에서 호스트-모바일 간 WebRTC DataChannel 연결 수립
- [ ] 센서 데이터(motion/orientation)가 DataChannel로 전송됨
- [ ] 레이턴시 < 10ms (LAN 내)
- [ ] WebRTC 실패 시 Socket.io 폴백 자동 작동
- [ ] 기존 게임 코드 변경 없이 동작
- [ ] iOS Safari + Android Chrome 모두 정상 동작
