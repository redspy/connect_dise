import { GAMES } from '../games/registry.js';

const multiList = document.getElementById('multi-game-list');
const soloList  = document.getElementById('solo-game-list');
const tabMulti  = document.getElementById('tab-multi');
const tabSolo   = document.getElementById('tab-solo');

function createCard(game) {
  const card = document.createElement('div');
  card.className = 'game-card';
  const thumbnailHtml = game.thumbnailImg
    ? `<div class="game-thumbnail-img-wrap"><img class="game-thumbnail-img" src="${game.thumbnailImg}" alt="${game.name}"></div>`
    : `<div class="game-thumbnail">${game.thumbnail}</div>`;

  const metaHtml = game.minPlayers != null
    ? `<p class="game-meta">${game.minPlayers}${game.maxPlayers ? `~${game.maxPlayers}` : ''}명</p>`
    : `<p class="game-meta">1인 플레이</p>`;

  card.innerHTML = `
    ${thumbnailHtml}
    <h2>${game.name}</h2>
    <p>${game.description}</p>
    ${metaHtml}
  `;
  card.addEventListener('click', () => {
    window.location.href = game.hostPath;
  });
  return card;
}

for (const game of GAMES) {
  const card = createCard(game);
  if (game.group === 'solo') {
    soloList.appendChild(card);
  } else {
    multiList.appendChild(card);
  }
}

function switchTab(tab) {
  if (tab === 'multi') {
    tabMulti.classList.add('active');
    tabSolo.classList.remove('active');
    multiList.classList.remove('hidden');
    soloList.classList.add('hidden');
  } else {
    tabSolo.classList.add('active');
    tabMulti.classList.remove('active');
    soloList.classList.remove('hidden');
    multiList.classList.add('hidden');
  }
}

tabMulti.addEventListener('click', () => switchTab('multi'));
tabSolo.addEventListener('click',  () => switchTab('solo'));
