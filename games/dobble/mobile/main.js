import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { DobbleMobile } from './DobbleMobile.js';

const sdk = new MobileSDK({ gameId: 'dobble' });
new DobbleMobile(sdk);
