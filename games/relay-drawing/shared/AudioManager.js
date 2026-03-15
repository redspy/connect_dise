/**
 * AudioManager.js
 * 간단한 사운드 관리 유틸리티
 */
export class AudioManager {
  constructor() {
    this._bgm = null;
    this._sfx = new Map();
    this._muted = false;
  }

  // BGM 재생
  playBGM(url, loop = true) {
    if (this._bgm) {
      if (this._bgm.src.endsWith(url)) return;
      this._bgm.pause();
    }
    this._bgm = new Audio(url);
    this._bgm.loop = loop;
    this._bgm.volume = 0.4;
    if (!this._muted) {
      this._bgm.play().catch(e => console.warn('BGM play failed:', e));
    }
  }

  stopBGM() {
    if (this._bgm) {
      this._bgm.pause();
      this._bgm = null;
    }
  }

  // SFX 로드 및 재생
  playSFX(url, volume = 1.0) {
    let audio = this._sfx.get(url);
    if (!audio) {
      audio = new Audio(url);
      this._sfx.set(url, audio);
    }
    audio.volume = volume;
    audio.currentTime = 0;
    if (!this._muted) {
      audio.play().catch(e => console.warn('SFX play failed:', e));
    }
  }

  toggleMute() {
    this._muted = !this._muted;
    if (this._muted && this._bgm) {
      this._bgm.pause();
    } else if (!this._muted && this._bgm) {
      this._bgm.play().catch(e => {});
    }
    return this._muted;
  }
}

export const audioManager = new AudioManager();
