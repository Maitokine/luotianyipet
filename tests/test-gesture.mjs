// GestureTracker 单测：单击/双击/拖拽/甩出手势分类（真实时钟 + 宽裕余量）
import { GestureTracker, CLICK_MAX_MOVE, DBLCLICK_WINDOW, THROW_SPEED, CLICK_MAX_MS } from '../src/renderer/js/interact.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function recorder() {
  const calls = { click: 0, dblclick: 0, dragStart: 0, dragMove: [], dragEnd: 0, throw: [] };
  return {
    calls,
    handlers: {
      onClick: () => { calls.click += 1; },
      onDblclick: () => { calls.dblclick += 1; },
      onDragStart: () => { calls.dragStart += 1; },
      onDragMove: (x, y, dx, dy) => { calls.dragMove.push({ x, y, dx, dy }); },
      onDragEnd: () => { calls.dragEnd += 1; },
      onThrow: (vx, vy) => { calls.throw.push({ vx, vy }); },
    },
  };
}

export async function run(t) {
  t.eq(CLICK_MAX_MOVE, 6, '点击位移阈值 6px（K3）');
  t.eq(DBLCLICK_WINDOW, 400, '双击窗口 400ms（Windows 真机双击间隔常 300-450ms，260 会拆成两次单击）');
  t.eq(THROW_SPEED, 0.35, '甩出速度阈值 0.35px/ms（K3）');
  t.eq(CLICK_MAX_MS, 500, '点击按住上限 500ms');

  // ---- 单击 ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(30);
    g.pointerUp(102, 101);
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.click, 1, '快速单击触发 onClick');
    t.eq(calls.dblclick, 0, '单击不触发双击');
    t.eq(calls.dragStart, 0, '单击不触发拖拽');
  }

  // ---- 双击（第二击在窗口内 → 只有 dblclick，无 click） ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(30);
    g.pointerUp(101, 100);
    await sleep(80);
    g.pointerDown(102, 100);
    await sleep(30);
    g.pointerUp(103, 101);
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.dblclick, 1, '双击触发 onDblclick');
    t.eq(calls.click, 0, '双击抑制了第一次单击');
  }

  // ---- 两次独立单击（间隔 > 400ms） ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(20);
    g.pointerUp(101, 100);
    await sleep(DBLCLICK_WINDOW + 120);
    g.pointerDown(300, 300);
    await sleep(20);
    g.pointerUp(301, 300);
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.click, 2, '两次独立单击各触发一次');
    t.eq(calls.dblclick, 0, '不误判双击');
  }

  // ---- 长按不算点击 ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(CLICK_MAX_MS + 150);
    g.pointerUp(101, 100);
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.click, 0, '按住超过 500ms 不算点击');
  }

  // ---- 小幅移动（<6px）仍是点击 ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    g.pointerMove(104, 103); // 位移 5px，未超阈值
    await sleep(30);
    g.pointerUp(104, 103);
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.click, 1, '6px 内抖动仍判为点击');
    t.eq(calls.dragStart, 0, '未超阈值不进入拖拽');
  }

  // ---- 拖拽（慢速释放 → dragEnd） ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(20);
    g.pointerMove(140, 130); // 位移 50px > 6px → 进入拖拽
    await sleep(120);
    g.pointerMove(170, 150);
    await sleep(300); // 长停顿 → 释放速度充分衰减
    g.pointerUp(171, 151);
    t.eq(calls.dragStart, 1, '超阈值移动触发 onDragStart');
    t.eq(calls.dragMove.length, 2, '拖拽中每次 move 回调 onDragMove');
    t.eq(calls.dragMove[0], { x: 140, y: 130, dx: 40, dy: 30 }, 'onDragMove 携带增量');
    t.eq(calls.dragEnd, 1, '慢速释放触发 onDragEnd');
    t.eq(calls.throw.length, 0, '慢速释放不判甩出');
    t.eq(calls.click, 0, '拖拽不算点击');
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.click, 0, '拖拽结束后无迟到点击');
  }

  // ---- 甩出（快速释放 → throw 带速度） ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(500, 500);
    await sleep(20);
    g.pointerMove(560, 510); // 快速移动
    await sleep(30);
    g.pointerMove(620, 530); // 60ms 内 60px → ~1px/ms
    g.pointerUp(621, 531);
    t.eq(calls.throw.length, 1, '快速释放触发 onThrow');
    t.ok(calls.throw[0].vx > THROW_SPEED, '甩出水平速度超过阈值');
    t.ok(calls.throw[0].vx > 0.8 && calls.throw[0].vy > 0.1, '甩出速度方向正确（向右下）');
    t.eq(calls.dragEnd, 0, '甩出不触发 dragEnd');
  }

  // ---- 速度计算（注入时钟，确定性验证） ----
  {
    let nowMs = 0;
    const g = new GestureTracker({ now: () => nowMs, ...recorder().handlers });
    nowMs = 0;
    g.pointerDown(0, 0);
    t.eq(g.velocity(), { x: 0, y: 0 }, '单样本速度为 0');
    nowMs = 20;
    g.pointerMove(100, 0); // 20ms 移动 100px → 5px/ms
    const v = g.velocity();
    t.close(v.x, 5, 1e-9, '速度采样正确（100px / 20ms）');
    t.close(v.y, 0, 1e-9, 'y 速度为 0');
  }

  // ---- 拖拽打断待定单击 ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(20);
    g.pointerUp(101, 100); // 单击候选，400ms 定时器启动
    await sleep(60);
    g.pointerDown(100, 100);
    await sleep(10);
    g.pointerMove(140, 120); // 进入拖拽 → 取消待定单击
    await sleep(100);
    g.pointerUp(141, 121);
    await sleep(DBLCLICK_WINDOW + 80);
    t.eq(calls.click, 0, '拖拽取消了待定单击');
    t.eq(calls.dragStart, 1, '拖拽正常触发');
    t.eq(calls.dblclick, 0, '拖拽不判双击');
  }

  // ---- 双击第二击超窗口 → 两次单击 ----
  {
    const { calls, handlers } = recorder();
    const g = new GestureTracker(handlers);
    g.pointerDown(100, 100);
    await sleep(20);
    g.pointerUp(101, 100);
    await sleep(DBLCLICK_WINDOW + 100); // 超过双击窗口
    g.pointerDown(150, 100);
    await sleep(20);
    g.pointerUp(151, 100);
    await sleep(DBLCLICK_WINDOW + 60);
    t.eq(calls.click, 2, '间隔超窗口算两次单击');
    t.eq(calls.dblclick, 0, '不触发双击');
  }
}
