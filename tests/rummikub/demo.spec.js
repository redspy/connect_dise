import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('루미큐브 — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 2인 가상 봇 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/rummikub/host/`);

    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 카운트다운 → 게임 시작 → 보드 렌더링 확인
    const board = host.locator('#rk-board');
    await expect(board).toBeVisible({ timeout: 20_000 });
    const playersPanel = host.locator('.rk-player-card').first();
    await expect(playersPanel).toBeVisible({ timeout: 10_000 });

    await hostCtx.close();
  });

});
