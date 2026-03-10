import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { AVATARS, avatarUrl } from '../host/NunchiGame.js';

export class NunchiMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'n-screen' });

    // State
    this._nickname = '';
    this._avatarId = 1;
    this._selectedCard = null;
    this._useDouble = false;
    this._submitted = false;
    this._remainingCards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    this._doublesLeft = 3;
    this._totalScore = 0;
    this._currentRound = 0;
    this._maxRounds = 10;
    this._otherPlayers = [];
    this._myRoundResult = null;
    this._countdownTimer = null;

    this._buildAvatarGrid();
    this._wireUI();
    this._wireMessages();
    this._prefillNickname();
  }

  // ─── MobileBaseGame hooks ────────────────────────────────────────────────

  onJoin(player) {
    // Platform joined — show setup screen (profile not set yet)
    this.showScreen('setup');
  }

  onRejoin(player) {
    if (this._nickname) {
      // localStorage에서 복구된 닉네임이 있음 → 즉시 프로필 재전송하여 setup 화면 건너뜀
      // 호스트가 이후 rejoinState로 실제 게임/로비 화면을 보내줌
      this._sendProfile();
    }
    // 닉네임 없으면 초기 setup 화면 유지 (첫 접속 사용자)
  }

  onAllReady() {
    // Not used: game start is controlled by host button
  }

  onReset() {
    this._selectedCard = null;
    this._useDouble = false;
    this._submitted = false;
    this._remainingCards = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    this._doublesLeft = 3;
    this._totalScore = 0;
    this._currentRound = 0;
    this._myRoundResult = null;
    this._clearCountdown();

    // 준비 버튼 초기화 (이전 게임에서 disabled 상태였으므로 반드시 리셋)
    const btnReady = document.getElementById('btn-ready');
    if (btnReady) {
      btnReady.disabled = false;
      btnReady.textContent = '준비하기';
    }

    if (this._nickname) {
      // 이전 프로필이 있으면 setup 건너뛰고 대기 화면으로 바로 이동
      // 호스트가 프로필을 초기화했으므로 다시 전송
      this._sendProfile();
    } else {
      this.showScreen('setup');
    }
  }

  // ─── Message handlers ────────────────────────────────────────────────────

  _wireMessages() {
    this.onMessage('rejoinState', (payload) => {
      this._applyRejoinState(payload);
    });

    this.onMessage('playerListUpdated', ({ players }) => {
      this._otherPlayers = players.filter(p => p.id !== this.playerId);
      this._renderWaitingPlayers();
    });

    this.onMessage('gameStarted', ({ players }) => {
      this._otherPlayers = players.filter(p => p.id !== this.playerId);
      const me = players.find(p => p.id === this.playerId);
      if (me) {
        this._remainingCards = me.remainingCards ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        this._doublesLeft = me.doublesLeft ?? 3;
        this._totalScore = me.totalScore ?? 0;
      }
      this._showScreen_RoundInput();
    });

    this.onMessage('roundStarted', ({ round, maxRounds, playerData }) => {
      this._currentRound = round;
      this._maxRounds = maxRounds;
      this._submitted = false;
      this._selectedCard = null;
      this._useDouble = false;
      this._myRoundResult = null;

      const myData = playerData?.[this.playerId];
      if (myData) {
        this._remainingCards = myData.remainingCards;
        this._doublesLeft = myData.doublesLeft;
        this._totalScore = myData.totalScore;
      }
      _vibrate([200, 150, 200, 150, 600]); // 둥 둥 두우우웅
      this._showScreen_RoundInput();
    });

    this.onMessage('submissionStatus', ({ submitted, total }) => {
      if (this._submitted) {
        document.getElementById('waiting-count').textContent =
          `${submitted.length} / ${total}명 제출완료`;
      }
    });

    this.onMessage('roundRevealed', ({ roundResult }) => {
      _vibrate([120, 80, 120]); // 두두
      const myScore = roundResult.scores[this.playerId];
      this._totalScore = roundResult.totals[this.playerId] ?? this._totalScore;
      this._myRoundResult = myScore;
      this._showScreen_RoundResult(roundResult);
    });

    this.onMessage('gameFinished', ({ rankings }) => {
      this._showScreen_GameResult(rankings);
    });
  }

  // ─── UI setup ────────────────────────────────────────────────────────────

  _wireUI() {
    // Setup: submit profile
    document.getElementById('btn-join').addEventListener('click', () => {
      const nick = document.getElementById('nickname-input').value.trim();
      if (!nick) { alert('닉네임을 입력해주세요'); return; }
      this._nickname = nick;
      this._sendProfile();
    });

    // Waiting: change profile (back to setup)
    document.getElementById('btn-change-profile').addEventListener('click', () => {
      this.showScreen('setup');
    });

    // Waiting: ready button
    document.getElementById('btn-ready').addEventListener('click', () => {
      document.getElementById('btn-ready').disabled = true;
      document.getElementById('btn-ready').textContent = '준비완료 ✓';
      this.ready();
    });

    // Round input: double toggle
    document.getElementById('btn-double').addEventListener('click', () => {
      if (this._submitted) return;
      if (!this._useDouble && this._doublesLeft <= 0) {
        alert('더블 아이템이 없습니다!');
        return;
      }
      this._useDouble = !this._useDouble;
      this._renderDoubleBtn();
    });

    // Round input: submit
    document.getElementById('btn-submit').addEventListener('click', () => {
      if (this._submitted) return;
      if (!this._selectedCard) { alert('카드를 선택해주세요'); return; }
      this._submitChoice();
    });

    // Game result: rematch
    document.getElementById('btn-rematch').addEventListener('click', () => {
      this.sendToHost('requestRematch', {});
    });
  }

  _prefillNickname() {
    const savedNick = localStorage.getItem('nunchi_nickname');
    const savedAvatarId = Number(localStorage.getItem('nunchi_avatarId') || '0');

    if (savedNick) {
      // 이전 게임의 닉네임·아바타 복구
      this._nickname = savedNick;
      this._avatarId = savedAvatarId || 1;
      const input = document.getElementById('nickname-input');
      if (input) input.value = savedNick;
      document.querySelectorAll('.avatar-btn').forEach(b => {
        b.classList.toggle('selected', Number(b.dataset.avatarId) === this._avatarId);
      });
      return;
    }

    // 처음 접속 — 랜덤 닉네임 생성
    const adjectives = ['빠른', '느린', '용감한', '조용한', '귀여운', '날카로운', '엉뚱한', '현명한'];
    const nouns = ['판다', '여우', '펭귄', '곰', '고블린', '기사', '마법사', '로봇'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const input = document.getElementById('nickname-input');
    if (input) input.value = `${adj}${noun}`;
  }

  _buildAvatarGrid() {
    const grid = document.getElementById('avatar-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const av of AVATARS) {
      const btn = document.createElement('button');
      btn.className = 'avatar-btn';
      btn.dataset.avatarId = av.id;
      btn.innerHTML = `<img src="${avatarUrl(av.id)}" alt="${av.name}">`;
      btn.addEventListener('click', () => {
        this._avatarId = av.id;
        document.querySelectorAll('.avatar-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
      grid.appendChild(btn);
    }
    // Select first by default
    grid.querySelector('.avatar-btn')?.classList.add('selected');
  }

  // ─── Profile ─────────────────────────────────────────────────────────────

  _sendProfile() {
    this.sendToHost('setProfile', { nickname: this._nickname, avatarId: this._avatarId });
    localStorage.setItem('nunchi_nickname', this._nickname);
    localStorage.setItem('nunchi_avatarId', String(this._avatarId));
    this._renderMyHeader();
    document.getElementById('waiting-nickname').textContent = this._nickname;
    const waitingAvatar = document.getElementById('waiting-my-avatar');
    if (waitingAvatar) {
      waitingAvatar.src = avatarUrl(this._avatarId);
      waitingAvatar.style.borderColor = this.playerColor ?? '#fff';
    }
    this.showScreen('waiting');
  }

  // ─── Screen renderers ────────────────────────────────────────────────────

  _renderMyHeader() {
    const headerAvatar = document.getElementById('my-avatar-header');
    const headerName = document.getElementById('my-name-header');
    const headerScore = document.getElementById('my-score-header');
    if (headerAvatar) {
      headerAvatar.src = avatarUrl(this._avatarId);
      headerAvatar.style.borderColor = this.playerColor ?? '#fff';
    }
    if (headerName) headerName.textContent = this._nickname;
    if (headerScore) headerScore.textContent = `${this._totalScore}점`;
  }

  _renderWaitingPlayers() {
    const list = document.getElementById('waiting-players');
    if (!list) return;
    list.innerHTML = this._otherPlayers.map(p => `
      <div class="waiting-player">
        <img class="wp-avatar" src="${avatarUrl(p.avatarId)}" style="border-color:${p.color}" alt="">
        <span>${p.nickname}</span>
      </div>
    `).join('');
  }

  _showScreen_RoundInput() {
    // Update header
    this._renderMyHeader();
    document.getElementById('my-score-header').textContent = `${this._totalScore}점`;
    document.getElementById('round-label').textContent = `Round ${this._currentRound} / ${this._maxRounds}`;
    document.getElementById('doubles-left').textContent = `더블 ${this._doublesLeft}개 남음`;

    // Build card grid
    this._renderCardGrid();
    this._renderDoubleBtn();

    const submitBtn = document.getElementById('btn-submit');
    if (submitBtn) submitBtn.disabled = true;

    this.showScreen('round_input');
  }

  _renderCardGrid() {
    const grid = document.getElementById('card-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let n = 1; n <= 10; n++) {
      const available = this._remainingCards.includes(n);
      const btn = document.createElement('button');
      btn.className = `card-btn ${available ? '' : 'used'}`;
      btn.textContent = n;
      btn.disabled = !available;
      if (available) {
        btn.addEventListener('click', () => {
          this._selectedCard = n;
          document.querySelectorAll('.card-btn').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          document.getElementById('btn-submit').disabled = false;
        });
      }
      grid.appendChild(btn);
    }
  }

  _renderDoubleBtn() {
    const btn = document.getElementById('btn-double');
    if (!btn) return;
    btn.className = `btn-double ${this._useDouble ? 'active' : ''}`;
    btn.textContent = this._useDouble
      ? `× 2 더블 ON (${this._doublesLeft}개 남음)`
      : `더블 사용 OFF (${this._doublesLeft}개 남음)`;
  }

  _submitChoice() {
    this._submitted = true;
    this.sendToHost('submitChoice', { card: this._selectedCard, useDouble: this._useDouble });

    // Switch to waiting_reveal
    document.getElementById('submitted-card-display').textContent = this._selectedCard;
    document.getElementById('submitted-double-display').textContent =
      this._useDouble ? '더블 사용 ✓' : '';
    document.getElementById('waiting-count').textContent = '제출 완료, 기다리는 중...';
    this.showScreen('waiting_reveal');
  }

  _applyRejoinState({ phase, players, myData, round, maxRounds, alreadySubmitted, rankings, lastRoundResult, myProfile }) {
    // 로비 상태: 프로필 복구 후 대기 화면으로
    if (phase === 'lobby') {
      this._otherPlayers = players.filter(p => p.id !== this.playerId);
      if (myProfile) {
        this._nickname = myProfile.nickname;
        this._avatarId = myProfile.avatarId;
        // onRejoin에서 이미 _sendProfile()을 보냈으므로 화면만 직접 전환
        document.getElementById('waiting-nickname').textContent = this._nickname;
        const waitingAvatar = document.getElementById('waiting-my-avatar');
        if (waitingAvatar) {
          waitingAvatar.src = avatarUrl(this._avatarId);
          waitingAvatar.style.borderColor = this.playerColor ?? '#fff';
        }
        this._renderWaitingPlayers();
        this.showScreen('waiting');
      } else {
        this.showScreen('setup'); // 프로필 미설정 → 설정 화면
      }
      return;
    }

    this._currentRound = round;
    this._maxRounds = maxRounds;
    this._otherPlayers = players.filter(p => p.id !== this.playerId);

    // 페이지 새로고침 후 닉네임·아바타가 초기화된 경우 플레이어 목록에서 복구
    const me = players.find(p => p.id === this.playerId);
    if (me) {
      if (!this._nickname && me.nickname) this._nickname = me.nickname;
      if (me.avatarId) this._avatarId = me.avatarId;
    }

    if (myData) {
      this._remainingCards = myData.remainingCards;
      this._doublesLeft = myData.doublesLeft;
      this._totalScore = myData.totalScore;
    }

    if (phase === 'game_result' && rankings) {
      this._showScreen_GameResult(rankings);
      return;
    }

    if (alreadySubmitted) {
      // 이미 제출한 상태 — 공개 대기 화면으로 복구
      this._submitted = true;
      this._selectedCard = alreadySubmitted.card;
      this._useDouble = alreadySubmitted.useDouble;
      document.getElementById('submitted-card-display').textContent = alreadySubmitted.card;
      document.getElementById('submitted-double-display').textContent =
        alreadySubmitted.useDouble ? '더블 사용 ✓' : '';
      document.getElementById('waiting-count').textContent =
        `${alreadySubmitted.submittedCount} / ${alreadySubmitted.total}명 제출완료`;
      this.showScreen('waiting_reveal');
      return;
    }

    if (phase === 'round_reveal' && lastRoundResult) {
      // 공개 중 — 내 점수가 있는 경우만 라운드 결과 표시
      const myScore = lastRoundResult.scores?.[this.playerId];
      if (myScore) {
        this._totalScore = lastRoundResult.totals?.[this.playerId] ?? this._totalScore;
        this._myRoundResult = myScore;
        this._showScreen_RoundResult(lastRoundResult);
        return;
      }
      // 내 점수 없으면 (게임 중 신규 합류) 라운드 입력 대기
    }

    // 기본: 라운드 입력 화면
    this._submitted = false;
    this._selectedCard = null;
    this._useDouble = false;
    this._myRoundResult = null;
    this._clearCountdown();
    this._showScreen_RoundInput();
  }

  _showScreen_RoundResult(roundResult) {
    const myScore = roundResult.scores[this.playerId];
    if (!myScore) return;

    document.getElementById('result-round').textContent = `Round ${roundResult.round} 결과`;
    document.getElementById('result-my-card').textContent = myScore.card;
    document.getElementById('result-base').textContent = `기본 점수: ${myScore.base}점`;
    document.getElementById('result-double-row').style.display = myScore.useDouble ? '' : 'none';
    document.getElementById('result-final').textContent = `+${myScore.final}점 획득`;
    document.getElementById('result-total').textContent = `누적 점수: ${this._totalScore}점`;

    const isLast = this._currentRound >= this._maxRounds;
    document.getElementById('result-next-hint').textContent =
      isLast ? '게임이 곧 종료됩니다...' : '다음 라운드를 기다리는 중...';

    this._clearCountdown();
    if (!isLast) {
      let count = 5;
      const el = document.getElementById('round-countdown');
      if (el) {
        el.textContent = count;
        this._countdownTimer = setInterval(() => {
          count--;
          if (count > 0) {
            el.textContent = count;
          } else if (count === 0) {
            el.textContent = 'Go!';
          } else {
            this._clearCountdown();
            if (el) el.textContent = '';
          }
        }, 1000);
      }
    }

    this.showScreen('round_result');
  }

  _clearCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  _showScreen_GameResult(rankings) {
    const medals = ['🥇', '🥈', '🥉'];
    const rankMedals = _calcRankMedals(rankings, medals);

    const myIdx = rankings.findIndex(p => p.id === this.playerId);
    document.getElementById('game-result-my-rank').textContent = rankMedals[myIdx];
    document.getElementById('game-result-my-score').textContent = `${this._totalScore}점`;

    const list = document.getElementById('game-result-rankings');
    list.innerHTML = rankings.map((p, i) => `
      <div class="gr-row ${p.id === this.playerId ? 'me' : ''}">
        <span class="gr-rank">${rankMedals[i]}</span>
        <img class="gr-avatar" src="${avatarUrl(p.avatarId)}" style="border-color:${p.color}" alt="">
        <span class="gr-name">${p.nickname}</span>
        <span class="gr-score">${p.totalScore}점</span>
      </div>
    `).join('');

    this.showScreen('game_result');
  }
}

function _vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}

function _calcRankMedals(rankings, medals) {
  const result = [];
  let displayRank = 1;
  for (let i = 0; i < rankings.length; i++) {
    if (i > 0 && rankings[i].totalScore < rankings[i - 1].totalScore) {
      displayRank = i + 1;
    }
    result.push(medals[displayRank - 1] ?? `${displayRank}위`);
  }
  return result;
}
