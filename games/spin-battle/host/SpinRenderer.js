import * as THREE from 'three';
import { BOARD_RADIUS, SPINNER_RADIUS, MAX_RPM, BOWL_HEIGHT, ITEM_TYPES } from './SpinPhysics.js';

export class SpinRenderer {
  constructor(container) {
    this.container = container;
    this.spinnerMeshes = new Map();     // playerId → THREE.Group
    this.spinAngles = new Map();        // playerId → accumulated spin angle (rad)
    this.precessionAngles = new Map();  // playerId → accumulated precession angle (rad)
    this.particles = [];
    this.itemMeshes = new Map();        // itemId → THREE.Group
    this._frame = 0;

    // Reusable quaternion objects to avoid per-frame GC pressure
    this._tiltQuat = new THREE.Quaternion();
    this._spinQuat = new THREE.Quaternion();
    this._tiltAxis = new THREE.Vector3();
    this._yAxis   = new THREE.Vector3(0, 1, 0);

    this._setupRenderer();
    this._setupScene();
    this._setupBoard();
    this._setupLights();
  }

  _setupRenderer() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100);
    this.camera.position.set(0, 14, 6);
    this.camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => this._onResize());
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    // No scene.background → CSS body gradient shows through (alpha: true)
  }

  _setupBoard() {
    // ── 어두운 금속 오목 경기장 (사이버틱) ─────────────────────────────────
    const bowlPoints = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      bowlPoints.push(new THREE.Vector2(t * BOARD_RADIUS, BOWL_HEIGHT * t * t));
    }

    const bowlGeo = new THREE.LatheGeometry(bowlPoints, 96);
    const bowlMat = new THREE.MeshStandardMaterial({
      color: 0x0b0f1c,
      roughness: 0.22,
      metalness: 0.92,
      side: THREE.DoubleSide,
    });
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.receiveShadow = true;
    this.scene.add(bowl);

    // ── 동심 네온 링 (경기장 바닥 트랙) ───────────────────────────────────
    const ringDefs = [
      { f: 0.26, color: 0x4499ff, intensity: 2.2 },  // 내부 블루
      { f: 0.53, color: 0xaa44ff, intensity: 1.8 },  // 중간 퍼플
      { f: 0.80, color: 0x00ffcc, intensity: 2.4 },  // 외부 시안
    ];
    for (const { f, color, intensity } of ringDefs) {
      const r = f * BOARD_RADIUS;
      const y = BOWL_HEIGHT * f * f;
      const geo = new THREE.TorusGeometry(r, 0.038, 8, 96);
      const mat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: intensity,
        roughness: 0.1, metalness: 0.3,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y + 0.012;
      this.scene.add(ring);
      // 링 글로우 라이트
      const gl = new THREE.PointLight(color, 0.55, BOARD_RADIUS * 0.9);
      gl.position.set(0, y + 0.08, 0);
      this.scene.add(gl);
    }

    // ── 중앙 글로우 스팟 ────────────────────────────────────────────────────
    const cGeo = new THREE.CircleGeometry(BOARD_RADIUS * 0.09, 32);
    const cMat = new THREE.MeshBasicMaterial({ color: 0x4499ff, transparent: true, opacity: 0.5 });
    const cMesh = new THREE.Mesh(cGeo, cMat);
    cMesh.rotation.x = -Math.PI / 2;
    cMesh.position.y = 0.004;
    this.scene.add(cMesh);

    // ── 시안 네온 림 ────────────────────────────────────────────────────────
    const rimGeo = new THREE.TorusGeometry(BOARD_RADIUS, 0.22, 16, 96);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x00eeff, emissive: 0x00eeff, emissiveIntensity: 2.5,
      metalness: 0.5, roughness: 0.08,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = BOWL_HEIGHT;
    this.scene.add(rim);

    // 림 주변 글로우 라이트 4개
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const rl = new THREE.PointLight(0x00eeff, 1.6, 5);
      rl.position.set(Math.cos(a) * BOARD_RADIUS, BOWL_HEIGHT + 0.15, Math.sin(a) * BOARD_RADIUS);
      this.scene.add(rl);
    }

    // ── 외벽 (어두운 금속) ──────────────────────────────────────────────────
    const outerGeo = new THREE.CylinderGeometry(
      BOARD_RADIUS * 1.04, BOARD_RADIUS * 1.09, BOWL_HEIGHT * 1.25, 96, 1, true
    );
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x080c18, roughness: 0.3, metalness: 0.95, side: THREE.BackSide,
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.y = BOWL_HEIGHT * 0.5;
    this.scene.add(outer);

    // ── 핑크/마젠타 어센트 링 (외벽 상단) ─────────────────────────────────
    const accentGeo = new THREE.TorusGeometry(BOARD_RADIUS * 1.055, 0.055, 8, 96);
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xff44aa, emissive: 0xff44aa, emissiveIntensity: 1.8,
    });
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.rotation.x = Math.PI / 2;
    accent.position.y = BOWL_HEIGHT * 1.1;
    this.scene.add(accent);

    // 핑크 어센트 글로우
    for (let i = 0; i < 4; i++) {
      const a = (i / 4 + 0.125) * Math.PI * 2;
      const pl = new THREE.PointLight(0xff44aa, 0.7, 4);
      pl.position.set(Math.cos(a) * BOARD_RADIUS * 1.05, BOWL_HEIGHT * 1.1, Math.sin(a) * BOARD_RADIUS * 1.05);
      this.scene.add(pl);
    }
  }

  _setupLights() {
    // 어두운 사이버 앰비언트
    this.scene.add(new THREE.AmbientLight(0x0d1133, 0.5));

    // 메인 방향광 (쿨 블루화이트)
    const dir = new THREE.DirectionalLight(0x88aaff, 0.85);
    dir.position.set(6, 14, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 45;
    dir.shadow.camera.left = -13;
    dir.shadow.camera.right = 13;
    dir.shadow.camera.top = 13;
    dir.shadow.camera.bottom = -13;
    this.scene.add(dir);

    // 퍼플 네온 사이드 필
    const purple = new THREE.PointLight(0x8844ff, 1.1, 25);
    purple.position.set(-9, 5, -5);
    this.scene.add(purple);

    // 시안 네온 사이드 필
    const cyan = new THREE.PointLight(0x00ccff, 1.1, 25);
    cyan.position.set(9, 5, -5);
    this.scene.add(cyan);

    // 핑크 드라마틱 백라이트
    const pinkBack = new THREE.PointLight(0xff3388, 0.7, 20);
    pinkBack.position.set(0, 2, 10);
    this.scene.add(pinkBack);

    // 오렌지 반대편 악센트
    const orange = new THREE.PointLight(0xff6600, 0.45, 18);
    orange.position.set(0, 4, -10);
    this.scene.add(orange);
  }

  _buildSpinnerMesh(color) {
    const group = new THREE.Group();

    const profile = [
      new THREE.Vector2(0,    -0.48),
      new THREE.Vector2(0.07, -0.32),
      new THREE.Vector2(0.55,  0.00),
      new THREE.Vector2(0.52,  0.08),
      new THREE.Vector2(0.18,  0.26),
      new THREE.Vector2(0.04,  0.40),
      new THREE.Vector2(0,     0.40),
    ];
    const bodyGeo = new THREE.LatheGeometry(profile, 28);
    const spinnerColor = new THREE.Color(color);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: spinnerColor,
      metalness: 0.45,
      roughness: 0.4,
      emissive: spinnerColor,
      emissiveIntensity: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    body.scale.set(SPINNER_RADIUS / 0.55, SPINNER_RADIUS / 0.55, SPINNER_RADIUS / 0.55);
    group.add(body);

    const ringGeo = new THREE.TorusGeometry(SPINNER_RADIUS * 0.55, SPINNER_RADIUS * 0.09, 8, 28);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.9,
      roughness: 0.1,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = SPINNER_RADIUS * 0.3;
    group.add(ring);

    const tipGeo = new THREE.SphereGeometry(0.03, 8, 8);
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9 });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = -SPINNER_RADIUS * 0.88;
    group.add(tip);

    return group;
  }

  addSpinner(playerId, color) {
    const mesh = this._buildSpinnerMesh(color);
    mesh.position.y = SPINNER_RADIUS * 0.88;
    this.spinnerMeshes.set(playerId, mesh);
    this.spinAngles.set(playerId, Math.random() * Math.PI * 2);
    this.precessionAngles.set(playerId, Math.random() * Math.PI * 2);
    this.scene.add(mesh);
  }

  removeSpinner(playerId) {
    const mesh = this.spinnerMeshes.get(playerId);
    if (mesh) {
      this.scene.remove(mesh);
      this.spinnerMeshes.delete(playerId);
      this.spinAngles.delete(playerId);
      this.precessionAngles.delete(playerId);
    }
  }

  updateSpinner(playerId, x, z, rpm) {
    const mesh = this.spinnerMeshes.get(playerId);
    if (!mesh) return;

    const rpmRatio = Math.max(0, rpm / MAX_RPM);

    mesh.position.x = x;
    mesh.position.z = z;

    // Follow bowl surface: spinner y = bowlSurface + height above tip
    const rSq = x * x + z * z;
    const bowlSurfaceY = BOWL_HEIGHT * rSq / (BOARD_RADIUS * BOARD_RADIUS);

    const spinDelta = rpmRatio * 0.5;
    const spinAngle = ((this.spinAngles.get(playerId) || 0) + spinDelta) % (Math.PI * 2);
    this.spinAngles.set(playerId, spinAngle);

    const precSpeed = Math.pow(1 - rpmRatio, 5) * 0.25;
    const precAngle = ((this.precessionAngles.get(playerId) || 0) + precSpeed) % (Math.PI * 2);
    this.precessionAngles.set(playerId, precAngle);

    const tiltAngle = Math.pow(1 - rpmRatio, 4) * (Math.PI * 0.455);

    mesh.position.y = bowlSurfaceY + Math.max(0.04, SPINNER_RADIUS * 0.88 * Math.cos(tiltAngle));

    this._tiltAxis.set(Math.cos(precAngle), 0, -Math.sin(precAngle));
    this._tiltQuat.setFromAxisAngle(this._tiltAxis, tiltAngle);
    this._spinQuat.setFromAxisAngle(this._yAxis, spinAngle);

    mesh.quaternion.multiplyQuaternions(this._tiltQuat, this._spinQuat);
  }

  // ─── Item management ──────────────────────────────────────────────────────────

  _buildItemMesh(type) {
    const group = new THREE.Group();

    if (type === ITEM_TYPES.ENERGY) {
      const geo = new THREE.SphereGeometry(0.25, 14, 14);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xFFEB3B,
        emissive: 0xFFEB3B,
        emissiveIntensity: 1.0,
        metalness: 0.1,
        roughness: 0.25,
      });
      group.add(new THREE.Mesh(geo, mat));
      // Inner glow sphere
      const glowGeo = new THREE.SphereGeometry(0.32, 10, 10);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xFFEB3B, transparent: true, opacity: 0.2 });
      group.add(new THREE.Mesh(glowGeo, glowMat));
      const light = new THREE.PointLight(0xFFEB3B, 1.8, 2.0);
      group.add(light);

    } else if (type === ITEM_TYPES.SHIELD) {
      const geo = new THREE.OctahedronGeometry(0.3, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x26C6DA,
        emissive: 0x26C6DA,
        emissiveIntensity: 0.9,
        metalness: 0.4,
        roughness: 0.2,
      });
      group.add(new THREE.Mesh(geo, mat));
      const glowGeo = new THREE.OctahedronGeometry(0.38, 0);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x26C6DA, transparent: true, opacity: 0.18, wireframe: true });
      group.add(new THREE.Mesh(glowGeo, glowMat));
      const light = new THREE.PointLight(0x26C6DA, 1.5, 2.0);
      group.add(light);

    } else if (type === ITEM_TYPES.COGS) {
      const geo = new THREE.TorusGeometry(0.22, 0.09, 8, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xFF5722,
        emissive: 0xFF5722,
        emissiveIntensity: 0.8,
        metalness: 0.6,
        roughness: 0.25,
      });
      group.add(new THREE.Mesh(geo, mat));
      // Second ring at 90 deg for cog-like look
      const geo2 = new THREE.TorusGeometry(0.22, 0.09, 8, 16);
      const ring2 = new THREE.Mesh(geo2, mat);
      ring2.rotation.y = Math.PI / 2;
      group.add(ring2);
      const light = new THREE.PointLight(0xFF5722, 1.5, 2.0);
      group.add(light);
    }

    return group;
  }

  addItem(item) {
    const group = this._buildItemMesh(item.type);
    group.userData.itemX = item.x;
    group.userData.itemZ = item.z;
    group.userData.itemPhase = Math.random() * Math.PI * 2;

    // Set initial position
    const rSq = item.x * item.x + item.z * item.z;
    const bowlY = BOWL_HEIGHT * rSq / (BOARD_RADIUS * BOARD_RADIUS);
    group.position.set(item.x, bowlY + 0.45, item.z);

    this.itemMeshes.set(item.id, group);
    this.scene.add(group);
  }

  removeItem(itemId) {
    const mesh = this.itemMeshes.get(itemId);
    if (mesh) {
      this.spawnCollisionParticles(mesh.userData.itemX, mesh.userData.itemZ, 0xffd740);
      this.scene.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.itemMeshes.delete(itemId);
    }
  }

  clearItems() {
    for (const [, mesh] of this.itemMeshes) {
      this.scene.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.itemMeshes.clear();
  }

  _updateItemMeshes() {
    for (const [, mesh] of this.itemMeshes) {
      const x = mesh.userData.itemX;
      const z = mesh.userData.itemZ;
      const phase = mesh.userData.itemPhase;
      const rSq = x * x + z * z;
      const bowlY = BOWL_HEIGHT * rSq / (BOARD_RADIUS * BOARD_RADIUS);
      // Bob up and down
      mesh.position.y = bowlY + 0.45 + Math.sin(this._frame * 0.06 + phase) * 0.12;
      // Spin
      mesh.rotation.y += 0.035;
    }
  }

  // ─── Particles ───────────────────────────────────────────────────────────────

  spawnWallParticles(x, z, colorHex, speed = 0.05) {
    const baseColor = new THREE.Color(colorHex || '#ffffff');
    const rSq = x * x + z * z;
    const bowlY = BOWL_HEIGHT * rSq / (BOARD_RADIUS * BOARD_RADIUS);

    // 벽 법선 방향 (바깥→안쪽): 중심을 향하는 방향
    const dist = Math.sqrt(rSq) || 1;
    const inX = -x / dist;
    const inZ = -z / dist;

    // 충돌 세기에 따라 파티클 수 결정 (3~18개)
    const count = Math.min(18, Math.max(3, Math.round(speed * 120)));

    for (let i = 0; i < count; i++) {
      // 스파크형: 작고 납작한 플레어
      const geo = new THREE.SphereGeometry(0.025 + Math.random() * 0.03, 4, 4);
      const bright = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5 + Math.random() * 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 1 });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, bowlY + 0.12, z);

      // 안쪽+랜덤 측면 방향으로 발사
      const spread = (Math.random() - 0.5) * 1.4; // 좌우 퍼짐
      const perpX = -inZ * spread;
      const perpZ = inX * spread;
      const spd = (0.04 + Math.random() * 0.09) * (1 + speed * 3);

      p.userData = {
        vx: (inX * (0.6 + Math.random() * 0.4) + perpX) * spd,
        vz: (inZ * (0.6 + Math.random() * 0.4) + perpZ) * spd,
        vy: 0.05 + Math.random() * 0.1,
        life: 1.0,
        decay: 0.04 + Math.random() * 0.04,
      };
      this.scene.add(p);
      this.particles.push(p);
    }
  }

  spawnCollisionParticles(x, z, colorHex) {
    const baseColor = new THREE.Color(colorHex || '#ffffff');
    const rSq = x * x + z * z;
    const bowlY = BOWL_HEIGHT * rSq / (BOARD_RADIUS * BOARD_RADIUS);
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.SphereGeometry(0.04, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 1 });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, bowlY + 0.25, z);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.04 + Math.random() * 0.06;
      p.userData = {
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: 0.06 + Math.random() * 0.08,
        life: 1.0,
      };
      this.scene.add(p);
      this.particles.push(p);
    }
  }

  _updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.position.x += p.userData.vx;
      p.position.y += p.userData.vy;
      p.position.z += p.userData.vz;
      p.userData.vy -= 0.004;
      p.userData.life -= p.userData.decay ?? 0.035;
      p.material.opacity = Math.max(0, p.userData.life);
      if (p.userData.life <= 0) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this.particles.splice(i, 1);
      }
    }
  }

  render() {
    this._updateParticles();
    this._updateItemMeshes();
    this._frame++;
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}
