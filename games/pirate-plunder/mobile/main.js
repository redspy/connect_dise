import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { PiratePlunderMobile } from './PiratePlunderMobile.js';

const sdk = new MobileSDK({ gameId: 'pirate-plunder' });
new PiratePlunderMobile(sdk);
