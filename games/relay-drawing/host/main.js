import { HostSDK } from '../../../platform/client/HostSDK.js';
import { RelayDrawingGame } from './RelayDrawingGame.js';

const sdk = new HostSDK({ gameId: 'relay-drawing' });
const game = new RelayDrawingGame(sdk);
