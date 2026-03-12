/**
 * main.js — Give You Fire 호스트 진입점
 * HostSDK를 초기화하고 TetrisGame 인스턴스를 생성합니다.
 */

import { HostSDK }    from '../../../platform/client/HostSDK.js';
import { TetrisGame } from './TetrisGame.js';

const sdk  = new HostSDK({ gameId: 'give-you-fire' });
const game = new TetrisGame(sdk); // eslint-disable-line no-unused-vars
