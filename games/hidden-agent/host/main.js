import { HostSDK } from '../../../platform/client/HostSDK.js';
import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { DemoSimulator } from './DemoSimulator.js';

// 비밀 제시어 풀 (시민용 단어, 스파이용 단어 쌍)
const WORD_PAIRS = [
  { citizen: '사과', spy: '배' },
  { citizen: '스마트폰', spy: '컴퓨터' },
  { citizen: '비행기', spy: '헬리콥터' },
  { citizen: '바다', spy: '수영장' },
  { citizen: '축구', spy: '농구' },
  { citizen: '라떼', spy: '아메리카노' },
  { citizen: '고양이', spy: '강아지' },
  { citizen: '피자', spy: '햄버거' },
  { citizen: '짜장면', spy: '짬뽕' },
  { citizen: '콜라', spy: '사이다' },
  { citizen: '라면', spy: '우동' },
  { citizen: '안경', spy: '선글라스' },
];

class HiddenAgentGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'game-overlay', qrContainerId: null });

    this._profiles = new Map();         // playerId -> { nickname, avatar }
    this._assignedRoles = new Map();    // playerId -> 'citizen' | 'spy'
    this._assignedWords = new Map();    // playerId -> word string
    this._playerHints = new Map();      // playerId -> hint word string
    this._playerVotes = new Map();      // playerId -> targetPlayerId string

    this._gameTimer = null;
    this._demoSimulator = new DemoSimulator(this);
    this._isDemoActive = false;
    this._gameTimerLimit = 0;
    this._gameTimerStart = 0;

    this._spyPlayerId = null;
    this._citizenWord = '';
    this._spyWord = '';

    this._wireMessages();
  }

  // ─── HostBaseGame 생명주기 훅 ─────────────────────────────────────────────

  async onSetup({ sessionId }) {
    document.documentElement.dataset.sessionId = sessionId;
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => {
        if (this.playerCount >= 3) {
          this._startGame();
        } else {
          alert('스파이를 찾아라! 게임은 최소 3인 이상 플레이어가 접속해야 합니다.');
        }
      };
    }

    document.getElementById('btn-restart').onclick = () => {
      this.resetSession();
    };

    // 데모 모드 버튼 리스너 바인딩
    const btnDemoStart = document.getElementById('btn-demo-start');
    const btnDemoStop = document.getElementById('btn-demo-stop');
    const demoBanner = document.getElementById('demo-banner');

    if (btnDemoStart) {
      btnDemoStart.onclick = () => {
        if (this.playerCount > 0) {
          alert('현재 로비에 접속 중인 플레이어가 있어 데모 플레이를 실행할 수 없습니다.');
          return;
        }
        this._isDemoActive = true;
        if (demoBanner) demoBanner.classList.remove('hidden');

        // QR접속 카드 흐리게(Blur) 블락 처리
        if (this._lobbyEl) {
          const qrCard = this._lobbyEl.querySelector('.lobby-qr-card');
          if (qrCard) qrCard.style.filter = 'blur(6px) grayscale(40%)';
        }

        this._demoSimulator.start();
      };
    }

    if (btnDemoStop) {
      btnDemoStop.onclick = () => {
        this._isDemoActive = false;
        if (demoBanner) demoBanner.classList.add('hidden');

        // QR 블러 원복
        if (this._lobbyEl) {
          const qrCard = this._lobbyEl.querySelector('.lobby-qr-card');
          if (qrCard) qrCard.style.filter = '';
        }

        this._demoSimulator.stop();
      };
    }

    this.setPhase('lobby');
  }

  onPlayerJoin(player) {
    if (this._isDemoActive) return; // 데모 중 실유저 난입 방어
    this._updateLobby();
  }

  onPlayerLeave(playerId) {
    if (this._isDemoActive) return; // 데모 중 가드
    this._profiles.delete(playerId);
    this._assignedRoles.delete(playerId);
    this._assignedWords.delete(playerId);
    this._playerHints.delete(playerId);
    this._playerVotes.delete(playerId);
    this._updateLobby();
  }

  onReadyUpdate({ readyCount }) {
    this.updateLobbyReady(readyCount);
  }

  onAllReady() {
    this.updateLobbyReady(this.playerCount);
  }

  onPlayerRejoin(player) {
    if (this._isDemoActive) return; // 데모 중 가드
    // 게임 진행 도중 재접속 시
    if (this.phase !== 'lobby' && this.phase !== 'loading') {
      const role = this._assignedRoles.get(player.id);
      const word = this._assignedWords.get(player.id);
      const nickname = this._profiles.get(player.id)?.nickname ?? '익명';
      this.setPlayerName(player.id, nickname);

      // 재접속한 스마트폰에 역할 재할당
      this.sendToPlayer(player.id, 'assignRole', {
        role,
        word,
        phase: this.phase,
        hasSubmittedHint: this._playerHints.has(player.id),
        hasSubmittedVote: this._playerVotes.has(player.id),
        survivingPlayers: this._getSurvivingPlayersList(),
      });
    } else {
      this._updateLobby();
      const hasName = this._profiles.has(player.id);
      const nickname = this._profiles.get(player.id)?.nickname ?? null;
      this.sendToPlayer(player.id, 'lobbyState', {
        phase: 'lobby',
        hasName: hasName,
        nickname: nickname,
      });
    }
  }

  onReset() {
    this._assignedRoles.clear();
    this._assignedWords.clear();
    this._playerHints.clear();
    this._playerVotes.clear();
    this._spyPlayerId = null;
    this._citizenWord = '';
    this._spyWord = '';
    this._stopTimer();

    // 데모 배너 및 필터 원복
    this._isDemoActive = false;
    const demoBanner = document.getElementById('demo-banner');
    if (demoBanner) demoBanner.classList.add('hidden');
    if (this._lobbyEl) {
      const qrCard = this._lobbyEl.querySelector('.lobby-qr-card');
      if (qrCard) qrCard.style.filter = '';
    }

    // 캔버스 비우기
    const canvas = document.getElementById('bubble-canvas');
    if (canvas) {
      canvas.innerHTML = `<div style="position: absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:rgba(255,255,255,0.15); font-size:1.5rem; text-align:center;" id="canvas-placeholder">플레이어가 모바일로 단어를 보내면 이곳에 둥둥 떠다닙니다...</div>`;
    }

    this._updateLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  // ─── 메시지 처리 및 조율 ──────────────────────────────────────────────────

  _wireMessages() {
    // 프로필 등록 수신
    this.onMessage('setProfile', (player, { nickname, avatar }) => {
      if (this._isDemoActive) return; // 데모 중 실유저 패킷 가드
      const name = nickname.trim() || '익명';
      this._profiles.set(player.id, { nickname: name, avatar: avatar || null });
      this.setPlayerName(player.id, name);
      this._updateLobby();
    });

    // 힌트 단어 제출 수신
    this.onMessage('submitHint', (player, { hint }) => {
      if (this._isDemoActive) return; // 데모 중 가드
      if (this.phase !== 'discussion') return;
      if (this._playerHints.has(player.id)) return; // 중복 방지

      const cleanHint = hint.trim().substring(0, 10);
      this._playerHints.set(player.id, cleanHint);

      // TV 대화면에 떠다니는 풍선 연출 생성
      this._spawnFloatingBubble(player.id, cleanHint);

      // 제출 카운트 업데이트
      this._updateSubmitStatus();

      // 전원 제출 시 페이즈 전환
      if (this._playerHints.size === this.playerCount) {
        this._stopTimer();
        this._startVotingPhase();
      }
    });

    // 투표 제출 수신
    this.onMessage('submitVote', (player, { targetId }) => {
      if (this._isDemoActive) return; // 데모 중 가드
      if (this.phase !== 'voting') return;
      if (this._playerVotes.has(player.id)) return; // 중복 방지

      this._playerVotes.set(player.id, targetId);

      // TV 투표 완료 상태 실시간 연출 업데이트
      this._updateVoteStatus();

      // 전원 투표 시 결과 페이즈로 전환
      if (this._playerVotes.size === this.playerCount) {
        this._stopTimer();
        this._revealResult();
      }
    });
  }

  // ─── 로비 관리 ────────────────────────────────────────────────────────────

  _updateLobby() {
    this.renderLobbyPlayers(this._profiles);
  }

  // ─── 게임 비즈니스 로직 핵심 흐름 ────────────────────────────────────────────

  _startGame() {
    // 1. 역할 및 제시어 추첨
    const playersArr = Array.from(this.players.values());
    const spyPlayer = playersArr[Math.floor(Math.random() * playersArr.length)];
    this._spyPlayerId = spyPlayer.id;

    // 제시어 쌍 무작위 추출
    const wordPair = WORD_PAIRS[Math.floor(Math.random() * WORD_PAIRS.length)];
    this._citizenWord = wordPair.citizen;
    this._spyWord = wordPair.spy;

    // 역할 배정 저장 및 유니캐스트 전송 (보안 확보)
    playersArr.forEach(p => {
      const isSpy = (p.id === this._spyPlayerId);
      const role = isSpy ? 'spy' : 'citizen';
      const word = isSpy ? this._spyWord : this._citizenWord;

      this._assignedRoles.set(p.id, role);
      this._assignedWords.set(p.id, word);

      // 모바일에 역할 안내 패킷 유니캐스트
      this.sendToPlayer(p.id, 'assignRole', {
        role,
        word,
        phase: 'setup',
      });
    });

    // 2. Setup 페이즈 진입 및 카운트다운 시작 (5초)
    this.setPhase('setup');
    let countdownVal = 5;
    const countdownEl = document.getElementById('setup-countdown');
    if (countdownEl) countdownEl.textContent = countdownVal;

    const setupInterval = setInterval(() => {
      countdownVal--;
      if (countdownEl) countdownEl.textContent = countdownVal;

      if (countdownVal <= 0) {
        clearInterval(setupInterval);
        this._startDiscussionPhase();
      }
    }, 1000);
  }

  _startDiscussionPhase() {
    this.setPhase('discussion');
    this._playerHints.clear();
    this._updateSubmitStatus();

    // 힌트 수집 화면 모바일에 고지
    this.broadcast('phaseChange', { phase: 'discussion' });

    // 40초 제한시간 타이머 가동
    this._startTimer(40, () => {
      // 시간 초과 시 힌트 미제출자는 공백 처리 후 자동 다음 단계
      this.players.forEach(p => {
        if (!this._playerHints.has(p.id)) {
          this._playerHints.set(p.id, '...');
          this._spawnFloatingBubble(p.id, '...');
        }
      });
      setTimeout(() => this._startVotingPhase(), 2000);
    });
  }

  _updateSubmitStatus() {
    const total = this.playerCount;
    const submitted = this._playerHints.size;
    const el = document.getElementById('submit-status-text');
    if (el) el.textContent = `제출 현황: ${submitted} / ${total}명`;
  }

  _spawnFloatingBubble(playerId, hint) {
    const canvas = document.getElementById('bubble-canvas');
    if (!canvas) return;

    // 플레이스홀더 텍스트 숨김
    const placeholder = document.getElementById('canvas-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    const nickname = this._profiles.get(playerId)?.nickname ?? '익명';
    const color = this.players.get(playerId)?.color ?? '#fff';

    const bubble = document.createElement('div');
    bubble.className = 'floating-bubble';
    bubble.innerHTML = `<span style="font-size: 0.9rem; color: ${color}; font-weight: normal;">${nickname}:</span><br>${hint}`;

    // 임의의 좌표 배정 (경계선 이내)
    const maxX = canvas.clientWidth - 180;
    const maxY = canvas.clientHeight - 80;
    bubble.style.left = `${Math.max(20, Math.floor(Math.random() * maxX))}px`;
    bubble.style.top = `${Math.max(20, Math.floor(Math.random() * maxY))}px`;

    // 통통 튀는 무작위 애니메이션 주기 설정
    const delay = Math.random() * -5;
    bubble.style.animationDelay = `${delay}s`;

    canvas.appendChild(bubble);
  }

  _startVotingPhase() {
    this.setPhase('voting');
    this._playerVotes.clear();
    this._buildVoteUI();
    this._updateVoteStatus();

    // 모바일 투표 화면 전환 브로드캐스트
    this.broadcast('phaseChange', {
      phase: 'voting',
      survivingPlayers: this._getSurvivingPlayersList(),
    });

    // 30초 제한시간 타이머 가동
    this._startTimer(30, () => {
      // 시간 만료 시 무효표 처리 후 강제 결과 도출
      this._revealResult();
    });
  }

  _getSurvivingPlayersList() {
    return Array.from(this.players.values()).map(p => ({
      id: p.id,
      nickname: this._profiles.get(p.id)?.nickname ?? '익명',
    }));
  }

  _buildVoteUI() {
    const container = document.getElementById('vote-list-container');
    if (!container) return;
    container.innerHTML = '';

    this.players.forEach(p => {
      const nickname = this._profiles.get(p.id)?.nickname ?? '익명';
      const color = p.color;

      const card = document.createElement('div');
      card.className = 'vote-card';
      card.id = `vote-card-${p.id}`;
      card.innerHTML = `
        <div style="width: 24px; height: 24px; border-radius: 50%; background: ${color}; margin: 0 auto 10px;"></div>
        <h3 style="font-size: 1.2rem;">${nickname}</h3>
        <div class="vote-progress-bg">
          <div class="vote-progress-fill" id="vote-progress-${p.id}"></div>
        </div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;" id="vote-count-text-${p.id}">득표: 0표</p>
      `;
      container.appendChild(card);
    });
  }

  _updateVoteStatus() {
    const total = this.playerCount;
    const votedCount = this._playerVotes.size;

    const el = document.getElementById('vote-status-text');
    if (el) el.textContent = `투표 완료: ${votedCount} / ${total}명`;

    // 게이지 및 투표 마크 갱신
    this._playerVotes.forEach((targetId, voterId) => {
      const card = document.getElementById(`vote-card-${voterId}`);
      if (card) card.classList.add('voted');
    });

    // 각 유저의 득표수 계산 및 바 업데이트
    const votesCounter = new Map();
    this._playerVotes.forEach((targetId) => {
      votesCounter.set(targetId, (votesCounter.get(targetId) || 0) + 1);
    });

    this.players.forEach(p => {
      const votes = votesCounter.get(p.id) || 0;
      const pct = (votes / total) * 100;
      const progressFill = document.getElementById(`vote-progress-${p.id}`);
      const progressText = document.getElementById(`vote-count-text-${p.id}`);

      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `득표: ${votes}표`;
    });
  }

  _revealResult() {
    this.setPhase('result');

    // 득표수 통계
    const voteCounts = new Map();
    this.players.forEach(p => voteCounts.set(p.id, 0)); // 0으로 초기화

    this._playerVotes.forEach((targetId) => {
      voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
    });

    // 최다 득표자 선정
    let maxVotes = -1;
    let candidates = [];
    voteCounts.forEach((votes, playerId) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        candidates = [playerId];
      } else if (votes === maxVotes) {
        candidates.push(playerId);
      }
    });

    // 다수 득표자 탈락 결정
    let eliminatedPlayerId = null;
    if (candidates.length > 0 && maxVotes > 0) {
      // 동률인 경우 무작위 1명 탈락
      eliminatedPlayerId = candidates[Math.floor(Math.random() * candidates.length)];
    }

    const winnerBanner = document.getElementById('winner-banner-text');
    const resultDetail = document.getElementById('result-detail-text');
    const revealWordsBox = document.getElementById('reveal-words-box');

    let gameWinner = '';

    if (eliminatedPlayerId) {
      const nickname = this._profiles.get(eliminatedPlayerId)?.nickname ?? '익명';
      const role = this._assignedRoles.get(eliminatedPlayerId);

      if (role === 'spy') {
        // 스파이 검거 성공 -> 시민 승리!
        gameWinner = 'citizen';
        winnerBanner.textContent = '시민 승리! 🎉';
        winnerBanner.style.background = 'linear-gradient(to right, #10b981, #06b6d4)';
        winnerBanner.style.webkitBackgroundClip = 'text';
        resultDetail.textContent = `최다 득표자 [${nickname}]은 숨어있던 스파이였습니다!`;
      } else {
        // 무고한 시민 탈락 -> 스파이 승리!
        gameWinner = 'spy';
        winnerBanner.textContent = '스파이 승리! 🕵️‍♂️';
        winnerBanner.style.background = 'linear-gradient(to right, #ef4444, #f59e0b)';
        winnerBanner.style.webkitBackgroundClip = 'text';
        resultDetail.textContent = `최다 득표자 [${nickname}]은 무고한 시민이었습니다! 스파이가 교묘하게 살아남았습니다.`;
      }
    } else {
      // 투표가 전혀 이뤄지지 않은 경우 -> 스파이 승리
      gameWinner = 'spy';
      winnerBanner.textContent = '스파이 승리! 🕵️‍♂️';
      winnerBanner.style.background = 'linear-gradient(to right, #ef4444, #f59e0b)';
      winnerBanner.style.webkitBackgroundClip = 'text';
      resultDetail.textContent = '시간이 초과되어 아무도 탈락시키지 못했습니다. 스파이가 유유히 탈출했습니다!';
    }

    // 제시어 대조박스 업데이트
    const spyNickname = this._profiles.get(this._spyPlayerId)?.nickname ?? '익명';
    if (revealWordsBox) {
      revealWordsBox.innerHTML = `
        <div style="display: flex; justify-content: space-around; gap: 20px;">
          <div>
            <p style="font-size: 0.9rem; color: var(--text-muted);">시민 제시어</p>
            <h3 style="font-size: 2rem; color: #06b6d4;">${this._citizenWord}</h3>
          </div>
          <div style="border-left: 1px solid rgba(255,255,255,0.1);"></div>
          <div>
            <p style="font-size: 0.9rem; color: var(--text-muted);">스파이 (${spyNickname}) 제시어</p>
            <h3 style="font-size: 2rem; color: #ef4444;">${this._spyWord}</h3>
          </div>
        </div>
      `;
    }

    // 모바일에 게임 종료 및 결과 패킷 송신
    this.broadcast('phaseChange', {
      phase: 'result',
      gameWinner,
      spyPlayerId: this._spyPlayerId,
      citizenWord: this._citizenWord,
      spyWord: this._spyWord,
    });
  }

  // ─── 유틸리티 및 타이머 ─────────────────────────────────────────────────────

  _startTimer(seconds, onTimeout) {
    this._stopTimer();
    this._gameTimerLimit = seconds;
    this._gameTimerStart = Date.now();

    const isDiscussion = (this.phase === 'discussion');
    const timerBar = document.getElementById(isDiscussion ? 'disc-timer-bar' : 'vote-timer-bar');
    const timerText = isDiscussion ? document.getElementById('disc-timer-text') : null;

    if (timerBar) timerBar.style.width = '100%';

    this._gameTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this._gameTimerStart) / 1000);
      const remaining = Math.max(0, this._gameTimerLimit - elapsed);

      const pct = (remaining / this._gameTimerLimit) * 100;
      if (timerBar) timerBar.style.width = `${pct}%`;
      if (timerText) timerText.textContent = `남은 시간: ${remaining}초`;

      if (remaining <= 0) {
        this._stopTimer();
        if (onTimeout) onTimeout();
      }
    }, 200);
  }

  _stopTimer() {
    if (this._gameTimer) {
      clearInterval(this._gameTimer);
      this._gameTimer = null;
    }
  }
}

const sdk = new HostSDK({ gameId: 'hidden-agent' });
new HiddenAgentGame(sdk);
