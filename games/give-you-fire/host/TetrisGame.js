/**
 * TetrisGame.js — Give You Fire 호스트 게임 클래스
 * HostBaseGame을 상속하여 로비/대시보드/결과 화면을 관리합니다.
 *
 * 주요 역할:
 *  - 4코너 QR 렌더링, 미리보기 체크박스 관리
 *  - 플레이어 입장/프로필/준비 처리
 *  - 게임 중: 미니 보드 실시간 렌더링, 속도 레벨 표시
 *  - 라인 클리어 공격: 클리어한 플레이어 외 모두에게 levelUp 전송
 *  - 탈락 처리 및 최종 결과 집계
 */

import { HostBaseGame } from '../../../platform/client/HostBaseGame.js';
import { renderBoard } from '../shared/BoardRenderer.js';
import { DemoSimulator } from './DemoSimulator.js';

/** 색상 표시에 사용할 플레이어 색상 목록 (플랫폼에서 자동 배정되지만 레이블용으로 보유) */

export class TetrisGame extends HostBaseGame {
  constructor(sdk) {
    super(sdk, { overlayClass: 'gyf-overlay', qrContainerId: null });

    /** id → { nickname } */
    this._profiles = new Map();

    /** id → { level, lines, board: number[][], alive: boolean, rank: number|null } */
    this._playerData = new Map();

    this._gameStarted  = false;
    this._showNextPiece = false;  // 로비 체크박스 설정
    this._gameMode      = 'classic'; // 'classic' | 'quick'
    this._readyCount   = 0;
    this._aliveCount   = 0;
    this._gameStartTime = null;
    this._elapsed      = 0;
    this._elapsedTimer = null;
    this._isDemo       = false;
    this._countdownTimer   = null;
    this._countdownOverlay = null;
    this._sessionId    = null; // 간단대결모드 iframe src 조립에 사용

    this._demoSimulator = new DemoSimulator(this);
    this._wireGameMessages();
  }

  // ─── HostBaseGame 훅 ──────────────────────────────────────────────────────

  async onSetup({ sessionId }) {
    this._sessionId = sessionId;

    // 간단대결모드: 체크하면 이 기기(호스트) 자신도 실제 모바일 클라이언트
    // 페이지를 iframe으로 로드해 진짜 플레이어로 참여함 — HostSDK가 QR에
    // 인코딩하는 것과 동일한 `/mobile/?session=<id>` URL이라, 서버 입장에서는
    // 물리적으로 다른 폰이 접속한 것과 구분되지 않는다(재접속 유예, 데모 가드,
    // sendToPlayer/broadcast 등 기존 규칙이 특수 처리 없이 그대로 적용됨).
    const joinChk = document.getElementById('chk-join-as-player');
    const frameWrap = document.getElementById('gyf-self-frame-wrap');
    const frame = document.getElementById('gyf-self-frame');
    const closeBtn = document.getElementById('gyf-self-frame-close');
    if (joinChk && frameWrap && frame) {
      joinChk.addEventListener('change', () => {
        if (joinChk.checked) this._openSelfFrame();
        else this._closeSelfFrame();
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (joinChk) joinChk.checked = false;
        this._closeSelfFrame();
      });
    }

    // 미리보기 체크박스
    const chk = document.getElementById('chk-next-piece');
    if (chk) {
      chk.addEventListener('change', () => {
        this._showNextPiece = chk.checked;
      });
    }

    // 게임 모드 선택 리스너 추가
    const modeClassic = document.getElementById('mode-classic');
    const modeQuick = document.getElementById('mode-quick');
    if (modeClassic && modeQuick) {
      modeClassic.addEventListener('change', () => { if (modeClassic.checked) this._gameMode = 'classic'; });
      modeQuick.addEventListener('change', () => { if (modeQuick.checked) this._gameMode = 'quick'; });
    }

    // 로비 시작 버튼 (카운트다운으로 시작)
    if (this._lobbyEl) {
      this._lobbyEl.onStart = () => { if (this._canStart()) this._startCountdown(); };
    }

    document.getElementById('btn-restart-result')?.addEventListener('click', () => {
      this.resetSession();
    });
    document.getElementById('btn-restart-game')?.addEventListener('click', () => {
      this.resetSession();
    });

    const demoPlayBtn = document.getElementById('demoPlayBtn');
    if (demoPlayBtn) {
      demoPlayBtn.onclick = () => {
        if (!this._isDemo) {
          // 유휴 자동 데모(HostBaseGame._triggerAutoDemo)는 이미 실제 플레이어가
          // 있으면 시작하지 않도록 가드돼 있는데(AGENTS.md 필수 처리 사항), 수동
          // 버튼에는 같은 가드가 없어 로비에 실제 플레이어가 대기 중일 때 눌러도
          // 봇 3명이 얹혀 섞인 채로 카운트다운이 시작돼버림(claude 헤드리스 리뷰로
          // 발견) — 같은 원칙을 수동 경로에도 동일 적용.
          if (this.playerCount > 0) return;
          this._demoSimulator.startDemo();
        } else {
          this._demoSimulator.stopDemo();
        }
      };
    }

    this.setPhase('lobby');
  }

  // ─── 간단대결모드 (호스트 자신이 iframe으로 실제 플레이어 참여) ────────────

  _openSelfFrame() {
    const frameWrap = document.getElementById('gyf-self-frame-wrap');
    const frame = document.getElementById('gyf-self-frame');
    if (!frameWrap || !frame || !this._sessionId) return;
    // HostSDK가 QR에 인코딩하는 것과 동일한 URL 형식(HostSDK.js의 _qrUrl 조립부
    // 참고) — 이 iframe은 서버 입장에서 진짜 소켓 접속을 하는 진짜 플레이어이므로
    // 재접속 유예/데모 가드/sendToPlayer 등 기존 규칙이 특수 처리 없이 그대로 적용됨.
    frame.src = `${location.origin}/games/give-you-fire/mobile/?session=${this._sessionId}`;
    frameWrap.classList.remove('hidden');
  }

  _closeSelfFrame() {
    const frameWrap = document.getElementById('gyf-self-frame-wrap');
    const frame = document.getElementById('gyf-self-frame');
    if (!frameWrap || !frame) return;
    // src를 비워 내부 소켓 연결 자체를 끊는다 — 단순히 wrap을 숨기기만 하면
    // iframe 내부 소켓은 계속 살아있어 "참여 취소"가 실제로 반영되지 않는다.
    // 서버는 이후 일반적인 playerDisconnect → 재접속 유예 → leave 경로를 그대로 밟는다.
    frame.src = 'about:blank';
    frameWrap.classList.add('hidden');
  }

  onPlayerJoin(player) {
    if (this._isDemo) {
      // 실제 플레이어 접속 시 자동 중단 (project convention — dobble/nunchi-ten/relay-drawing과 동일).
      // 데모 시작 시 _startCountdown()이 즉시 _gameStarted=true로 만들어버리므로, 아래
      // _gameStarted 가드보다 먼저 이 체크가 없으면 데모 중 접속한 실제 플레이어는
      // 아무 UI 반응 없이 조용히 무시된다(AGENTS.md 필수 처리 사항 참고).
      this._demoSimulator.stopDemo();
      this.resetSession();
      return;
    }
    if (this._gameStarted) return;
    this._playerData.set(player.id, { level: 1, lines: 0, board: null, alive: true, rank: null });
    this._renderLobby();
    this._updateReadyStatus();
    this._broadcastPlayerList();
  }

  onPlayerRejoin(player) {
    if (!this._gameStarted && this.phase === 'result') {
      const finalRankings = this._buildFinalRankings();
      this.sendToPlayer(player.id, 'gameFinished', { rankings: finalRankings });
      return;
    }
    if (!this._gameStarted) return;

    const data = this._playerData.get(player.id);
    if (!data) return;

    if (!data.alive) {
      // 탈락자 재접속 시: 관전 화면으로 유도
      this.sendToPlayer(player.id, 'rejoinState', {
        phase:         'eliminated',
        nickname:      this._profiles.get(player.id)?.nickname ?? '???',
        rank:          data.rank ?? 1,
        mode:          this._gameMode
      });
      return;
    }

    this.sendToPlayer(player.id, 'rejoinState', {
      phase:         'playing',
      showNextPiece: this._showNextPiece,
      level:         data.level,
      lines:         data.lines,
      engineState:   data.engineState || null,
      mode:          this._gameMode
    });
  }

  onPlayerLeave(playerId) {
    if (this._gameStarted) {
      const data = this._playerData.get(playerId);
      if (data && data.alive) {
        data.alive = false;
        this._aliveCount--;
        const rank = this._aliveCount + 1;
        data.rank = rank;
        this._renderPlayerCard(playerId);
        this.broadcast('playerEliminated', { playerId, rank });

        if (this._aliveCount <= 1) {
          // 남은 생존자를 1위로 설정
          for (const [id, d] of this._playerData) {
            if (d.alive) {
              d.alive = false;
              d.rank = 1;
            }
          }
          this._endGame();
        }
      }
    } else {
      this._profiles.delete(playerId);
      this._playerData.delete(playerId);
      this._renderLobby();
      this._updateReadyStatus();
      this._broadcastPlayerList();
    }
  }

  onReadyUpdate({ readyCount, total }) {
    this._readyCount = readyCount;
    this._updateReadyStatus();
    this._updateStartBtn();
  }

  onAllReady() {
    this._updateStartBtn();
  }

  onReset() {
    this._demoSimulator.stopDemo();
    this._stopCountdown();
    this._profiles.clear();
    this._playerData.clear();
    this._gameStarted   = false;
    this._gameMode      = 'classic';
    this._readyCount    = 0;
    this._aliveCount    = 0;
    this._gameStartTime = null;
    this._stopElapsedTimer();
    this._renderLobby();
    this.updateLobbyReady(0);
    this.setPhase('lobby');
  }

  onPhaseChange(from, to) {
    if (this._isDemo) {
      this._demoSimulator.onPhaseChange(to);
    }
    this._syncSelfFrameFullscreen(to);
  }

  /**
   * 간단대결모드로 호스트 자신도 참여 중이면, 게임이 시작된 순간부터는
   * 호스트 화면 전체가 클라이언트(iframe) UI가 되어야 함 — 우하단 작은
   * 패널을 화면 전체로 확대하고, 이제 정보가 중복되는 PC 대시보드는
   * 감춘다(상대방 현황은 iframe 안의 TetrisMobile이 opponentSnapshot으로
   * 받는 미니보드 스트립이 대신 보여줌 — _broadcastOpponentSnapshot() 참고).
   * 로비로 돌아가면(재대결 등) 다시 작은 패널 + 대시보드 동시 노출로 복귀.
   */
  _syncSelfFrameFullscreen(phase) {
    const frameWrap = document.getElementById('gyf-self-frame-wrap');
    const dashboard = document.getElementById('dashboard-grid');
    if (!frameWrap || frameWrap.classList.contains('hidden')) return;
    const shouldFullscreen = phase === 'playing' || phase === 'result';
    frameWrap.classList.toggle('fullscreen', shouldFullscreen);
    if (dashboard) dashboard.style.visibility = shouldFullscreen ? 'hidden' : '';
  }

  // ─── 메시지 처리 ──────────────────────────────────────────────────────────

  _wireGameMessages() {
    // 닉네임 설정
    this.onMessage('setProfile', (player, { nickname }) => {
      this._profiles.set(player.id, { nickname });
      this.setPlayerName(player.id, nickname);
      if (!this._gameStarted) {
        this._renderLobby();
        this._broadcastPlayerList();
      }
    });

    // 모바일에서 보드 상태 업데이트 수신 (100ms 스로틀로 도착)
    this.onMessage('boardUpdate', (player, { board, level, lines, engineState }) => {
      const data = this._playerData.get(player.id);
      if (!data || !data.alive) return;
      data.board = board;
      data.level = level;
      data.lines = lines;
      data.engineState = engineState || null;
      this._renderPlayerCard(player.id);
    });

    // 라인 클리어 공격 처리
    this.onMessage('linesCleared', (player, { count }) => {
      if (!this._gameStarted) return;

      // 공격 성공 연출 (호스트 카드 플래시 및 배지)
      const attackerCard = document.getElementById(`card-${player.id}`);
      if (attackerCard) {
        attackerCard.classList.add('gyf-attacker-flash');
        const badge = document.createElement('div');
        badge.className = 'gyf-fire-badge';
        badge.textContent = count === 4 ? '🔥 TETRIS FIRE!' : count >= 2 ? '🔥 DOUBLE FIRE!' : '🔥 FIRE!';
        attackerCard.appendChild(badge);
        setTimeout(() => {
          attackerCard.classList.remove('gyf-attacker-flash');
          badge.remove();
        }, 1000);
      }

      const maxLevel = this._gameMode === 'quick' ? 40 : 100;

      // 클리어한 플레이어 외 모든 생존 플레이어에게 levelUp 전송
      for (const [id, data] of this._playerData) {
        if (id === player.id || !data.alive) continue;
        const prevLevel = data.level;
        const newLevel = Math.min(maxLevel, data.level + count);
        data.level = newLevel;
        this.sendToPlayer(id, 'levelUp', { newLevel });
        
        // 레벨 UI 즉시 갱신
        this._renderPlayerCard(id);

        // 피격 흔들림 연출
        const victimCard = document.getElementById(`card-${id}`);
        if (victimCard && newLevel > prevLevel) {
          victimCard.classList.add('gyf-victim-shake');
          setTimeout(() => victimCard.classList.remove('gyf-victim-shake'), 600);
        }
      }
    });

    // 플레이어 탈락
    this.onMessage('gameOver', (player) => {
      const data = this._playerData.get(player.id);
      if (!data || !data.alive) return;
      data.alive = false;
      this._aliveCount--;
      const rank = this._aliveCount + 1;
      data.rank = rank;
      this._renderPlayerCard(player.id);

      const playersArr = [...this.players.values()];
      this.broadcast('playerEliminated', { playerId: player.id, rank });

      // 1인 플레이: 탈락 = 게임 종료
      if (playersArr.length === 1) {
        this._endGame();
        return;
      }
      // 멀티: 1명 이하 생존 시 종료
      if (this._aliveCount <= 1) {
        // 남은 생존자를 1위로 설정
        for (const [id, d] of this._playerData) {
          if (d.alive) {
            d.alive = false;
            d.rank = 1;
          }
        }
        this._endGame();
      }
    });

    // 1인 클리어 (레벨 100/40 도달 — 다른 플레이어가 아직 생존 중이어도 즉시 경기 종료)
    this.onMessage('soloClear', (player) => {
      const data = this._playerData.get(player.id);
      if (data) { data.alive = false; data.rank = 1; }

      // 아직 탈락하지 않고 생존 중이던 다른 플레이어들은 rank가 null로 남아 있으면
      // _buildFinalRankings()의 `data.rank ?? 1` 기본값 때문에 전부 공동 1위로 표시되는
      // 버그가 있었음(멀티플레이에서 한 명이 먼저 레벨 캡을 찍고 나머지가 아직 레이스
      // 중인, 이 게임의 가장 흔한 승리 시나리오에서 실측 확인). 남은 생존자는 레벨→
      // 라인 수 내림차순으로 2위부터 순위를 매겨 종료한다.
      const stillAlive = [...this._playerData.entries()]
        .filter(([id, d]) => id !== player.id && d.alive)
        .sort(([, a], [, b]) => (b.level - a.level) || (b.lines - a.lines));

      let nextRank = 2;
      for (const [id, d] of stillAlive) {
        d.alive = false;
        d.rank = nextRank++;
      }

      this._endGame();
    });

    // 다시하기 요청
    this.onMessage('requestRematch', () => {
      this.resetSession();
    });

    // 호스트리스 모드(폰만으로 방 만들기)에서는 <game-lobby>의 "게임 시작"
    // 버튼이 화면에 안 보이는 헤드리스 iframe 안에 있어 아무도 누를 수 없다
    // — 방을 만든 폰 자신의 UI(TetrisMobile.js 대기 화면)에서 이 메시지를
    // 보내 대신 시작을 트리거한다. requestRematch와 동일한 패턴.
    this.onMessage('requestStart', () => {
      if (this._canStart()) this._startCountdown();
    });
  }

  // ─── 게임 시작 ───────────────────────────────────────────────────────────

  _canStart() {
    return this.playerCount >= 1 && this._readyCount === this.playerCount;
  }

  _startCountdown() {
    if (this._gameStarted) return;
    this._gameStarted = true;

    let count = 3;
    this.broadcast('gameCountdown', { count });

    // 호스트 화면에 카운트다운 엘리먼트 동적 삽입
    const overlay = document.createElement('div');
    overlay.id = 'gyf-countdown-overlay';
    overlay.className = 'gyf-countdown-overlay';
    overlay.innerHTML = `<div class="gyf-countdown-num">${count}</div>`;
    document.body.appendChild(overlay);
    this._countdownOverlay = overlay;

    // 인스턴스 필드에 저장해 onReset()에서 반드시 clear — 안 그러면 카운트다운
    // 도중(전원 퇴장 자동 리셋, 수동 리셋 등) onReset()이 호출돼도 이 인터벌은 계속
    // 살아서 1~3초 뒤 이미 로비로 돌아온 세션에 _startGame()을 뒤늦게 발화시켜
    // "리셋했는데 게임이 다시 시작되는" 유령 재시작 버그가 생긴다(codex 정적 리뷰로
    // 발견, AGENTS.md 필수 처리 사항의 "setTimeout/setInterval 체인은 인스턴스 필드에
    // 저장하고 onReset()에서 clear" 규칙과 동일 패턴).
    this._countdownTimer = setInterval(() => {
      count--;
      if (count <= 0) {
        clearInterval(this._countdownTimer);
        this._countdownTimer = null;
        overlay.remove();
        this._countdownOverlay = null;
        this._startGame();
      } else {
        this.broadcast('gameCountdown', { count });
        const numEl = overlay.querySelector('.gyf-countdown-num');
        if (numEl) numEl.textContent = count;
      }
    }, 1000);
  }

  _stopCountdown() {
    if (this._countdownTimer) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
    if (this._countdownOverlay) {
      this._countdownOverlay.remove();
      this._countdownOverlay = null;
    }
  }

  _startGame() {
    this._gameStarted  = true;
    this._aliveCount   = this.playerCount;
    this._gameStartTime = Date.now();

    const startLevel = this._gameMode === 'quick' ? 5 : 1;

    // 모든 플레이어 데이터 초기화. color는 여기서 스냅샷해 둔다 — 게임 도중
    // 완전히 퇴장(재접속 유예시간 만료)한 플레이어는 HostBaseGame이 onPlayerLeave
    // 훅을 부르기도 전에 this.players(_players)에서 이미 삭제해버리므로,
    // _buildFinalRankings()가 그 시점에 this.players를 다시 조회하면 색상은 물론
    // 참가 자체가 통째로 사라진다(claude 헤드리스 리뷰로 발견).
    for (const [id, player] of this.players) {
      this._playerData.set(id, { level: startLevel, lines: 0, board: null, alive: true, rank: null, engineState: null, color: player.color });
    }

    // 대시보드 렌더링
    this._renderDashboard();
    this.setPhase('playing');

    // 경과 시간 타이머
    this._startElapsedTimer();

    // 게임 시작 메시지 브로드캐스트
    this.broadcast('gameStarted', {
      showNextPiece: this._showNextPiece,
      mode: this._gameMode,
      startLevel: startLevel,
      targetLevel: this._gameMode === 'quick' ? 40 : 100
    });
  }

  // ─── 게임 종료 ───────────────────────────────────────────────────────────

  _endGame() {
    this._stopElapsedTimer();
    this._gameStarted = false;

    // 최종 순위 포함 종료 메시지
    const finalRankings = this._buildFinalRankings();
    this.broadcast('gameFinished', { rankings: finalRankings });

    // 결과 화면 렌더링
    this._renderResult(finalRankings);
    this.setPhase('result');
  }

  _buildFinalRankings() {
    // this.players(현재 접속 중인 플레이어)가 아니라 _playerData를 순회한다 —
    // 게임 도중 완전히 퇴장(재접속 유예시간 만료)한 플레이어는 onPlayerLeave 훅이
    // 불리기 전에 이미 this.players에서 삭제돼 있어, this.players 기준으로 걸러내면
    // 정상적으로 순위가 매겨진 중도 이탈자가 최종 결과에서 통째로 빠지는 버그가
    // 있었음(claude 헤드리스 리뷰로 발견). color도 _startGame()에서 미리 스냅샷해
    // 둔 값을 쓴다 — this.players에는 이미 없을 수 있으므로.
    return [...this._playerData.entries()].map(([id, data]) => {
      const profile = this._profiles.get(id) ?? {};
      return {
        id,
        nickname: profile.nickname ?? '???',
        color:    data.color ?? '#888',
        rank:     data.rank ?? 1,
        level:    data.level ?? 1,
        lines:    data.lines ?? 0,
      };
    }).sort((a, b) => a.rank - b.rank);
  }

  // ─── 경과 시간 타이머 ────────────────────────────────────────────────────

  _startElapsedTimer() {
    this._elapsed = 0;
    this._elapsedTimer = setInterval(() => {
      this._elapsed++;
      const el = document.getElementById('game-elapsed');
      if (el) el.textContent = this._formatTime(this._elapsed);
    }, 1000);
  }

  _stopElapsedTimer() {
    if (this._elapsedTimer) {
      clearInterval(this._elapsedTimer);
      this._elapsedTimer = null;
    }
  }

  _formatTime(s) {
    const m   = String(Math.floor(s / 60)).padStart(2, '0');
    const sec = String(s % 60).padStart(2, '0');
    return `${m}:${sec}`;
  }

  // ─── 로비 UI ─────────────────────────────────────────────────────────────

  _renderLobby() {
    this.renderLobbyPlayers(this._profiles);
  }

  _updateReadyStatus() {
    this.updateLobbyReady(this._readyCount);
  }

  _updateStartBtn() {
    this.updateLobbyReady(this._readyCount);
  }

  _broadcastPlayerList() {
    const players = [...this.players.values()].map(p => ({
      id:       p.id,
      color:    p.color,
      nickname: this._profiles.get(p.id)?.nickname ?? '...',
    }));
    this.broadcast('playerListUpdated', { players });
  }

  // ─── 대시보드 UI ─────────────────────────────────────────────────────────

  _renderDashboard() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const startLevel = this._gameMode === 'quick' ? 5 : 1;
    const maxLevel = this._gameMode === 'quick' ? 40 : 100;
    const initialPct = (startLevel / maxLevel) * 100;

    for (const [id, player] of this.players) {
      const profile = this._profiles.get(id) ?? {};
      const card = document.createElement('div');
      card.className = 'gyf-player-card';
      card.id = `card-${id}`;
      card.innerHTML = `
        <div class="gyf-card-header">
          <span class="gyf-card-dot" style="background:${player.color}"></span>
          <span class="gyf-card-nick">${profile.nickname ?? '???'}</span>
          <span class="gyf-card-level" id="lvl-${id}">Lv.${startLevel}</span>
        </div>
        <div class="gyf-card-bar-wrap">
          <div class="gyf-card-bar" id="bar-${id}" style="width:${initialPct}%;background:${player.color}"></div>
        </div>
        <canvas class="gyf-mini-board" id="canvas-${id}" width="120" height="240"></canvas>
        <div class="gyf-card-status" id="status-${id}">PLAYING</div>
      `;
      grid.appendChild(card);

      // 빈 보드로 초기 렌더링
      const canvas = card.querySelector(`#canvas-${id}`);
      if (canvas) renderBoard(canvas, null);
    }
  }

  _renderPlayerCard(playerId) {
    const data   = this._playerData.get(playerId);
    const player = this.players.get(playerId);
    if (!data || !player) return;

    // 레벨 텍스트
    const lvlEl = document.getElementById(`lvl-${playerId}`);
    if (lvlEl) lvlEl.textContent = `Lv.${data.level}`;

    // 레벨 프로그래스 바 (게임 모드에 맞춰 스케일링)
    const barEl = document.getElementById(`bar-${playerId}`);
    if (barEl) {
      const maxLvl = this._gameMode === 'quick' ? 40 : 100;
      const pct = Math.min(100, (data.level / maxLvl) * 100);
      barEl.style.width = `${pct}%`;
    }

    // 미니 보드 캔버스 렌더링
    const canvas = document.getElementById(`canvas-${playerId}`);
    if (canvas) {
      renderBoard(canvas, data.board ?? null, { isDead: !data.alive });
    }

    // 상태 텍스트
    const statusEl = document.getElementById(`status-${playerId}`);
    if (statusEl) {
      if (!data.alive) {
        statusEl.textContent = `${data.rank}위 탈락`;
        statusEl.classList.add('gyf-eliminated');
        const cardEl = document.getElementById(`card-${playerId}`);
        if (cardEl) cardEl.classList.add('gyf-card-dead');
      }
    }

    this._broadcastOpponentSnapshot();
  }

  /**
   * 대시보드 미니보드와 동일한 정보를 모든 플레이어에게도 브로드캐스트한다.
   * 호스트 대시보드가 안 보이는 상황(간단대결모드로 호스트 자신이 전체화면
   * 클라이언트 UI로 전환됐을 때, 또는 PC/TV 없이 폰끼리만 하는 호스트리스
   * 모드)에서도 각자 폰 화면에 작은 "상대방 미니보드"로 띄우기 위함
   * (TetrisMobile.js의 opponentSnapshot 핸들러가 렌더링). 모드 무관하게
   * 항상 보내며, 받는 쪽에서 자기 자신의 id는 걸러낸다.
   */
  _broadcastOpponentSnapshot() {
    const players = [...this._playerData.entries()].map(([id, data]) => {
      const player = this.players.get(id);
      const profile = this._profiles.get(id) ?? {};
      return {
        id,
        nickname: profile.nickname ?? '???',
        color: data.color ?? player?.color ?? '#888',
        level: data.level ?? 1,
        lines: data.lines ?? 0,
        board: data.board ?? null,
        alive: data.alive,
      };
    });
    this.broadcast('opponentSnapshot', { players });
  }

  // ─── 결과 화면 ───────────────────────────────────────────────────────────

  _renderResult(rankings) {
    const list = document.getElementById('result-rankings');
    if (!list) return;
    const medals = ['🥇', '🥈', '🥉', ''];
    list.innerHTML = rankings.map((r, i) => `
      <div class="gyf-rank-row">
        <span class="gyf-rank-medal">${medals[Math.min(i, 3)]}</span>
        <span class="gyf-rank-dot" style="background:${r.color}"></span>
        <span class="gyf-rank-nick">${r.nickname}</span>
        <span class="gyf-rank-detail">Lv.${r.level} / ${r.lines}줄</span>
      </div>
    `).join('');
  }
}
