/**
 * Dixit E2E 테스트
 *
 * 전제 조건:
 *   - `npm run dev` 로 개발 서버(https://localhost:5173 + http://localhost:3000) 실행 중
 *   - `npx playwright install chromium` 으로 브라우저 설치 완료
 */

import { test, expect } from '@playwright/test';

const BASE = 'https://localhost:5173';

// ── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 세션 ID 취득 (호스트 페이지가 <html data-session-id="..."> 를 세팅할 때까지 대기) */
async function getSessionId(hostPage) {
  await hostPage.locator('html[data-session-id]').waitFor({ timeout: 15_000 });
  return hostPage.getAttribute('html', 'data-session-id');
}

/** 모바일 페이지 생성 후 세션에 접속 */
async function openMobile(browser, sessionId) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/games/dixit/mobile/?session=${sessionId}`);
  return page;
}

/** 닉네임 입력 → 참여 → 준비 완료 */
async function joinAndReady(page, nickname) {
  await page.locator('#nickname-input').waitFor({ timeout: 10_000 });
  await page.fill('#nickname-input', nickname);
  await page.click('#btn-join');
  await page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 10_000 });
  await page.click('#btn-ready');
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

test.describe('Dixit — 3인 게임', () => {

  test('로비: 3명 접속 및 세션 ID 확인', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/dixit/host/`);

    const sid = await getSessionId(host);
    expect(sid).toMatch(/^[A-Z0-9]{4,8}$/i);

    // 3명 접속
    const pages = [];
    for (const nick of ['Alice', 'Bob', 'Charlie']) {
      const p = await openMobile(browser, sid);
      await p.locator('#nickname-input').waitFor({ timeout: 10_000 });
      await p.fill('#nickname-input', nick);
      await p.click('#btn-join');
      await p.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 10_000 });
      pages.push(p);
    }

    // 호스트 로비에 3명 표시 확인
    await expect(host.locator('game-lobby')).toBeVisible();
    for (const nick of ['Alice', 'Bob', 'Charlie']) {
      await expect(host.locator('game-lobby')).toContainText(nick);
    }

    await hostCtx.close();
    for (const p of pages) await p.context().close();
  });

  test('1라운드 전체 플로우: 이야기꾼 → 카드 제출 → 투표 → 결과', async ({ browser }) => {
    // ── 호스트 열기 ──────────────────────────────────────────────────────────
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/dixit/host/`);
    const sid = await getSessionId(host);

    // ── 모바일 3명 접속 & 준비 ───────────────────────────────────────────────
    const players = [
      { name: 'Alice', page: await openMobile(browser, sid) },
      { name: 'Bob',   page: await openMobile(browser, sid) },
      { name: 'Carol', page: await openMobile(browser, sid) },
    ];

    for (const { page, name } of players) {
      await joinAndReady(page, name);
    }

    // ── 게임 시작: 호스트 storytelling 페이즈 ────────────────────────────────
    await host.locator('[data-phase="storytelling"]:not(.hidden)').waitFor({ timeout: 20_000 });
    await expect(host.locator('#storyteller-name')).toBeVisible();

    // ── 이야기꾼 식별 ─────────────────────────────────────────────────────────
    // 세 페이지 중 가장 먼저 storyteller-clue 화면을 보이는 쪽이 이야기꾼
    const storytellerIndex = await Promise.race(
      players.map(({ page }, i) =>
        page
          .locator('[data-screen="storyteller-clue"]:not(.hidden)')
          .waitFor({ timeout: 15_000 })
          .then(() => i),
      ),
    );

    const storyteller = players[storytellerIndex].page;
    const followers   = players.filter((_, i) => i !== storytellerIndex).map(p => p.page);

    // ── 이야기꾼: 카드 선택 → 힌트 입력 → 제출 ──────────────────────────────
    const firstCard = storyteller.locator('#storyteller-hand .dx-card-img').first();
    await firstCard.waitFor({ timeout: 10_000 });
    await firstCard.click();

    await storyteller.fill('#clue-input', '꿈꾸는 여행');
    await storyteller.locator('#submit-clue-btn:not([disabled])').waitFor({ timeout: 5_000 });
    await storyteller.click('#submit-clue-btn');

    // ── 호스트 card-selection 페이즈 ─────────────────────────────────────────
    await host.locator('[data-phase="card-selection"]:not(.hidden)').waitFor({ timeout: 10_000 });
    await expect(host.locator('#current-clue')).toContainText('꿈꾸는 여행');

    // ── 팔로워: 카드 선택 → 제출 ─────────────────────────────────────────────
    for (const page of followers) {
      await page.locator('[data-screen="card-select"]:not(.hidden)').waitFor({ timeout: 10_000 });
      await page.locator('#follower-hand .dx-card-img').first().click();
      await page.locator('#submit-card-btn:not([disabled])').waitFor({ timeout: 5_000 });
      await page.click('#submit-card-btn');
    }

    // ── 호스트 voting 페이즈 ──────────────────────────────────────────────────
    await host.locator('[data-phase="voting"]:not(.hidden)').waitFor({ timeout: 10_000 });

    // ── 팔로워: 투표 (자신의 카드 제외) ──────────────────────────────────────
    for (const page of followers) {
      await page.locator('[data-screen="vote"]:not(.hidden)').waitFor({ timeout: 10_000 });

      // my-submitted 클래스가 없는 투표 카드 선택
      const votableCard = page.locator('#voting-board .dx-vote-card-wrap:not(.my-submitted)').first();
      await votableCard.waitFor({ timeout: 5_000 });
      await votableCard.click();

      await page.locator('#submit-vote-btn:not([disabled])').waitFor({ timeout: 5_000 });
      await page.click('#submit-vote-btn');
    }

    // ── 호스트 round-result 페이즈 ────────────────────────────────────────────
    await host.locator('[data-phase="round-result"]:not(.hidden)').waitFor({ timeout: 10_000 });
    await expect(host.locator('#round-conclusion')).toBeVisible();

    // ── 모바일 결과 화면 & 점수 확인 ─────────────────────────────────────────
    for (const { page } of players) {
      await page.locator('[data-screen="round-result"]:not(.hidden)').waitFor({ timeout: 10_000 });
      await expect(page.locator('#my-score')).toBeVisible();
    }

    // 정리
    await hostCtx.close();
    for (const { page } of players) await page.context().close();
  });

});
