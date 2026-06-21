import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Dice — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 주사위 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/dice/host/`);

    // 주사위 박스 대기
    await host.locator('#dice-box').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 봇 가상 접속 수 확인
    const playerStatus = host.locator('#player-status');
    await expect(playerStatus).toHaveText('3 Player(s) connected and ready!', { timeout: 10_000 });

    // 주사위 던지기 시작 상태 확인
    await expect(playerStatus).toHaveText('Rolling dice!! 🎲', { timeout: 10_000 });

    await hostCtx.close();
  });

});
