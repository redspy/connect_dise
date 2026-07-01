import { test, expect } from '@playwright/test';

test.describe('Pit Trade — 데모 플레이 및 실시간 거래 매칭 E2E 테스트', () => {
  test.beforeEach(async ({ page }) => {
    // HTTPS 자가서명 인증서 가드 통과 및 게임 호스트 페이지 접속
    await page.goto('https://localhost:5173/games/pit-trade/host/');
  });

  test('Attract Mode: 3인 가상 봇 실시간 카드 교환 및 시장 독점 완료 후 종 울리기 검증', async ({ page }) => {
    // 1. 호스트 페이지 접속 (HTTPS)
    page.on('pageerror', err => console.log('HOST PAGE ERROR:', err.message));
    page.on('console', msg => console.log('HOST CONSOLE LOG:', msg.text()));

    await page.goto('https://localhost:5173/games/pit-trade/host/');
    const title = page.locator('.title');
    await expect(title).toContainText('왁자지껄 거래소');

    // 2. 데모 플레이 시작 버튼 클릭
    const demoPlayBtn = page.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 3. 게임 화면으로 전사(Phase Transition) 완료 확인
    const gameOverlay = page.locator('.phase-overlay[data-phase="game"]');
    await expect(gameOverlay).not.toHaveClass(/hidden/, { timeout: 8000 });

    console.log('[Pit Trade Demo] 실시간 거래소 개장 완료. 봇 카드 교환 모니터링 시작...');

    // 4. 가상 봇들이 실시간으로 카드를 교환하며 시장 독점을 달성할 때까지 결과 화면 감시 (최대 30초 대기)
    const resultOverlay = page.locator('.phase-overlay[data-phase="result"]');
    await expect(resultOverlay).not.toHaveClass(/hidden/, { timeout: 35000 });

    const winnerName = await page.locator('#winner-name').textContent();
    console.log(`[Pit Trade Result] 시장 독점 성공! 우승 상인: ${winnerName}`);
    expect(winnerName).not.toBe('');

    // 5. 랭킹 스코어보드 정보 존재 여부 확인
    const rankingRows = page.locator('.ranking-row');
    const rowCount = await rankingRows.count();
    console.log(`[Pit Trade Result] 집계 완료된 스코어보드 랭킹 수: ${rowCount}`);
    expect(rowCount).toBeGreaterThanOrEqual(3);

    // 6. 복귀 버튼 클릭하여 로비 상태로 원복 확인
    const restartBtn = page.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 7. 로비 오버레이 복구 확인
    const lobbyOverlay = page.locator('.phase-overlay[data-phase="lobby"]');
    await expect(lobbyOverlay).not.toHaveClass(/hidden/);
    console.log('[Pit Trade Demo] 로비 리셋 및 복구 검증 완료!');
  });
});
