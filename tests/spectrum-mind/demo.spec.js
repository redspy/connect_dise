import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('Spectrum Mind — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 스펙트럼 마인드 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/spectrum-mind/host/`);

    // 로비 오버레이 및 룸 코드 초기화 감지
    const lobby = host.locator('game-lobby');
    await lobby.waitFor({ timeout: 15_000 });
    const code = lobby.locator('.lobby-session-code');
    await expect(code).toBeVisible({ timeout: 5000 });
    await expect(code).not.toHaveText('------', { timeout: 10_000 });

    // 데모 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 1단계: 출제자 힌트 입력 대기 화면 노출 확인
    const giverProfile = host.locator('.sm-giver-profile');
    await expect(giverProfile).toBeVisible({ timeout: 5000 });

    // 2단계: 자동 제시어 입력 후 추측 단계 진입 검증
    const clueWord = host.locator('#display-clue');
    await expect(clueWord).toBeVisible({ timeout: 10_000 });
    await expect(clueWord).not.toHaveText('제시어 대기');

    // 3단계: 다이얼 캔버스 로드 및 가상 바늘 회전 감지
    const canvas = host.locator('#sm-dial-canvas');
    await expect(canvas).toBeVisible({ timeout: 5000 });

    // 4단계: 가상 봇 회전 완료 후 점수 공개 영역 검증
    const nextRoundBtn = host.locator('#btn-next-round');
    await expect(nextRoundBtn).toBeVisible({ timeout: 15_000 });

    await hostCtx.close();
  });

});
