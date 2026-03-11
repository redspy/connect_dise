import { HostSDK } from '../../../platform/client/HostSDK.js';
import { PuzzleGame } from './PuzzleGame.js';

const sdk = new HostSDK({ gameId: 'digit-puzzle' });
new PuzzleGame(sdk);
