import { HostSDK } from '../../../platform/client/HostSDK.js';
import { TradingBattleGame } from './TradingBattleGame.js';

const sdk = new HostSDK({ gameId: 'trading-battle' });
const game = new TradingBattleGame(sdk);
