export class SensorManager {
  constructor() {
    this._orientationHandler = null;
    this._motionHandler = null;
  }

  async requestPermission() {
    const promises = [];

    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function'
    ) {
      promises.push(DeviceOrientationEvent.requestPermission());
    }

    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      promises.push(DeviceMotionEvent.requestPermission());
    }

    if (promises.length === 0) {
      return true; // Not iOS 13+ or not an HTTPS context
    }

    try {
      const results = await Promise.all(promises);
      return results.every(res => res === 'granted');
    } catch (err) {
      console.warn('Sensor permission error:', err);
      return false;
    }
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
