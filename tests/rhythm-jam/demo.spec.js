import { test, expect } from '@playwright/test';

test.describe('Rhythm Jam — 데모 플레이 및 전체 게임 흐름 E2E 테스트', () => {
  test('Attract Mode: 3인 가상 봇 실시간 오케스트라 데모 연주 및 결과 도출 검증', async ({ page }) => {
    // 1. 호스트 페이지 접속
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('console', msg => console.log('CONSOLE:', msg.text()));

    await page.goto('https://localhost:5173/games/rhythm-jam/host/index.html');
    await expect(page.locator('.lobby-title')).toContainText('RHYTHM JAM');

    // 2. 수록곡 정보 선택 확인
    const selectBox = page.locator('#track-select-box');
    await expect(selectBox).toBeVisible();
    await selectBox.selectOption('disco');

    // 3. 데모 플레이 실행
    const demoBtn = page.locator('#demoPlayBtn');
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // 4. 플레이 페이즈 진입 및 HUD 점수 갱신 확인
    const playingOverlay = page.locator('[data-phase="playing"]');
    await expect(playingOverlay).not.toHaveClass(/hidden/);

    const canvas = page.locator('#stage-canvas');
    await expect(canvas).toBeVisible();

    // 5. 봇들이 리드미컬하게 연주하여 점수가 상승하는지 관찰
    const scoreVal = page.locator('#hud-score');
    
    // 점수가 0보다 큰 값으로 상승할 때까지 최대 5초 대기
    await page.waitForFunction(
      () => {
        const scoreText = document.getElementById('hud-score')?.textContent || '0';
        return parseInt(scoreText, 10) > 0;
      },
      { timeout: 5000 }
    );

    const scoreAfterPlay = await scoreVal.textContent();
    console.log(`[Rhythm Jam Demo] 봇 연주 누적 점수: ${scoreAfterPlay}`);
    expect(parseInt(scoreAfterPlay || '0', 10)).toBeGreaterThan(0);

    // 6. 데모 연주(8초) 종료 후 결과 랭크 및 스코어 보드 노출 확인
    const resultOverlay = page.locator('[data-phase="result"]');
    await expect(resultOverlay).not.toHaveClass(/hidden/, { timeout: 12000 });

    const finalScore = await page.locator('#result-score').textContent();
    const finalAccuracy = await page.locator('#result-accuracy').textContent();
    const finalGrade = await page.locator('#result-grade').textContent();

    console.log(`[Rhythm Jam Result] 최종 점수: ${finalScore} / 정확도: ${finalAccuracy} / 등급: ${finalGrade}`);
    expect(parseInt(finalScore || '0', 10)).toBeGreaterThan(0);

    // 7. 로비 복귀 클릭
    const restartBtn = page.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 8. 로비 상태 복구 확인
    const lobbyOverlay = page.locator('[data-phase="lobby"]');
    await expect(lobbyOverlay).not.toHaveClass(/hidden/);
  });
});
