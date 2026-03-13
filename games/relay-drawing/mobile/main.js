import { MobileSDK } from '../../../platform/client/MobileSDK.js';
import { RelayDrawingMobile } from './RelayDrawingMobile.js';

// SDK 초기화 및 게임 인스턴스 생성
const sdk = new MobileSDK();
const game = new RelayDrawingMobile(sdk);
