// dance.js 单测：DanceJudge 判定阈值（A20/A21）+ Dance 集成（媒体状态 → fsm）
import { DanceJudge, Dance, PLAY_SUSTAIN_S, STOP_SUSTAIN_S } from '../src/renderer/js/dance.js';

function makeFsm({ allowDance = true } = {}) {
  const calls = { begin: [], end: 0 };
  return {
    calls,
    allowDance,
    beginDance(opts) { calls.begin.push(opts); return this.allowDance; },
    endDance() { calls.end += 1; },
  };
}

export function run(t) {
  t.eq(PLAY_SUSTAIN_S, 5, '播放持续 5s 触发跳舞（A20/K8）');
  t.eq(STOP_SUSTAIN_S, 10, '停止 10s 结束跳舞（A21/K8）');

  // ---------- DanceJudge ----------

  // 播放 ≥5s 触发
  {
    const j = new DanceJudge();
    let ev = null;
    for (let s = 0; s < 4.9; s += 0.1) ev = j.update(true, 0.1);
    t.eq(ev, null, '播放 4.9s 未到阈值不触发');
    ev = j.update(true, 0.2);
    t.eq(ev, 'start', '播放 ≥5s 触发 start');
    t.eq(j.dancing, true, '判定器进入跳舞态');
    for (let s = 0; s < 3; s += 0.5) ev = j.update(true, 0.5);
    t.eq(ev, null, '持续播放不再重复触发');
  }

  // 未启用不触发
  {
    const j = new DanceJudge({ enabled: false });
    let ev = null;
    for (let s = 0; s < 10; s += 0.5) ev = j.update(true, 0.5);
    t.eq(ev, null, '功能关闭时播放多久都不触发');
  }

  // 停止 ≥10s 结束
  {
    const j = new DanceJudge();
    for (let s = 0; s < 5; s += 0.5) j.update(true, 0.5);
    let ev = null;
    for (let s = 0; s < 9.9; s += 0.3) ev = j.update(false, 0.3);
    t.eq(ev, null, '停止 9.9s 仍在跳');
    ev = j.update(false, 0.2);
    t.eq(ev, 'stop', '停止 ≥10s 触发 stop');
    t.eq(j.dancing, false, '判定器退出跳舞态');
  }

  // 短暂暂停（<10s）恢复 → 不结束
  {
    const j = new DanceJudge();
    for (let s = 0; s < 5; s += 0.5) j.update(true, 0.5);
    let ev = null;
    for (let s = 0; s < 6; s += 0.5) ev = j.update(false, 0.5); // 暂停 6s
    t.eq(ev, null, '暂停 6s 不结束');
    ev = j.update(true, 0.1); // 恢复
    t.eq(ev, null, '恢复播放无事件（继续跳）');
    t.eq(j.dancing, true, '仍在跳舞');
    // 恢复后再次停止，需重新计满 10s
    ev = null;
    for (let s = 0; s < 9.5; s += 0.5) ev = j.update(false, 0.5);
    t.eq(ev, null, '恢复后的停止需重新累计 10s');
    ev = j.update(false, 0.6);
    t.eq(ev, 'stop', '累计满 10s 结束');
  }

  // 跳舞中途关闭功能 → 立即停
  {
    const j = new DanceJudge();
    for (let s = 0; s < 5; s += 0.5) j.update(true, 0.5);
    t.eq(j.setEnabled(false), 'stop', '关闭功能返回 stop');
    t.eq(j.dancing, false, '关闭后退出跳舞态');
    t.eq(j.setEnabled(true), null, '重新启用无事件');
    let ev = null;
    for (let s = 0; s < 5; s += 0.5) ev = j.update(true, 0.5);
    t.eq(ev, 'start', '重新启用后可再次触发');
  }

  // 自定义阈值
  {
    const j = new DanceJudge({ playSustain: 2, stopSustain: 3 });
    let ev = null;
    for (let s = 0; s < 2; s += 0.5) ev = j.update(true, 0.5);
    t.eq(ev, 'start', '自定义播放阈值 2s 生效');
    ev = null;
    for (let s = 0; s < 3; s += 0.5) ev = j.update(false, 0.5);
    t.eq(ev, 'stop', '自定义停止阈值 3s 生效');
  }

  // ---------- Dance 集成 ----------

  // 媒体播放 5s → fsm.beginDance
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 5.2; s += 0.2) d.tick(0.2);
    t.eq(fsm.calls.begin.length, 1, '播放满 5s 调用一次 beginDance');
    t.eq(fsm.calls.begin[0].source, 'music', '来源标记 music');
  }

  // fsm 忙时重试
  {
    const fsm = makeFsm({ allowDance: false });
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 6; s += 0.5) d.tick(0.5);
    t.ok(fsm.calls.begin.length >= 2, `fsm 忙时逐帧重试（实际 ${fsm.calls.begin.length} 次）`);
  }

  // SMTC 不可用 → 视为未播放
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: true, available: false });
    for (let s = 0; s < 12; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 0, 'SMTC 不可用不触发跳舞');
  }

  // 完整链路：播放 → 跳 → 停止 10s → 结束
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 5.5; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 1, '开始跳舞');
    d.onMediaStatus({ playing: false, available: true });
    for (let s = 0; s < 9.5; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.end, 0, '停止 9.5s 未结束');
    d.tick(1.0);
    t.eq(fsm.calls.end, 1, '停止满 10s 结束跳舞');
  }

  // 设置关闭 → 中途结束
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 5.5; s += 0.5) d.tick(0.5);
    d.sync({ settings: { danceWithMusic: false } });
    t.eq(fsm.calls.end, 1, '关闭跳舞功能立即结束');
    for (let s = 0; s < 10; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 1, '关闭后不再开始');
  }

  // 设置开启 → 可触发
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.sync({ settings: { danceWithMusic: false } });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 8; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 0, '关闭状态不触发');
    d.sync({ settings: { danceWithMusic: true } });
    for (let s = 0; s < 5.5; s += 0.5) d.tick(0.5);
    t.ok(fsm.calls.begin.length >= 1, '重新开启后可触发');
  }

  // A22：唱完接跳舞
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: true, available: true });
    t.eq(d.singEnded(), true, '系统音乐在放 → 唱完转跳舞成功');
    t.eq(fsm.calls.begin[0].source, 'handover', '来源标记 handover');
  }
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm });
    d.onMediaStatus({ playing: false, available: true });
    t.eq(d.singEnded(), false, '系统音乐未放 → 不转跳舞');
    t.eq(fsm.calls.begin.length, 0, '未调用 beginDance');
  }

  // ---------- Lv.3 解锁门控（PRD §5.5 跳舞动作） ----------
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm, canDance: () => false });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 12; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 0, '未解锁时播放多久都不触发跳舞');
  }
  {
    let unlocked = false;
    const fsm = makeFsm();
    const d = new Dance({ fsm, canDance: () => unlocked });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 8; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 0, '锁定期间不触发');
    unlocked = true;
    for (let s = 0; s < 5.5; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 1, '解锁后重新计满 5s 触发');
  }
  {
    let unlocked = true;
    const fsm = makeFsm();
    const d = new Dance({ fsm, canDance: () => unlocked });
    d.onMediaStatus({ playing: true, available: true });
    for (let s = 0; s < 6; s += 0.5) d.tick(0.5);
    t.eq(fsm.calls.begin.length, 1, '已解锁正常开始跳舞');
    unlocked = false;
    d.tick(0.5);
    t.eq(fsm.calls.end, 1, '跳舞中途被锁定立即结束');
  }
  {
    const fsm = makeFsm();
    const d = new Dance({ fsm, canDance: () => false });
    d.onMediaStatus({ playing: true, available: true });
    t.eq(d.singEnded(), false, '未解锁时唱完不接跳舞（A22 门控）');
    t.eq(fsm.calls.begin.length, 0, '未调用 beginDance');
  }
}
