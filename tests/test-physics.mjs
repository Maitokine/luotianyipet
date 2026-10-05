// physics.js 单测：弹道纯函数 + clampSpeed + Physics 类生命周期
import { stepBallistics, clampSpeed, Physics, G, RESTITUTION, WALL_BOUNCE, STOP_VY, MAX_SPEED } from '../src/renderer/js/physics.js';

const BOUNDS = { minX: 0, maxX: 1000, minY: 0, groundY: 500 };

function freeFall(st, dt, n) {
  let s = st;
  for (let i = 0; i < n; i++) s = stepBallistics(s, dt, BOUNDS).state;
  return s;
}

export function run(t) {
  // ---- 常量一致性 ----
  t.eq(G, 2200, '重力常量 2200 px/s²（K4）');
  t.eq(RESTITUTION, 0.45, '落地弹性 0.45（K4）');
  t.eq(WALL_BOUNCE, 0.6, '墙弹 0.6（K4）');
  t.eq(STOP_VY, 260, '落地判定速度阈值 260（K4）');
  t.eq(MAX_SPEED, 2200, '抛出初速上限 2200（K4）');

  // ---- 自由落体（半隐式欧拉：先更新速度再积分位置） ----
  {
    const r = stepBallistics({ x: 500, y: 100, vx: 0, vy: 0 }, 0.1, BOUNDS);
    t.close(r.state.vy, G * 0.1, 1e-9, '一帧后 vy = g·dt');
    t.close(r.state.y, 100 + G * 0.1 * 0.1, 1e-9, '一帧后 y = y0 + vy_new·dt');
    t.eq(r.event, null, '自由落体无事件');
  }

  // ---- 左墙反弹 ----
  {
    const r = stepBallistics({ x: 100, y: 250, vx: -3000, vy: 0 }, 0.1, BOUNDS);
    t.eq(r.state.x, BOUNDS.minX, '撞左墙 x 钳制到 minX');
    t.close(r.state.vx, 3000 * WALL_BOUNCE, 1e-9, '撞墙 vx 反向 × WALL_BOUNCE');
    t.eq(r.event, 'wall', '撞墙事件');
  }

  // ---- 右墙反弹 ----
  {
    const r = stepBallistics({ x: 900, y: 250, vx: 3000, vy: 0 }, 0.1, BOUNDS);
    t.eq(r.state.x, BOUNDS.maxX, '撞右墙 x 钳制到 maxX');
    t.ok(r.state.vx < 0, '撞右墙 vx 反向');
    t.eq(r.event, 'wall', '右墙事件');
  }

  // ---- 顶部钳制（重力先作用，再钳制反弹） ----
  {
    const r = stepBallistics({ x: 500, y: 10, vx: 100, vy: -2000 }, 0.05, BOUNDS);
    t.eq(r.state.y, BOUNDS.minY, '飞出顶部 y 钳制到 minY');
    t.close(r.state.vy, Math.abs(-2000 + G * 0.05) * 0.4, 1e-9, '顶部 vy 转为正值 ×0.4（重力后速度）');
    t.eq(r.event, 'ceiling', '顶部事件');
  }

  // ---- 高速落地弹起 ----
  {
    const r = stepBallistics({ x: 500, y: 490, vx: 800, vy: 2000 }, 0.1, BOUNDS);
    t.eq(r.state.y, BOUNDS.groundY, '落地 y 钳制到 groundY');
    t.ok(r.state.vy < 0, '高速落地 vy 反向弹起');
    t.close(Math.abs(r.state.vy), (2000 + G * 0.1) * RESTITUTION, 1e-6, '弹起速度 = 入地速度 × RESTITUTION');
    t.close(r.state.vx, 800 * 0.75, 1e-9, '落地水平速度摩擦 ×0.75');
    t.eq(r.event, 'bounce', '弹跳事件');
  }

  // ---- 低速落地停止 ----
  {
    const r = stepBallistics({ x: 500, y: 495, vx: 300, vy: 100 }, 0.05, BOUNDS);
    t.eq(r.state.y, BOUNDS.groundY, '低速落地钳制');
    t.eq(r.state.vy, 0, '低速落地 vy 归零');
    t.eq(r.state.vx, 0, '低速落地 vx 归零');
    t.eq(r.event, 'landed', '落地事件');
  }

  // ---- clampSpeed ----
  {
    t.eq(clampSpeed({ x: 3000, y: 4000 }), { x: 1320, y: 1760 }, 'clampSpeed 按比例限幅到 2200');
    t.eq(clampSpeed({ x: 100, y: -100 }), { x: 100, y: -100 }, '低于上限不缩放');
    t.eq(clampSpeed({ x: 0, y: 0 }), { x: 0, y: 0 }, '零向量原样返回');
  }

  // ---- Physics 类：launch → 飞行 → landed ----
  {
    const moves = [];
    const p = new Physics({ onMove: (x, y) => moves.push([x, y]) });
    t.ok(p.step(0.016), '未激活时 step 直接返回已落地');
    p.launch(1500, -1600, 500, 100, BOUNDS); // 合速度 2193 < 2200 → 不限幅
    t.ok(p.active, 'launch 后激活');
    t.eq(p.st.vx, 1500, 'launch 保留 vx（未超上限）');
    t.close(p.st.vy, -1600, 1e-9, 'launch 保留 vy（未超上限）');
    let landed = false;
    for (let i = 0; i < 1200 && !landed; i++) landed = p.step(1 / 60);
    t.ok(landed, '抛出后最终落地');
    t.ok(!p.active, '落地后不再激活');
    t.ok(moves.length > 10, '飞行期间持续回调 onMove');
    t.ok(moves.every(([x]) => x >= BOUNDS.minX - 0.001 && x <= BOUNDS.maxX + 0.001), 'x 始终在边界内');
  }

  // ---- Physics 类：launch 初速限幅 ----
  {
    const p = new Physics({ onMove: () => {} });
    p.launch(99999, 0, 500, 100, BOUNDS);
    t.eq(p.st.vx, MAX_SPEED, 'launch 初速 vx 被限幅');
  }

  // ---- Physics 类：settle（原地放下） ----
  {
    const p = new Physics({ onMove: () => {} });
    // 空中放下 → 坠落后落地
    t.ok(!p.settle(500, 300, BOUNDS), '空中 settle 返回未落地');
    let landed = false;
    for (let i = 0; i < 600 && !landed; i++) landed = p.step(1 / 60);
    t.ok(landed, '空中放下最终落地');
    t.ok(!p.active, '落地后失活');
  }
  {
    const moves = [];
    const p = new Physics({ onMove: (x, y) => moves.push([x, y]) });
    t.ok(p.settle(500, BOUNDS.groundY, BOUNDS), '放正在地面上立即落地');
    t.eq(moves.length, 1, '立即落地回调一次 onMove');
    t.eq(moves[0][1], BOUNDS.groundY, '落地 y 为 groundY');
  }

  // ---- 高抛多次弹跳（A12：1~2 次后停） ----
  {
    let s = { x: 500, y: 0, vx: 0, vy: -2000 };
    let bounces = 0;
    for (let i = 0; i < 2000; i++) {
      const r = stepBallistics(s, 1 / 60, BOUNDS);
      if (r.event === 'bounce') bounces += 1;
      if (r.event === 'landed') { s = r.state; break; }
      s = r.state;
    }
    t.ok(bounces >= 1 && bounces <= 3, `高抛弹跳 1~3 次后停（实际 ${bounces} 次）`);
  }
}
