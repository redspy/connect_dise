import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Dixit — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 딕싯 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/dixit/host/`);

    // 로비 로딩 대기
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 스토리텔링 진입 대기
    const storytellingPhase = host.locator('.dx-overlay[data-phase="storytelling"]');
    await storytellingPhase.waitFor({ timeout: 15_000 });

    // 카드 선택 단계 진입 대기 (봇이 힌트를 내면 자동으로 이 단계로 넘어감)
    const cardSelectionPhase = host.locator('.dx-overlay[data-phase="card-selection"]');
    await cardSelectionPhase.waitFor({ timeout: 15_000 });

    // 투표 단계 진입 대기 (봇들이 카드를 모두 제출하면 자동으로 이 단계로 넘어감)
    const votingPhase = host.locator('.dx-overlay[data-phase="voting"]');
    await votingPhase.waitFor({ timeout: 15_000 });

    await hostCtx.close();
  });

});
