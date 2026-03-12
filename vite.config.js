import { defineConfig } from 'vite';
import { resolve } from 'path';
import { existsSync, readdirSync, readFileSync, cpSync } from 'fs';
import { extname } from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

/**
 * 각 게임의 games/<id>/assets/ 폴더를 /games/<id>/assets/ URL로 서빙하는 플러그인.
 * 게임을 플러그인/스토어 형태로 추가해도 별도 설정 없이 자동 동작합니다.
 */
function gameAssetsPlugin() {
  return {
    name: 'game-assets',

    // dev: games/*/assets/ → /games/*/assets/ 미들웨어
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/games\/([^/?#]+)\/assets\/(.+?)(\?.*)?$/);
        if (!match) return next();
        const [, gameId, assetPath] = match;
        const filePath = resolve(`games/${gameId}/assets/${assetPath}`);
        if (!existsSync(filePath)) return next();
        res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
        res.end(readFileSync(filePath));
      });
    },

    // build: games/*/assets/ → dist/games/*/assets/ 복사
    closeBundle() {
      const gamesDir = 'games';
      if (!existsSync(gamesDir)) return;
      for (const gameId of readdirSync(gamesDir)) {
        const assetsDir = `${gamesDir}/${gameId}/assets`;
        if (existsSync(assetsDir)) {
          cpSync(assetsDir, `dist/games/${gameId}/assets`, { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    basicSsl(),
    gameAssetsPlugin(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://127.0.0.1:3000',
        ws: true
      }
    }
  },
  build: {
    rollupOptions: {
      input: {
        lobby:            resolve(__dirname, 'index.html'),
        spinBattleHost:   resolve(__dirname, 'games/spin-battle/host/index.html'),
        spinBattleMobile: resolve(__dirname, 'games/spin-battle/mobile/index.html'),
        diceHost:         resolve(__dirname, 'games/dice/host/index.html'),
        diceMobile:       resolve(__dirname, 'games/dice/mobile/index.html'),
        nunchiHost:       resolve(__dirname, 'games/nunchi-ten/host/index.html'),
        nunchiMobile:     resolve(__dirname, 'games/nunchi-ten/mobile/index.html'),
        digitPuzzleHost:   resolve(__dirname, 'games/digit-puzzle/host/index.html'),
        digitPuzzleMobile: resolve(__dirname, 'games/digit-puzzle/mobile/index.html'),
        giveYouFireHost:   resolve(__dirname, 'games/give-you-fire/host/index.html'),
        giveYouFireMobile: resolve(__dirname, 'games/give-you-fire/mobile/index.html'),
      },
    },
  },
});
