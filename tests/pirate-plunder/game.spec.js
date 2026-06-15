/**
 * 해적의 전리품 (pirate-plunder) E2E 테스트
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
  await page.goto(`${BASE}/games/pirate-plunder/mobile/?session=${sessionId}`);
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

test.describe("해적의 전리품 — E2E 통합 테스트", () => {
  test.setTimeout(90_000); // 5라운드 완주를 위해 타임아웃을 90초로 연장

  test('3인 플레이: 입장 ➔ 5라운드 진행(Lookout 포함) ➔ 결과 도출 ➔ 리셋', async ({ browser }) => {
    // 1. 호스트(TV) 대화면 열기
    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    await host.goto(`${BASE}/games/pirate-plunder/host/`);

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

    // 5개 라운드를 차례대로 시뮬레이션
    for (let r = 1; r <= 5; r++) {
      console.log(`--- Round ${r} Start ---`);

      // 4. Setup 페이즈 대기
      await host.locator('[data-phase="setup"]:not(.hidden)').waitFor({ timeout: 10_000 });

      // 모바일 기기별로 역할 배정 화면(role-reveal) 노출 확인
      const playerStates = []; // { name, page, role }
      for (const p of players) {
        await p.page.locator('[data-screen="role-reveal"]:not(.hidden)').waitFor({ timeout: 10_000 });
        
        // 역할 텍스트 확인
        const roleTitleText = await p.page.textContent('#role-title');
        const role = roleTitleText.includes('망보기') ? 'lookout' : 'pirate';
        playerStates.push({ name: p.name, page: p.page, role });
      }

      // 3인 중 딱 1명만 망보기(lookout) 역할이어야 함
      const lookouts = playerStates.filter(ps => ps.role === 'lookout');
      const pirates = playerStates.filter(ps => ps.role === 'pirate');
      expect(lookouts.length).toBe(1);
      expect(pirates.length).toBe(2);

      // 5. Negotiation 페이즈 (협상 및 결정 제출)
      await host.locator('[data-phase="negotiation"]:not(.hidden)').waitFor({ timeout: 10_000 });

      // 망보기 플레이어는 대기 화면으로 가 있어야 함
      const lookoutPlayer = lookouts[0];
      await expect(lookoutPlayer.page.locator('[data-screen="waiting"]:not(.hidden)')).toBeVisible();

      // 해적 플레이어 2명은 의사 결정 제출
      // 라운드 1일 때만 슬라이더 잠금 해제와 훔치기(Steal) 동작을 검증함
      if (r === 1) {
        const p1 = pirates[0];
        const p2 = pirates[1];

        // p1은 Split 선택
        await p1.page.locator('[data-screen="negotiation"]:not(.hidden)').waitFor({ timeout: 5_000 });
        await p1.page.click('#btn-split');
        await p1.page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 5_000 });

        // p2는 Steal 선택 (슬라이더 밀어야 함)
        await p2.page.locator('[data-screen="negotiation"]:not(.hidden)').waitFor({ timeout: 5_000 });
        const handle = p2.page.locator('#steal-slider-handle');
        const track = p2.page.locator('#steal-slider-track');
        const box = await track.boundingBox();
        
        if (box) {
          // 슬라이더 드래그 시뮬레이션
          await handle.hover();
          await p2.page.mouse.down();
          await p2.page.mouse.move(box.x + box.width - 10, box.y + box.height / 2, { steps: 5 });
          await p2.page.mouse.up();
        }

        // Steal 버튼 활성화 대기 및 탭
        await p2.page.locator('#btn-steal:not(.disabled)').waitFor({ timeout: 5_000 });
        await p2.page.click('#btn-steal');
        // 마지막 제출자는 waiting을 거치지 않고 호스트에 의해 즉시 reveal 페이즈로 전환될 수 있으므로 waiting 대기를 생략합니다.
      } else {
        // 나머지 라운드는 빠른 진행을 위해 모두 Split 선택
        const p1 = pirates[0];
        const p2 = pirates[1];

        // 첫 번째 해적 제출 후 대기 화면 확인
        await p1.page.locator('[data-screen="negotiation"]:not(.hidden)').waitFor({ timeout: 5_000 });
        await p1.page.click('#btn-split');
        await p1.page.locator('[data-screen="waiting"]:not(.hidden)').waitFor({ timeout: 5_000 });

        // 두 번째 해적 제출 (즉시 reveal 전환되므로 waiting 대기 생략)
        await p2.page.locator('[data-screen="negotiation"]:not(.hidden)').waitFor({ timeout: 5_000 });
        await p2.page.click('#btn-split');
      }

      // 호스트 제출 상황 100% 대기
      await expect(host.locator('#submit-status-text')).toContainText('제출 현황: 2 / 2명');

      // 6. Reveal 페이즈 대기 및 확인
      await host.locator('[data-phase="reveal"]:not(.hidden)').waitFor({ timeout: 10_000 });

      // 모바일 기기별 결과 화면(reveal) 노출 확인
      for (const p of players) {
        await p.page.locator('[data-screen="reveal"]:not(.hidden)').waitFor({ timeout: 10_000 });
      }
    }

    // 7. 5라운드 완료 후 최종 결과(Result) 페이즈 검증
    await host.locator('[data-phase="result"]:not(.hidden)').waitFor({ timeout: 15_000 });
    await expect(host.locator('.pp-winner-banner')).toBeVisible();

    // 8. 선술집 복귀(다시 하기) 버튼 작동 검증
    await host.click('#btn-restart');

    // 세션이 정상 리셋되어 로비 페이즈로 복귀하는지 대기
    await host.locator('[data-phase="lobby"]:not(.hidden)').waitFor({ timeout: 10_000 });

    // 정리
    await hostCtx.close();
    for (const p of players) {
      await p.page.context().close();
    }
  });
});
