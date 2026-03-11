import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { PuzzleMobile } from './PuzzleMobile.js';

const sdk = new MobileSDK();
new PuzzleMobile(sdk);
