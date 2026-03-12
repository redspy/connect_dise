/**
 * main.js — Give You Fire 모바일 진입점
 * MobileSDK를 초기화하고 TetrisMobile 인스턴스를 생성합니다.
 */

import { MobileSDK }    from '../../../platform/client/MobileSDK.js';
import { TetrisMobile } from './TetrisMobile.js';

const sdk  = new MobileSDK();
const game = new TetrisMobile(sdk); // eslint-disable-line no-unused-vars
