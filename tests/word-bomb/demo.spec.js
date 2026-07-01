import { test, expect } from '@playwright/test';

test.describe('Word Bomb — 데모 플레이 및 전체 게임 흐름 E2E 테스트', () => {
  test('Attract Mode: 3인 가상 봇 실시간 단어 패스 릴레이 및 폭사 벌칙자 도출 검증', async ({ page }) => {
    // 1. 호스트 페이지 접속 (HTTPS)
    page.on('pageerror', err => console.log('HOST PAGE ERROR:', err.message));
    page.on('console', msg => console.log('HOST CONSOLE LOG:', msg.text()));

    await page.goto('https://localhost:5173/games/word-bomb/host/index.html');
    await expect(page.locator('.lobby-title')).toContainText('WORD BOMB');

    // 2. 카테고리 기동 확인
    const selectBox = page.locator('#category-select-box');
    await expect(selectBox).toBeVisible();
    await selectBox.selectOption('food'); // 맛있는 음식 카테고리 선택

    // 3. 데모 플레이 실행
    const demoBtn = page.locator('#demoPlayBtn');
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // 4. 플레이 페이즈 진입 및 타이머 째깍 개시 확인
    const playingOverlay = page.locator('[data-phase="playing"]');
    await expect(playingOverlay).not.toHaveClass(/hidden/);

    const canvas = page.locator('#bomb-canvas');
    await expect(canvas).toBeVisible();

    // 5. 봇들이 키워드를 읽고 빠르게 패스하여 성공 단어 개수가 늘어나는지 관찰
    const passedVal = page.locator('#hud-passed-count');
    
    // 최소 1개 이상의 단어가 5초 내에 통과될 때까지 대기
    await page.waitForFunction(
      () => {
        const text = document.getElementById('hud-passed-count')?.textContent || '0';
        return parseInt(text, 10) > 0;
      },
      { timeout: 7000 }
    );

    const passesAfterPlay = await passedVal.textContent();
    console.log(`[Word Bomb Demo] 봇 릴레이 성공 단어 수: ${passesAfterPlay}`);
    expect(parseInt(passesAfterPlay || '0', 10)).toBeGreaterThan(0);

    // 6. 데모 폭탄(10초) 폭사 종료 후 패배자 및 통과 스코어보드 노출 확인
    const resultOverlay = page.locator('[data-phase="result"]');
    await expect(resultOverlay).not.toHaveClass(/hidden/, { timeout: 15000 });

    const finalPassed = await page.locator('#result-passed-words').textContent();
    const loserName = await page.locator('#loser-name').textContent();

    console.log(`[Word Bomb Result] 최종 패스 수: ${finalPassed} / 패배 벌칙자: ${loserName}`);
    expect(parseInt(finalPassed || '0', 10)).toBeGreaterThan(0);
    expect(loserName).not.toBeNull();

    // 7. 대기실 복귀
    const restartBtn = page.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 8. 대기실 정상 역복구 검증
    const lobbyOverlay = page.locator('[data-phase="lobby"]');
    await expect(lobbyOverlay).not.toHaveClass(/hidden/);
  });
});
