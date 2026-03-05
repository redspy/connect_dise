import * as THREE from 'three';
import { BOARD_RADIUS, SPINNER_RADIUS, MAX_RPM } from './SpinPhysics.js';

export class SpinRenderer {
  constructor(container) {
    this.container = container;
    this.spinnerMeshes = new Map();     // playerId → THREE.Group
    this.spinAngles = new Map();        // playerId → accumulated spin angle (rad)
    this.precessionAngles = new Map();  // playerId → accumulated precession angle (rad)
    this.particles = [];

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
    this.camera.position.set(0, 13, 5.5);
    this.camera.lookAt(0, 0, 0);

    window.addEventListener('resize', () => this._onResize());
  }

  _setupScene() {
    this.scene = new THREE.Scene();
  }

  _setupBoard() {
    // Board surface (cylinder = flat disc)
    const boardGeo = new THREE.CylinderGeometry(BOARD_RADIUS, BOARD_RADIUS * 1.03, 0.25, 64);
    const boardMat = new THREE.MeshLambertMaterial({ color: 0x1a6b3a });
    const boardMesh = new THREE.Mesh(boardGeo, boardMat);
    boardMesh.position.y = -0.125;
    boardMesh.receiveShadow = true;
    this.scene.add(boardMesh);

    // Felt pattern (inner ring detail)
    const innerGeo = new THREE.RingGeometry(0, BOARD_RADIUS - 0.1, 64);
    const innerMat = new THREE.MeshLambertMaterial({
      color: 0x1a6b3a,
      side: THREE.DoubleSide,
    });
    const innerMesh = new THREE.Mesh(innerGeo, innerMat);
    innerMesh.rotation.x = -Math.PI / 2;
    innerMesh.position.y = 0.001;
    this.scene.add(innerMesh);

    // Gold rim (Torus)
    const rimGeo = new THREE.TorusGeometry(BOARD_RADIUS, 0.18, 16, 64);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0xFFD700,
      metalness: 0.85,
      roughness: 0.15,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.0;
    this.scene.add(rim);

    // Outer base ring
    const baseGeo = new THREE.CylinderGeometry(BOARD_RADIUS * 1.08, BOARD_RADIUS * 1.12, 0.18, 64);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x2a1406, metalness: 0.3, roughness: 0.8 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = -0.22;
    this.scene.add(base);
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));

    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    dir.position.set(6, 14, 8);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 1024;
    dir.shadow.mapSize.height = 1024;
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 40;
    dir.shadow.camera.left = -10;
    dir.shadow.camera.right = 10;
    dir.shadow.camera.top = 10;
    dir.shadow.camera.bottom = -10;
    this.scene.add(dir);

    const warm = new THREE.PointLight(0xffa050, 0.4, 18);
    warm.position.set(0, 6, 0);
    this.scene.add(warm);
  }

  _buildSpinnerMesh(color) {
    const group = new THREE.Group();

    // Body via LatheGeometry
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
      emissiveIntensity: 0.25,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    body.scale.set(SPINNER_RADIUS / 0.55, SPINNER_RADIUS / 0.55, SPINNER_RADIUS / 0.55);
    group.add(body);

    // Bright metallic ring on top (white/silver accent)
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

    // Tip (small sphere at bottom)
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

    const rpmRatio = Math.max(0, rpm / MAX_RPM); // 1.0 → 0.0

    // ── Position ──────────────────────────────────────────────────────────────
    mesh.position.x = x;
    mesh.position.z = z;

    // ── Self-spin (fast at high RPM, stops at 0) ──────────────────────────────
    const spinDelta = rpmRatio * 0.5;
    const spinAngle = ((this.spinAngles.get(playerId) || 0) + spinDelta) % (Math.PI * 2);
    this.spinAngles.set(playerId, spinAngle);

    // ── Precession (세차운동): lean direction rotates around Y ─────────────────
    // 구간별 세차 속도:
    //   50~100% RPM → 거의 0  (직립 안정)
    //   20~50%  RPM → 느린 흔들림
    //   10~20%  RPM → 뚜렷한 세차
    //    0~10%  RPM → 격렬한 빙글빙글
    const precSpeed = Math.pow(1 - rpmRatio, 5) * 0.25;
    const precAngle = ((this.precessionAngles.get(playerId) || 0) + precSpeed) % (Math.PI * 2);
    this.precessionAngles.set(playerId, precAngle);

    // ── Tilt angle (지수 4: 50% 이상에서는 ~5° 이하, 아래로 급격히 기울어짐) ──
    //   50% → ~5°   중간 → ~34°   10% → ~54°   0% → ~82°
    const tiltAngle = Math.pow(1 - rpmRatio, 4) * (Math.PI * 0.455);

    // ── Height: tip stays near board, body drops as it tilts ──────────────────
    mesh.position.y = Math.max(0.04, SPINNER_RADIUS * 0.88 * Math.cos(tiltAngle));

    // ── Quaternion composition ────────────────────────────────────────────────
    // Tilt axis = perpendicular to lean direction in the XZ plane
    //   lean direction = (sin(precAngle), 0, cos(precAngle))
    //   tilt axis      = (cos(precAngle), 0, -sin(precAngle))   [Y × lean]
    this._tiltAxis.set(Math.cos(precAngle), 0, -Math.sin(precAngle));
    this._tiltQuat.setFromAxisAngle(this._tiltAxis, tiltAngle);
    this._spinQuat.setFromAxisAngle(this._yAxis, spinAngle);

    // tiltQuat * spinQuat  →  spin in place, then tilt the whole thing
    mesh.quaternion.multiplyQuaternions(this._tiltQuat, this._spinQuat);
  }

  spawnCollisionParticles(x, z, colorHex) {
    const baseColor = new THREE.Color(colorHex || '#ffffff');
    for (let i = 0; i < 10; i++) {
      const geo = new THREE.SphereGeometry(0.035, 4, 4);
      const mat = new THREE.MeshBasicMaterial({ color: baseColor, transparent: true, opacity: 1 });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, 0.25, z);
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.04 + Math.random() * 0.06;
      p.userData = {
        vx: Math.cos(angle) * speed,
        vz: Math.sin(angle) * speed,
        vy: 0.05 + Math.random() * 0.07,
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
      p.userData.life -= 0.035;
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
