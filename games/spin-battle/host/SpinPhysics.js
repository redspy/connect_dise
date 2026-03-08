export const BOARD_RADIUS = 5.5;
export const SPINNER_RADIUS = 0.57;
export const MAX_RPM = 3000;
export const BOWL_HEIGHT = 1.0; // 비주얼 bowl rim 높이 (renderer에서 사용)

export const ITEM_TYPES = {
  ENERGY: 'energy', // RPM +5%
  SHIELD: 'shield', // 10s: 충돌 시 상대방 강하게 튕김
  COGS: 'cogs', // 5s: 충돌 시 상대방 RPM 더 많이 깎음
};

// 런타임에 DevPanel에서 실시간 수정 가능한 파라미터
export const physicsConfig = {
  BOWL_FORCE: 0.0004, // 중심 인력 (r에 비례)
  BASE_DECAY: 0.3, // rpm/frame 자연 감소
  MAX_MOVE_FORCE: 0.009, // 기울기 → 속도 변환 계수
  FRICTION: 0.94, // 속도 감쇠
  COLLISION_PENALTY: 6, // 충돌 시 RPM 페널티
  EDGE_PENALTY: 1.4, // 경계 충돌 RPM 페널티
  WALL_RESTITUTION: 2.5, // 벽 반발계수 (0=흡수, 1=완전탄성)
};

const ITEM_PICKUP_RADIUS = 0.5;
const ITEM_TTL = 420; // ~7s @ 60fps
const SHIELD_DURATION = 600; // ~10s @ 60fps
const COGS_DURATION = 300; // ~5s  @ 60fps

export class SpinPhysics {
  constructor() {
    this.spinners = new Map();
    this.items = [];
    this.spinnerBuffs = new Map();
    this._nextItemId = 0;
    this._physicsFrame = 0;
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
    this.spinnerBuffs.set(playerId, { shield: 0, cogs: 0 });
  }

  setTilt(playerId, tiltX, tiltZ) {
    const s = this.spinners.get(playerId);
    if (s && !s.eliminated) {
      s.tiltX = tiltX;
      s.tiltZ = tiltZ;
    }
  }

  spawnItem(type) {
    const angle = Math.random() * Math.PI * 2;
    const radius = (0.25 + Math.random() * 0.65) * BOARD_RADIUS;
    const item = {
      id: this._nextItemId++,
      type,
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      spawnFrame: this._physicsFrame,
    };
    this.items.push(item);
    return item;
  }

  getBuffs(playerId) {
    return this.spinnerBuffs.get(playerId) || { shield: 0, cogs: 0 };
  }

  // Returns { eliminated, collisions, pickedUp, expired }
  update() {
    this._physicsFrame++;
    const cfg = physicsConfig;
    const active = [...this.spinners.values()].filter((s) => !s.eliminated);

    // Apply tilt forces, bowl gravity, decay RPM
    for (const s of active) {
      const power = (s.rpm / MAX_RPM) * cfg.MAX_MOVE_FORCE;
      s.vx += s.tiltX * power;
      s.vz += s.tiltZ * power;
      s.vx -= s.x * cfg.BOWL_FORCE;
      s.vz -= s.z * cfg.BOWL_FORCE;
      s.vx *= cfg.FRICTION;
      s.vz *= cfg.FRICTION;
      s.rpm = Math.max(0, s.rpm - cfg.BASE_DECAY);
    }

    // Tick buff durations
    for (const buffs of this.spinnerBuffs.values()) {
      if (buffs.shield > 0) buffs.shield--;
      if (buffs.cogs > 0) buffs.cogs--;
    }

    // Move
    for (const s of active) {
      s.x += s.vx;
      s.z += s.vz;
    }

    // Item TTL expiry (7초)
    const expired = [];
    for (const item of [...this.items]) {
      if (this._physicsFrame - item.spawnFrame > ITEM_TTL) {
        const idx = this.items.indexOf(item);
        if (idx >= 0) this.items.splice(idx, 1);
        expired.push(item);
      }
    }

    // Item pickups
    const pickedUp = [];
    for (const item of [...this.items]) {
      for (const s of active) {
        const dx = s.x - item.x;
        const dz = s.z - item.z;
        if (dx * dx + dz * dz < ITEM_PICKUP_RADIUS * ITEM_PICKUP_RADIUS) {
          this._applyItemEffect(s, item.type);
          pickedUp.push({ item, playerId: s.id });
          const idx = this.items.indexOf(item);
          if (idx >= 0) this.items.splice(idx, 1);
          break;
        }
      }
    }

    // Circle-circle collisions
    const collisions = [];
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const hit = this._resolveCollision(active[i], active[j]);
        if (hit) collisions.push(hit);
      }
    }

    // Board boundary
    const wallHits = [];
    for (const s of active) {
      const dist = Math.sqrt(s.x * s.x + s.z * s.z);
      const limit = BOARD_RADIUS - SPINNER_RADIUS;
      if (dist > limit) {
        const nx = s.x / dist;
        const nz = s.z / dist;
        const overlap = dist - limit;
        s.x -= nx * overlap;
        s.z -= nz * overlap;
        const dot = s.vx * nx + s.vz * nz;
        if (dot > 0) {
          s.vx -= 2 * dot * nx * cfg.WALL_RESTITUTION;
          s.vz -= 2 * dot * nz * cfg.WALL_RESTITUTION;
          // 벽 충돌 위치: 경계면 위 지점
          const wx = nx * limit;
          const wz = nz * limit;
          wallHits.push({ x: wx, z: wz, color: s.color, speed: Math.abs(dot) });
        }
        s.rpm = Math.max(0, s.rpm - cfg.EDGE_PENALTY);
      }
    }

    // Elimination
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

    return { eliminated, collisions, pickedUp, expired, wallHits };
  }

  _applyItemEffect(spinner, type) {
    if (type === ITEM_TYPES.ENERGY) {
      spinner.rpm = Math.min(MAX_RPM, spinner.rpm * 1.05);
    } else if (type === ITEM_TYPES.SHIELD) {
      const buffs = this.spinnerBuffs.get(spinner.id);
      if (buffs) buffs.shield = SHIELD_DURATION;
    } else if (type === ITEM_TYPES.COGS) {
      const buffs = this.spinnerBuffs.get(spinner.id);
      if (buffs) buffs.cogs = COGS_DURATION;
    }
  }

  _resolveCollision(a, b) {
    const cfg = physicsConfig;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distSq = dx * dx + dz * dz;
    const minDist = SPINNER_RADIUS * 2;

    if (distSq >= minDist * minDist || distSq === 0) return null;

    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;

    const overlap = minDist - dist;
    a.x -= nx * overlap * 0.5;
    a.z -= nz * overlap * 0.5;
    b.x += nx * overlap * 0.5;
    b.z += nz * overlap * 0.5;

    const buffsA = this.spinnerBuffs.get(a.id) || { shield: 0, cogs: 0 };
    const buffsB = this.spinnerBuffs.get(b.id) || { shield: 0, cogs: 0 };

    const relVx = b.vx - a.vx;
    const relVz = b.vz - a.vz;
    const dot = relVx * nx + relVz * nz;
    const combinedRpm = (a.rpm + b.rpm) / 2;
    const minPush = (combinedRpm / MAX_RPM) * 0.04;
    const impulse = Math.min(dot * 1.6, -minPush);
    a.vx += impulse * nx;
    a.vz += impulse * nz;
    b.vx -= impulse * nx;
    b.vz -= impulse * nz;

    // Shield: push opponent away harder
    if (buffsA.shield > 0) {
      b.vx -= nx * 0.09;
      b.vz -= nz * 0.09;
    }
    if (buffsB.shield > 0) {
      a.vx += nx * 0.09;
      a.vz += nz * 0.09;
    }

    const rpmDiff = (a.rpm - b.rpm) * 0.000025;
    a.vx += rpmDiff * nx;
    a.vz += rpmDiff * nz;
    b.vx -= rpmDiff * nx;
    b.vz -= rpmDiff * nz;

    // RPM penalty (cogs: deal 2.5x damage to opponent)
    const penaltyBase = cfg.COLLISION_PENALTY * (0.5 + Math.random() * 0.5);
    a.rpm = Math.max(0, a.rpm - penaltyBase * (buffsB.cogs > 0 ? 2.5 : 1.0));
    b.rpm = Math.max(0, b.rpm - penaltyBase * (buffsA.cogs > 0 ? 2.5 : 1.0));

    return {
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      colorA: a.color,
      colorB: b.color,
    };
  }

  getState() {
    return [...this.spinners.values()];
  }
}
