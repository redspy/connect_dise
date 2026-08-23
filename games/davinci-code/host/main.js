/**
 * main.js — 다빈치 코드 호스트 진입점
 */
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { DavinciGame } from './DavinciGame.js';

const sdk = new HostSDK({ gameId: 'davinci-code' });
const game = new DavinciGame(sdk); // eslint-disable-line no-unused-vars
