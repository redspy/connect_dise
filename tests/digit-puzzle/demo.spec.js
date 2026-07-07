import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Digit Puzzle — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 슬라이딩 퍼즐 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/digit-puzzle/host/`);

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

    // 데모 진행 배너 렌더링 확인
    const demoBanner = host.locator('#demoActiveBanner');
    await expect(demoBanner).toBeVisible({ timeout: 5000 });

    // 대시보드 진행 카드 렌더링 확인
    const firstCard = host.locator('.dp-dash-card').first();
    await expect(firstCard).toBeVisible({ timeout: 15_000 });

    // 데모가 진행되어 봇 중 누군가 완성하고 결과 오버레이가 보일 때까지 대기
    const resultOverlay = host.locator('.dp-overlay[data-phase="result"]');
    await expect(resultOverlay).toBeVisible({ timeout: 35_000 });

    // 결과 랭킹 아이템들이 그려졌는지 확인
    const rankings = host.locator('#result-rankings .dp-rank-item');
    await expect(rankings).toHaveCount(3, { timeout: 5000 });

    // 자동 리셋되어 로비 오버레이가 다시 보이는지 검증
    const lobbyOverlay = host.locator('.dp-overlay[data-phase="lobby"]');
    await expect(lobbyOverlay).toBeVisible({ timeout: 15_000 });

    await hostCtx.close();
  });

});
