// fsm.js 单测：日常循环（A7/A8）、睡觉与惊醒（A9）、打断与快照恢复、
// 拖拽/抛出（A11/A12）、优先级、唱歌跳舞接口、提醒（A23 打断部分）
import {
  Fsm, IDLE_PICK_AFTER, SLEEP_AFTER, CLICK_REACT_MS, WALK_SPEED, PRIORITY,
} from '../src/renderer/js/fsm.js';

// Node 无 rAF：桩掉（start() 只用一次，tick 由测试手动驱动）
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

function makeRig() {
  const calls = { plays: [], flips: [] };
  return {
    calls,
    _action: null,
    play(name, opts = {}) { this._action = name; calls.plays.push(name); return opts.onDone || null; },
    get action() { return this._action; },
    setFlip(v) { calls.flips.push(v); },
    setZoom() {},
    setPalette() {},
  };
}

function makeBubble() {
  const calls = { says: [], fxs: [] };
  return {
    calls,
    say: (text, ms) => calls.says.push({ text, ms }),
    fx: (k) => calls.fxs.push(k),
    hideSay() {},
    lyric() {}, hideLyric() {}, badge() {}, hideBadge() {}, clearFx() {},
  };
}

function makeFsm(over = {}) {
  const rig = makeRig();
  const bubble = makeBubble();
  const moves = [];
  const fsm = new Fsm({
    rig,
    bubble,
    moveWindow: (x, y) => moves.push([x, y]),
    rand: () => 0.5,
    ...over,
  });
  return { fsm, rig, bubble, moves };
}

const WA = { x: 0, y: 0, width: 1920, height: 1040 }; // groundY = 620
const DT = 1 / 60;

function tickN(fsm, secs, dt = DT) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) fsm.tick(dt);
}

export function run(t) {
  t.eq(IDLE_PICK_AFTER, 30, '闲置 30s 触发小动作（A8）');
  t.eq(SLEEP_AFTER, 120, '2 分钟无操作睡觉（A8）');
  t.eq(CLICK_REACT_MS, 2000, '单击互动 2s（A10）');
  t.eq(WALK_SPEED, 42, '闲逛速度 42px/s');
  t.eq(PRIORITY.sing, 4, '唱歌优先级 4');
  t.eq(PRIORITY.dance, 3, '跳舞优先级 3');
  t.eq(PRIORITY.physics, 5, '物理优先级 5');

  // ---------- A7 闲逛与折返 ----------
  {
    const { fsm, rig, moves } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    t.ok(rig.calls.plays.includes('walk'), 'start 播放 walk 动画');
    const x0 = fsm.winX;
    tickN(fsm, 2);
    t.close(fsm.winX - x0, WALK_SPEED * 2 * 1, 25, '2 秒后前进约 84px'); // rand=0.5 → walkDir=+1
    t.ok(moves.length > 60, '闲逛持续移动窗口');
    // 推到右边界 → 折返（单帧精确断言）
    fsm.winX = 1859.8;
    fsm.tick(DT);
    t.eq(fsm.winX, 1860, '右边界钳制（hi = 1920-60）');
    t.eq(fsm.walkDir, -1, '触边后方向反转');
    t.ok(rig.calls.flips.includes(true), '折返时镜像翻转');
    tickN(fsm, 1);
    t.ok(fsm.winX < 1860, '折返后向左移动');
  }

  // ---------- A8 闲置 30s 随机小动作 ----------
  {
    // rand=0.5 → roll=0.5 → pace
    const { fsm, rig } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    t.ok(fsm.pickCooldown > 14 && fsm.pickCooldown < 26, `walk 进入后冷却 15~25s（实际 ${fsm.pickCooldown.toFixed(1)}）`);
    tickN(fsm, 29.5);
    t.eq(fsm.daily, 'walk', '29.5s 时仍在闲逛');
    tickN(fsm, 1);
    t.eq(fsm.daily, 'pace', '30s 后触发踱步（roll=0.5）');
    t.ok(rig.calls.plays.includes('walk'), '踱步视觉上映射为 walk');
    tickN(fsm, 8.5);
    t.eq(fsm.daily, 'walk', '踱步 8s 后回闲逛');
  }
  {
    // rand=0.2 → roll=0.2 → daze
    const { fsm, rig } = makeFsm({ rand: () => 0.2 });
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.idleSecs = 40; // 直接越过阈值（冷却 15+0.2*10=17s）
    tickN(fsm, 18);
    t.eq(fsm.daily, 'daze', 'roll=0.2 → 发呆（持续 4+0.2*6≈5.2s）');
    t.ok(rig.calls.plays.includes('idle'), '发呆视觉上映射为 idle');
    tickN(fsm, 5.5);
    t.eq(fsm.daily, 'walk', '发呆结束后回闲逛');
  }
  {
    // rand=0.9 → roll=0.9 → hum + 音符特效
    const { fsm, rig, bubble } = makeFsm({ rand: () => 0.9 });
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.idleSecs = 40;
    tickN(fsm, 25);
    t.eq(fsm.daily, 'hum', 'roll=0.9 → 哼唱');
    t.ok(rig.calls.plays.includes('idle'), '哼唱视觉上映射为 idle');
    tickN(fsm, 3);
    t.ok(bubble.calls.fxs.filter((k) => k === 'note').length >= 2, '哼唱期间冒音符特效');
    tickN(fsm, 20);
    t.eq(fsm.daily, 'walk', '哼唱 10+9=19s 后回闲逛');
  }

  // ---------- A8 冷却期内不重复触发 ----------
  {
    const { fsm } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.idleSecs = 40; // 已超 30s 阈值
    tickN(fsm, 19);    // 冷却 15+0.5*10=20s
    t.eq(fsm.daily, 'walk', '冷却期内不触发小动作');
    tickN(fsm, 2);
    t.eq(fsm.daily, 'pace', '冷却结束且闲置超阈值 → 触发');
  }

  // ---------- A8 120 秒睡觉 + ZZZ ----------
  {
    const { fsm, rig, bubble } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    tickN(fsm, 121, 0.5);
    t.eq(fsm.daily, 'sleep', '120s 无操作进入睡觉');
    t.ok(rig.calls.plays.includes('sleep'), '播放睡觉动画');
    tickN(fsm, 5, 0.5);
    t.ok(bubble.calls.fxs.filter((k) => k === 'zzz').length >= 1, '睡觉冒 ZZZ 特效');
    // 睡觉期间持续睡觉（不会自己醒）
    tickN(fsm, 60, 0.5);
    t.eq(fsm.daily, 'sleep', '无互动持续睡觉');
  }

  // ---------- A9 睡觉中被单击 → 惊醒 ----------
  {
    const { fsm, rig } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    tickN(fsm, 121, 0.5);
    t.eq(fsm.daily, 'sleep', '前置：已睡着');
    const r = fsm.trigger('click');
    t.eq(r, 'woken', '睡中单击返回 woken');
    t.eq(fsm.idleSecs, 0, '互动即时重置闲置计时');
    t.ok(rig.calls.plays.includes('jump'), '播放惊醒 jump 动画');
    t.eq(fsm.interrupt.type, 'click-react', '进入单击互动打断');
    tickN(fsm, 2.2);
    t.eq(fsm.interrupt, null, '惊醒互动 2s 后结束');
    t.eq(fsm.daily, 'walk', '醒来回闲逛');
    t.ok(fsm.idleSecs < 0.5, '互动结束后闲置计时从零重新累计');
  }

  // ---------- A10 单击互动 + 快照恢复 ----------
  {
    const { fsm, rig, bubble } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    // 人为进入 daze（5s），2s 后被单击打断
    fsm._enterDaily('daze', 5);
    tickN(fsm, 2);
    const r = fsm.trigger('click');
    t.eq(r, 'react', '单击返回 react');
    t.eq(rig.calls.plays[rig.calls.plays.length - 1], 'jump', '播放 jump 互动动画');
    t.eq(fsm.interrupt.type, 'click-react', '进入打断');
    t.eq(fsm.daily, 'daze', '日常状态保持 daze（快照）');
    tickN(fsm, 1);
    t.close(fsm.actionLeft, 5 - 2, 0.5, '打断期间日常计时冻结');
    tickN(fsm, 1.2);
    t.eq(fsm.interrupt, null, '2s 互动结束');
    t.eq(fsm.daily, 'daze', '恢复发呆');
    t.ok(fsm.actionLeft > 2 && fsm.actionLeft <= 3.1, '恢复剩余时长（≈3s）');
    tickN(fsm, 3.5);
    t.eq(fsm.daily, 'walk', '发呆自然结束后回闲逛');
    t.ok(bubble.calls.says.length === 0, '无台词库时不冒泡（M3 接入后补充）');
  }

  // ---------- 双击 → 点歌请求 ----------
  {
    const { fsm } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    tickN(fsm, 121, 0.5);
    const r = fsm.trigger('dblclick');
    t.eq(r, 'sing-request', '双击返回 sing-request（M4 music 处理）');
    t.eq(fsm.daily, 'walk', '睡梦中双击 → 惊醒为 walk');
  }

  // ---------- A11 拖拽 ----------
  {
    const { fsm, rig, moves } = makeFsm();
    fsm.setGeometry({ workArea: WA, winBounds: { x: 500, y: 620 } });
    fsm.start();
    const r1 = fsm.trigger('drag-start');
    t.eq(r1, 'grabbed', '拖拽开始进入 grabbed');
    t.ok(rig.calls.plays.includes('grabbed'), '播放被抓动画');
    t.eq(fsm.grabbed, true, 'grabbed getter');
    fsm.trigger('drag-move', { x: 700, y: 300 });
    t.eq(fsm.winX, 700, '拖拽更新 winX');
    t.eq(fsm.winY, 300, '拖拽更新 winY');
    t.ok(moves.length > 0, '拖拽触发窗口移动');
    const last = moves[moves.length - 1];
    t.eq(last[0], 700, '窗口移动到拖拽位置');
    // 原地放下（无速度）→ 物理 → 落地动画 → 恢复
    const r2 = fsm.trigger('drag-end');
    t.eq(r2, 'settling', '放下进入物理下落');
    t.ok(rig.calls.plays.includes('grabbed'), '下落播放 grabbed 动画');
    tickN(fsm, 3);
    t.ok(rig.calls.plays.includes('jump'), '落地播放 jump 动画');
    t.eq(fsm.interrupt, null, '落地动画后退出打断');
    t.eq(fsm.daily, 'walk', '恢复闲逛');
    t.close(fsm.winY, 620, 2, '最终贴地（groundY=620）');
  }

  // ---------- A12 甩出 ----------
  {
    const { fsm, rig } = makeFsm();
    fsm.setGeometry({ workArea: WA, winBounds: { x: 500, y: 620 } });
    fsm.start();
    fsm.trigger('drag-start');
    fsm.trigger('drag-move', { x: 900, y: 200 });
    const r = fsm.trigger('throw', { vx: -2500, vy: -1800 });
    t.eq(r, 'thrown', '甩出返回 thrown');
    t.ok(rig.calls.plays.includes('grabbed'), '飞行播放 grabbed 动画');
    let landed = false;
    for (let i = 0; i < 60 * 15 && !landed; i++) {
      fsm.tick(DT);
      landed = rig.calls.plays.includes('jump');
    }
    t.ok(landed, '抛出后最终落地（jump）');
    t.ok(fsm.winX >= -240 - 1 && fsm.winX <= 1860 + 1, `x 在边界内（实际 ${fsm.winX.toFixed(0)}）`);
    t.close(fsm.winY, 620, 2, '落地贴地');
    tickN(fsm, 1.2);
    t.eq(fsm.interrupt, null, '落地后退出物理打断');
    t.eq(fsm.daily, 'walk', '恢复闲逛');
  }

  // ---------- 优先级 ----------
  {
    const { fsm } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    t.ok(fsm.beginSing(), '空闲时可开始唱歌');
    t.eq(fsm.singing, true, 'singing getter');
    t.eq(fsm.beginDance(), false, '唱歌期间不能跳舞（sing > dance）');
    t.ok(fsm.canInterrupt('dance') === false, 'canInterrupt 校验优先级');
    let singEndCalled = 0;
    fsm.onSingEnd = () => { singEndCalled += 1; };
    fsm.endSing();
    t.eq(fsm.singing, false, 'endSing 退出唱歌');
    t.eq(singEndCalled, 1, 'onSingEnd 回调（A22 衔接点）');
    t.ok(fsm.beginDance({ source: 'music', duration: 30 }), '唱歌结束后可跳舞');
    t.eq(fsm.dancing, true, 'dancing getter');
    // 唱歌可打断跳舞
    t.ok(fsm.beginSing(), '唱歌可打断跳舞');
    fsm.endSing();
    // 跳舞中被单击 → 低优先级忽略
    fsm.beginDance({ source: 'music', duration: 30 });
    t.eq(fsm.trigger('click'), 'ignored', '跳舞期间单击被忽略');
    // 但通知气泡仍显示（文案不丢）
    const { bubble } = fsm.deps;
    const r = fsm.notify({ text: '该喝水啦' });
    t.eq(r, false, '跳舞期间 notify 打断被拒');
    t.ok(bubble.calls.says.some((s) => s.text === '该喝水啦'), 'notify 文案仍然显示');
  }

  // ---------- 唱歌期间音符特效 ----------
  {
    const { fsm, bubble } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.beginSing();
    tickN(fsm, 3);
    t.ok(bubble.calls.fxs.filter((k) => k === 'note').length >= 2, '唱歌期间冒音符');
  }

  // ---------- 跳舞只用一个 dance 动作 ----------
  {
    const { fsm, rig } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.beginDance({ source: 'music', duration: 20 });
    tickN(fsm, 0.5);
    t.eq(rig._action, 'dance', '起舞 dance');
    tickN(fsm, 12);
    t.eq(rig._action, 'dance', '12s 后仍为 dance');
    tickN(fsm, 8);
    t.eq(fsm.interrupt, null, '20s 时长到自动结束');
  }

  // ---------- notify（空闲时） ----------
  {
    const { fsm, rig, bubble } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    const r = fsm.notify({ text: '久坐提醒', ms: 5000 });
    t.eq(r, true, '空闲时 notify 打断成功');
    t.eq(fsm.interrupt.type, 'notify', '进入 notify 打断');
    t.ok(rig.calls.plays.includes('dance'), '播放 dance 庆祝动画');
    t.ok(bubble.calls.says.some((s) => s.text === '久坐提醒'), '显示提醒文案');
    tickN(fsm, 5.2);
    t.eq(fsm.interrupt, null, '提醒结束恢复');
  }

  // ---------- manualAction（菜单指令） ----------
  {
    const { fsm, rig } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    t.eq(fsm.manualAction('sit'), true, '坐下指令');
    t.eq(fsm.daily, 'sit', '进入 sit');
    t.ok(rig.calls.plays.includes('sit'), '播放坐下');
    t.eq(fsm.manualAction('dance'), true, '跳舞指令');
    t.eq(fsm.dancing, true, '进入跳舞');
    t.eq(fsm.manualAction('daze'), false, '发呆指令已删除');
    t.eq(fsm.manualAction('bogus'), false, '未知指令拒绝');
    // 被抓时拒绝指令
    fsm.trigger('drag-start');
    t.eq(fsm.manualAction('sit'), false, '被抓时拒绝指令');
  }

  // ---------- 拖拽打断日常 → 快照恢复 ----------
  {
    const { fsm } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm._enterDaily('hum', 20);
    tickN(fsm, 5);
    fsm.trigger('drag-start');
    t.eq(fsm.daily, 'hum', '快照保留 hum');
    tickN(fsm, 2); // grabbed 不推进日常
    t.close(fsm.actionLeft, 15, 0.5, 'grabbed 期间日常计时冻结');
    fsm.trigger('drag-move', { x: 900, y: 300 });
    fsm.trigger('throw', { vx: 0, vy: 0 });
    tickN(fsm, 4);
    t.eq(fsm.daily, 'hum', '抛出落地后恢复哼唱');
    t.ok(fsm.actionLeft > 13 && fsm.actionLeft <= 15.1, '恢复剩余时长');
  }

  // ---------- 唱歌被打断 → onSingInterrupted 通知（真机反馈：拖拽后双击切歌两首叠加的根因） ----------
  {
    let interrupted = 0;
    const { fsm } = makeFsm({ onSingInterrupted: () => { interrupted += 1; } });
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    t.ok(fsm.beginSing(), '进入唱歌态');
    fsm.trigger('drag-start'); // grabbed(5) 打断 sing(4)
    t.eq(interrupted, 1, '拖拽打断唱歌触发 onSingInterrupted');
    t.eq(fsm.singing, false, 'fsm 已退出唱歌态');
    fsm.trigger('drag-end');
    t.eq(interrupted, 1, '拖拽结束不重复通知');
  }
  {
    let interrupted = 0;
    let singEnded = 0;
    const { fsm } = makeFsm({
      onSingInterrupted: () => { interrupted += 1; },
      onSingEnd: () => { singEnded += 1; },
    });
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.beginSing();
    fsm.endSing(); // 正常结束（music 主动停）
    t.eq(interrupted, 0, '正常结束不触发 interrupted');
    t.eq(singEnded, 1, '正常结束触发 onSingEnd');
  }
  {
    let interrupted = 0;
    const { fsm } = makeFsm({ onSingInterrupted: () => { interrupted += 1; } });
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.beginSing();
    fsm.trigger('click'); // click-react(2) < sing(4)：不打断
    t.eq(interrupted, 0, '低优先级事件不打断唱歌');
    t.eq(fsm.singing, true, '仍在唱歌态');
  }
  {
    let interrupted = 0;
    const { fsm } = makeFsm({ onSingInterrupted: () => { interrupted += 1; } });
    fsm.setGeometry({ workArea: WA });
    fsm.start();
    fsm.beginDance({ source: 'manual', duration: 5 });
    fsm.trigger('drag-start'); // grabbed 打断 dance（不是 sing）
    t.eq(interrupted, 0, '打断跳舞不触发唱歌打断回调');
  }

  // ---------- 几何：地面计算 ----------
  {
    const { fsm } = makeFsm();
    fsm.setGeometry({ workArea: WA });
    t.eq(fsm.groundY, 620, 'groundY = workArea 底 - 窗口高');
  }
}
