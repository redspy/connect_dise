import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Spin Battle — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 팽이 배틀 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/spin-battle/host/`);

    // 로비 대기
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 런칭 단계 진입 대기
    await host.locator('.spin-overlay[data-phase="launching"]').waitFor({ timeout: 15_000 });

    // 배틀 시작 대기 (카운트다운 포함하여 각 봇들의 RPM 바 렌더링 확인)
    await host.locator('#rpm-fill-bot_amy').waitFor({ timeout: 15_000 });
    await expect(host.locator('#rpm-fill-bot_bob')).toBeVisible({ timeout: 10_000 });
    await expect(host.locator('#rpm-fill-bot_charles')).toBeVisible({ timeout: 10_000 });

    await hostCtx.close();
  });

});
