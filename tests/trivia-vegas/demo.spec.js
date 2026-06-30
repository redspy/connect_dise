import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Trivia Vegas — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 퀴즈 추정 및 칩 베팅 E2E 완주 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();

    host.on('console', msg => console.log('HOST PAGE LOG:', msg.text()));
    host.on('pageerror', err => console.error('HOST PAGE ERROR STACK:', err.stack || err.message));

    await host.goto(`${BASE}/games/trivia-vegas/host/`);

    // 1. 로비 감지
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });

    // 2. 데모 플레이 실행
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 3. 게임 대국 진입 확인
    const gameArea = host.locator('#game-container');
    await expect(gameArea).toBeVisible({ timeout: 5000 });

    // 3라운드 실행 루프
    for (let r = 1; r <= 3; r++) {
      // 봇들의 퀴즈 추정값 제출 완료 및 정렬 버튼 활성화 대기
      const sortBtn = host.locator('#btn-sort-estimates');
      await expect(sortBtn).toBeVisible({ timeout: 10_000 });
      await sortBtn.click();

      // 베팅 시간 경과(3초) 후 정산 버튼 활성화 대기
      const resolveBtn = host.locator('#btn-resolve-bets');
      await expect(resolveBtn).toBeVisible({ timeout: 10_000 });
      await resolveBtn.click();

      // 다음 라운드(또는 성적표) 버튼 활성화 대기
      const nextBtn = host.locator('#btn-next-round');
      await expect(nextBtn).toBeVisible({ timeout: 5000 });
      await nextBtn.click();
    }

    // 4. 최종 성적 발표 오버레이 노출 확인
    const resultPanel = host.locator('[data-phase="result"]');
    await expect(resultPanel).toBeVisible({ timeout: 5000 });

    // 5. 로비 복귀 검증
    const restartBtn = host.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 로비 화면 복귀 성공 확인
    await expect(lobby).toBeVisible({ timeout: 5000 });

    await hostCtx.close();
  });

});
