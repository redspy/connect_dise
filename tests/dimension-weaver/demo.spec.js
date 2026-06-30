import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Dimension Weaver — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 실시간 시공간 장애물 격파 및 골인 E2E 완주 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();

    host.on('console', msg => console.log('HOST PAGE LOG:', msg.text()));
    host.on('pageerror', err => console.error('HOST PAGE ERROR:', err.stack || err.message));

    await host.goto(`${BASE}/games/dimension-weaver/host/`);

    // 1. 로비 감지
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });

    // 2. 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 3. 게임 플레이 컨테이너 감지
    const gameArea = host.locator('#game-container');
    await expect(gameArea).toBeVisible({ timeout: 5000 });

    // 4. 러너 달리기 및 장애물 격파 완주 대기
    // 데모 모드에서는 20m 골인 지점을 향해 4 blocks/sec의 속도로 질주하므로 10초 내 결과 발표에 도달해야 함.
    const resultPanel = host.locator('[data-phase="result"]');
    await expect(resultPanel).toBeVisible({ timeout: 15_000 });

    // 5. 로비 리셋 복귀 검증
    const restartBtn = host.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 로비 화면으로 무사 복귀 확인
    await expect(lobby).toBeVisible({ timeout: 5000 });

    await hostCtx.close();
  });

});
