import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Panic Cockpit — 데모 플레이 및 전체 게임 흐름 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 실시간 협동 데모 비행 완료 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1920, height: 1080 } });
    const host = await hostCtx.newPage();

    // 콘솔 로그 및 페이지 에러 추적 리스너 추가
    host.on('console', msg => console.log('HOST PAGE LOG:', msg.text()));
    host.on('pageerror', err => console.error('HOST PAGE ERROR:', err.message));

    await host.goto(`${BASE}/games/panic-cockpit/host/`);

    // 1. 호스트 화면 진입 및 로비 렌더링 확인
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });

    // 2. 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 3. 게임 대국 화면 전환 감지
    const hud = host.locator('#cockpit-container');
    await expect(hud).toBeVisible({ timeout: 5000 });

    // 4. 실시간 명령어 카드 리스트 노출 확인
    const commandList = host.locator('#active-commands-list');
    await expect(commandList).toBeVisible({ timeout: 5000 });

    // 최소 하나 이상의 명령어 카드가 생성되었는지 검증
    const firstCard = commandList.locator('.command-card').first();
    await expect(firstCard).toBeVisible({ timeout: 5000 });

    // 5. 비행 완료 또는 선체 완파 결과 도출 화면 대기 (최대 60초)
    const resultPanel = host.locator('[data-phase="result"]');
    await expect(resultPanel).toBeVisible({ timeout: 60_000 });

    // 6. 결과 메시지 유효성 검증
    const resultMessage = host.locator('#result-message');
    await expect(resultMessage).not.toBeEmpty();

    // 7. 로비로 복귀 버튼 작동 확인
    const restartBtn = host.locator('#btn-restart-result');
    await expect(restartBtn).toBeVisible();
    await restartBtn.click();

    // 로비 화면으로 다시 복귀했는지 확인
    await expect(lobby).toBeVisible({ timeout: 5000 });

    await hostCtx.close();
  });

});
