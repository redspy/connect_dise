document.addEventListener('DOMContentLoaded', () => {
    const BOARD_SIZE = 13;
    const boardElement = document.getElementById('board');
    const modal = document.getElementById('modal');
    const modalMessage = document.getElementById('modal-message');
    const restartBtn = document.getElementById('restart-btn');
    const modalRestartBtn = document.getElementById('modal-restart-btn');
    const playerBlackIndicator = document.getElementById('player-black');
    const playerWhiteIndicator = document.getElementById('player-white');

    let board = [];
    let currentPlayer = 'black'; // 'black' (User) or 'white' (AI)
    let gameActive = true;
    let ai = new OmokAI(BOARD_SIZE);

    // Initialize Game
    function initGame() {
        board = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
        currentPlayer = 'black';
        gameActive = true;
        renderBoard();
        updateStatus();
        modal.classList.add('hidden');
    }

    // Render the board grid
    function renderBoard() {
        boardElement.innerHTML = '';
        for (let r = 0; r < BOARD_SIZE; r++) {
            for (let c = 0; c < BOARD_SIZE; c++) {
                const cell = document.createElement('div');
                cell.classList.add('cell');
                cell.dataset.row = r;
                cell.dataset.col = c;

                // Add Hoshi (Star points)
                if (isHoshi(r, c)) {
                    cell.classList.add('hoshi');
                }

                cell.addEventListener('click', handleCellClick);
                boardElement.appendChild(cell);
            }
        }
    }

    function isHoshi(r, c) {
        // Standard star points for 13x13: (3,3), (3,9), (6,6), (9,3), (9,9)
        // 0-indexed: 3, 9, 6
        const points = [3, 9, 6];
        return points.includes(r) && points.includes(c);
    }

    // Handle user click
    function handleCellClick(e) {
        if (!gameActive || currentPlayer !== 'black') return;

        const r = parseInt(e.target.dataset.row);
        const c = parseInt(e.target.dataset.col);

        if (board[r][c] !== null) return; // Cell occupied

        placeStone(r, c, 'black');

        if (checkWin(r, c, 'black')) {
            endGame('You Win!');
            return;
        }

        currentPlayer = 'white';
        updateStatus();

        // AI Turn with slight delay for realism
        setTimeout(() => {
            if (!gameActive) return;
            const move = ai.calculateBestMove(board, 'white', 'black');
            if (move) {
                placeStone(move.r, move.c, 'white');
                if (checkWin(move.r, move.c, 'white')) {
                    endGame('AI Wins!');
                } else {
                    currentPlayer = 'black';
                    updateStatus();
                }
            }
        }, 500);
    }

    function placeStone(r, c, color) {
        board[r][c] = color;
        const cell = document.querySelector(`.cell[data-row='${r}'][data-col='${c}']`);

        // Remove previous last-move highlights
        document.querySelectorAll('.stone-piece').forEach(el => el.classList.remove('last-move'));

        const stone = document.createElement('div');
        stone.classList.add('stone-piece', color, 'last-move');
        cell.appendChild(stone);
    }

    function updateStatus() {
        if (currentPlayer === 'black') {
            playerBlackIndicator.classList.add('current');
            playerWhiteIndicator.classList.remove('current');
        } else {
            playerBlackIndicator.classList.remove('current');
            playerWhiteIndicator.classList.add('current');
        }
    }

    function checkWin(r, c, color) {
        return ai.checkWin(board, r, c, color);
    }

    function endGame(message) {
        gameActive = false;
        modalMessage.textContent = message;
        setTimeout(() => {
            modal.classList.remove('hidden');
        }, 500);
    }

    restartBtn.addEventListener('click', initGame);
    modalRestartBtn.addEventListener('click', initGame);

    // Start
    initGame();
});
