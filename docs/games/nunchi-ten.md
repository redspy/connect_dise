# 눈치 10단

- 경로: `games/nunchi-ten/`
- 인원: 2~6명
- 라운드: 10
- 핵심 규칙: 내 숫자보다 낮은 숫자 개수만큼 점수, 더블 3회

주요 메시지:
- M->H: `setProfile`, `submitChoice`, `requestRematch`
- H->M: `playerListUpdated`, `gameStarted`, `roundStarted`, `submissionStatus`, `roundRevealed`, `gameFinished`, `rejoinState`

구현 특징:
- 아바타 8종 선택
- 재연결 시 `rejoinState`로 화면/라운드 상태 복원
- 타이브레이크: 총점 desc -> 남은 더블 asc -> 최고 라운드 점수 desc
