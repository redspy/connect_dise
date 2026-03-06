import { physicsConfig } from './SpinPhysics.js';

const PHYSICS_DEFS = [
  {
    key: 'BOWL_FORCE', label: 'Bowl Force',
    min: 0, max: 0.002, step: 0.00005,
    fmt: v => v.toFixed(5),
    hint: 'Pull toward center of bowl',
  },
  {
    key: 'BASE_DECAY', label: 'RPM Decay',
    min: 0, max: 2, step: 0.05,
    fmt: v => v.toFixed(2),
    hint: 'Base RPM drain over time',
  },
  {
    key: 'MAX_MOVE_FORCE', label: 'Tilt Force',
    min: 0, max: 0.03, step: 0.0005,
    fmt: v => v.toFixed(4),
    hint: 'How strong tilt steering is',
  },
  {
    key: 'FRICTION', label: 'Friction',
    min: 0.88, max: 1.0, step: 0.002,
    fmt: v => v.toFixed(3),
    hint: 'Higher = less speed loss',
  },
  {
    key: 'COLLISION_PENALTY', label: 'Collision Penalty',
    min: 0, max: 30, step: 0.5,
    fmt: v => v.toFixed(1),
    hint: 'RPM loss per hit',
  },
  {
    key: 'EDGE_PENALTY', label: 'Edge Penalty',
    min: 0, max: 5, step: 0.1,
    fmt: v => v.toFixed(2),
    hint: 'RPM loss near wall',
  },
  {
    key: 'WALL_RESTITUTION', label: 'Wall Restitution',
    min: 0, max: 10, step: 0.1,
    fmt: v => v.toFixed(1),
    hint: 'Wall bounce multiplier',
  },
];

const LIGHT_DEFS = [
  { key: 'ambientIntensity', label: 'Ambient', min: 0, max: 1.2, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'hemisphereIntensity', label: 'Hemisphere', min: 0, max: 1.2, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'directionalIntensity', label: 'Directional', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'purpleIntensity', label: 'Purple Fill', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'cyanIntensity', label: 'Cyan Fill', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'pinkBackIntensity', label: 'Back Pink', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'underGlowIntensity', label: 'Under Glow', min: 0, max: 1.0, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'coreLightIntensity', label: 'Core Light', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'ringGlowIntensity', label: 'Inner Ring Glow', min: 0, max: 1.2, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'rimGlowIntensity', label: 'Rim Glow', min: 0, max: 1.2, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'accentGlowIntensity', label: 'Top Accent Glow', min: 0, max: 1.2, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'ringEmissiveMult', label: 'Ring Emissive', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'segmentEmissiveMult', label: 'Segment Emissive', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'coreEmissiveIntensity', label: 'Core Emissive', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'rimEmissiveIntensity', label: 'Rim Emissive', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'pulseOpacityMult', label: 'Center Pulse', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'trailOpacityMult', label: 'Orbit Trails', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'pylonEmissiveMult', label: 'Outer Pylons', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'bloomStrength', label: 'Bloom Strength', min: 0, max: 2.0, step: 0.02, fmt: v => v.toFixed(2) },
  { key: 'bloomRadius', label: 'Bloom Radius', min: 0, max: 1.0, step: 0.01, fmt: v => v.toFixed(2) },
  { key: 'bloomThreshold', label: 'Bloom Threshold', min: 0, max: 1.5, step: 0.01, fmt: v => v.toFixed(2) },
];

export class DevPanel {
  constructor({ onSpawnIntervalChange, onVisualParamChange, onVisualReset, getVisualState } = {}) {
    this.onSpawnIntervalChange = onSpawnIntervalChange;
    this.onVisualParamChange = onVisualParamChange;
    this.onVisualReset = onVisualReset;
    this.getVisualState = getVisualState;

    this._build();
  }

  _paramHtml(prefix, def, value, hint = '') {
    return `
      <div class="dev-param">
        <div class="dev-param-header">
          <span class="dev-param-label">${def.label}</span>
          <span class="dev-param-value" id="dv-${prefix}-${def.key}">${def.fmt(value)}</span>
        </div>
        <input type="range" class="dev-slider"
          id="ds-${prefix}-${def.key}"
          min="${def.min}" max="${def.max}" step="${def.step}" value="${value}">
        ${hint ? `<div class="dev-param-hint">${hint}</div>` : ''}
      </div>
    `;
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'dev-panel';

    const visual = this.getVisualState ? this.getVisualState() : {};

    let html = `
      <div class="dev-title">Spin Dev Panel</div>
      <div class="dev-hint">Enabled by <code>?dev</code></div>
    `;

    html += `<div class="dev-title" style="margin-top:8px;font-size:.86rem;">Physics</div>`;
    for (const def of PHYSICS_DEFS) {
      html += this._paramHtml('phy', def, physicsConfig[def.key], def.hint);
    }

    html += `
      <div class="dev-param">
        <div class="dev-param-header">
          <span class="dev-param-label">Item Spawn (sec)</span>
          <span class="dev-param-value" id="dv-spawnInterval">5.0s</span>
        </div>
        <input type="range" class="dev-slider"
          id="ds-spawnInterval" min="1" max="20" step="0.5" value="5">
        <div class="dev-param-hint">Item spawn interval in battle phase</div>
      </div>
    `;

    html += `<div class="dev-title" style="margin-top:8px;font-size:.86rem;">Lighting</div>`;
    for (const def of LIGHT_DEFS) {
      const current = visual[def.key] ?? 0;
      html += this._paramHtml('vis', def, current);
    }

    html += `
      <button class="dev-reset-btn" id="dev-reset-btn">Reset To Defaults</button>
    `;

    panel.innerHTML = html;
    document.body.appendChild(panel);

    for (const def of PHYSICS_DEFS) {
      const slider = document.getElementById(`ds-phy-${def.key}`);
      const valEl = document.getElementById(`dv-phy-${def.key}`);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        physicsConfig[def.key] = v;
        valEl.textContent = def.fmt(v);
      });
    }

    const spawnSlider = document.getElementById('ds-spawnInterval');
    const spawnVal = document.getElementById('dv-spawnInterval');
    spawnSlider.addEventListener('input', () => {
      const sec = parseFloat(spawnSlider.value);
      spawnVal.textContent = sec.toFixed(1) + 's';
      if (this.onSpawnIntervalChange) this.onSpawnIntervalChange(sec * 1000);
    });

    for (const def of LIGHT_DEFS) {
      const slider = document.getElementById(`ds-vis-${def.key}`);
      const valEl = document.getElementById(`dv-vis-${def.key}`);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        valEl.textContent = def.fmt(v);
        if (this.onVisualParamChange) this.onVisualParamChange(def.key, v);
      });
    }

    document.getElementById('dev-reset-btn').addEventListener('click', () => {
      this._resetToDefaults();
    });

    this._defaults = {
      physics: { ...physicsConfig },
      spawnInterval: 5,
      visual: { ...visual },
    };
  }

  _resetToDefaults() {
    for (const def of PHYSICS_DEFS) {
      physicsConfig[def.key] = this._defaults.physics[def.key];
      document.getElementById(`ds-phy-${def.key}`).value = this._defaults.physics[def.key];
      document.getElementById(`dv-phy-${def.key}`).textContent = def.fmt(this._defaults.physics[def.key]);
    }

    document.getElementById('ds-spawnInterval').value = this._defaults.spawnInterval;
    document.getElementById('dv-spawnInterval').textContent = this._defaults.spawnInterval.toFixed(1) + 's';
    if (this.onSpawnIntervalChange) this.onSpawnIntervalChange(this._defaults.spawnInterval * 1000);

    for (const def of LIGHT_DEFS) {
      const value = this._defaults.visual[def.key];
      if (value === undefined) continue;
      document.getElementById(`ds-vis-${def.key}`).value = value;
      document.getElementById(`dv-vis-${def.key}`).textContent = def.fmt(value);
      if (this.onVisualParamChange) this.onVisualParamChange(def.key, value);
    }

    if (this.onVisualReset) this.onVisualReset();
  }
}
