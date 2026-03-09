import { HostSDK } from '../../../platform/client/HostSDK.js';
import { SpinGame } from './SpinGame.js';
import { DevPanel } from './DevPanel.js';

const IS_DEV = new URLSearchParams(location.search).has('dev');

const sdk = new HostSDK({ gameId: 'spin-battle' });
const game = new SpinGame(sdk, document.getElementById('spin-canvas'), { devMode: IS_DEV });

if (IS_DEV) {
  new DevPanel({
    onSpawnIntervalChange: (ms) => game.setItemSpawnInterval(ms),
    onVisualParamChange: (key, value) => game.setVisualParam(key, value),
    onVisualReset: () => game.resetVisualParams(),
    getVisualState: () => game.getVisualState(),
  });
}
