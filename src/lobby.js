import { GAMES } from '../games/registry.js';

const gameList = document.getElementById('game-list');

for (const game of GAMES) {
  const card = document.createElement('div');
  card.className = 'game-card';
  const thumbnailHtml = game.thumbnailImg
    ? `<div class="game-thumbnail-img-wrap"><img class="game-thumbnail-img" src="${game.thumbnailImg}" alt="${game.name}"></div>`
    : `<div class="game-thumbnail">${game.thumbnail}</div>`;
  card.innerHTML = `
    ${thumbnailHtml}
    <h2>${game.name}</h2>
    <p>${game.description}</p>
    <p class="game-meta">${game.minPlayers}~${game.maxPlayers}명</p>
  `;
  card.addEventListener('click', () => {
    window.location.href = game.hostPath;
  });
  gameList.appendChild(card);
}
