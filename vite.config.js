import { defineConfig } from 'vite';
import { resolve } from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    basicSsl()
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
      },
    },
  },
});
