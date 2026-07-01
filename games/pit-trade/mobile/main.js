import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { MobileBaseGame } from '../../../platform/client/MobileBaseGame.js';

const COMM_META = {
  diamond: { name: '다이아몬드', emoji: '💎' },
  gold: { name: '골드', emoji: '🪙' },
  oil: { name: '석유', emoji: '🛢️' },
  wheat: { name: '밀', emoji: '🌾' },
  coffee: { name: '커피', emoji: '☕' },
  wood: { name: '목재', emoji: '🪵' },
  sugar: { name: '설탕', emoji: '🍬' },
  spices: { name: '향신료', emoji: '🌶️' },
  bull: { name: '황소(조커)', emoji: '🐂' },
  bear: { name: '곰(패널티)', emoji: '🐻' }
};

class PitTradeMobile extends MobileBaseGame {
  constructor(sdk) {
    super(sdk, { screenClass: 'mobile-screen' });

    this._hand = [];
    this._selectedCardIds = [];

    this._setupUI();
    this._wireMessages();
  }

  onReset() {
    const btnReady = document.getElementById('btn-ready');
    if (btnReady) {
      btnReady.disabled = false;
      btnReady.classList.remove('ready-btn');
      btnReady.textContent = '준비 완료';
    }

    this._hand = [];
    this._selectedCardIds = [];
    document.getElementById('bell-trigger-zone')?.classList.add('hidden');

    this.showScreen('setup');
  }

  _setupUI() {
    const btnJoin = document.getElementById('btn-join');
    const btnReady = document.getElementById('btn-ready');
    const inputNick = document.getElementById('nickname-input');

    const btnList = document.getElementById('btn-list-trade');
    const btnCancel = document.getElementById('btn-cancel-trade');
    const btnRing = document.getElementById('btn-ring-bell');

    // 1. 대기방 조인
    if (btnJoin) {
      btnJoin.onclick = () => {
        const nickname = inputNick?.value.trim() || 'Player';
        document.getElementById('hud-my-nick').textContent = nickname;
        this.sdk.sendToHost('setProfile', { nickname });
        this.showScreen('waiting');
      };
    }

    // 2. 준비 완료
    if (btnReady) {
      btnReady.onclick = () => {
        btnReady.classList.add('ready-btn');
        btnReady.textContent = '준비 완료!';
        btnReady.disabled = true;
        this.sdk.ready();
      };
    }

    // 3. 거래 내놓기
    if (btnList) {
      btnList.onclick = () => {
        if (this._selectedCardIds.length === 0) return;

        this.sdk.sendToHost('registerTrade', {
          cardCount: this._selectedCardIds.length,
          cardIds: this._selectedCardIds.map(idx => this._hand[idx])
        });
      };
    }

    // 4. 거래 등록 취소
    if (btnCancel) {
      btnCancel.onclick = () => {
        this.sdk.sendToHost('cancelTrade', {});
        this._selectedCardIds = [];
        this._renderHand();
        this._renderSelectedSlots();
      };
    }

    // 5. 종 울리기
    if (btnRing) {
      btnRing.onclick = () => {
        this.sdk.sendToHost('ringBell', {});
      };
    }
  }

  _wireMessages() {
    // 1. 거래 매칭 결과 수령
    this.sdk.onMessage('tradeExecuted', ({ hand, gotBear, poolCounts }) => {
      this._hand = hand;
      this._selectedCardIds = [];
      if (poolCounts) {
        this._poolCounts = poolCounts;
      }

      // 곰 카드를 인계받았을 경우 비밀 햅틱 노티 작동
      if (gotBear) {
        this.sdk.vibrate([150, 100, 150]);
        
        // 사이렌 적색 플래시 경보 레이어 깜빡임
        const flash = document.getElementById('explosion-flash-alert');
        if (flash) {
          flash.classList.remove('hidden');
          void flash.offsetWidth; // reflow
          setTimeout(() => flash.classList.add('hidden'), 250);
        }
      }

      this._renderHand();
      this._renderSelectedSlots();
      this._checkMonopolyStatus();
    });

    // 2. 시장 매물 동기화
    this.sdk.onMessage('tradeState', (state) => {
      const container = document.getElementById('mobile-market-list');
      if (!container) return;
      container.innerHTML = '';

      const myId = this.sdk.getMyPlayer()?.id || 'me';

      // 내 매물을 제외한 시장 거래만 렌더링
      const others = state.filter(t => t.playerId !== myId);
      if (others.length === 0) {
        container.innerHTML = `<div style="color: #64748b; font-style: italic; font-size: 13px;">현재 시장에 매물이 없습니다.</div>`;
        return;
      }

      others.forEach(t => {
        const row = document.createElement('div');
        row.className = 'market-trade-row';
        row.innerHTML = `
          <span>${t.nickname}</span>
          <span class="badge">${t.cardCount}장 교환 희망</span>
        `;
        row.onclick = () => this._onAcceptTrade(t.playerId, t.cardCount);
        container.appendChild(row);
      });
    });

    // 3. 게임 라운드 완료 결과 수령
    this.sdk.onMessage('gameFinished', ({ winnerId, winnerNick, bearHolderId, scores }) => {
      document.getElementById('bell-trigger-zone')?.classList.add('hidden');
      
      const winnerTxt = document.getElementById('result-winner-text');
      if (winnerTxt) {
        const isMeWinner = winnerId === this.sdk.getMyPlayer()?.id;
        winnerTxt.textContent = isMeWinner ? '🎉 당신이 시장을 독점했습니다!' : `🔔 ${winnerNick} 승리!`;
      }

      const bearTxt = document.getElementById('result-bear-text');
      if (bearTxt) {
        const isMeBear = bearHolderId === this.sdk.getMyPlayer()?.id;
        bearTxt.textContent = isMeBear ? '🐻 곰 카드 패널티 피격! (-50점 감점)' : '🐻 곰 카드 회피 성공!';
        bearTxt.className = isMeBear ? 'bear-status loser' : 'bear-status';
      }

      // 스코어 리스트 렌더링
      const scoreList = document.getElementById('mobile-score-list');
      if (scoreList) {
        scoreList.innerHTML = '';
        scores.forEach(([nick, val]) => {
          const row = document.createElement('div');
          row.className = 'score-row';
          row.innerHTML = `
            <span>${nick}</span>
            <span>${val} 점</span>
          `;
          scoreList.appendChild(row);
        });
      }

      this.showScreen('result');
    });
  }

  // 거래 수락 교환 처리
  _onAcceptTrade(targetId, count) {
    if (this._selectedCardIds.length !== count) {
      alert(`⚠️ 상대방이 ${count}장 교환을 원합니다! 내 교환 상자에도 정확히 ${count}장의 동일 상품 카드를 담아야 거래할 수 있습니다.`);
      return;
    }

    this.sdk.sendToHost('executeTrade', {
      targetPlayerId: targetId,
      cardCount: count,
      cardIds: this._selectedCardIds.map(idx => this._hand[idx])
    });
  }

  // 카드 선택 제어
  _onCardClick(cardVal, cardIndex) {
    const isSelected = this._selectedCardIds.includes(cardIndex);

    if (isSelected) {
      const idx = this._selectedCardIds.indexOf(cardIndex);
      this._selectedCardIds.splice(idx, 1);
    } else {
      // 곰 카드(Bear)는 오직 1장 교환만 가능하며, 일반 상품과 섞어 교환할 수 없습니다.
      if (cardVal === 'bear') {
        this._selectedCardIds = [cardIndex];
      } else {
        // 이미 곰 카드가 선택되어 있으면 리셋
        const hasBearSelected = this._selectedCardIds.some(idx => this._hand[idx] === 'bear');
        if (hasBearSelected) {
          this._selectedCardIds = [];
        }

        // 동일한 종류의 카드(또는 황소 조커)만 함께 교환 가능
        const currentTypes = this._selectedCardIds.map(idx => this._hand[idx]).filter(c => c !== 'bull');
        
        if (currentTypes.length > 0 && cardVal !== 'bull' && cardVal !== currentTypes[0]) {
          // 다른 종류 카드 선택 시 기존 선택 해제하고 새로운 카드 선택
          this._selectedCardIds = [cardIndex];
        } else {
          // 최대 4장 제한 가드
          if (this._selectedCardIds.length >= 4) {
            alert('⚠️ 한 번에 교환할 수 있는 카드는 최대 4장입니다.');
            return;
          }
          this._selectedCardIds.push(cardIndex);
        }
      }
    }

    this._renderHand();
    this._renderSelectedSlots();
  }

  _renderHand() {
    const grid = document.getElementById('cards-hand-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // 곰 카드를 들고 있는지 HUD 배너 갱신
    const hasBear = this._hand.includes('bear');
    document.getElementById('hud-bear-alert')?.classList.toggle('active', hasBear);

    this._hand.forEach((c, idx) => {
      const isSelected = this._selectedCardIds.includes(idx);
      const meta = COMM_META[c] || { name: c, emoji: '🃏' };

      const card = document.createElement('div');
      card.className = `mobile-card-item ${isSelected ? 'selected' : ''} ${c === 'bull' ? 'bull-card' : ''} ${c === 'bear' ? 'bear-card' : ''}`;
      card.innerHTML = `
        <span class="card-emoji">${meta.emoji}</span>
        <span class="card-name">${meta.name}</span>
      `;
      card.onclick = () => this._onCardClick(c, idx);
      grid.appendChild(card);
    });

    this.showScreen('game');
  }

  _renderSelectedSlots() {
    const container = document.getElementById('selected-trade-slots');
    if (!container) return;
    container.innerHTML = '';

    if (this._selectedCardIds.length === 0) {
      container.innerHTML = `<div style="color: #64748b; font-style: italic; font-size: 13px;">카드를 탭하여 추가하세요 (동일 상품 최대 4장)</div>`;
      return;
    }

    this._selectedCardIds.forEach(idx => {
      const c = this._hand[idx];
      const meta = COMM_META[c] || { name: c, emoji: '🃏' };
      const slot = document.createElement('div');
      slot.className = 'slot-item';
      slot.textContent = meta.emoji;
      container.appendChild(slot);
    });
  }

  // 독점 체크 (황소 포함 9장 완료 시 종 울리기 버튼 활성화)
  _checkMonopolyStatus() {
    let counts = {};
    let bullCount = 0;
    this._hand.forEach(c => {
      if (c === 'bull') bullCount++;
      else if (c !== 'bear') {
        counts[c] = (counts[c] || 0) + 1;
      }
    });

    let isCornered = false;
    Object.keys(counts).forEach(c => {
      const target = ((this._poolCounts && this._poolCounts[c]) || 9) - 1;
      if (counts[c] + bullCount >= target) {
        isCornered = true;
      }
    });

    const bellPanel = document.getElementById('bell-trigger-zone');
    if (bellPanel) {
      bellPanel.classList.toggle('hidden', !isCornered);
    }
  }
}

// SDK 기동 및 인스턴스 생성
const sdk = new MobileSDK();
new PitTradeMobile(sdk);
