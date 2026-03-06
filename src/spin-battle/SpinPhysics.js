export const BOARD_RADIUS = 5;
export const SPINNER_RADIUS = 0.38;
export const MAX_RPM = 3000;
export const BASE_DECAY = 0.3;      // rpm/frame at 60fps  (3000rpm → ~167s 자연 소진)
export const COLLISION_PENALTY = 6;
export const EDGE_PENALTY = 0.8;
export const MAX_MOVE_FORCE = 0.009;
export const FRICTION = 0.96;

export class SpinPhysics {
  constructor() {
    this.spinners = new Map(); // playerId → state object
  }

  addSpinner(playerId, color, rpm, spawnAngle) {
    const r = BOARD_RADIUS * 0.45;
    this.spinners.set(playerId, {
      id: playerId,
      color,
      rpm,
      x: Math.cos(spawnAngle) * r,
      z: Math.sin(spawnAngle) * r,
      vx: 0,
      vz: 0,
      tiltX: 0,
      tiltZ: 0,
      eliminated: false,
    });
  }

  setTilt(playerId, tiltX, tiltZ) {
    const s = this.spinners.get(playerId);
    if (s && !s.eliminated) {
      s.tiltX = tiltX;
      s.tiltZ = tiltZ;
    }
  }

  // Returns array of { id, reason } for newly eliminated spinners
  update() {
    const active = [...this.spinners.values()].filter(s => !s.eliminated);

    // Apply tilt forces and decay RPM
    for (const s of active) {
      const power = (s.rpm / MAX_RPM) * MAX_MOVE_FORCE;
      s.vx += s.tiltX * power;
      s.vz += s.tiltZ * power;
      s.vx *= FRICTION;
      s.vz *= FRICTION;
      s.rpm = Math.max(0, s.rpm - BASE_DECAY);
    }

    // Move
    for (const s of active) {
      s.x += s.vx;
      s.z += s.vz;
    }

    // Circle-circle collisions
    const collisions = []; // track for particle effects
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const hit = this._resolveCollision(active[i], active[j]);
        if (hit) collisions.push(hit);
      }
    }

    // Board boundary
    for (const s of active) {
      const dist = Math.sqrt(s.x * s.x + s.z * s.z);
      const limit = BOARD_RADIUS - SPINNER_RADIUS;
      if (dist > limit) {
        const nx = s.x / dist;
        const nz = s.z / dist;
        const overlap = dist - limit;
        s.x -= nx * overlap;
        s.z -= nz * overlap;
        // Reflect velocity
        const dot = s.vx * nx + s.vz * nz;
        if (dot > 0) {
          s.vx -= 2 * dot * nx * 0.6;
          s.vz -= 2 * dot * nz * 0.6;
        }
        s.rpm = Math.max(0, s.rpm - EDGE_PENALTY);
      }
    }

    // Elimination check
    const eliminated = [];
    for (const s of active) {
      const dist = Math.sqrt(s.x * s.x + s.z * s.z);
      if (dist > BOARD_RADIUS + 0.3) {
        s.eliminated = true;
        eliminated.push({ id: s.id, reason: 'fell_off', x: s.x, z: s.z });
      } else if (s.rpm <= 0) {
        s.eliminated = true;
        eliminated.push({ id: s.id, reason: 'stopped', x: s.x, z: s.z });
      }
    }

    return { eliminated, collisions };
  }

  _resolveCollision(a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distSq = dx * dx + dz * dz;
    const minDist = SPINNER_RADIUS * 2;

    if (distSq >= minDist * minDist || distSq === 0) return null;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;

    // Separate
    const overlap = minDist - dist;
    a.x -= nx * overlap * 0.5;
    a.z -= nz * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.z += nz * overlap * 0.5;

    // Impulse: elastic bounce with RPM-based minimum push
    const relVx = b.vx - a.vx;
    const relVz = b.vz - a.vz;
    const dot = relVx * nx + relVz * nz;
    const combinedRpm = (a.rpm + b.rpm) / 2;
    const minPush = (combinedRpm / MAX_RPM) * 0.04; // RPM 기반 최소 반발력
    const impulse = Math.min(dot * 1.6, -minPush); // 반발계수 1.6, 항상 최소 튕김 보장
    a.vx += impulse * nx;
    a.vz += impulse * nz;
    b.vx -= impulse * nx;
    b.vz -= impulse * nz;

    // RPM-based push: higher RPM spinner pushes harder
    const rpmDiff = (a.rpm - b.rpm) * 0.000025;
    a.vx += rpmDiff * nx;
    a.vz += rpmDiff * nz;
    b.vx -= rpmDiff * nx;
    b.vz -= rpmDiff * nz;

    // RPM penalty from collision
    const penalty = COLLISION_PENALTY * (0.5 + Math.random() * 0.5);
    a.rpm = Math.max(0, a.rpm - penalty);
    b.rpm = Math.max(0, b.rpm - penalty);

    return { ax: a.x, az: a.z, bx: b.x, bz: b.z, colorA: a.color, colorB: b.color };
  }

  getState() {
    return [...this.spinners.values()];
  }
}
