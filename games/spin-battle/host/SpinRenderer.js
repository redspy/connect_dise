import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BOARD_RADIUS, SPINNER_RADIUS, MAX_RPM, BOWL_HEIGHT, ITEM_TYPES } from './SpinPhysics.js';

export class SpinRenderer {
  constructor(container) {
    this.container = container;
    this.spinnerMeshes = new Map();
    this.spinAngles = new Map();
    this.precessionAngles = new Map();
    this.particles = [];
    this.itemMeshes = new Map();
    this.animatedRings = [];
    this.energyPylons = [];
    this.pulseDiscs = [];
    this.orbitTrails = [];
    this.ringGlowLights = [];
    this.rimGlowLights = [];
    this.accentGlowLights = [];
    this.segmentMaterials = [];
    this.lightRefs = {};
    this.materialRefs = {};
    this._frame = 0;

    this.visualDefaults = {
      ambientIntensity: 0.4,
      hemisphereIntensity: 0.46,
      directionalIntensity: 0.98,
      purpleIntensity: 0.8,
      cyanIntensity: 0.82,
      pinkBackIntensity: 0.55,
      underGlowIntensity: 0.12,
      coreLightIntensity: 0.65,
      ringGlowIntensity: 0.18,
      rimGlowIntensity: 0.35,
      accentGlowIntensity: 0.2,
      ringEmissiveMult: 1,
      segmentEmissiveMult: 1,
      coreEmissiveIntensity: 0.78,
      rimEmissiveIntensity: 0.96,
      pulseOpacityMult: 1,
      trailOpacityMult: 1,
      pylonEmissiveMult: 1,
      bloomStrength: 0.45,
      bloomRadius: 0.24,
      bloomThreshold: 0.45,
    };
    this.visualState = { ...this.visualDefaults };

    this._tiltQuat = new THREE.Quaternion();
    this._spinQuat = new THREE.Quaternion();
    this._tiltAxis = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    this._setupRenderer();
    this._setupScene();
    this._setupPostprocessing();
    this._setupBoard();
    this._setupLights();
  }

  _setupRenderer() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 100);
    this.camera.position.set(0, 11.4, 9.8);
    this.camera.lookAt(0, 0.35, 0);

    window.addEventListener('resize', () => this._onResize());
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x040914, 0.02);
  }

  _setupPostprocessing() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio, 2);

    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h),
      this.visualState.bloomStrength,
      this.visualState.bloomRadius,
      this.visualState.bloomThreshold
    );
    this.composer.addPass(this.bloomPass);
  }

  _setupBoard() {
    const board = new THREE.Group();
    this.scene.add(board);

    const bowlPoints = [];
    const N = 32;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      bowlPoints.push(new THREE.Vector2(t * BOARD_RADIUS, BOWL_HEIGHT * t * t));
    }

    const bowlGeo = new THREE.LatheGeometry(bowlPoints, 96);
    const bowlMat = new THREE.MeshStandardMaterial({
      color: 0x070c18,
      roughness: 0.2,
      metalness: 0.95,
      emissive: 0x0a1227,
      emissiveIntensity: 0.45,
      side: THREE.DoubleSide,
    });
    const bowl = new THREE.Mesh(bowlGeo, bowlMat);
    bowl.receiveShadow = true;
    board.add(bowl);

    const deckGeo = new THREE.CylinderGeometry(BOARD_RADIUS * 1.25, BOARD_RADIUS * 1.31, 0.24, 96);
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0x050a14,
      roughness: 0.28,
      metalness: 0.9,
      emissive: 0x081124,
      emissiveIntensity: 0.3,
    });
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.y = -0.13;
    board.add(deck);

    const plateGeo = new THREE.CircleGeometry(BOARD_RADIUS * 1.32, 6);
    const plateMat = new THREE.MeshStandardMaterial({
      color: 0x090f1d,
      roughness: 0.42,
      metalness: 0.75,
    });
    const plate = new THREE.Mesh(plateGeo, plateMat);
    plate.rotation.x = -Math.PI / 2;
    plate.position.y = -0.24;
    board.add(plate);

    const gridGeo = new THREE.RingGeometry(BOARD_RADIUS * 0.3, BOARD_RADIUS * 1.22, 96, 1);
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x1aa0ff,
      transparent: true,
      opacity: 0.17,
      side: THREE.DoubleSide,
      wireframe: true,
    });
    const grid = new THREE.Mesh(gridGeo, gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.22;
    board.add(grid);

    const ringDefs = [
      { f: 0.23, color: 0x30c6ff, intensity: 1.2, width: 0.035, speed: 0.02, amp: 0.18 },
      { f: 0.41, color: 0xc169ff, intensity: 1.05, width: 0.032, speed: 0.018, amp: 0.16 },
      { f: 0.6, color: 0xff6a40, intensity: 1.0, width: 0.036, speed: 0.014, amp: 0.14 },
      { f: 0.8, color: 0x2be7ff, intensity: 1.25, width: 0.04, speed: 0.012, amp: 0.2 },
    ];
    for (const { f, color, intensity, width, speed, amp } of ringDefs) {
      const r = f * BOARD_RADIUS;
      const y = BOWL_HEIGHT * f * f;
      const geo = new THREE.TorusGeometry(r, width, 12, 160);
      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: intensity,
        roughness: 0.08,
        metalness: 0.38,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y + 0.012;
      board.add(ring);
      this.animatedRings.push({
        kind: 'ring',
        mesh: ring,
        base: intensity,
        amp,
        speed,
        phase: Math.random() * Math.PI * 2,
      });

      const gl = new THREE.PointLight(color, 0.18, BOARD_RADIUS * 0.74);
      gl.position.set(0, y + 0.08, 0);
      board.add(gl);
      this.ringGlowLights.push(gl);
    }

    const trailDefs = [
      { radius: BOARD_RADIUS * 0.52, tube: 0.026, arc: Math.PI * 1.08, color: 0xff7b2f, y: 0.09, speed: 0.0035 },
      { radius: BOARD_RADIUS * 0.58, tube: 0.028, arc: Math.PI * 1.16, color: 0x3ad6ff, y: 0.1, speed: -0.003 },
      { radius: BOARD_RADIUS * 0.68, tube: 0.022, arc: Math.PI * 0.78, color: 0xb569ff, y: 0.11, speed: 0.0025 },
    ];
    for (const trail of trailDefs) {
      const geo = new THREE.TorusGeometry(trail.radius, trail.tube, 12, 128, trail.arc);
      const mat = new THREE.MeshBasicMaterial({
        color: trail.color,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI * 2;
      mesh.position.y = trail.y;
      board.add(mesh);
      this.orbitTrails.push({
        mesh,
        speed: trail.speed,
        baseOpacity: mat.opacity,
        phase: Math.random() * Math.PI * 2,
      });
    }

    const coreGeo = new THREE.CylinderGeometry(BOARD_RADIUS * 0.11, BOARD_RADIUS * 0.13, 0.16, 48);
    const coreMat = new THREE.MeshStandardMaterial({
      color: 0x6fd4ff,
      emissive: 0x3cb8ff,
      emissiveIntensity: 0.78,
      roughness: 0.15,
      metalness: 0.75,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    this.materialRefs.core = coreMat;
    core.position.y = 0.04;
    board.add(core);

    const coreDiscGeo = new THREE.CircleGeometry(BOARD_RADIUS * 0.17, 42);
    const coreDiscMat = new THREE.MeshBasicMaterial({
      color: 0x59c7ff,
      transparent: true,
      opacity: 0.14,
    });
    const coreDisc = new THREE.Mesh(coreDiscGeo, coreDiscMat);
    coreDisc.rotation.x = -Math.PI / 2;
    coreDisc.position.y = 0.008;
    board.add(coreDisc);
    this.pulseDiscs.push({ mesh: coreDisc, base: 1.0, amp: 0.2, speed: 0.04, phase: 0.4 });

    const coreHaloGeo = new THREE.RingGeometry(BOARD_RADIUS * 0.17, BOARD_RADIUS * 0.22, 64);
    const coreHaloMat = new THREE.MeshBasicMaterial({
      color: 0x9bf8ff,
      transparent: true,
      opacity: 0.12,
      side: THREE.DoubleSide,
    });
    const coreHalo = new THREE.Mesh(coreHaloGeo, coreHaloMat);
    coreHalo.rotation.x = -Math.PI / 2;
    coreHalo.position.y = 0.011;
    board.add(coreHalo);
    this.pulseDiscs.push({ mesh: coreHalo, base: 1.0, amp: 0.12, speed: 0.03, phase: 1.5 });

    const coreLight = new THREE.PointLight(0x6ce8ff, 0.65, 2.8);
    coreLight.position.set(0, 0.36, 0);
    board.add(coreLight);
    this.lightRefs.core = coreLight;

    const rimGeo = new THREE.TorusGeometry(BOARD_RADIUS, 0.22, 16, 96);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x1ef4ff,
      emissive: 0x1ef4ff,
      emissiveIntensity: 0.96,
      metalness: 0.58,
      roughness: 0.08,
    });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    this.materialRefs.rim = rimMat;
    rim.rotation.x = Math.PI / 2;
    rim.position.y = BOWL_HEIGHT;
    board.add(rim);

    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const segGeo = new THREE.BoxGeometry(0.34, 0.07, 0.16);
      const color = i % 2 === 0 ? 0xff42a7 : 0x35ceff;
      const segBase = 0.76;
      const segMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: segBase,
        roughness: 0.22,
        metalness: 0.3,
      });
      this.segmentMaterials.push(segMat);
      const seg = new THREE.Mesh(segGeo, segMat);
      seg.position.set(Math.cos(a) * BOARD_RADIUS, BOWL_HEIGHT + 0.03, Math.sin(a) * BOARD_RADIUS);
      seg.rotation.y = -a;
      board.add(seg);
      this.animatedRings.push({
        kind: 'segment',
        mesh: seg,
        base: segBase,
        amp: 0.12,
        speed: 0.04,
        phase: a * 2,
      });
    }

    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const rl = new THREE.PointLight(i % 2 ? 0xff4ea8 : 0x1ce7ff, 0.35, 4.2);
      rl.position.set(Math.cos(a) * BOARD_RADIUS, BOWL_HEIGHT + 0.15, Math.sin(a) * BOARD_RADIUS);
      board.add(rl);
      this.rimGlowLights.push(rl);
    }

    const outerGeo = new THREE.CylinderGeometry(BOARD_RADIUS * 1.04, BOARD_RADIUS * 1.1, BOWL_HEIGHT * 1.26, 96, 1, true);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x060c16,
      roughness: 0.3,
      metalness: 0.95,
      side: THREE.BackSide,
    });
    const outer = new THREE.Mesh(outerGeo, outerMat);
    outer.position.y = BOWL_HEIGHT * 0.5;
    board.add(outer);

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const towerGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.85, 8);
      const towerMat = new THREE.MeshStandardMaterial({
        color: 0x57d5ff,
        emissive: 0x57d5ff,
        emissiveIntensity: 1.1,
        roughness: 0.2,
        metalness: 0.45,
      });
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.position.set(
        Math.cos(a) * BOARD_RADIUS * 1.09,
        BOWL_HEIGHT * 0.72,
        Math.sin(a) * BOARD_RADIUS * 1.09
      );
      board.add(tower);
      this.energyPylons.push({
        mesh: tower,
        baseY: tower.position.y,
        phase: a * 1.9,
      });
    }

    const accentGeo = new THREE.TorusGeometry(BOARD_RADIUS * 1.06, 0.05, 8, 120);
    const accentMat = new THREE.MeshStandardMaterial({
      color: 0xff4da6,
      emissive: 0xff4da6,
      emissiveIntensity: 0.72,
      roughness: 0.1,
      metalness: 0.4,
    });
    this.materialRefs.accent = accentMat;
    const accent = new THREE.Mesh(accentGeo, accentMat);
    accent.rotation.x = Math.PI / 2;
    accent.position.y = BOWL_HEIGHT * 1.1;
    board.add(accent);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5 + 0.12) * Math.PI * 2;
      const pl = new THREE.PointLight(0xff4aa8, 0.2, 3.2);
      pl.position.set(Math.cos(a) * BOARD_RADIUS * 1.05, BOWL_HEIGHT * 1.1, Math.sin(a) * BOARD_RADIUS * 1.05);
      board.add(pl);
      this.accentGlowLights.push(pl);
    }

    const sparkCount = 220;
    const sparkPos = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
      const r = BOARD_RADIUS * (1.7 + Math.random() * 1.2);
      const a = Math.random() * Math.PI * 2;
      sparkPos[i * 3] = Math.cos(a) * r;
      sparkPos[i * 3 + 1] = 0.4 + Math.random() * 5.2;
      sparkPos[i * 3 + 2] = Math.sin(a) * r;
    }
    const sparksGeo = new THREE.BufferGeometry();
    sparksGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparksMat = new THREE.PointsMaterial({
      color: 0x5fd4ff,
      size: 0.045,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
    });
    board.add(new THREE.Points(sparksGeo, sparksMat));
  }

  _setupLights() {
    const ambient = new THREE.AmbientLight(0x0d1230, this.visualState.ambientIntensity);
    this.scene.add(ambient);
    this.lightRefs.ambient = ambient;

    const hemi = new THREE.HemisphereLight(0x58d4ff, 0x080d1c, this.visualState.hemisphereIntensity);
    this.scene.add(hemi);
    this.lightRefs.hemi = hemi;

    const dir = new THREE.DirectionalLight(0x8ea2ff, this.visualState.directionalIntensity);
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
    this.lightRefs.dir = dir;

    const purple = new THREE.PointLight(0x8a44ff, this.visualState.purpleIntensity, 22);
    purple.position.set(-9, 5, -5);
    this.scene.add(purple);
    this.lightRefs.purple = purple;

    const cyan = new THREE.PointLight(0x18e7ff, this.visualState.cyanIntensity, 22);
    cyan.position.set(9, 5, -5);
    this.scene.add(cyan);
    this.lightRefs.cyan = cyan;

    const pinkBack = new THREE.PointLight(0xff348f, this.visualState.pinkBackIntensity, 18);
    pinkBack.position.set(0, 2, 10);
    this.scene.add(pinkBack);
    this.lightRefs.pinkBack = pinkBack;

    const underGlow = new THREE.PointLight(0x00ffdf, this.visualState.underGlowIntensity, 9);
    underGlow.position.set(0, -1.5, 0);
    this.scene.add(underGlow);
    this.lightRefs.underGlow = underGlow;

    this.applyVisualState();
  }

  _buildSpinnerMesh(color) {
    const group = new THREE.Group();

    const profile = [
      new THREE.Vector2(0, -0.48),
      new THREE.Vector2(0.07, -0.32),
      new THREE.Vector2(0.55, 0),
      new THREE.Vector2(0.52, 0.08),
      new THREE.Vector2(0.18, 0.26),
      new THREE.Vector2(0.04, 0.4),
      new THREE.Vector2(0, 0.4),
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

  _buildItemMesh(type) {
    const group = new THREE.Group();

    if (type === ITEM_TYPES.ENERGY) {
      const geo = new THREE.SphereGeometry(0.25, 14, 14);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffeb3b,
        emissive: 0xffeb3b,
        emissiveIntensity: 1.0,
        metalness: 0.1,
        roughness: 0.25,
      });
      group.add(new THREE.Mesh(geo, mat));

      const glowGeo = new THREE.SphereGeometry(0.32, 10, 10);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0xffeb3b, transparent: true, opacity: 0.2 });
      group.add(new THREE.Mesh(glowGeo, glowMat));
      const light = new THREE.PointLight(0xffeb3b, 1.8, 2.0);
      group.add(light);
    } else if (type === ITEM_TYPES.SHIELD) {
      const geo = new THREE.OctahedronGeometry(0.3, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x26c6da,
        emissive: 0x26c6da,
        emissiveIntensity: 0.9,
        metalness: 0.4,
        roughness: 0.2,
      });
      group.add(new THREE.Mesh(geo, mat));
      const glowGeo = new THREE.OctahedronGeometry(0.38, 0);
      const glowMat = new THREE.MeshBasicMaterial({ color: 0x26c6da, transparent: true, opacity: 0.18, wireframe: true });
      group.add(new THREE.Mesh(glowGeo, glowMat));
      const light = new THREE.PointLight(0x26c6da, 1.5, 2.0);
      group.add(light);
    } else if (type === ITEM_TYPES.COGS) {
      const geo = new THREE.TorusGeometry(0.22, 0.09, 8, 16);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xff5722,
        emissive: 0xff5722,
        emissiveIntensity: 0.8,
        metalness: 0.6,
        roughness: 0.25,
      });
      group.add(new THREE.Mesh(geo, mat));
      const geo2 = new THREE.TorusGeometry(0.22, 0.09, 8, 16);
      const ring2 = new THREE.Mesh(geo2, mat);
      ring2.rotation.y = Math.PI / 2;
      group.add(ring2);
      const light = new THREE.PointLight(0xff5722, 1.5, 2.0);
      group.add(light);
    }

    return group;
  }

  addItem(item) {
    const group = this._buildItemMesh(item.type);
    group.userData.itemX = item.x;
    group.userData.itemZ = item.z;
    group.userData.itemPhase = Math.random() * Math.PI * 2;

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
      mesh.position.y = bowlY + 0.45 + Math.sin(this._frame * 0.06 + phase) * 0.12;
      mesh.rotation.y += 0.035;
    }
  }

  spawnWallParticles(x, z, colorHex, speed = 0.05) {
    const baseColor = new THREE.Color(colorHex || '#ffffff');
    const rSq = x * x + z * z;
    const bowlY = BOWL_HEIGHT * rSq / (BOARD_RADIUS * BOARD_RADIUS);

    const dist = Math.sqrt(rSq) || 1;
    const inX = -x / dist;
    const inZ = -z / dist;

    const count = Math.min(18, Math.max(3, Math.round(speed * 120)));

    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.025 + Math.random() * 0.03, 4, 4);
      const bright = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.5 + Math.random() * 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: bright, transparent: true, opacity: 1 });
      const p = new THREE.Mesh(geo, mat);
      p.position.set(x, bowlY + 0.12, z);

      const spread = (Math.random() - 0.5) * 1.4;
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

  applyVisualState() {
    if (this.lightRefs.ambient) this.lightRefs.ambient.intensity = this.visualState.ambientIntensity;
    if (this.lightRefs.hemi) this.lightRefs.hemi.intensity = this.visualState.hemisphereIntensity;
    if (this.lightRefs.dir) this.lightRefs.dir.intensity = this.visualState.directionalIntensity;
    if (this.lightRefs.purple) this.lightRefs.purple.intensity = this.visualState.purpleIntensity;
    if (this.lightRefs.cyan) this.lightRefs.cyan.intensity = this.visualState.cyanIntensity;
    if (this.lightRefs.pinkBack) this.lightRefs.pinkBack.intensity = this.visualState.pinkBackIntensity;
    if (this.lightRefs.underGlow) this.lightRefs.underGlow.intensity = this.visualState.underGlowIntensity;
    if (this.lightRefs.core) this.lightRefs.core.intensity = this.visualState.coreLightIntensity;

    for (const light of this.ringGlowLights) light.intensity = this.visualState.ringGlowIntensity;
    for (const light of this.rimGlowLights) light.intensity = this.visualState.rimGlowIntensity;
    for (const light of this.accentGlowLights) light.intensity = this.visualState.accentGlowIntensity;

    if (this.materialRefs.core) this.materialRefs.core.emissiveIntensity = this.visualState.coreEmissiveIntensity;
    if (this.materialRefs.rim) this.materialRefs.rim.emissiveIntensity = this.visualState.rimEmissiveIntensity;

    if (this.bloomPass) {
      this.bloomPass.strength = this.visualState.bloomStrength;
      this.bloomPass.radius = this.visualState.bloomRadius;
      this.bloomPass.threshold = this.visualState.bloomThreshold;
    }
  }

  setVisualParam(key, value) {
    if (!(key in this.visualState)) return;
    this.visualState[key] = Number(value);
    this.applyVisualState();
  }

  getVisualState() {
    return { ...this.visualState };
  }

  resetVisualParams() {
    this.visualState = { ...this.visualDefaults };
    this.applyVisualState();
  }

  render() {
    this._updateParticles();
    this._updateItemMeshes();

    const t = this._frame;
    for (const ring of this.animatedRings) {
      const wave = Math.sin(t * ring.speed + ring.phase);
      if (ring.mesh.material?.emissiveIntensity !== undefined) {
        const mult = ring.kind === 'segment'
          ? this.visualState.segmentEmissiveMult
          : this.visualState.ringEmissiveMult;
        ring.mesh.material.emissiveIntensity = (ring.base + wave * ring.amp) * mult;
      }
    }

    for (const pylon of this.energyPylons) {
      const bob = Math.sin(t * 0.02 + pylon.phase) * 0.04;
      pylon.mesh.position.y = pylon.baseY + bob;
      if (pylon.mesh.material?.emissiveIntensity !== undefined) {
        pylon.mesh.material.emissiveIntensity =
          (0.55 + (bob + 0.04) * 2.6) * this.visualState.pylonEmissiveMult;
      }
    }

    for (const disc of this.pulseDiscs) {
      const wave = (Math.sin(t * disc.speed + disc.phase) + 1) * 0.5;
      const scale = disc.base + wave * disc.amp;
      disc.mesh.scale.set(scale, scale, scale);
      if (disc.mesh.material?.opacity !== undefined) {
        disc.mesh.material.opacity = (0.06 + wave * 0.1) * this.visualState.pulseOpacityMult;
      }
    }

    for (const trail of this.orbitTrails) {
      trail.mesh.rotation.z += trail.speed;
      const wave = (Math.sin(t * 0.03 + trail.phase) + 1) * 0.5;
      if (trail.mesh.material?.opacity !== undefined) {
        trail.mesh.material.opacity =
          trail.baseOpacity * (0.8 + wave * 0.15) * this.visualState.trailOpacityMult;
      }
    }

    if (this.bloomPass) {
      this.bloomPass.strength = this.visualState.bloomStrength;
      this.bloomPass.radius = this.visualState.bloomRadius;
      this.bloomPass.threshold = this.visualState.bloomThreshold;
    }

    this._frame++;
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  _onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    if (this.composer) this.composer.setSize(w, h);
  }
}
