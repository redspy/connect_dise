export class SensorManager {
  constructor() {
    this._orientationHandler = null;
    this._motionHandler = null;
  }

  async requestPermission() {
    // On iOS 13+, requesting DeviceMotionEvent implicitly grants DeviceOrientationEvent too.
    // iOS Safari throws a security error if we call requestPermission() twice on the same user gesture.
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    ) {
      try {
        const state = await DeviceMotionEvent.requestPermission();
        return state === 'granted';
      } catch (err) {
        console.warn('Sensor permission error:', err);
        return false;
      }
    }
    
    // For non-iOS 13+ devices, or when accessed over HTTP where the API is unavailable
    return true;
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
