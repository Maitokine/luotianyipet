// 抛出物理（M2 / K4）：重力 + 落地弹跳 + 边界反弹（纯逻辑可测试）
export const G = 2200;            // 重力 px/s²
export const RESTITUTION = 0.45;  // 落地弹性
export const WALL_BOUNCE = 0.6;   // 左右边界弹性
export const STOP_VY = 260;       // 落地判定速度阈值 px/s
export const MAX_SPEED = 2200;    // 抛出初速上限 px/s

// 单步弹道（纯函数）：返回新状态与事件
export function stepBallistics(st, dt, bounds) {
  const s = { x: st.x, y: st.y, vx: st.vx, vy: st.vy };
  let event = null;
  s.vy += G * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  // 左右边界
  if (s.x < bounds.minX) { s.x = bounds.minX; s.vx = -s.vx * WALL_BOUNCE; event = 'wall'; }
  else if (s.x > bounds.maxX) { s.x = bounds.maxX; s.vx = -s.vx * WALL_BOUNCE; event = 'wall'; }
  // 顶部边界（不可飞出屏幕上方）
  if (s.y < bounds.minY) { s.y = bounds.minY; s.vy = Math.abs(s.vy) * 0.4; event = 'ceiling'; }
  // 地面
  if (s.y >= bounds.groundY) {
    s.y = bounds.groundY;
    if (Math.abs(s.vy) > STOP_VY) {
      s.vy = -s.vy * RESTITUTION; // 弹跳（A12：1~2 次后停）
      s.vx *= 0.75;
      event = 'bounce';
    } else {
      s.vy = 0;
      s.vx = 0;
      event = 'landed';
    }
  }
  return { state: s, event };
}

export function clampSpeed(v, max = MAX_SPEED) {
  const len = Math.hypot(v.x, v.y);
  if (len <= max || len === 0) return { x: v.x, y: v.y };
  return { x: (v.x / len) * max, y: (v.y / len) * max };
}

// 与 fsm 集成的受管物理（渲染层）
export class Physics {
  constructor({ onMove }) {
    this.onMove = onMove || (() => {});
    this.active = false;
    this.st = null;
    this.bounds = null;
  }

  launch(vx, vy, x, y, bounds) {
    const v = clampSpeed({ x: vx, y: vy });
    this.st = { x, y, vx: v.x, vy: v.y };
    this.bounds = bounds;
    this.active = true;
  }

  // 原地放下：从空中坠落到地面（无水平速度）
  settle(x, y, bounds) {
    this.st = { x, y, vx: 0, vy: 0 };
    this.bounds = bounds;
    this.active = true;
    if (y >= bounds.groundY) {
      this.active = false;
      this.onMove(x, bounds.groundY);
      return true;
    }
    return false;
  }

  // 返回：是否已落地（落地后 active=false）
  step(dt) {
    if (!this.active) return true;
    const { state, event } = stepBallistics(this.st, dt, this.bounds);
    this.st = state;
    this.onMove(state.x, state.y);
    if (event === 'landed') {
      this.active = false;
      return true;
    }
    return false;
  }
}
