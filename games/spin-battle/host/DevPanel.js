import { physicsConfig } from './SpinPhysics.js';

const PARAM_DEFS = [
  {
    key: 'BOWL_FORCE', label: '중심 인력',
    min: 0, max: 0.002, step: 0.00005,
    fmt: v => v.toFixed(5),
    hint: '값이 클수록 팽이가 가운데로 강하게 모임',
  },
  {
    key: 'BASE_DECAY', label: 'RPM 자연 감소',
    min: 0, max: 2, step: 0.05,
    fmt: v => v.toFixed(2),
    hint: '값이 클수록 팽이가 빨리 멈춤',
  },
  {
    key: 'MAX_MOVE_FORCE', label: '기울기 힘',
    min: 0, max: 0.03, step: 0.0005,
    fmt: v => v.toFixed(4),
    hint: '값이 클수록 기울기에 민감하게 반응',
  },
  {
    key: 'FRICTION', label: '속도 감쇠 (마찰)',
    min: 0.88, max: 1.0, step: 0.002,
    fmt: v => v.toFixed(3),
    hint: '1.0에 가까울수록 잘 미끄러짐',
  },
  {
    key: 'COLLISION_PENALTY', label: '충돌 RPM 페널티',
    min: 0, max: 30, step: 0.5,
    fmt: v => v.toFixed(1),
    hint: '충돌 시 RPM이 깎이는 양',
  },
  {
    key: 'EDGE_PENALTY', label: '가장자리 RPM 페널티',
    min: 0, max: 5, step: 0.1,
    fmt: v => v.toFixed(2),
    hint: '경기장 경계 닿을 때 RPM 페널티',
  },
  {
    key: 'WALL_RESTITUTION', label: '벽 반발계수 (반발장치)',
    min: 0, max: 10, step: 0.1,
    fmt: v => v.toFixed(1),
    hint: '1=일반 반사, 1 이상=반발장치 효과 (최대 10)',
  },
];

export class DevPanel {
  constructor({ onSpawnIntervalChange } = {}) {
    this.onSpawnIntervalChange = onSpawnIntervalChange;
    this._build();
  }

  _build() {
    const panel = document.createElement('div');
    panel.id = 'dev-panel';

    let html = `
      <div class="dev-title">⚙️ Dev Panel</div>
      <div class="dev-hint">URL에 <code>?dev</code> 파라미터로 활성화</div>
    `;

    for (const def of PARAM_DEFS) {
      const val = physicsConfig[def.key];
      html += `
        <div class="dev-param">
          <div class="dev-param-header">
            <span class="dev-param-label">${def.label}</span>
            <span class="dev-param-value" id="dv-${def.key}">${def.fmt(val)}</span>
          </div>
          <input type="range" class="dev-slider"
            id="ds-${def.key}"
            min="${def.min}" max="${def.max}" step="${def.step}" value="${val}">
          <div class="dev-param-hint">${def.hint}</div>
        </div>
      `;
    }

    // Item spawn interval
    html += `
      <div class="dev-param">
        <div class="dev-param-header">
          <span class="dev-param-label">아이템 생성 주기</span>
          <span class="dev-param-value" id="dv-spawnInterval">5.0s</span>
        </div>
        <input type="range" class="dev-slider"
          id="ds-spawnInterval" min="1" max="20" step="0.5" value="5">
        <div class="dev-param-hint">배틀 중 아이템이 몇 초마다 등장하는지</div>
      </div>
      <button class="dev-reset-btn" id="dev-reset-btn">기본값으로 초기화</button>
    `;

    panel.innerHTML = html;
    document.body.appendChild(panel);

    // Bind physics sliders
    for (const def of PARAM_DEFS) {
      const slider = document.getElementById(`ds-${def.key}`);
      const valEl  = document.getElementById(`dv-${def.key}`);
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        physicsConfig[def.key] = v;
        valEl.textContent = def.fmt(v);
      });
    }

    // Bind spawn interval slider
    const spawnSlider = document.getElementById('ds-spawnInterval');
    const spawnVal    = document.getElementById('dv-spawnInterval');
    spawnSlider.addEventListener('input', () => {
      const sec = parseFloat(spawnSlider.value);
      spawnVal.textContent = sec.toFixed(1) + 's';
      if (this.onSpawnIntervalChange) this.onSpawnIntervalChange(sec * 1000);
    });

    // Reset button
    document.getElementById('dev-reset-btn').addEventListener('click', () => {
      this._resetToDefaults();
    });

    this._defaults = { ...physicsConfig, spawnInterval: 5 };
  }

  _resetToDefaults() {
    for (const def of PARAM_DEFS) {
      physicsConfig[def.key] = this._defaults[def.key];
      document.getElementById(`ds-${def.key}`).value = this._defaults[def.key];
      document.getElementById(`dv-${def.key}`).textContent = def.fmt(this._defaults[def.key]);
    }
    document.getElementById('ds-spawnInterval').value = this._defaults.spawnInterval;
    document.getElementById('dv-spawnInterval').textContent = this._defaults.spawnInterval.toFixed(1) + 's';
    if (this.onSpawnIntervalChange) this.onSpawnIntervalChange(this._defaults.spawnInterval * 1000);
  }
}
