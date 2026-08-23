/**
 * main.js — 루미큐브 호스트 진입점
 */
import { HostSDK } from '../../../platform/client/HostSDK.js';
import { RummikubGame } from './RummikubGame.js';

const sdk = new HostSDK({ gameId: 'rummikub' });
const game = new RummikubGame(sdk); // eslint-disable-line no-unused-vars
