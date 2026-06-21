import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Give You Fire — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 캠프파이어 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/give-you-fire/host/`);

    // 로비 대기
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 대시보드 렌더링 확인
    const firstCard = host.locator('.gyf-player-card').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });

    await hostCtx.close();
  });

});
