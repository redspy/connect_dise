/**
 * 스파이를 찾아라! (hidden-agent) E2E 테스트
 *
 * 전제 조건:
 *   - `npm run dev` 로 개발 서버 실행 중
 */

import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

async function openMobile(browser, sessionId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/games/hidden-agent/mobile/?session=${sessionId}`);
  return page;
}

/** 닉네임 입력 → 참여 및 준비 완료 */
async function joinLobby(page, nickname) {
  await page.locator('#input-nickname').waitFor({ timeout: 10_000 });
  await page.fill('#input-nickname', nickname);
  await page.click('#btn-join');
  // 준비 완료 후 waiting 화면 전환 대기
  await page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 10_000 });
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

test.describe('스파이를 찾아라! — E2E 통합 테스트', () => {

  test('3인 플레이: 입장 ➔ 역할 배정 ➔ 힌트 제출 ➔ 투표 ➔ 결과 도출 ➔ 리셋', async ({ browser }) => {
    // 1. 호스트(TV) 대화면 열기
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/hidden-agent/host/`);

    await host.locator('html[data-session-id]').waitFor({ timeout: 15_000 });
    const sid = await host.getAttribute('html', 'data-session-id');
    expect(sid).toMatch(/^[A-Z0-9]{4,8}$/i);

    // 2. 3명의 플레이어 모바일 접속 및 로비 대기
    const playerNicks = ['Alice', 'Bob', 'Charlie'];
    const players = [];

    for (const nick of playerNicks) {
      const p = await openMobile(browser, sid);
      await joinLobby(p, nick);
      players.push({ name: nick, page: p });
    }

    // 호스트 로비 화면에 3명 정상 표기 및 시작 버튼 활성화 대기
    await expect(host.locator('game-lobby')).toContainText('Alice');
    await expect(host.locator('game-lobby')).toContainText('Bob');
    await expect(host.locator('game-lobby')).toContainText('Charlie');

    await host.locator('game-lobby .lobby-start-btn:not([disabled])').waitFor({ timeout: 10_000 });
    await expect(host.locator('game-lobby .lobby-start-btn')).toHaveText('게임 시작!');

    // 3. 호스트에서 시작 클릭
    await host.click('game-lobby .lobby-start-btn');

    // 4. Setup 페이즈 (역할 배정 중 연출 대기 - 5초)
    await host.locator('[data-phase="setup"]:not(.hidden)').waitFor({ timeout: 10_000 });
    
    // 모바일 기기별로 3D Flip Card 화면(role-reveal) 노출 확인
    for (const { page } of players) {
      await page.locator('[data-screen="role-reveal"]:not(.hidden)').waitFor({ timeout: 10_000 });
      // 카드 앞면 터치하여 뒤집기
      await page.click('#reveal-card-container');
      await page.locator('#reveal-card.flipped').waitFor({ timeout: 5_000 });
      
      // 내 제시어 데이터가 성공적으로 바인딩되었는지 확인
      const word = await page.textContent('#reveal-secret-word');
      expect(word).not.toBeNull();
      expect(word.trim()).not.toBe('');
    }

    // 5. Discussion 페이즈 (힌트 수집)
    await host.locator('[data-phase="discussion"]:not(.hidden)').waitFor({ timeout: 10_000 });

    for (const { page, name } of players) {
      await page.locator('[data-screen="submit-hint"]:not(.hidden)').waitFor({ timeout: 10_000 });
      // 단어 입력 후 전송
      await page.fill('#input-hint-word', `${name}힌트`);
      await page.click('#btn-submit-hint');
      await page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 5_000 });
    }

    // 호스트 화면에 단어 제출 수 완료 표시 및 둥둥 떠다니는 거품 개수 확인
    await expect(host.locator('#submit-status-text')).toContainText('제출 현황: 3 / 3명');
    const bubblesCount = await host.locator('.floating-bubble').count();
    expect(bubblesCount).toBe(3);

    // 6. Voting 페이즈 (스파이 지목 투표)
    await host.locator('[data-phase="voting"]:not(.hidden)').waitFor({ timeout: 10_000 });

    for (const { page } of players) {
      await page.locator('[data-screen="vote"]:not(.hidden)').waitFor({ timeout: 10_000 });
      
      // 나를 제외한 타 플레이어 지목 버튼 중 첫 번째 클릭
      const firstVoteBtn = page.locator('.vote-item-btn').first();
      await firstVoteBtn.waitFor({ timeout: 5_000 });
      
      // confirm 창 자동 허용 설정 수반(Playwright는 confirm 모달 자동 승인함)
      page.once('dialog', async dialog => {
        await dialog.accept();
      });
      await firstVoteBtn.click();
      await page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 5_000 });
    }

    // 호스트 투표완료 실시간 연계 표시 확인
    await expect(host.locator('#vote-status-text')).toContainText('투표 완료: 3 / 3명');

    // 7. Result 페이즈 (승리 배너 확인)
    await host.locator('[data-phase="result"]:not(.hidden)').waitFor({ timeout: 10_000 });
    await expect(host.locator('#winner-banner-text')).toBeVisible();

    // 8. 처음으로 리셋
    await host.click('#btn-restart');

    // 호스트 및 모바일이 lobby/setup-profile 상태로 리셋되었는지 확인
    await host.locator('[data-phase="lobby"]:not(.hidden)').waitFor({ timeout: 10_000 });
    
    // 정리
    await hostCtx.close();
    for (const { page } of players) await page.context().close();
  });

});
