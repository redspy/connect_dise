# 그림 릴레이

- 경로: `games/relay-drawing/`
- 인원: 2~8명

구현 특징:
- 턴별 과제 할당(`roundAssignments`)
- 그림/단어 번갈아 제출
- 제한시간 종료 시 자동 제출(더미 데이터 포함)
- 결과 발표 단계에서 체인 순차 공개
- 모바일 리액션 이모지 송신 지원

주요 메시지:
- M->H: `setProfile`, `submitTurn`, `sendReaction`
- H->M: `playerListUpdated`, `gameStarting`, `roundAssignments`, `showResults`
