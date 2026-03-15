# 주사위

- 경로: `games/dice/`
- 인원: 1~6명

구현 특징:
- 모바일 더블탭/강한 모션으로 던지기
- 호스트는 `@3d-dice/dice-box`로 3D 주사위 렌더링
- 던지는 동안 호스트 UI 10초 숨김 후 복구

주요 메시지:
- M->H: `throwDice`, `resetDice`, `gyroData`
