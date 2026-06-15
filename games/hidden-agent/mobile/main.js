import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

class HiddenAgentController extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'ha-screen' });

    this._myRole = '';
    this._myWord = '';
    this._isCardRevealed = false;

    this._wireMessages();
    this._initUIEvents();
  }

  // ─── MobileBaseGame 생명주기 훅 ──────────────────────────────────────────

  onJoin(player) {
    // 최초 세션 입장 시 프로필 설정 화면 표시
    this.showScreen('setup-profile');
    
    // 이전에 로컬 스토리지에 저장해 둔 닉네임이 있다면 세팅
    const savedNick = localStorage.getItem('ha_nickname');
    if (savedNick) {
      document.getElementById('input-nickname').value = savedNick;
    }
  }

  onRejoin(player) {
    // 새로고침 혹은 순간 연결 끊김 복귀 시 (정보 자동 복구 대기)
    this.showScreen('waiting');
    document.getElementById('waiting-title').textContent = '세션 연결 복구 중...';
    document.getElementById('waiting-desc').textContent = '기존 게임 진행 정보를 호스트로부터 복원하고 있습니다.';
  }

  onReset() {
    this._myRole = '';
    this._myWord = '';
    this._isCardRevealed = false;

    // 카드를 다시 앞면으로 원복
    const card = document.getElementById('reveal-card');
    if (card) card.classList.remove('flipped');

    // 닉네임 입력 단계 혹은 대기 화면으로 유도
    const nickInput = document.getElementById('input-nickname').value.trim();
    if (nickInput) {
      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '호스트에서 시작하길 기다리는 중...';
      document.getElementById('waiting-desc').textContent = '방장이 게임을 시작할 때까지 잠시 대기해 주세요.';
    } else {
      this.showScreen('setup-profile');
    }
  }

  // ─── UI 인터랙션 및 바인딩 ────────────────────────────────────────────────

  _initUIEvents() {
    // 1. 프로필 설정 및 입장 버튼
    document.getElementById('btn-join').onclick = () => {
      const inputEl = document.getElementById('input-nickname');
      const nickname = inputEl.value.trim();

      if (!nickname) {
        alert('닉네임을 입력해 주세요!');
        return;
      }

      // 로컬 스토리지 저장
      localStorage.setItem('ha_nickname', nickname);

      // 프로필 전달 및 SDK 준비 완료 선언
      this.sendToHost('setProfile', { nickname });
      this.ready();

      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '준비 완료!';
      document.getElementById('waiting-desc').textContent = '다른 플레이어들이 다 모이면 방장이 게임을 시작합니다.';
    };

    // 2. 3D 카드 플립 제어
    const cardContainer = document.getElementById('reveal-card-container');
    const card = document.getElementById('reveal-card');
    if (cardContainer && card) {
      cardContainer.onclick = () => {
        if (!this._isCardRevealed) {
          card.classList.add('flipped');
          this._isCardRevealed = true;
          this.vibrate(100); // 탭할 때 약한 진동 피드백

          // 정체를 충분히 확인하도록 4초 뒤 자동으로 대기 화면 전환 유도 버튼 노출 혹은 자동 처리
          setTimeout(() => {
            // 토론 페이즈 개시 전까지 정체 확인을 계속 보여줌
            if (this._myRole) {
              console.log('Role confirmed, waiting for host...');
            }
          }, 3000);
        }
      };
    }

    // 3. 힌트 단어 전송 버튼
    document.getElementById('btn-submit-hint').onclick = () => {
      const hintInput = document.getElementById('input-hint-word');
      const hint = hintInput.value.trim();

      if (!hint) {
        alert('힌트 단어를 입력해 주세요!');
        return;
      }

      if (hint.includes(' ')) {
        alert('띄어쓰기 없이 단어 하나만 입력해 주세요!');
        return;
      }

      // 힌트 송신
      this.sendToHost('submitHint', { hint });
      hintInput.value = ''; // 필드 비우기

      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '힌트 전송 완료!';
      document.getElementById('waiting-desc').textContent = '다른 플레이어들이 단어를 제출할 때까지 대기합니다. TV 화면을 주목하세요!';
    };
  }

  // ─── 메시지 처리 ─────────────────────────────────────────────────────────

  _wireMessages() {
    // 1. 호스트로부터 개별 역할 배정 수신 (보안 유니캐스트 패킷)
    this.onMessage('assignRole', (data) => {
      this._myRole = data.role;
      this._myWord = data.word;
      this._isCardRevealed = false;

      // 카드 앞뒷면 내용 렌더링
      const card = document.getElementById('reveal-card');
      const cardBack = document.getElementById('reveal-card-back');
      const roleLabel = document.getElementById('reveal-role-label');
      const roleTitle = document.getElementById('reveal-role-title');
      const secretWord = document.getElementById('reveal-secret-word');

      if (card) card.classList.remove('flipped'); // 초기화

      if (cardBack) {
        cardBack.className = 'card-face card-back';
        if (data.role === 'spy') {
          cardBack.classList.add('spy');
          if (roleLabel) roleLabel.textContent = '🕵️‍♂️ SPY';
          if (roleTitle) roleTitle.textContent = '스파이';
        } else {
          cardBack.classList.add('citizen');
          if (roleLabel) roleLabel.textContent = '👥 CITIZEN';
          if (roleTitle) roleTitle.textContent = '시민';
        }
      }

      if (secretWord) secretWord.textContent = data.word;

      // 만약 Rejoin으로 들어온 게 아니라면 역할 공개 화면 우선 노출
      if (!data.phase || data.phase === 'setup') {
        this.showScreen('role-reveal');
      } else {
        // Rejoin 복원 상황 처리
        this._restoreRejoinPhase(data);
      }
    });

    // 2. 호스트 페이즈 전환 브로드캐스트 수신
    this.onMessage('phaseChange', (data) => {
      switch (data.phase) {
        case 'discussion':
          // 내 단어를 힌트 입력 화면에 가볍게 박아줌
          document.getElementById('submit-hint-my-word').textContent = this._myWord;
          this.showScreen('submit-hint');
          break;

        case 'voting':
          this._buildVoteButtons(data.survivingPlayers);
          this.showScreen('vote');
          break;

        case 'result':
          this._showGameResult(data);
          break;
        default:
          this.showScreen('waiting');
          break;
      }
    });

    // 3. Lobby State restoration on Rejoin
    this.onMessage('lobbyState', (data) => {
      if (!data.hasName) {
        this.showScreen('setup-profile');
      } else {
        this.showScreen('waiting');
        document.getElementById('waiting-title').textContent = '준비 완료!';
        document.getElementById('waiting-desc').textContent = '다른 플레이어들이 다 모이면 방장이 게임을 시작합니다.';
      }
    });
  }

  // ─── 헬퍼 함수 ──────────────────────────────────────────────────────────

  _restoreRejoinPhase(data) {
    if (data.hasSubmittedHint && data.phase === 'discussion') {
      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '힌트 제출 완료!';
      document.getElementById('waiting-desc').textContent = '이미 단어를 제출했습니다. 다른 사람들의 제출을 기다리고 있습니다.';
    } else if (data.phase === 'discussion') {
      document.getElementById('submit-hint-my-word').textContent = this._myWord;
      this.showScreen('submit-hint');
    } else if (data.hasSubmittedVote && data.phase === 'voting') {
      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '투표 완료!';
      document.getElementById('waiting-desc').textContent = '이미 투표를 마쳤습니다. 집계 결과를 대기하고 있습니다.';
    } else if (data.phase === 'voting') {
      this._buildVoteButtons(data.survivingPlayers);
      this.showScreen('vote');
    } else if (data.phase === 'result') {
      this.showScreen('waiting');
      document.getElementById('waiting-title').textContent = '게임 종료';
      document.getElementById('waiting-desc').textContent = '결과가 TV 화면에 게시되었습니다.';
    }
  }

  _buildVoteButtons(survivingPlayers) {
    const container = document.getElementById('vote-btn-container');
    if (!container) return;
    container.innerHTML = '';

    // 나를 제외한 생존 플레이어 리스트 구성
    const voteTargets = survivingPlayers.filter(p => p.id !== this.playerId);

    if (voteTargets.length === 0) {
      container.innerHTML = `<p style="text-align:center; color:var(--text-muted);">투표할 수 있는 다른 플레이어가 없습니다.</p>`;
      return;
    }

    voteTargets.forEach(target => {
      const btn = document.createElement('button');
      btn.className = 'vote-item-btn';
      btn.innerHTML = `
        <span>👤 ${target.nickname}</span>
        <span style="font-size: 0.8rem; opacity: 0.6;">지목하기 &rarr;</span>
      `;

      btn.onclick = () => {
        if (confirm(`진짜 [${target.nickname}]을 스파이로 지목하시겠습니까?`)) {
          this.sendToHost('submitVote', { targetId: target.id });
          this.showScreen('waiting');
          document.getElementById('waiting-title').textContent = '투표 완료!';
          document.getElementById('waiting-desc').textContent = `[${target.nickname}]을 스파이로 투표했습니다. 집계 완료 대기 중...`;
          this.vibrate([80, 50, 80]); // 투표 시 찌르륵 진동 피드백
        }
      };

      container.appendChild(btn);
    });
  }

  _showGameResult(data) {
    this.showScreen('waiting');
    
    const isCitizenWin = (data.gameWinner === 'citizen');
    const isImSpy = (this._myRole === 'spy');
    
    let title = '';
    let desc = '';
    
    if (isCitizenWin) {
      title = isImSpy ? '패배... 😢' : '승리! 🎉';
      desc = isImSpy 
        ? `시민들이 제시어 [${data.citizenWord}]를 지키며 스파이인 당신을 지목해 찾아냈습니다.`
        : `스파이의 정체는 [${data.spyWord}]를 가진 스파이였습니다! 검거에 성공했습니다.`;
    } else {
      title = isImSpy ? '승리! 🕵️‍♂️' : '패배... 😢';
      desc = isImSpy 
        ? '시민들을 교묘하게 유인하여 무고한 탈락을 이끌어 냈습니다. 승리를 쟁취했습니다!'
        : `시민 한 명이 오해를 받아 억울하게 탈락하였습니다. 스파이가 승리했습니다.`;
    }

    document.getElementById('waiting-title').textContent = title;
    document.getElementById('waiting-desc').textContent = desc;

    // 승패 여부에 따라 다른 진동 패턴 작동
    if ((isCitizenWin && !isImSpy) || (!isCitizenWin && isImSpy)) {
      this.vibrate([100, 100, 100, 100, 300]); // 승리: 경쾌한 진동
    } else {
      this.vibrate(500); // 패배: 웅- 무거운 진동
    }
  }
}

const sdk = new MobileSDK({ gameId: 'hidden-agent' });
new HiddenAgentController(sdk);
