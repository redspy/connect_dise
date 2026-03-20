import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { TradingMobile } from './TradingMobile.js';

const sdk = new MobileSDK();
const game = new TradingMobile(sdk);
