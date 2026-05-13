/**
 * 그림 릴레이 E2E 테스트
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
  await page.goto(`${BASE}/games/relay-drawing/mobile/?session=${sessionId}`);
  return page;
}

/** 닉네임 입력 → 참여 → 준비 완료 */
async function joinAndReady(page, nickname) {
  await page.locator('#nickname').waitFor({ timeout: 10_000 });
  await page.fill('#nickname', nickname);
  await page.click('#joinBtn');
  await page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 10_000 });
  await page.click('#readyBtn');
}

/** 캔버스에 간단한 선 하나를 시뮬레이션 */
async function drawOnCanvas(page) {
  const canvas = page.locator('#drawingCanvas');
  await canvas.waitFor({ timeout: 10_000 });
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 40, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 80, { steps: 8 });
  await page.mouse.move(box.x + 80,  box.y + 140, { steps: 8 });
  await page.mouse.up();
}

// ── 테스트 ───────────────────────────────────────────────────────────────────

test.describe('그림 릴레이 — 2인 게임', () => {

  test('로비: 2명 접속 및 준비 확인', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/relay-drawing/host/`);

    await host.locator('html[data-session-id]').waitFor({ timeout: 15_000 });
    const sid = await host.getAttribute('html', 'data-session-id');
    expect(sid).toMatch(/^[A-Z0-9]{4,8}$/i);

    const pages = [];
    for (const nick of ['Alice', 'Bob']) {
      const p = await openMobile(browser, sid);
      await p.locator('#nickname').waitFor({ timeout: 10_000 });
      await p.fill('#nickname', nick);
      await p.click('#joinBtn');
      await p.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 10_000 });
      pages.push(p);
    }

    // 호스트 로비에 두 플레이어 표시 확인
    await expect(host.locator('game-lobby')).toContainText('Alice');
    await expect(host.locator('game-lobby')).toContainText('Bob');

    // 준비 완료 → 시작 버튼 활성화 확인
    for (const p of pages) await p.click('#readyBtn');
    await host.locator('game-lobby .lobby-start-btn:not([disabled])').waitFor({ timeout: 10_000 });
    await expect(host.locator('game-lobby .lobby-start-btn')).toHaveText('게임 시작!');

    await hostCtx.close();
    for (const p of pages) await p.context().close();
  });

  test('2라운드 전체 플로우: 그리기 → 단어 → 결과 발표 → 종료', async ({ browser }) => {
    // ── 호스트 열기 ──────────────────────────────────────────────────────────
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/relay-drawing/host/`);

    await host.locator('html[data-session-id]').waitFor({ timeout: 15_000 });
    const sid = await host.getAttribute('html', 'data-session-id');

    // ── 모바일 2명 접속 & 준비 ───────────────────────────────────────────────
    const players = [
      { name: 'Alice', page: await openMobile(browser, sid) },
      { name: 'Bob',   page: await openMobile(browser, sid) },
    ];

    for (const { page, name } of players) {
      await joinAndReady(page, name);
    }

    // 시간 제한 없음 설정 (테스트가 제출 타이밍을 제어)
    await host.selectOption('#timeLimit', '0');

    // ── 호스트: 시작 버튼 클릭 ──────────────────────────────────────────────
    await host.locator('game-lobby .lobby-start-btn:not([disabled])').waitFor({ timeout: 15_000 });
    await host.click('game-lobby .lobby-start-btn');

    // ── 인트로 카운트다운(3s) 후 game 페이즈 ─────────────────────────────────
    await host.locator('[data-phase="game"]:not(.hidden)').waitFor({ timeout: 20_000 });
    await expect(host.locator('#gameClock')).toContainText('∞'); // 무제한 확인

    // ── Round 1: 그리기 ───────────────────────────────────────────────────────
    for (const { page } of players) {
      await page.locator('[data-screen="draw"]:not(.hidden)').waitFor({ timeout: 15_000 });
      // 주제(프롬프트) 표시 확인
      await expect(page.locator('#drawTopic')).not.toBeEmpty();
      // 캔버스에 선 그리기
      await drawOnCanvas(page);
      // 제출
      await page.click('#submitDrawBtn');
      await page.locator('[data-screen="standby"]:not(.hidden)').waitFor({ timeout: 5_000 });
    }

    // ── Round 2: 단어 (라운드 전환 2s 대기 후 roundAssignments broadcast) ────
    for (const { page } of players) {
      await page.locator('[data-screen="word"]:not(.hidden)').waitFor({ timeout: 15_000 });
      // 이전 라운드의 그림 표시 확인
      await expect(page.locator('#previousDrawing')).toBeVisible();
      // 설명 입력 후 제출
      await page.fill('#wordGuess', '테스트 그림 묘사');
      await page.click('#submitWordBtn');
      await page.locator('[data-screen="standby"]:not(.hidden)').waitFor({ timeout: 5_000 });
    }

    // ── 결과 발표 페이즈 ─────────────────────────────────────────────────────
    await host.locator('[data-phase="result"]:not(.hidden)').waitFor({ timeout: 15_000 });

    // 모바일: spectate 화면
    for (const { page } of players) {
      await page.locator('[data-screen="spectate"]:not(.hidden)').waitFor({ timeout: 10_000 });
    }

    // ── 이야기 1 자동 재생 → 버튼 활성화 ────────────────────────────────────
    // 각 스텝이 2.5s 간격으로 표시되므로 최대 20s 대기
    await host.locator('#nextStoryBtn:not([disabled])').waitFor({ timeout: 20_000 });
    await host.click('#nextStoryBtn');

    // ── 이야기 2 자동 재생 → "결과 마치기" 버튼 활성화 ─────────────────────
    await host.locator('#nextStoryBtn:not([disabled])').waitFor({ timeout: 20_000 });
    await expect(host.locator('#nextStoryBtn')).toHaveText('결과 마치기');
    await host.click('#nextStoryBtn');

    // ── Final 페이즈 ─────────────────────────────────────────────────────────
    await host.locator('[data-phase="final"]:not(.hidden)').waitFor({ timeout: 10_000 });

    // ── 결과 이미지 공유: final 페이즈 버튼 → 미리보기 모달 ───────────────
    await expect(host.locator('.rd-share-trigger').last()).toBeVisible();
    await host.locator('.rd-share-trigger').last().click();

    // 이미지 생성 후 모달 표시 (PNG data URL 확인)
    await host.locator('#sharePreviewOverlay:not(.hidden)').waitFor({ timeout: 15_000 });
    await expect(host.locator('#sharePreviewImg')).toHaveAttribute('src', /^data:image\/png/);
    await expect(host.locator('#shareDownloadBtn')).toBeVisible();

    // 닫기 버튼
    await host.click('#shareCloseBtn');
    await expect(host.locator('#sharePreviewImg')).not.toBeVisible();

    // 정리
    await hostCtx.close();
    for (const { page } of players) await page.context().close();
  });

  test('결과 이미지 공유: result 페이즈에서도 버튼 동작 확인', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/relay-drawing/host/`);

    await host.locator('html[data-session-id]').waitFor({ timeout: 15_000 });
    const sid = await host.getAttribute('html', 'data-session-id');

    const players = [
      { name: 'Alice', page: await openMobile(browser, sid) },
      { name: 'Bob',   page: await openMobile(browser, sid) },
    ];
    for (const { page, name } of players) await joinAndReady(page, name);

    await host.selectOption('#timeLimit', '0');
    await host.locator('game-lobby .lobby-start-btn:not([disabled])').waitFor({ timeout: 15_000 });
    await host.click('game-lobby .lobby-start-btn');

    await host.locator('[data-phase="game"]:not(.hidden)').waitFor({ timeout: 20_000 });

    // Round 1 & 2 빠르게 진행
    for (const { page } of players) {
      await page.locator('[data-screen="draw"]:not(.hidden)').waitFor({ timeout: 15_000 });
      await drawOnCanvas(page);
      await page.click('#submitDrawBtn');
    }
    for (const { page } of players) {
      await page.locator('[data-screen="word"]:not(.hidden)').waitFor({ timeout: 15_000 });
      await page.fill('#wordGuess', '테스트');
      await page.click('#submitWordBtn');
    }

    // Result 페이즈에서 공유 버튼 확인
    await host.locator('[data-phase="result"]:not(.hidden)').waitFor({ timeout: 15_000 });
    await expect(host.locator('.rd-share-trigger').first()).toBeVisible();
    await host.locator('.rd-share-trigger').first().click();

    await host.locator('#sharePreviewOverlay:not(.hidden)').waitFor({ timeout: 15_000 });
    await expect(host.locator('#sharePreviewImg')).toHaveAttribute('src', /^data:image\/png/);

    await host.click('#shareCloseBtn');

    await hostCtx.close();
    for (const { page } of players) await page.context().close();
  });

});
