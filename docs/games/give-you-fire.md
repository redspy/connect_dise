# Give You Fire

- 경로: `games/give-you-fire/`
- 인원: 1~4명
- 장르: 배틀 테트리스

구현 특징:
- 모바일 제스처 조작(탭 회전, 드래그 이동, 하향 스와이프로 드롭)
- 5초마다 자동 레벨 상승
- 라인 클리어 시 상대 `levelUp` 공격
- 1인 모드: 레벨 100 도달 시 `soloClear`
- 호스트 대시보드: 미니보드/레벨바/생존상태

주요 메시지:
- M->H: `setProfile`, `boardUpdate`, `linesCleared`, `gameOver`, `soloClear`, `requestRematch`
- H->M: `playerListUpdated`, `gameStarted`, `levelUp`, `playerEliminated`, `gameFinished`
