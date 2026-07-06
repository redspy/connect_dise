import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { GAMES } from '../games/registry.js';

const docsRoot = './docs/games';

async function run() {
  console.log(`🚀 [Auto-Orchestrator] Starting evaluation pipeline for ${GAMES.length} games...\n`);

  for (let i = 0; i < GAMES.length; i++) {
    const game = GAMES[i];
    console.log(`==========================================================`);
    console.log(`🎮 [${i + 1}/${GAMES.length}] Processing Game: ${game.name} (${game.id})`);
    console.log(`==========================================================`);

    const gameDocDir = path.join(docsRoot, game.id);
    const evalFilePath = path.join(gameDocDir, 'evaluation.md');
    if (fs.existsSync(evalFilePath)) {
      console.log(`⏭️ Skipping ${game.name} (${game.id}) - evaluation.md already exists.`);
      console.log(`==========================================================\n`);
      continue;
    }

    if (!fs.existsSync(gameDocDir)) {
      fs.mkdirSync(gameDocDir, { recursive: true });
    }

    const prompt = `
connect-dise 플랫폼의 게임 '${game.name}' (id: ${game.id})을 분석하여 평가 및 개선안을 작성해라.

분석 대상 게임 폴더: games/${game.id}/ (host 및 mobile 소스 코드)
문서 저장 경로: docs/games/${game.id}/evaluation.md

다음 4가지 섹션을 담은 완성도 높은 markdown 문서를 작성 또는 갱신해라:

1. [게임 평가]
   - 게임의 코어 플레이 방식 및 재미 요소 분석.
   - Host/Mobile 코드베이스의 아키텍처 및 구현 완성도 평가.
2. [대중성 강화 요소]
   - 대중적 흥행을 위해 보완해야 할 구체적인 요소 3가지 제안 (예: 마이크로 애니메이션 연출, 사운드, 조작감 피드백, 규칙 간소화 등).
3. [가상 전문가 회의록 (Decision Making Meeting)]
   - 7인 가상 전문가(PMOrchestrator, GameScout, KidsBoardGameExpert, OnlineGameProducer, UIUXDesigner, TechAnalyst, SeniorGameDev) 회의를 시뮬레이션하여 위 대중성 강화 요소들의 적용 타당성을 논의하고 최종 반영 의사결정 도출.
4. [테스트 결과 및 수정 방향]
   - 게임의 전체적인 동작 검증 시나리오 작성.
   - 🤖 데모 시뮬레이터(DemoSimulator.js)의 개선점 및 수정 가이드라인 제시.

이 내용을 한글로 상세하게 작성하여 docs/games/${game.id}/evaluation.md 파일로 생성하거나 덮어써라.
`;

    console.log(`🤖 Running Codex (headless) to write docs/games/${game.id}/evaluation.md...`);
    
    const result = spawnSync('codex', [
      '-a',
      'never',
      'exec',
      '--sandbox',
      'workspace-write',
      prompt
    ], { stdio: 'inherit', cwd: process.cwd() });

    if (result.status === 0) {
      console.log(`✅ Success: Generated evaluation for ${game.name}`);
    } else {
      console.error(`❌ Error: Codex failed for ${game.name} with exit code ${result.status}`);
    }
    console.log(`==========================================================\n`);
  }

  console.log(`🏁 [Auto-Orchestrator] Evaluation pipeline completed successfully.`);
}

run();
