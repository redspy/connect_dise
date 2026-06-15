import { HostSDK } from '../../../platform/client/HostSDK.js';
import { PiratePlunderGame } from './PiratePlunderGame.js';

const sdk = new HostSDK({ gameId: 'pirate-plunder' });
new PiratePlunderGame(sdk);
