import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Trading Battle — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 단타대회 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/trading-battle/host/`);

    // 로비 대기
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 트레이딩 보드 활성화 대기
    const board = host.locator('#game-board');
    await expect(board).toBeVisible({ timeout: 15_000 });

    // 플레이어 패널들이 생성되었는지 확인
    const firstPanel = host.locator('.player-panel').first();
    await expect(firstPanel).toBeVisible({ timeout: 10_000 });

    await hostCtx.close();
  });

});
