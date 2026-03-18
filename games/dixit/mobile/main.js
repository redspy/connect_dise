import { MobileSDK }   from '../../../platform/client/MobileSDK.js';
import { DixitMobile } from './DixitMobile.js';

const sdk = new MobileSDK({ gameId: 'dixit' });
new DixitMobile(sdk);
