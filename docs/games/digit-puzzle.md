# Digit Puzzle

- 경로: `games/digit-puzzle/`
- 인원: 2~4명
- 퍼즐: 4x4 슬라이딩 (15 puzzle)

구현 특징:
- 호스트가 300회 유효 이동으로 풀이 가능한 공통 보드 생성
- 모바일 탭/스와이프 입력
- 진행률 500ms 스로틀 전송
- 호스트 대시보드에 미니보드/진행률/시간 표시

주요 메시지:
- M->H: `setProfile`, `progressUpdate`, `puzzleComplete`, `requestRematch`
- H->M: `playerListUpdated`, `gameStarted`, `gameFinished`
