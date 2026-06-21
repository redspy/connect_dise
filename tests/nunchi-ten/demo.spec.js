import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

test.describe('눈치 10단 — 데모 플레이 E2E 테스트', () => {

  test('Attract Mode: 3인 가상 봇 눈치 10단 데모 자동화 풀플로우 검증', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/nunchi-ten/host/`);

    // 로비 로딩 대기
    await host.locator('game-lobby').waitFor({ timeout: 15_000 });

    // 데모 플레이 실행 버튼 클릭
    const demoPlayBtn = host.locator('#demoPlayBtn');
    await expect(demoPlayBtn).toBeVisible();
    await demoPlayBtn.click();

    // 1라운드 카드 정산 화면으로 넘어갈 때까지 대기 (봇 자동 제출 ➔ 라운드 정산 진입)
    await host.locator('.n-overlay[data-phase="round_reveal"]:not(.hidden)').waitFor({ timeout: 25_000 });
    
    // 결과 테이블에 봇들의 이름이 들어있는지 확인
    await expect(host.locator('#reveal-cards')).toContainText('🤖 에이미 봇');
    await expect(host.locator('#reveal-cards')).toContainText('🤖 밥 봇');
    await expect(host.locator('#reveal-cards')).toContainText('🤖 찰리 봇');

    await hostCtx.close();
  });

});
