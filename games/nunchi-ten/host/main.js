import { HostSDK } from '../../../platform/client/HostSDK.js';
import { NunchiGame } from './NunchiGame.js';
import { NunchiDevPanel } from './NunchiDevPanel.js';

const IS_DEV = new URLSearchParams(location.search).has('dev');

const sdk = new HostSDK({ gameId: 'nunchi-ten' });
const game = new NunchiGame(sdk);

if (IS_DEV) {
  new NunchiDevPanel({
    onJumpToRound: (round) => game.devJumpToRound(round),
  });
}
