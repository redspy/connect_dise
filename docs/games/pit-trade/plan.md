# 왁자지껄 거래소 (Pit Trade) 기획 및 개발 규약 문서

## 1. 상품 구성 및 분기

이 게임은 3인에서 8인까지 플레이 가능하며, 인원수에 맞춰 상품의 종류가 동적으로 분기됩니다. 각 상품당 총 9장의 카드가 배포되며, 한 사람이 특정 상품 9장을 완전히 독점(Corner the Market)하면 즉시 벨을 울려 승리합니다.

### 인원수별 활성 상품 목록
*   **3인**: 💎 다이아몬드 (100점), 🪙 골드 (80점), 🛢️ 오일 (70점)
*   **4인**: 💎 다이아몬드 (100점), 🪙 골드 (80점), 🛢️ 오일 (70점), 🌾 밀 (60점)
*   **5인**: 💎 다이아몬드 (100점), 🪙 골드 (80점), 🛢️ 오일 (70점), 🌾 밀 (60점), ☕ 커피 (50점)
*   **6~8인**: 💎 다이아몬드 (100점), 🪙 골드 (80점), 🛢️ 오일 (70점), 🌾 밀 (60점), ☕ 커피 (50점), 🪵 목재 (40점)

### 특수 조커/패널티 카드
*   **황소 (Bull - 조커, 1장)**: 보유 시 임의의 다른 1개 상품으로 간주해 9장 독점을 선점할 수 있습니다.
*   **곰 (Bear - 패널티, 1장)**: 라운드가 종료되는 시점에 이 카드를 손에 쥐고 있는 플레이어는 **-50점 감점**을 받습니다.

---

## 2. 소켓 메시지 흐름 및 이벤트 프로토콜

모든 교환은 실시간으로 중계되며, 다중 유저 동시 터치로 인한 레이스 컨디션을 방지하기 위해 호스트 상태 메모리에서 단일 트랜잭션 단위로 교환 검증을 진행합니다.

### 2.1. 대기방 & 프로필 설정
*   `setProfile` (Mobile -> Host): 닉네임 정보 송신.
    *   Payload: `{ nickname: string }`

### 2.2. 실시간 거래 교환 프로토콜
*   `registerTrade` (Mobile -> Host): 거래를 위해 N장의 카드 등록 요청.
    *   Payload: `{ cardCount: number, cardIds: string[] }`
    *   *보안 가드*: 다른 유저에게는 어떤 상품(다이아, 골드 등)을 교환하려는지 비밀로 유지되며, 오직 교환 장수(`cardCount`) 정보만 전파됩니다.
*   `cancelTrade` (Mobile -> Host): 등록했던 거래 취소 요청.
*   `tradeState` (Host -> Mobile): 현재 전체 유저들의 공개 거래 등록 상태 전파.
    *   Payload: `[ { playerId: string, cardCount: number, nickname: string } ]`
*   `executeTrade` (Mobile -> Host): 시장에 등록된 다른 플레이어 B의 N장 거래에 대해, 나의 N장 카드를 교환 수락.
    *   Payload: `{ targetPlayerId: string, cardCount: number, cardIds: string[] }`
    *   *호스트 트랜잭션 락*: 호스트는 두 유저의 현재 카드 소유 여부를 확인하고 카드 ID를 상호 교환한 뒤, 성공 시 `tradeExecuted` 이벤트를 각각 송출합니다.
*   `tradeExecuted` (Host -> Mobile): 거래 매칭 성공 및 새 카드 핸드 전송.
    *   Payload: `{ hand: string[] }`

### 2.3. 독점 선언 및 게임 종료
*   `ringBell` (Mobile -> Host): 9장 독점(또는 황소 포함 9장 완성) 달성 시 종 울리기 요청.
*   `gameFinished` (Host -> Mobile): 라운드 종료 통지 및 점수 결과 전송.
    *   Payload: `{ winnerId: string, winnerNick: string, scores: Map<string, number>, bearHolderId: string }`
