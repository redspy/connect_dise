import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Dobble — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 도블 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/dobble/host/`);

    // 로비 로딩 대기
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 게임 화면 진입 대기
    await host.locator('#game-board').waitFor({ timeout: 15_000 });

    // 봇들이 매칭 탭 성공해서 점수가 올라가는지 확인
    // 누군가 점수를 획득하여 1점 이상이 되는 카드가 나올 때까지 대기
    const firstScore = host.locator('.db-sc-score').first();
    await expect(firstScore).not.toContainText('0 / 10', { timeout: 30_000 });

    await hostCtx.close();
  });

});
