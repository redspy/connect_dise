export class SensorManager {
  constructor() {
    this._orientationHandler = null;
    this._motionHandler = null;
  }

  async requestPermission() {
    let granted = true;

    // iOS 13+ requires explicit permission. 
    // Requesting DeviceMotionEvent usually covers both on iOS Safari.
    // We use else if to prevent double prompting which auto-denies the second request.
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      try {
        const state = await DeviceMotionEvent.requestPermission();
        granted = (state === 'granted');
      } catch (err) {
        console.warn('DeviceMotionEvent permit error:', err);
      }
    } else if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      try {
        const state = await DeviceOrientationEvent.requestPermission();
        granted = (state === 'granted');
      } catch (err) {
        console.warn('DeviceOrientationEvent permit error:', err);
      }
    }

    return granted;
  }

  onOrientation(callback) {
    this._orientationHandler = (e) => {
      callback({ beta: e.beta ?? 0, gamma: e.gamma ?? 0, alpha: e.alpha ?? 0 });
    };
    window.addEventListener('deviceorientation', this._orientationHandler);
  }

  onMotion(callback) {
    this._motionHandler = (e) => {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc) return;
      const mag = Math.sqrt((acc.x ?? 0) ** 2 + (acc.y ?? 0) ** 2 + (acc.z ?? 0) ** 2);
      const shakeMagnitude = Math.max(0, mag - 9.8);
      callback({ shakeMagnitude, acc });
    };
    window.addEventListener('devicemotion', this._motionHandler);
  }

  destroy() {
    if (this._orientationHandler) {
      window.removeEventListener('deviceorientation', this._orientationHandler);
      this._orientationHandler = null;
    }
    if (this._motionHandler) {
      window.removeEventListener('devicemotion', this._motionHandler);
      this._motionHandler = null;
    }
  }
}
