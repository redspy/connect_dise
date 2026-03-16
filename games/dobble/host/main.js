import { HostSDK } from '../../../platform/client/HostSDK.js';
import { DobbleGame } from './DobbleGame.js';

const sdk  = new HostSDK({ gameId: 'dobble' });
new DobbleGame(sdk);
