import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HerdLogicDemoSimulator } from './DemoSimulator.js';

export class HerdLogicGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'hl-overlay', qrContainerId: 'qr-box' });

    // 기본 상태
    this._round = 1;
    this._maxRounds = 3;
    this._gameActive = false;
    this._roundPhase = 'writing'; // 'writing' | 'revealed'
    this._pinkCowPlayerId = null;

    this._playerAnswers = new Map(); // id -> rawAnswer
    this._playerScores = new Map(); // id -> score

    // 질문 목록
    this._questionPool = [
      '가장 인기 있는 과일은?',
      '가장 해롭다고 생각하는 야식 메뉴는?',
      '여름 휴가로 가장 가고 싶은 나라는?',
      '가장 대표적인 애완동물은?',
      '한국인들이 가장 자주 마시는 음료는?',
      '일주일 중 가장 피곤한 요일은?',
      '눈이 오면 가장 먼저 하고 싶은 일은?',
      '가장 먼저 떠오르는 초능력은?',
      '학창 시절 가장 싫어했던 과목은?',
      '가장 맛있는 라면 브랜드는?'
    ];
    this._questions = [];

    this._demoSimulator = new HerdLogicDemoSimulator(this);
    this._isDemo = false;

    this._wireGameMessages();
  }

  async onSetup({ sessionId }) {
    this.setPhase('lobby');

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          this._demoSimulator.startDemo();
          demoPlayBtn.textContent = '⏹️ 데모 중지';
        } else {
          this._demoSimulator.stopDemo();
          this.resetSession();
        }
      };
    }

    const actionBtn = document.getElementById('btn-action-host');
    if (actionBtn) {
      actionBtn.onclick = () => this._revealAnswers();
    }

    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.onclick = () => this._handleNextRound();
    }

    const restartBtn = document.getElementById('btn-restart-result');
    if (restartBtn) {
      restartBtn.onclick = () => this.resetSession();
    }
  }

  onPlayerJoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);
  }

  onPlayerLeave(playerId) {
    this._playerAnswers.delete(playerId);
    this._playerScores.delete(playerId);
    if (this._pinkCowPlayerId === playerId) {
      this._pinkCowPlayerId = null;
    }
    this.renderLobbyPlayers(this._playerNicknames);

    // 진행 중 연결된 유저들이 모두 제출했는지 다시 체크
    if (this._gameActive && this._roundPhase === 'writing') {
      this._checkAllSubmitted();
    }
  }

  onPlayerRejoin(player) {
    this._resetIdleTimer();
    this.renderLobbyPlayers(this._playerNicknames);

    // 현재 플레이 상태 복원 패킷 송신
    if (this._gameActive) {
      const activeQuestion = this._questions[this._round - 1];
      this.sendToPlayer(player.id, 'rejoinState', {
        phase: 'playing',
        round: this._round,
        question: activeQuestion,
        hasSubmitted: this._playerAnswers.has(player.id),
        pinkCowPlayer: this._pinkCowPlayerId ? this._playerNicknames.get(this._pinkCowPlayerId) : null
      });
    } else {
      // 로비 상태 리싱크
      this.sendToPlayer(player.id, 'lobbyState', { phase: 'lobby' });
    }
  }

  onAllReady() {
    this._startGame();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._gameActive = false;
    this._round = 1;
    this._pinkCowPlayerId = null;
    this._playerAnswers.clear();
    this._playerScores.clear();

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) demoPlayBtn.textContent = '🤖 데모 플레이 실행';

    const grid = document.getElementById('players-grid');
    if (grid) grid.innerHTML = '';

    this.setPhase('lobby');
  }

  // ─── Game Loop ───────────────────────────────────────────────────────────

  _startGame() {
    this._gameActive = true;
    this._round = 1;
    this._pinkCowPlayerId = null;
    this._playerScores.clear();
    this._playerAnswers.clear();

    // 점수판 초기화
    const plist = [...this.players.values()];
    plist.forEach(p => this._playerScores.set(p.id, 0));

    // 랜덤 질문 3개 추출
    const pool = [...this._questionPool];
    this._questions = [];
    for (let i = 0; i < this._maxRounds; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      this._questions.push(pool.splice(idx, 1)[0]);
    }

    this.setPhase('playing');
    this._startRound();
  }

  _startRound() {
    this._roundPhase = 'writing';
    this._playerAnswers.clear();

    // HUD 업데이트
    const roundEl = document.getElementById('hud-round');
    const phaseEl = document.getElementById('hud-phase-label');
    const qEl = document.getElementById('current-question');

    if (roundEl) roundEl.textContent = `${this._round} / ${this._maxRounds}`;
    if (phaseEl) phaseEl.textContent = '답변 제출 단계';
    if (qEl) qEl.textContent = this._questions[this._round - 1];

    // 버튼 숨김
    document.getElementById('btn-action-host')?.classList.add('hidden');
    document.getElementById('btn-next-round')?.classList.add('hidden');

    // 모바일에 전달
    this.broadcast('newQuestion', {
      round: this._round,
      question: this._questions[this._round - 1],
      pinkCowPlayer: this._pinkCowPlayerId ? this._playerNicknames.get(this._pinkCowPlayerId) : null
    });

    this._renderPlayerCards();

    // 데모 시뮬레이션 격발
    if (this._isDemo) {
      this._demoSimulator.queueBotAnswers(this._questions[this._round - 1]);
    }
  }

  _checkAllSubmitted() {
    const plist = [...this.players.values()];
    const activePlayersCount = plist.length;

    let submittedCount = 0;
    plist.forEach(p => {
      if (this._playerAnswers.has(p.id)) {
        submittedCount++;
      }
    });

    if (submittedCount >= activePlayersCount && activePlayersCount > 0) {
      document.getElementById('btn-action-host')?.classList.remove('hidden');
    } else {
      document.getElementById('btn-action-host')?.classList.add('hidden');
    }
  }

  // ─── 답변 채점 및 정규화 ───────────────────────────────────────────────────

  _normalize(text) {
    if (!text) return '';
    // 앞뒤 공백 정제 및 소문자화
    let val = text.trim().toLowerCase();
    // 특수문자 제거
    val = val.replace(/[?.!,\-_~]/g, '');
    // 한글인 경우 조사 및 서술어 정사화 (은/는/이/가/을/를/야/이야/다/입니다)
    val = val.replace(/(은|는|이|가|을|를|야|이야|다|입니다|의|에)$/, '');
    return val.trim();
  }

  _revealAnswers() {
    this._roundPhase = 'revealed';
    document.getElementById('btn-action-host')?.classList.add('hidden');

    const plist = [...this.players.values()];
    const normalizedGroups = new Map(); // normalizedText -> [playerId]

    // 1. 답변 그룹화
    plist.forEach(p => {
      const raw = this._playerAnswers.get(p.id) || '무응답';
      const norm = this._normalize(raw);
      if (!normalizedGroups.has(norm)) {
        normalizedGroups.set(norm, []);
      }
      normalizedGroups.get(norm).push(p.id);
    });

    // 2. 다수파 찾기
    let maxCount = 0;
    let majorityAnswers = [];

    normalizedGroups.forEach((players, normText) => {
      // 무응답 그룹 제외
      if (normText === '') return;

      if (players.length > maxCount) {
        maxCount = players.length;
        majorityAnswers = [normText];
      } else if (players.length === maxCount && maxCount > 0) {
        majorityAnswers.push(normText);
      }
    });

    // 3. 핑크 카우(Pink Cow) 분배 조건 판별
    // Herd Mentality 룰: 튀는 유일한(단 한명) 엉뚱한 답변을 낸 플레이어가 있으면 핑크 카우 획득.
    // 여러 명이 고유한 답변을 냈다면 핑크 카우는 이전 홀더를 유지하거나 이동하지 않음.
    let uniquePlayerId = null;
    let uniqueCount = 0;

    normalizedGroups.forEach((players, normText) => {
      if (players.length === 1 && normText !== '') {
        uniquePlayerId = players[0];
        uniqueCount++;
      }
    });

    // 오직 한 명만 튀었을 경우에만 핑크 카우 이전/신규 수령
    if (uniqueCount === 1) {
      this._pinkCowPlayerId = uniquePlayerId;
    }

    // 4. 스코어 가산
    // 다수파 답변에 속한 플레이어들에게 +1점 부여 (단, 현재 핑크 카우 홀더는 가점 0점 패널티)
    const majorityPlayerIds = [];
    normalizedGroups.forEach((players, normText) => {
      if (majorityAnswers.includes(normText)) {
        players.forEach(pid => {
          majorityPlayerIds.push(pid);
          if (pid !== this._pinkCowPlayerId) {
            const currentScore = this._playerScores.get(pid) || 0;
            this._playerScores.set(pid, currentScore + 1);
          }
        });
      }
    });

    // 5. 모바일 햅틱 결과 패킷 발송
    plist.forEach(p => {
      const isMajority = majorityPlayerIds.includes(p.id);
      const isPinkCow = this._pinkCowPlayerId === p.id;
      
      this.sendToPlayer(p.id, 'resolveAnswer', {
        match: isMajority,
        pinkCow: isPinkCow,
        rawAnswer: this._playerAnswers.get(p.id) || '무응답'
      });
    });

    // 6. 호스트 화면 렌더링
    const phaseEl = document.getElementById('hud-phase-label');
    if (phaseEl) phaseEl.textContent = '답변 공개 단계';

    this._renderPlayerCards(majorityPlayerIds);

    // 다음 라운드 또는 최종 결과 버튼 제어
    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = this._round < this._maxRounds ? '다음 질문 ➔' : '최종 성적 보기 🏆';
    }
  }

  _handleNextRound() {
    if (this._round < this._maxRounds) {
      this._round++;
      this._startRound();
    } else {
      this._endGame();
    }
  }

  _endGame() {
    this._gameActive = false;

    // 성적 순위 정렬
    const plist = [...this.players.values()];
    const ranking = plist.map(p => {
      let score = this._playerScores.get(p.id) || 0;
      // 핑크 카우 보유자는 최종 우승 불가 (점수 99점 삭감 등 패널티)
      const hasCow = this._pinkCowPlayerId === p.id;
      return {
        id: p.id,
        nickname: this._playerNicknames.get(p.id) || p.nickname || '익명',
        score: score,
        hasCow: hasCow,
        color: p.color
      };
    });

    // 정렬 규칙: 핑크카우 보유자는 꼴찌(하위), 그 외 점수 높은 순
    ranking.sort((a, b) => {
      if (a.hasCow !== b.hasCow) {
        return a.hasCow ? 1 : -1;
      }
      return b.score - a.score;
    });

    // 모바일에 임무 종료 방송
    const winnerName = ranking[0] ? ranking[0].nickname : '없음';
    this.broadcast('gameFinished', {
      ranking: ranking,
      winner: winnerName
    });

    // 순위판 렌더링
    const rankingList = document.getElementById('ranking-list');
    if (rankingList) {
      rankingList.innerHTML = ranking.map((item, idx) => `
        <div class="rank-row">
          <div class="rank-num">#${idx + 1}</div>
          <div class="rank-name-box">
            <span class="hl-avatar-circle" style="background-color: ${item.color}">${item.nickname[0]}</span>
            <span style="font-weight: bold; font-size: 1.1rem; color: #fff;">${item.nickname}</span>
            ${item.hasCow ? '<span style="font-size: 1.5rem;" title="핑크 카우 패널티">🐄 🎀</span>' : ''}
          </div>
          <div class="rank-score">${item.score} 점</div>
        </div>
      `).join('');
    }

    this.setPhase('result');
  }

  // ─── 렌더링 ───────────────────────────────────────────────────────────────

  _renderPlayerCards(majorityPlayerIds = []) {
    const grid = document.getElementById('players-grid');
    if (!grid) return;

    const plist = [...this.players.values()];
    grid.innerHTML = plist.map(p => {
      const rawAnswer = this._playerAnswers.get(p.id) || '제출 대기';
      const hasSubmitted = this._playerAnswers.has(p.id);
      const isFlipped = this._roundPhase === 'revealed';
      const isMajority = majorityPlayerIds.includes(p.id);
      const hasCow = this._pinkCowPlayerId === p.id;
      
      const nickname = this._playerNicknames.get(p.id) || p.nickname || '익명';
      const firstChar = nickname[0] || 'P';

      let cardClass = 'hl-player-card-container';
      if (isFlipped) cardClass += ' flipped';

      let backClass = 'hl-card-back hl-card-face';
      if (hasSubmitted) backClass += ' submitted';

      let frontClass = 'hl-card-front hl-card-face';
      if (isMajority) {
        frontClass += ' match';
      } else if (isFlipped) {
        frontClass += ' no-match';
      }

      return `
        <div class="${cardClass}">
          <div class="hl-card-inner">
            <!-- 뒷면 (대기 모드) -->
            <div class="${backClass}">
              <div class="hl-avatar-circle" style="background-color: ${p.color}">${firstChar}</div>
              <div style="font-weight: bold; margin-top: 10px;">${nickname}</div>
              <div class="status-badge">${hasSubmitted ? '제출 완료! 🔐' : '생각 중... 💤'}</div>
            </div>
            <!-- 앞면 (답변 오픈) -->
            <div class="${frontClass}">
              ${hasCow ? '<div class="pink-cow-badge" title="핑크 카우 보유자">🐄</div>' : ''}
              <div class="hl-avatar-circle" style="background-color: ${p.color}">${firstChar}</div>
              <div class="player-name">${nickname}</div>
              <div class="player-answer">"${rawAnswer}"</div>
              <div class="match-score-badge">${isMajority ? '+1 점' : '0 점'}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── 메시지 수신 ──────────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      player.nickname = nickname;
      this.setPlayerName(player.id, nickname);
      this.renderLobbyPlayers(this._playerNicknames);
    });

    this.onMessage('submitAnswer', (player, { answer }) => {
      if (!this._gameActive || this._roundPhase !== 'writing') return;

      this._playerAnswers.set(player.id, answer.trim());
      
      // 실시간 카드 상태 갱신
      this._renderPlayerCards();
      this._checkAllSubmitted();
    });
  }
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'herd-logic' });
new HerdLogicGame(sdk);
