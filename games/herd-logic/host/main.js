import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HerdLogicDemoSimulator } from './DemoSimulator.js';

export class HerdLogicGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'hl-overlay', qrContainerId: 'qr-box' });

    // 기본 상태
    this._round = 1;
    this._maxRounds = 4; // 대중성 강화를 위해 4라운드로 증가
    this._gameActive = false;
    this._roundPhase = 'writing'; // 'writing' | 'revealed'
    this._pinkCowPlayerId = null;

    this._playerAnswers = new Map(); // id -> rawAnswer
    this._playerScores = new Map(); // id -> score

    // 질문 목록 확장 (26개)
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
      '가장 맛있는 라면 브랜드는?',
      '로또 1등에 당첨되면 가장 먼저 사고 싶은 것은?',
      '가장 하기 싫은 집안일은?',
      '가장 좋아하는 고기 종류는?',
      '사무실 책상에 꼭 있어야 하는 물건은?',
      '한국인이 가장 좋아하는 찌개 종류는?',
      '겨울에 생각나는 대표적인 길거리 간식은?',
      '스트레스 해소에 가장 좋은 방법은?',
      '가장 선호하는 영화 장르는?',
      '스마트폰에서 가장 많이 쓰는 앱은?',
      '가장 무서워하는 동물이나 곤충은?',
      '생일에 받고 싶은 가장 무난한 선물은?',
      '가장 대중적인 스포츠 종목은?',
      '직장인들이 출근할 때 가장 많이 타는 교통수단은?',
      '카페에서 가장 많이 팔리는 디저트는?',
      '가장 키우고 싶은 식물이나 화초는?',
      '가장 좋아하는 피자 토핑은?'
    ];
    this._questions = [];

    this._demoSimulator = new HerdLogicDemoSimulator(this);
    this._isDemo = false;

    // 데모 진행용 타이머 식별자들
    this._demoNextRoundTimer = null;
    this._demoResetTimer = null;

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
    if (this._isDemo) {
      this._demoSimulator.stopDemo();
      this.resetSession();
      return;
    }
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

    // 현재 플레이 상태 복원 패킷 송신 (개선사항 1: 공개 단계 및 결과 단계 포함 상세 복구)
    if (this._gameActive) {
      const activeQuestion = this._questions[this._round - 1];
      const hasSubmitted = this._playerAnswers.has(player.id);
      
      if (this._roundPhase === 'revealed') {
        // 공개 단계인 경우, 점수 정산 시 산출된 결과를 포함하여 전달
        const plist = [...this.players.values()];
        const normalizedGroups = new Map();
        plist.forEach(p => {
          const raw = this._playerAnswers.get(p.id) || '무응답';
          const norm = this._normalize(raw);
          if (!normalizedGroups.has(norm)) normalizedGroups.set(norm, []);
          normalizedGroups.get(norm).push(p.id);
        });

        let maxCount = 0;
        let majorityAnswers = [];
        normalizedGroups.forEach((players, normText) => {
          if (normText === '') return;
          if (players.length > maxCount) {
            maxCount = players.length;
            majorityAnswers = [normText];
          } else if (players.length === maxCount && maxCount > 0) {
            majorityAnswers.push(normText);
          }
        });

        const majorityPlayerIds = [];
        normalizedGroups.forEach((players, normText) => {
          if (majorityAnswers.includes(normText)) {
            players.forEach(pid => majorityPlayerIds.push(pid));
          }
        });

        const isMajority = majorityPlayerIds.includes(player.id);
        const isPinkCow = this._pinkCowPlayerId === player.id;
        const rawAnswer = this._playerAnswers.get(player.id) || '무응답';

        this.sendToPlayer(player.id, 'rejoinState', {
          phase: 'playing',
          round: this._round,
          question: activeQuestion,
          hasSubmitted: true,
          pinkCowPlayer: this._pinkCowPlayerId ? this._playerNicknames.get(this._pinkCowPlayerId) : null,
          roundPhase: 'revealed',
          match: isMajority,
          pinkCow: isPinkCow,
          rawAnswer: rawAnswer
        });
      } else {
        // 작성 단계인 경우
        this.sendToPlayer(player.id, 'rejoinState', {
          phase: 'playing',
          round: this._round,
          question: activeQuestion,
          hasSubmitted: hasSubmitted,
          pinkCowPlayer: this._pinkCowPlayerId ? this._playerNicknames.get(this._pinkCowPlayerId) : null,
          roundPhase: 'writing',
          rawAnswer: this._playerAnswers.get(player.id) || ''
        });
      }
    } else if (this.phase === 'result') {
      // 최종 결과 화면인 경우 결과 데이터와 함께 rejoinState 전송
      const plist = [...this.players.values()];
      const ranking = plist.map(p => {
        let score = this._playerScores.get(p.id) || 0;
        const hasCow = this._pinkCowPlayerId === p.id;
        return {
          id: p.id,
          nickname: this._playerNicknames.get(p.id) || p.nickname || '익명',
          score: score,
          hasCow: hasCow,
          color: p.color
        };
      });

      ranking.sort((a, b) => {
        if (a.hasCow !== b.hasCow) {
          return a.hasCow ? 1 : -1;
        }
        return b.score - a.score;
      });

      const winnerName = ranking[0] ? ranking[0].nickname : '없음';

      this.sendToPlayer(player.id, 'rejoinState', {
        phase: 'result',
        ranking: ranking,
        winner: winnerName
      });
    } else {
      // 로비 상태 리싱크 (로비 프리징 방지 가드)
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

    const demoBanner = document.getElementById('demo-indicator-banner');
    if (demoBanner) demoBanner.classList.add('hidden');

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

    // 랜덤 질문 추출 (중복 제거)
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
    document.getElementById('btn-action-host')?.classList.add('hidden');

    // 대중성 개선안 1: 답변 공개 3, 2, 1 카운트다운 연출
    const countdownOverlay = document.getElementById('countdown-overlay');
    const countdownNumber = document.getElementById('countdown-number');
    
    if (countdownOverlay && countdownNumber) {
      countdownOverlay.classList.remove('hidden');
      let count = 3;
      countdownNumber.textContent = count;
      
      const interval = setInterval(() => {
        count--;
        if (count > 0) {
          countdownNumber.textContent = count;
        } else if (count === 0) {
          countdownNumber.textContent = '💥';
        } else {
          clearInterval(interval);
          countdownOverlay.classList.add('hidden');
          this._executeRevealLogic();
        }
      }, 1000);
    } else {
      this._executeRevealLogic();
    }
  }

  _executeRevealLogic() {
    this._roundPhase = 'revealed';
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

    // 6. 호스트 화면 렌더링 (동률 여부 전달)
    const phaseEl = document.getElementById('hud-phase-label');
    if (phaseEl) phaseEl.textContent = '답변 공개 단계';

    const isGoldMatch = majorityAnswers.length > 1; // 동률 다수파 여부
    this._renderPlayerCards(majorityPlayerIds, isGoldMatch);

    // 다음 라운드 또는 최종 결과 버튼 제어
    const nextBtn = document.getElementById('btn-next-round');
    if (nextBtn) {
      nextBtn.classList.remove('hidden');
      nextBtn.textContent = this._round < this._maxRounds ? '다음 질문 ➔' : '최종 성적 보기 🏆';
    }

    // 데모 시뮬레이션 자율 흐름 타이머 작동
    if (this._isDemo) {
      this._demoNextRoundTimer = setTimeout(() => {
        this._handleNextRound();
      }, 5000); // 공개 후 5초 뒤 자동으로 다음 질문/라운드 이행
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
      const hasCow = this._pinkCowPlayerId === p.id;
      return {
        id: p.id,
        nickname: this._playerNicknames.get(p.id) || p.nickname || '익명',
        score: score,
        hasCow: hasCow,
        color: p.color
      };
    });

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
      rankingList.innerHTML = ranking.map((item, idx) => {
        const cleanName = this._escapeHtml(item.nickname);
        const char = cleanName[0] || 'P';
        return `
          <div class="rank-row">
            <div class="rank-num">#${idx + 1}</div>
            <div class="rank-name-box">
              <span class="hl-avatar-circle" style="background-color: ${item.color}">${char}</span>
              <span style="font-weight: bold; font-size: 1.1rem; color: #fff;">${cleanName}</span>
              ${item.hasCow ? '<span style="font-size: 1.5rem;" title="핑크 카우 패널티">🐄 🎀</span>' : ''}
            </div>
            <div class="rank-score">${item.score} 점</div>
          </div>
        `;
      }).join('');
    }

    this.setPhase('result');

    // 데모 시뮬레이션 결과 노출 후 자동 로비 복귀 처리
    if (this._isDemo) {
      this._demoResetTimer = setTimeout(() => {
        this.resetSession();
      }, 8000); // 8초 뒤 로비 복귀
    }
  }

  // ─── 렌더링 ───────────────────────────────────────────────────────────────

  _renderPlayerCards(majorityPlayerIds = [], isGoldMatch = false) {
    const grid = document.getElementById('players-grid');
    if (!grid) return;

    const plist = [...this.players.values()];
    grid.innerHTML = plist.map((p, idx) => {
      const rawAnswer = this._playerAnswers.get(p.id) || '제출 대기';
      const hasSubmitted = this._playerAnswers.has(p.id);
      const isFlipped = this._roundPhase === 'revealed';
      const isMajority = majorityPlayerIds.includes(p.id);
      const hasCow = this._pinkCowPlayerId === p.id;
      
      const nickname = this._playerNicknames.get(p.id) || p.nickname || '익명';
      const cleanNickname = this._escapeHtml(nickname);
      const cleanRawAnswer = this._escapeHtml(rawAnswer);
      const firstChar = cleanNickname[0] || 'P';

      let cardClass = 'hl-player-card-container';
      if (isFlipped) cardClass += ' flipped';

      let backClass = 'hl-card-back hl-card-face';
      if (hasSubmitted) backClass += ' submitted';

      let frontClass = 'hl-card-front hl-card-face';
      if (isMajority) {
        if (isGoldMatch) {
          frontClass += ' gold-match';
        } else {
          frontClass += ' match';
        }
      } else if (isFlipped) {
        frontClass += ' no-match';
      }

      // 대중성 개선안 1: 80~120ms 수준의 스태거(차등 딜레이) 트랜지션 적용
      const delayStyle = isFlipped ? `style="transition-delay: ${idx * 120}ms;"` : '';

      return `
        <div class="${cardClass}">
          <div class="hl-card-inner" ${delayStyle}>
            <!-- 뒷면 (대기 모드) -->
            <div class="${backClass}">
              <div class="hl-avatar-circle" style="background-color: ${p.color}">${firstChar}</div>
              <div style="font-weight: bold; margin-top: 10px;">${cleanNickname}</div>
              <div class="status-badge">${hasSubmitted ? '제출 완료! 🔐' : '생각 중... 💤'}</div>
            </div>
            <!-- 앞면 (답변 오픈) -->
            <div class="${frontClass}">
              ${hasCow ? '<div class="pink-cow-badge" title="핑크 카우 보유자">🐄</div>' : ''}
              ${isMajority && isGoldMatch ? '<div class="gold-badge">🏆 동률 다수파</div>' : ''}
              <div class="hl-avatar-circle" style="background-color: ${p.color}">${firstChar}</div>
              <div class="player-name">${cleanNickname}</div>
              <div class="player-answer">"${cleanRawAnswer}"</div>
              <div class="match-score-badge">${isMajority ? '+1 점' : '0 점'}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // HTML 이스케이프 유틸리티
  _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─── 메시지 수신 ──────────────────────────────────────────────────────────

  _wireGameMessages() {
    this.onMessage('setProfile', (player, { nickname }) => {
      // XSS 방지
      const cleanNickname = this._escapeHtml(nickname);
      player.nickname = cleanNickname;
      this.setPlayerName(player.id, cleanNickname);
      this.renderLobbyPlayers(this._playerNicknames);
    });

    this.onMessage('submitAnswer', (player, { answer }) => {
      if (!this._gameActive || this._roundPhase !== 'writing') return;

      // 답변 정제
      const cleanAnswer = this._escapeHtml(answer.trim());
      this._playerAnswers.set(player.id, cleanAnswer);
      
      // 실시간 카드 상태 갱신
      this._renderPlayerCards();
      this._checkAllSubmitted();
    });
  }
}

// SDK 엔트리 초기화
const sdk = new HostSDK({ gameId: 'herd-logic' });
new HerdLogicGame(sdk);
