class OmokAI {
    constructor(boardSize) {
        this.size = boardSize;
        this.directions = [
            [0, 1],  // Horizontal
            [1, 0],  // Vertical
            [1, 1],  // Diagonal \
            [1, -1]  // Diagonal /
        ];
    }

    // Main function to get the best move
    calculateBestMove(board, aiColor, playerColor) {
        // 1. Check if AI can win immediately
        let winMove = this.findWinningMove(board, aiColor);
        if (winMove) return winMove;

        // 2. Check if Player is about to win and block it
        let blockMove = this.findWinningMove(board, playerColor);
        if (blockMove) return blockMove;

        // 3. Heuristic move based on scores
        return this.getBestHeuristicMove(board, aiColor, playerColor);
    }

    findWinningMove(board, color) {
        // Check all empty spots to see if placing a stone there creates 5 in a row
        // Or if it blocks a 4-in-a-row (which is effectively a win for the opponent)
        // Actually, for "winning move", we look for 4 existing stones that become 5.
        // For "blocking", we look for opponent's 3 or 4 that become dangerous.
        
        // Let's simplify: Check for "Open 4" or "4" that can become 5.
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (board[r][c] === null) {
                    board[r][c] = color;
                    if (this.checkWin(board, r, c, color)) {
                        board[r][c] = null;
                        return { r, c };
                    }
                    board[r][c] = null;
                }
            }
        }
        return null;
    }

    getBestHeuristicMove(board, aiColor, playerColor) {
        let bestScore = -Infinity;
        let bestMoves = [];

        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (board[r][c] === null) {
                    let score = this.evaluatePosition(board, r, c, aiColor, playerColor);
                    
                    // Add a little randomness to break ties and feel less robotic
                    score += Math.random() * 5; 

                    if (score > bestScore) {
                        bestScore = score;
                        bestMoves = [{ r, c }];
                    } else if (Math.abs(score - bestScore) < 1) {
                        bestMoves.push({ r, c });
                    }
                }
            }
        }

        if (bestMoves.length > 0) {
            const randomIdx = Math.floor(Math.random() * bestMoves.length);
            return bestMoves[randomIdx];
        }

        // Fallback: center or random
        const center = Math.floor(this.size / 2);
        if (board[center][center] === null) return { r: center, c: center };
        
        return { r: Math.floor(Math.random() * this.size), c: Math.floor(Math.random() * this.size) };
    }

    evaluatePosition(board, r, c, aiColor, playerColor) {
        let score = 0;

        // Prefer center
        const center = Math.floor(this.size / 2);
        const dist = Math.abs(r - center) + Math.abs(c - center);
        score -= dist; // Closer to center is better

        // Evaluate in all 4 directions
        for (let [dr, dc] of this.directions) {
            score += this.evaluateLine(board, r, c, dr, dc, aiColor, playerColor);
        }

        return score;
    }

    evaluateLine(board, r, c, dr, dc, aiColor, playerColor) {
        let score = 0;
        
        // Check AI potential (Offense)
        let aiCount = 0;
        let aiOpenEnds = 0;
        
        // Check Player potential (Defense)
        let playerCount = 0;
        let playerOpenEnds = 0;

        // Simulate placing stone at r,c
        
        // Scan for AI patterns
        let count = 1; // The stone we are placing
        let open1 = false;
        let open2 = false;
        
        // Check forward
        let i = 1;
        while (this.isValid(r + i * dr, c + i * dc) && board[r + i * dr][c + i * dc] === aiColor) {
            count++;
            i++;
        }
        if (this.isValid(r + i * dr, c + i * dc) && board[r + i * dr][c + i * dc] === null) open1 = true;

        // Check backward
        let j = 1;
        while (this.isValid(r - j * dr, c - j * dc) && board[r - j * dr][c - j * dc] === aiColor) {
            count++;
            j++;
        }
        if (this.isValid(r - j * dr, c - j * dc) && board[r - j * dr][c - j * dc] === null) open2 = true;

        if (count >= 5) score += 10000;
        else if (count === 4 && (open1 || open2)) score += 1000; // Open 4 or blocked 4
        else if (count === 3 && open1 && open2) score += 500; // Open 3
        else if (count === 3 && (open1 || open2)) score += 100;
        else if (count === 2 && open1 && open2) score += 50;

        // Scan for Player patterns (Blocking)
        // We pretend the opponent placed a stone here. How dangerous would it be?
        let pCount = 1;
        let pOpen1 = false;
        let pOpen2 = false;

        i = 1;
        while (this.isValid(r + i * dr, c + i * dc) && board[r + i * dr][c + i * dc] === playerColor) {
            pCount++;
            i++;
        }
        if (this.isValid(r + i * dr, c + i * dc) && board[r + i * dr][c + i * dc] === null) pOpen1 = true;

        j = 1;
        while (this.isValid(r - j * dr, c - j * dc) && board[r - j * dr][c - j * dc] === playerColor) {
            pCount++;
            j++;
        }
        if (this.isValid(r - j * dr, c - j * dc) && board[r - j * dr][c - j * dc] === null) pOpen2 = true;

        if (pCount >= 5) score += 9000; // MUST BLOCK
        else if (pCount === 4 && (pOpen1 || pOpen2)) score += 800;
        else if (pCount === 3 && pOpen1 && pOpen2) score += 400;
        else if (pCount === 3 && (pOpen1 || pOpen2)) score += 80;

        return score;
    }

    isValid(r, c) {
        return r >= 0 && r < this.size && c >= 0 && c < this.size;
    }

    checkWin(board, r, c, color) {
        for (let [dr, dc] of this.directions) {
            let count = 1;
            
            // Check forward
            let i = 1;
            while (this.isValid(r + i * dr, c + i * dc) && board[r + i * dr][c + i * dc] === color) {
                count++;
                i++;
            }

            // Check backward
            let j = 1;
            while (this.isValid(r - j * dr, c - j * dc) && board[r - j * dr][c - j * dc] === color) {
                count++;
                j++;
            }

            if (count >= 5) return true;
        }
        return false;
    }
}
