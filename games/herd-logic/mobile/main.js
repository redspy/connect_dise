import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';
import { MobileSDK } from '../../../platform/client/MobileSDK.js';

class HerdLogicMobileGame extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'hl-screen' });

    // UI Elements
    this.connectionStatus = document.getElementById('connection-status');
    this.statusLabel = this.connectionStatus.querySelector('.status-label');
    this.joinForm = document.getElementById('join-form');
    this.nicknameInput = document.getElementById('nickname-input');
    this.btnJoin = document.getElementById('btn-join');
    this.btnReady = document.getElementById('btn-ready');
    this.lobbyStatusText = document.getElementById('lobby-status');

    this.hudRoundMini = document.getElementById('hud-round-mini');
    this.pinkCowNotice = document.getElementById('pink-cow-notice');
    this.displayQuestion = document.getElementById('display-question');

    this.submitSection = document.getElementById('submit-section');
    this.answerInput = document.getElementById('answer-input');
    this.btnSubmitAnswer = document.getElementById('btn-submit-answer');

    this.waitingSubmissionSection = document.getElementById('waiting-submission-section');
    this.submittedAnswerText = document.getElementById('submitted-answer-text');

    this.roundResultSection = document.getElementById('round-result-section');
    this.roundResultAlert = document.getElementById('round-result-alert');
    this.resultIconMini = document.getElementById('result-icon-mini');
    this.resultTextMini = document.getElementById('result-text-mini');

    this.resultIcon = document.getElementById('result-icon');
    this.resultTitle = document.getElementById('result-title');
    this.resultDesc = document.getElementById('result-desc');

    this.myNickname = '';
    this.isReady = false;

    this._setupUIEvents();
    this._wireMessages();

    // 튜토리얼 팝업 및 팁 텍스트 추가 (대중성 개선안 B)
    this._injectTutorialIfNeeded();
  }

  _setupUIEvents() {
    this.btnJoin.addEventListener('click', () => this._handleJoin());
    this.btnReady.addEventListener('click', () => this._handleReady());
    this.btnSubmitAnswer.addEventListener('click', () => this._handleSubmitAnswer());
  }

  // ─── Lifecycle hooks ─────────────────────────────────────────────────────

  onJoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '서버 연결 완료';

    const saved = localStorage.getItem('herd_nickname');
    if (saved) {
      this.myNickname = saved;
      this.joinForm.classList.add('hidden');
      this.btnReady.classList.remove('hidden');
      this.sendToHost('setProfile', { nickname: this.myNickname });
    } else {
      this.joinForm.classList.remove('hidden');
      this.btnReady.classList.add('hidden');
    }
    this.showScreen('waiting');
  }

  onRejoin(player) {
    this.connectionStatus.classList.add('connected');
    this.statusLabel.textContent = '서버 연결 완료 (재연결)';
    // 재연결 시 닉네임 복원 및 프로필 전송을 수행해 호스트와 이름을 맞춤
    this.myNickname = player.nickname || localStorage.getItem('herd_nickname') || '';
    if (this.myNickname) {
      this.sendToHost('setProfile', { nickname: this.myNickname });
    }
    this.statusLabel.textContent = '연결 복구 중...';
  }

  onReset() {
    this.isReady = false;
    if (this.btnReady) {
      this.btnReady.disabled = false;
      this.btnReady.textContent = '준비하기';
    }
    this.answerInput.value = '';
    this.showScreen('waiting');
    this.lobbyStatusText.textContent = '세션이 리셋되었습니다. 대기 중...';
  }

  onHostDisconnect() {
    this.connectionStatus.classList.remove('connected');
    this.statusLabel.textContent = '연결 복구 중...';
  }

  // ─── UI Handlers ─────────────────────────────────────────────────────────

  _handleJoin() {
    const nickname = this.nicknameInput.value.trim();
    if (!nickname) {
      alert('닉네임을 입력해주세요.');
      return;
    }
    
    // HTML 이스케이프 적용 (보안 및 렌더링 안전성)
    const cleanNickname = this._escapeHtml(nickname);
    this.myNickname = cleanNickname;
    localStorage.setItem('herd_nickname', this.myNickname);

    this.joinForm.classList.add('hidden');
    this.btnReady.classList.remove('hidden');

    this.sendToHost('setProfile', { nickname: this.myNickname });
  }

  _handleReady() {
    this.isReady = true;
    this.btnReady.disabled = true;
    this.btnReady.textContent = '준비완료 ✓';
    this.ready();
  }

  _handleSubmitAnswer() {
    const ans = this.answerInput.value.trim();
    if (!ans) {
      alert('답변을 입력해주세요.');
      return;
    }

    // 입력값 정제 (공백 단축 및 XSS 방지)
    const cleanAns = this._escapeHtml(ans.replace(/\s+/g, ' '));

    this.vibrate('light');
    this.sendToHost('submitAnswer', { answer: cleanAns });

    // 화면 전환 (제출 완료 대기)
    this.submitSection.classList.add('hidden');
    this.waitingSubmissionSection.classList.remove('hidden');
    this.submittedAnswerText.textContent = cleanAns;
  }

  // HTML 이스케이프 유틸리티
  _escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 대중성 개선안 B: 입력 UX 강화 (예시 및 글자 수 표시)
  // 대중성 개선안 B: 튜토리얼 팝업 삽입
  _injectTutorialIfNeeded() {
    // 튜토리얼 마크업 및 가이드 추가
    const hintText = document.createElement('p');
    hintText.className = 'input-hint-text';
    hintText.innerHTML = '💡 <strong>꿀팁:</strong> 내가 아닌 남들이 가장 많이 적을 단어를 적으세요! (예: 사과, 강아지, 커피)<br><span id="char-counter">0 / 15 자</span>';
    hintText.style.cssText = 'font-size: 0.8rem; color: #aaa; margin-top: 4px; text-align: left; line-height: 1.4;';
    this.answerInput.parentNode.insertBefore(hintText, this.btnSubmitAnswer);

    this.answerInput.addEventListener('input', () => {
      const len = this.answerInput.value.length;
      const counter = document.getElementById('char-counter');
      if (counter) counter.textContent = `${len} / 15 자`;
    });

    // 튜토리얼 팝업을 대기실(waiting) 화면에 띄움
    const tutorialBox = document.createElement('div');
    tutorialBox.id = 'herd-tutorial-box';
    tutorialBox.className = 'tutorial-overlay hidden';
    tutorialBox.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 8000;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      padding: 30px;
      color: #fff;
      text-align: center;
    `;
    tutorialBox.innerHTML = `
      <div style="background:#1b261b; border:2px solid var(--btn-gold); padding:24px; border-radius:16px; max-width:90%;">
        <h3 style="color:var(--btn-gold); margin-top:0; font-size: 1.4rem;">🐄 허드 로직 가이드</h3>
        <p style="font-size:0.9rem; line-height:1.6; color:#ccc; text-align: left; margin: 15px 0;">
          1. 질문을 보고 <strong>'남들이 가장 많이 적을 단어'</strong>를 예상해 보세요.<br><br>
          2. 독창적인 단어는 NO! 가장 대중적인 단어를 적어 다수파에 합류해야 점수를 얻습니다.<br><br>
          3. 홀로 튄 엉뚱한 답변을 낸 플레이어는 <strong>핑크 카우(Pink Cow) 🐄</strong> 토큰을 받아 점수가 차단됩니다!
        </p>
        <button id="btn-close-tutorial" class="secondary-btn" style="margin-top:15px; width:100%; border-color: var(--btn-gold); color: var(--btn-gold);">이해했습니다! 👍</button>
      </div>
    `;
    document.body.appendChild(tutorialBox);

    const closeBtn = document.getElementById('btn-close-tutorial');
    closeBtn.addEventListener('click', () => {
      tutorialBox.classList.add('hidden');
      localStorage.setItem('herd_tutorial_seen', 'true');
    });

    // 최초 방문 시 튜토리얼 바로 노출
    if (!localStorage.getItem('herd_tutorial_seen')) {
      tutorialBox.classList.remove('hidden');
    }

    // 튜토리얼 다시보기 버튼 추가
    const showTutorialBtn = document.createElement('button');
    showTutorialBtn.textContent = '📖 게임 방법 보기';
    showTutorialBtn.className = 'secondary-btn';
    showTutorialBtn.style.cssText = 'margin-top: 10px; width: 100%;';
    showTutorialBtn.addEventListener('click', () => {
      tutorialBox.classList.remove('hidden');
    });
    this.joinForm.parentNode.insertBefore(showTutorialBtn, this.lobbyStatusText.nextSibling);
  }

  _wireMessages() {
    this.onMessage('newQuestion', ({ round, question, pinkCowPlayer }) => {
      this.hudRoundMini.textContent = `ROUND ${round}`;
      this.displayQuestion.textContent = question;

      const hasCow = pinkCowPlayer && pinkCowPlayer === this.myNickname;
      this.pinkCowNotice.classList.toggle('hidden', !hasCow);

      this.answerInput.value = '';
      const counter = document.getElementById('char-counter');
      if (counter) counter.textContent = '0 / 15 자';

      this.submitSection.classList.remove('hidden');
      this.waitingSubmissionSection.classList.add('hidden');
      this.roundResultSection.classList.add('hidden');

      this.showScreen('game');
    });

    this.onMessage('resolveAnswer', ({ match, pinkCow, rawAnswer }) => {
      this.waitingSubmissionSection.classList.add('hidden');
      this.roundResultSection.classList.remove('hidden');

      if (match) {
        this.roundResultAlert.className = 'success-alert';
        this.resultIconMini.textContent = '👍';
        this.resultTextMini.textContent = `다수파와 의견이 통했습니다! (+1점)\n제출한 답: "${rawAnswer}"`;
        this.vibrate('light');
      } else {
        if (pinkCow) {
          this.roundResultAlert.className = 'success-alert fail';
          this.resultIconMini.textContent = '🐄⚠️';
          this.resultTextMini.textContent = `너무 튀는 답변으로 핑크 카우를 받았습니다! 점수가 차단됩니다!\n제출한 답: "${rawAnswer}"`;
          this.vibrate('double');
        } else {
          this.roundResultAlert.className = 'success-alert fail';
          this.resultIconMini.textContent = '❌';
          this.resultTextMini.textContent = `다수파와 매칭에 실패했습니다. (0점)\n제출한 답: "${rawAnswer}"`;
          this.vibrate('medium');
        }
      }
    });

    this.onMessage('gameFinished', ({ ranking, winner }) => {
      const myRankIdx = ranking.findIndex(r => r.id === this.playerId);
      const myRank = myRankIdx !== -1 ? myRankIdx + 1 : null;
      const isWinner = myRank === 1;

      this.resultIcon.textContent = isWinner ? '🏆' : '🐄';
      this.resultTitle.textContent = isWinner ? '우승을 차지했습니다!' : '최종 순위 발표';
      
      if (myRank) {
        this.resultDesc.textContent = `당신의 최종 순위는 #${myRank}위 입니다. (전체 우승자: ${winner})`;
      } else {
        this.resultDesc.textContent = `최종 우승자: ${winner}`;
      }

      this.showScreen('result');

      if (isWinner) {
        this.vibrate([100, 50, 100, 50, 300]);
      } else {
        this.vibrate([200, 100, 200]);
      }
    });

    this.onMessage('rejoinState', ({ phase, round, question, hasSubmitted, pinkCowPlayer, roundPhase, match, pinkCow, rawAnswer, ranking, winner }) => {
      this.statusLabel.textContent = '서버 연결 완료';
      
      if (phase === 'playing') {
        this.hudRoundMini.textContent = `ROUND ${round}`;
        this.displayQuestion.textContent = question;

        const hasCow = pinkCowPlayer && pinkCowPlayer === this.myNickname;
        this.pinkCowNotice.classList.toggle('hidden', !hasCow);

        if (roundPhase === 'revealed') {
          // 공개 단계 복원
          this.submitSection.classList.add('hidden');
          this.waitingSubmissionSection.classList.add('hidden');
          this.roundResultSection.classList.remove('hidden');

          if (match) {
            this.roundResultAlert.className = 'success-alert';
            this.resultIconMini.textContent = '👍';
            this.resultTextMini.textContent = `다수파와 의견이 통했습니다! (+1점)\n제출한 답: "${rawAnswer}"`;
          } else {
            if (pinkCow) {
              this.roundResultAlert.className = 'success-alert fail';
              this.resultIconMini.textContent = '🐄⚠️';
              this.resultTextMini.textContent = `너무 튀는 답변으로 핑크 카우를 받았습니다! 점수가 차단됩니다!\n제출한 답: "${rawAnswer}"`;
            } else {
              this.roundResultAlert.className = 'success-alert fail';
              this.resultIconMini.textContent = '❌';
              this.resultTextMini.textContent = `다수파와 매칭에 실패했습니다. (0점)\n제출한 답: "${rawAnswer}"`;
            }
          }
        } else {
          // 작성 단계 복원
          if (hasSubmitted) {
            this.submitSection.classList.add('hidden');
            this.waitingSubmissionSection.classList.remove('hidden');
            this.submittedAnswerText.textContent = rawAnswer || '(제출 완료)';
          } else {
            this.submitSection.classList.remove('hidden');
            this.waitingSubmissionSection.classList.add('hidden');
          }
          this.roundResultSection.classList.add('hidden');
        }
        this.showScreen('game');
      } else if (phase === 'result') {
        // 결과 단계 복원
        const myRankIdx = ranking.findIndex(r => r.id === this.playerId);
        const myRank = myRankIdx !== -1 ? myRankIdx + 1 : null;
        const isWinner = myRank === 1;

        this.resultIcon.textContent = isWinner ? '🏆' : '🐄';
        this.resultTitle.textContent = isWinner ? '우승을 차지했습니다!' : '최종 순위 발표';
        
        if (myRank) {
          this.resultDesc.textContent = `당신의 최종 순위는 #${myRank}위 입니다. (전체 우승자: ${winner})`;
        } else {
          this.resultDesc.textContent = `최종 우승자: ${winner}`;
        }

        this.showScreen('result');
      } else {
        // 대기 화면 복원
        this.showScreen('waiting');
      }
    });

    this.onMessage('lobbyState', ({ phase }) => {
      if (phase === 'lobby') {
        this.isReady = false;
        this.btnReady.disabled = false;
        this.btnReady.textContent = '준비하기';
        this.showScreen('waiting');
      }
    });
  }
}

// SDK 엔트리 초기화
const sdk = new MobileSDK({ gameId: 'herd-logic' });
new HerdLogicMobileGame(sdk);
