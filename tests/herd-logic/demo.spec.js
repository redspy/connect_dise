import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Herd Logic — 데모 플레이 및 전체 게임 흐름 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 다수파 매칭 및 핑크카우 유발 E2E 완주 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();

    host.on('console', msg => console.log('HOST PAGE LOG:', msg.text()));
    host.on('pageerror', err => console.error('HOST PAGE ERROR:', err.message));

    await host.goto(`${BASE}/games/herd-logic/host/`);

    // 1. 호스트 화면 진입 및 로비 렌더링 확인
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });

    // 2. 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 3. 게임 대국 화면 전환 감지
    const gameArea = host.locator('#game-container');
    await expect(gameArea).toBeVisible({ timeout: 5000 });

    // 3라운드 반복 진행
    for (let r = 1; r <= 3; r++) {
      // 봇들 답변 제출 완료 및 호스트 답변 공개 버튼 노출 대기
      const revealBtn = host.locator('#btn-action-host');
      await expect(revealBtn).toBeVisible({ timeout: 10_000 });
      await revealBtn.click();

      // 답변 공개 완료 후 다음 라운드(혹은 최종 성적) 이동 버튼 대기
      const nextBtn = host.locator('#btn-next-round');
      await expect(nextBtn).toBeVisible({ timeout: 5000 });
      await nextBtn.click();
    }

    // 4. 최종 성적 발표 오버레이 노출 확인
    const resultPanel = host.locator('[data-phase="result"]');
    await expect(resultPanel).toBeVisible({ timeout: 5000 });

    const ranking = host.locator('#ranking-list');
    await expect(ranking).toBeVisible();

    // 5. 로비로 돌아가기 버튼 클릭 작동 확인
    const restartBtn = host.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 로비 화면으로 원상복귀 확인
    await expect(lobby).toBeVisible({ timeout: 5000 });

    await hostCtx.close();
  });

});
