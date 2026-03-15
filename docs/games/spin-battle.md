# 팽이 배틀

- 경로: `games/spin-battle/`
- 인원: 2~6명
- 단계: lobby -> launching -> countdown -> battle -> result

구현 특징:
- 런치 5초 흔들기(RPM 계산)
- 배틀 전 3초 카운트다운
- 기울기 입력 30fps 전송
- 아이템 시스템: `energy`, `shield`, `cogs`
- 개발자 패널(`?dev`)로 물리/광원 파라미터 조정

주요 메시지:
- M->H: `launchSpin`, `tiltInput`, `requestReset`
- H->M: `battleStart`, `eliminated`, `gameOver`
