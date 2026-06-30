import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Omok — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: AI vs AI 자율 대국 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/omok/host/`);

    // 로비 대기 및 방 코드 설정 대기 (onclick 바인딩 레이스 방지)
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });
    const code = lobby.locator('.lobby-session-code');
    await expect(code).toBeVisible({ timeout: 5000 });
    await expect(code).not.toHaveText('------', { timeout: 10_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 첫 돌이 판 위에 놓이는지 확인
    const firstStone = host.locator('.stone-piece').first();
    await expect(firstStone).toBeVisible({ timeout: 10_000 });

    await hostCtx.close();
  });

});
