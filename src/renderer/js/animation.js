// 动画引擎（M1 / K6 矢量方案）：Q 版洛天依矢量骨骼 + 帧动画
// 纯逻辑（ACTIONS / sampleAction / mergePose）与 DOM（Rig）分离，纯逻辑可在 Node 中测试

export const CANVAS_W = 180;
export const CANVAS_H = 200;
export const FEET_Y = 186;

// 各部件旋转/缩放轴心（画布坐标）
export const PART_PIVOTS = {
  head: [90, 70],
  tailL: [64, 90],
  tailR: [116, 90],
  armL: [76, 112],
  armR: [104, 112],
  legL: [82, 150],
  legR: [98, 150],
  body: [90, 110],
};

export function basePose() {
  return {
    char: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    head: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    tailL: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    tailR: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    armL: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    armR: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    legL: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    legR: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    body: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    shadow: { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 },
    face: { eyes: 'open', mouth: 'smile' },
  };
}

// 帧动画定义：frames 为"对基础姿态的部分覆盖"，按 fps 逐帧采样
export const ACTIONS = {
  idle: {
    fps: 2, loop: true, friendlyBlink: true,
    frames: [
      {},
      { char: { dy: -1.5, sy: 1.015 }, head: { dy: -0.5 } },
    ],
  },
  walk: {
    fps: 8, loop: true, friendlyBlink: true,
    frames: [
      { legL: { rot: 20 }, legR: { rot: -20 }, armL: { rot: -14 }, armR: { rot: 14 }, char: { dy: -2 }, tailL: { rot: 5 }, tailR: { rot: -5 } },
      { legL: { rot: 4 }, legR: { rot: -4 }, armL: { rot: -4 }, armR: { rot: 4 }, char: { dy: 0 } },
      { legL: { rot: -20 }, legR: { rot: 20 }, armL: { rot: 14 }, armR: { rot: -14 }, char: { dy: -2 }, tailL: { rot: -5 }, tailR: { rot: 5 } },
      { legL: { rot: -4 }, legR: { rot: 4 }, armL: { rot: 4 }, armR: { rot: -4 }, char: { dy: 0 } },
    ],
  },
  sit: {
    fps: 1, loop: true, friendlyBlink: true,
    frames: [
      { legL: { sy: 0.18, dy: -2 }, legR: { sy: 0.18, dy: -2 }, armL: { rot: 18 }, armR: { rot: -18 }, char: { dy: 14, sy: 0.92 }, face: { mouth: 'smile' } },
    ],
  },
  sleep: {
    fps: 1.5, loop: true,
    frames: [
      { char: { rot: -84, dy: 6, dx: -6 }, face: { eyes: 'closed', mouth: 'smile' }, head: { rot: 8 } },
      { char: { rot: -84, dy: 6, dx: -6, sy: 1.02 }, face: { eyes: 'closed', mouth: 'smile' }, head: { rot: 8 } },
    ],
  },
  sing: {
    fps: 5, loop: true,
    frames: [
      { char: { rot: -6, dy: -2 }, armL: { rot: -120 }, armR: { rot: -40 }, face: { eyes: 'happy', mouth: 'open' }, head: { rot: -5 } },
      { char: { dy: 0 }, armL: { rot: -100 }, armR: { rot: -20 }, face: { eyes: 'happy', mouth: 'open' } },
      { char: { rot: 6, dy: -2 }, armL: { rot: -40 }, armR: { rot: -120 }, face: { eyes: 'happy', mouth: 'open' }, head: { rot: 5 } },
      { char: { dy: 0 }, armL: { rot: -20 }, armR: { rot: -100 }, face: { eyes: 'happy', mouth: 'open' } },
    ],
  },
  dance: {
    fps: 6, loop: true,
    frames: [
      { char: { dy: -7 }, armL: { rot: -150 }, armR: { rot: 30 }, head: { rot: -8 }, legL: { rot: 10 }, face: { eyes: 'happy', mouth: 'open' } },
      { char: { dy: 0 }, armL: { rot: -80 }, armR: { rot: -30 }, head: { rot: 0 }, face: { eyes: 'happy', mouth: 'smile' } },
      { char: { dy: -7 }, armL: { rot: 30 }, armR: { rot: -150 }, head: { rot: 8 }, legR: { rot: 10 }, face: { eyes: 'happy', mouth: 'open' } },
      { char: { dy: 0 }, armL: { rot: -30 }, armR: { rot: -80 }, head: { rot: 0 }, face: { eyes: 'happy', mouth: 'smile' } },
    ],
  },
  grabbed: {
    fps: 2, loop: true,
    frames: [
      { legL: { rot: 16 }, legR: { rot: -16 }, armL: { rot: -140 }, armR: { rot: -140 }, face: { eyes: 'open', mouth: 'open' }, char: { dy: -2 } },
      { legL: { rot: 22 }, legR: { rot: -10 }, armL: { rot: -135 }, armR: { rot: -145 }, face: { eyes: 'open', mouth: 'open' }, char: { dy: -3 } },
    ],
  },
  jump: {
    fps: 10, loop: false,
    frames: [
      { char: { sy: 0.82, dy: 6 }, head: { dy: 2 }, legL: { rot: -8 }, legR: { rot: 8 } },
      { char: { dy: -26, sy: 1.06 }, armL: { rot: -150 }, armR: { rot: -150 }, legL: { rot: 10 }, legR: { rot: -10 }, face: { eyes: 'happy', mouth: 'open' } },
      { char: { dy: -14 }, armL: { rot: -60 }, armR: { rot: -60 } },
      { char: { sy: 0.88, dy: 4 }, head: { dy: 1.5 } },
    ],
  },
};

export const ACTION_NAMES = Object.keys(ACTIONS);

// 帧 → 完整姿态（部分覆盖合并到基础姿态）
export function mergePose(frame) {
  const pose = basePose();
  if (!frame) return pose;
  for (const key of Object.keys(frame)) {
    if (key === 'face') {
      Object.assign(pose.face, frame.face);
    } else if (pose[key]) {
      Object.assign(pose[key], frame[key]);
    }
  }
  return pose;
}

// 采样：返回当前帧姿态与完成状态（loop 循环；单次播完停在最后一帧并标记 done）
export function sampleAction(name, elapsedSec, speed = 1) {
  const action = ACTIONS[name];
  if (!action) throw new Error(`unknown action: ${name}`);
  const frames = action.frames;
  const t = Math.max(0, elapsedSec) * speed * action.fps;
  let idx;
  let done = false;
  if (action.loop) {
    idx = Math.floor(t) % frames.length;
  } else {
    idx = Math.min(Math.floor(t), frames.length - 1);
    if (t >= frames.length) done = true;
  }
  return {
    pose: mergePose(frames[idx]),
    done,
    frameIndex: idx,
    frameCount: frames.length,
    loop: action.loop,
  };
}

export function actionDuration(name, speed = 1) {
  const a = ACTIONS[name];
  if (!a) throw new Error(`unknown action: ${name}`);
  return a.frames.length / (a.fps * speed);
}

// ============ DOM 部分（仅渲染层使用） ============

const SVG_STRING = `
<svg viewBox="0 0 180 200" xmlns="http://www.w3.org/2000/svg">
  <g id="rig-root">
    <ellipse id="p-shadow" cx="90" cy="190" rx="34" ry="5" fill="rgba(0,0,0,0.10)"/>
    <g id="p-tailL">
      <path d="M62,82 C44,90 38,110 40,140 C41,152 48,160 56,150 C52,128 54,104 64,92 Z" fill="var(--hair)"/>
      <path d="M50,120 C48,132 50,142 54,148" stroke="var(--hair-dark)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </g>
    <g id="p-tailR">
      <path d="M118,82 C136,90 142,110 140,140 C139,152 132,160 124,150 C128,128 126,104 116,92 Z" fill="var(--hair)"/>
      <path d="M130,120 C132,132 130,142 126,148" stroke="var(--hair-dark)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
    </g>
    <g id="p-legL">
      <line x1="82" y1="150" x2="82" y2="162" stroke="var(--skin)" stroke-width="7" stroke-linecap="round"/>
      <line x1="82" y1="162" x2="82" y2="182" stroke="var(--shoe)" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="82" cy="185" rx="8" ry="4.5" fill="#ffffff"/>
    </g>
    <g id="p-legR">
      <line x1="98" y1="150" x2="98" y2="162" stroke="var(--skin)" stroke-width="7" stroke-linecap="round"/>
      <line x1="98" y1="162" x2="98" y2="182" stroke="var(--shoe)" stroke-width="7" stroke-linecap="round"/>
      <ellipse cx="98" cy="185" rx="8" ry="4.5" fill="#ffffff"/>
    </g>
    <g id="p-body">
      <!-- 白色上衣 -->
      <path d="M72,108 L108,108 L112,130 L68,130 Z" fill="var(--hem)"/>
      <!-- 蓝色水手领 -->
      <path d="M72,108 L90,124 L108,108 L118,112 L112,130 L68,130 L62,112 Z" fill="var(--dress)"/>
      <!-- 黄领带 -->
      <path d="M88,124 L92,124 L91,140 L89,140 Z" fill="var(--tie)"/>
      <!-- 中国结 -->
      <circle cx="102" cy="122" r="3" fill="var(--knot)"/>
      <!-- 蓝色百褶裙 -->
      <path d="M68,130 L112,130 L120,155 L60,155 Z" fill="var(--dress)"/>
      <!-- 白色裙摆 -->
      <path d="M60,155 L120,155 L122,159 L58,159 Z" fill="var(--hem)"/>
    </g>
    <g id="p-armL">
      <line x1="76" y1="112" x2="76" y2="135" stroke="var(--dress-dark)" stroke-width="8" stroke-linecap="round"/>
      <circle cx="76" cy="139" r="4" fill="var(--skin)"/>
    </g>
    <g id="p-armR">
      <line x1="104" y1="112" x2="104" y2="135" stroke="var(--dress-dark)" stroke-width="8" stroke-linecap="round"/>
      <circle cx="104" cy="139" r="4" fill="var(--skin)"/>
    </g>
    <g id="p-head">
      <!-- 后发 -->
      <path d="M48,76 C42,55 54,30 90,28 C126,30 138,55 132,76 C138,95 128,112 106,104 C100,100 80,100 74,104 C52,112 42,95 48,76 Z" fill="var(--hair)"/>
      <!-- 脸 -->
      <circle cx="90" cy="74" r="31" fill="var(--skin)"/>
      <!-- 刘海 -->
      <path d="M56,72 C56,48 72,34 90,34 C108,34 124,48 124,72 C120,58 110,52 102,56 C96,60 92,54 90,54 C88,54 84,60 78,56 C70,52 60,58 56,72 Z" fill="var(--hair)"/>
      <!-- 左鬓发 -->
      <path d="M56,70 C52,85 54,100 64,104 C58,94 58,80 60,70 Z" fill="var(--hair)"/>
      <!-- 右鬓发 -->
      <path d="M124,70 C128,85 126,100 116,104 C122,94 122,80 120,70 Z" fill="var(--hair)"/>
      <!-- 头顶蝴蝶结 -->
      <path d="M74,42 C70,34 78,28 86,34 L90,38 L94,34 C102,28 110,34 106,42 L98,46 L106,50 C110,58 102,64 94,58 L90,54 L86,58 C78,64 70,58 74,50 L82,46 Z" fill="var(--dress)"/>

      <g id="f-eyes-open">
        <ellipse cx="78" cy="78" rx="5" ry="6.5" fill="var(--eye)"/>
        <circle cx="79.5" cy="75.5" r="1.6" fill="#ffffff"/>
        <ellipse cx="102" cy="78" rx="5" ry="6.5" fill="var(--eye)"/>
        <circle cx="103.5" cy="75.5" r="1.6" fill="#ffffff"/>
      </g>
      <g id="f-eyes-closed" style="display:none">
        <path d="M72,78 Q78,83 84,78" stroke="#5a5e66" stroke-width="2" fill="none" stroke-linecap="round"/>
        <path d="M96,78 Q102,83 108,78" stroke="#5a5e66" stroke-width="2" fill="none" stroke-linecap="round"/>
      </g>
      <g id="f-eyes-happy" style="display:none">
        <path d="M72,80 Q78,73 84,80" stroke="var(--eye)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
        <path d="M96,80 Q102,73 108,80" stroke="var(--eye)" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      </g>

      <circle cx="66" cy="84" r="4.5" fill="var(--cheek)" opacity="0.7"/>
      <circle cx="114" cy="84" r="4.5" fill="var(--cheek)" opacity="0.7"/>

      <path id="f-mouth-smile" d="M84,92 Q90,97 96,92" stroke="#d98a8a" stroke-width="2" fill="none" stroke-linecap="round"/>
      <ellipse id="f-mouth-open" cx="90" cy="94" rx="4.5" ry="5.5" fill="#b96a6a" style="display:none"/>
      <path id="f-mouth-puff" d="M83,94 Q90,89 97,94 Q90,99 83,94 Z" fill="#e8a0a0" style="display:none"/>
    </g>
  </g>
</svg>`;

export class Rig {
  constructor(container) {
    if (typeof document === 'undefined') throw new Error('Rig requires DOM');
    container.innerHTML = SVG_STRING;
    this.container = container;
    this.svg = container.querySelector('svg');
    this.root = this.svg.querySelector('#rig-root');
    this.parts = {};
    for (const id of ['shadow', 'tailL', 'tailR', 'legL', 'legR', 'body', 'armL', 'armR', 'head']) {
      this.parts[id] = this.svg.querySelector(`#p-${id}`);
    }
    this.faces = {
      'eyes-open': this.svg.querySelector('#f-eyes-open'),
      'eyes-closed': this.svg.querySelector('#f-eyes-closed'),
      'eyes-happy': this.svg.querySelector('#f-eyes-happy'),
      'mouth-smile': this.svg.querySelector('#f-mouth-smile'),
      'mouth-open': this.svg.querySelector('#f-mouth-open'),
      'mouth-puff': this.svg.querySelector('#f-mouth-puff'),
    };
    this.current = null;
    this.elapsed = 0;
    this.speed = 1;
    this.onDone = null;
    this._doneFired = false;
    this._zoom = 1;
    this._flip = false;
    this._blinkUntil = 0;
    this._nextBlinkAt = performance.now() + 2500 + Math.random() * 2500;
    this._raf = null;
    this._last = null;

    this._tick = (ts) => {
      if (this._last == null) this._last = ts;
      const dt = Math.min(0.05, (ts - this._last) / 1000);
      this._last = ts;
      this.elapsed += dt;
      this._render(ts);
      this._raf = requestAnimationFrame(this._tick);
    };
    this._raf = requestAnimationFrame(this._tick);
  }

  play(name, { speed = 1, onDone = null } = {}) {
    if (!ACTIONS[name]) throw new Error(`unknown action: ${name}`);
    this.current = name;
    this.elapsed = 0;
    this.speed = speed;
    this.onDone = onDone;
    this._doneFired = false;
  }

  get action() {
    return this.current;
  }

  setZoom(v) {
    this._zoom = v;
    this._applyContainerTransform();
  }

  setFlip(v) {
    this._flip = v;
    this._applyContainerTransform();
  }

  _applyContainerTransform() {
    this.container.style.transform =
      `scaleX(${this._flip ? -1 : 1}) scale(${this._zoom})`;
    this.container.style.transformOrigin = '50% 100%';
  }

  setPalette(vars) {
    for (const [k, v] of Object.entries(vars)) {
      this.svg.style.setProperty(k, v);
    }
  }

  _render(now) {
    if (!this.current) return;
    const action = ACTIONS[this.current];
    const result = sampleAction(this.current, this.elapsed, this.speed);
    let pose = result.pose;
    // 眨眼叠加：允许眨眼的动作 + 当前睁眼 + 到达眨眼时刻
    if (action.friendlyBlink && pose.face.eyes === 'open') {
      if (this._blinkUntil > now) {
        pose = { ...pose, face: { ...pose.face, eyes: 'closed' } };
      } else if (now >= this._nextBlinkAt) {
        this._blinkUntil = now + 150;
        this._nextBlinkAt = now + 2500 + Math.random() * 2500;
      }
    }
    this._apply(pose);
    if (result.done && !this._doneFired) {
      this._doneFired = true;
      if (this.onDone) this.onDone();
    }
  }

  _apply(pose) {
    for (const [name, el] of Object.entries(this.parts)) {
      const p = pose[name];
      const [px, py] = PART_PIVOTS[name] || [0, 0];
      let t = '';
      if (name === 'shadow') {
        t = `translate(${p.dx},0)`;
      } else {
        t = `translate(${p.dx},${p.dy}) rotate(${p.rot},${px},${py})` +
          (p.sx !== 1 || p.sy !== 1 ? ` translate(${px},${py}) scale(${p.sx},${p.sy}) translate(${-px},${-py})` : '');
      }
      el.setAttribute('transform', t);
    }
    const c = pose.char;
    this.root.setAttribute('transform',
      `translate(${c.dx},${c.dy}) rotate(${c.rot},90,186) scale(${c.sx},${c.sy})`);
    // 面部表情
    for (const eyes of ['open', 'closed', 'happy']) {
      this.faces[`eyes-${eyes}`].style.display = pose.face.eyes === eyes ? '' : 'none';
    }
    for (const mouth of ['smile', 'open', 'puff']) {
      this.faces[`mouth-${mouth}`].style.display = pose.face.mouth === mouth ? '' : 'none';
    }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
