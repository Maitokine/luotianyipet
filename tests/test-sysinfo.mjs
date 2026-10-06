// 系统感知单测（T5.2）：电量判定 / CPU 判定 / CPU 采样 / 滚动均值 / 电池监听装配
import {
  BatteryJudge, CpuJudge, sampleCpuPercent, attachBatteryWatch,
} from '../src/shared/sysjudge.js';
import { CpuWatch } from '../src/main/sysinfo.js';

function cpuTimes({ user = 0, nice = 0, sys = 0, idle = 0, irq = 0 } = {}) {
  return [{ times: { user, nice, sys, idle, irq } }];
}

export async function run(t) {
  // ---------- sampleCpuPercent ----------
  {
    // delta: total +100（user+60, sys+20, idle+20）→ busy 80%
    const prev = cpuTimes({ user: 100, sys: 50, idle: 850 });
    const cur = cpuTimes({ user: 160, sys: 70, idle: 870 });
    t.close(sampleCpuPercent(prev, cur), 80, 0.001, '忙时占比 80%');
    t.eq(sampleCpuPercent(prev, prev), 0, '无增量返回 0');
    t.eq(sampleCpuPercent(null, cur), 0, 'prev 为 null 返回 0');
    t.eq(sampleCpuPercent(prev, []), 0, 'cur 为空数组返回 0');
    t.eq(sampleCpuPercent([], cur), 0, 'prev 为空数组返回 0');
  }
  {
    // 多核聚合：两核各 50% 忙 → 50%
    const mk = (u, i) => [{ times: { user: u, idle: i } }, { times: { user: u, idle: i } }];
    t.close(sampleCpuPercent(mk(0, 1000), mk(50, 1050)), 50, 0.001, '多核聚合均值 50%');
  }
  {
    // 钳制：构造异常负增量不产生负值
    const prev = [{ times: { user: 100, idle: 0 } }];
    const cur = [{ times: { user: 0, idle: 500 } }];
    t.eq(sampleCpuPercent(prev, cur), 0, '异常增量钳制为 0');
  }

  // ---------- BatteryJudge（≤20% 未充电提醒一次，插电重置） ----------
  {
    const j = new BatteryJudge();
    t.eq(j.update({ percent: 20, charging: false }), 'battery-low', '恰 20% 未充电触发（含边界）');
    t.eq(j.update({ percent: 19, charging: false }), null, '已提醒不重复');
    t.eq(j.update({ percent: 21, charging: false }), null, '21% 不触发');
    t.eq(j.update({ percent: 10, charging: true }), null, '充电中不触发');
    t.eq(j.update({ percent: 15, charging: false }), 'battery-low', '插电后重置，再掉线重新提醒');
  }
  {
    const j = new BatteryJudge();
    t.eq(j.update({ percent: 100, charging: false }), null, '满电不触发');
    t.eq(j.update({ percent: 15, charging: true }), null, '低电但充电中不触发');
  }
  {
    const j = new BatteryJudge({ threshold: 30 });
    t.eq(j.update({ percent: 25, charging: false }), 'battery-low', '自定义阈值 30 生效');
  }

  // ---------- CpuJudge（>85% 持续 30s，10 分钟冷却） ----------
  {
    // 持续 30s 触发：每样本 5s
    const j = new CpuJudge();
    let ev = null;
    for (let i = 0; i < 5; i += 1) ev = j.sample(90, 5);
    t.eq(ev, null, '持续 25s 未到阈值不触发');
    ev = j.sample(90, 5);
    t.eq(ev, 'cpu-high', '持续 30s 触发吐槽');
  }
  {
    // 边界：85% 不算超标（需 >85）
    const j = new CpuJudge();
    let ev = null;
    for (let i = 0; i < 10; i += 1) ev = j.sample(85, 5);
    t.eq(ev, null, '恰 85% 不触发（严格大于）');
    ev = j.sample(85.01, 30);
    t.eq(ev, 'cpu-high', '85.01% 视为超标');
  }
  {
    // 回落重置持续时长
    const j = new CpuJudge();
    let ev = null;
    for (let i = 0; i < 4; i += 1) ev = j.sample(90, 5); // 20s
    ev = j.sample(50, 5); // 回落 → 清零
    for (let i = 0; i < 5; i += 1) ev = j.sample(90, 5); // 再 25s
    t.eq(ev, null, '中途回落后需重新计满 30s');
    ev = j.sample(90, 5);
    t.eq(ev, 'cpu-high', '重新计满 30s 触发');
  }
  {
    // 10 分钟冷却：持续高负载下最多每 10 分钟一次
    let clock = 0;
    const j = new CpuJudge({ now: () => clock });
    let ev = null;
    for (let i = 0; i < 6; i += 1) { clock += 5000; ev = j.sample(90, 5); }
    t.eq(ev, 'cpu-high', '首轮 30s 触发');
    ev = null;
    for (let i = 0; i < 6; i += 1) { clock += 5000; ev = j.sample(90, 5); } // 又 30s，仍在冷却
    t.eq(ev, null, '冷却期内不重复触发');
    clock += 600000; // 越过冷却期（负载一直很高）
    ev = j.sample(90, 5);
    t.eq(ev, 'cpu-high', '冷却结束且仍高负载 → 再次触发');
    // 负载已回落 → 冷却结束也不触发
    ev = j.sample(20, 5);
    t.eq(ev, null, '低负载无事件');
    clock += 600000;
    ev = j.sample(90, 5);
    t.eq(ev, null, '冷却结束但持续时长不足（刚清零）不触发');
  }
  {
    const j = new CpuJudge({ threshold: 50, sustainSec: 10, cooldownMs: 0 });
    let ev = null;
    for (let i = 0; i < 2; i += 1) ev = j.sample(60, 5);
    t.eq(ev, 'cpu-high', '自定义阈值/持续时长生效');
    ev = j.sample(60, 5);
    t.eq(ev, null, '触发后重新累计（5s < 10s）');
    ev = j.sample(60, 5);
    t.eq(ev, 'cpu-high', '零冷却时再次满持续即触发');
  }

  // ---------- CpuWatch（滚动均值 + 采样链路） ----------
  {
    // 快照序列构造恒定 90% 忙时：每 tick user +450, idle +50（totalΔ500, busyΔ450）
    const snaps = [];
    let user = 0;
    let idle = 10000;
    for (let i = 0; i < 20; i += 1) {
      snaps.push([{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }]);
      user += 450;
      idle += 50;
    }
    let clock = 0;
    const events = [];
    const w = new CpuWatch({
      getCpuSnapshot: () => snaps.shift(),
      intervalMs: 5000,
      now: () => clock,
      onEvent: (e) => events.push(e),
    });
    for (let i = 0; i < 7; i += 1) { clock += 5000; w.tick(); }
    t.eq(events.length, 1, '持续高负载 7 个采样后触发一次');
    t.eq(events[0].type, 'cpu-high', '事件类型 cpu-high');
    t.eq(events[0].cpuPercent, 90, '上报均值 90%');
  }
  {
    // 低负载永不触发
    let user = 0;
    let idle = 10000;
    const w = new CpuWatch({
      getCpuSnapshot: () => {
        const s = [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
        user += 25; // 5% 忙
        idle += 475;
        return s;
      },
      intervalMs: 5000,
      onEvent: () => t.ok(false, '低负载不应触发'),
    });
    for (let i = 0; i < 40; i += 1) w.tick();
    t.ok(true, '低负载 40 个采样无事件');
  }
  {
    // 滚动均值抗毛刺：90,90,90,10 循环 → 窗口均值 ~70 永不超阈
    const seq = [90, 90, 90, 10, 90, 90, 90, 10, 90, 90, 90, 10];
    const snaps = [];
    let user = 0;
    let idle = 10000;
    for (const pct of seq) {
      snaps.push([{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }]);
      user += pct * 5;
      idle += (100 - pct) * 5;
    }
    let fired = 0;
    const w = new CpuWatch({
      getCpuSnapshot: () => snaps.shift(),
      intervalMs: 5000,
      onEvent: () => { fired += 1; },
    });
    for (let i = 0; i < 12; i += 1) w.tick();
    t.eq(fired, 0, '周期性毛刺被滚动均值平滑，不触发');
  }
  {
    // 快照异常不崩溃，恢复正常后重建基准
    let broken = true;
    let user = 0;
    let idle = 10000;
    let fired = 0;
    const w = new CpuWatch({
      getCpuSnapshot: () => {
        if (broken) return null;
        const s = [{ times: { user, nice: 0, sys: 0, idle, irq: 0 } }];
        user += 450;
        idle += 50;
        return s;
      },
      intervalMs: 5000,
      onEvent: () => { fired += 1; },
    });
    w.tick(); // null
    broken = false;
    for (let i = 0; i < 30; i += 1) w.tick();
    t.ok(fired >= 1, '快照恢复后正常触发');
  }

  // ---------- attachBatteryWatch ----------
  function makeFakeTimer() {
    const fns = [];
    return {
      setInterval: (fn) => { fns.push(fn); return fns.length - 1; },
      clearInterval: () => {},
      fire: () => { for (const fn of [...fns]) fn(); },
    };
  }
  function makeBattery(level, charging) {
    const listeners = {};
    return {
      level,
      charging,
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) {
        const arr = listeners[ev] || [];
        const i = arr.indexOf(fn);
        if (i >= 0) arr.splice(i, 1);
      },
      emit(ev) { for (const fn of listeners[ev] || []) fn(); },
      listeners,
    };
  }
  // 微任务 flush：attachBatteryWatch 内部是 Promise 链
  const flush = () => new Promise((r) => setTimeout(r, 0));

  // 初始即低电未充电：挂载即提醒
  {
    const timer = makeFakeTimer();
    const events = [];
    const b = makeBattery(0.15, false);
    attachBatteryWatch({
      getBattery: () => Promise.resolve(b),
      timer,
      onEvent: (e) => events.push(e),
    });
    await flush();
    t.eq(events.length, 1, '挂载时低电未充电立即提醒');
    t.eq(events[0].type, 'battery-low', '事件类型 battery-low');
    t.eq(events[0].percent, 15, '上报电量 15%');
    timer.fire();
    t.eq(events.length, 1, '已提醒不重复');
  }

  // 掉到阈值触发；插电重置；再掉电重新提醒
  {
    const timer = makeFakeTimer();
    const events = [];
    const b = makeBattery(0.8, false);
    attachBatteryWatch({
      getBattery: () => Promise.resolve(b),
      timer,
      onEvent: (e) => events.push(e),
    });
    await flush();
    t.eq(events.length, 0, '80% 不提醒');
    b.level = 0.18;
    b.emit('levelchange');
    t.eq(events.length, 1, '掉到 18% 触发提醒');
    b.charging = true;
    b.emit('chargingchange');
    t.eq(events.length, 1, '插电不触发');
    b.charging = false;
    b.emit('chargingchange');
    t.eq(events.length, 2, '拔电后仍在低电 → 重新提醒');
  }

  // getBattery 缺失 / 拒绝：静默禁用不崩溃
  {
    const timer = makeFakeTimer();
    const events = [];
    attachBatteryWatch({ timer, onEvent: (e) => events.push(e) });
    attachBatteryWatch({
      getBattery: () => Promise.reject(new Error('no battery')),
      timer,
      onEvent: (e) => events.push(e),
    });
    await flush();
    timer.fire();
    t.eq(events.length, 0, 'Battery API 不可用时静默禁用');
  }

  // stop 后不再响应
  {
    const timer = makeFakeTimer();
    const events = [];
    const b = makeBattery(0.15, false);
    const w = attachBatteryWatch({
      getBattery: () => Promise.resolve(b),
      timer,
      onEvent: (e) => events.push(e),
    });
    await flush();
    t.eq(events.length, 1, '停止前正常提醒');
    w.stop();
    b.level = 0.1;
    b.emit('levelchange');
    timer.fire();
    t.eq(events.length, 1, 'stop 后事件与轮询均已解除');
  }

  // 默认 timer（不注入）可用（真机修复回归）
  // 背景：Chromium 的 window.setInterval 是 unforgeable 方法，摘出绑定普通对象调用会抛
  // "Illegal invocation"（Node 无此限制）——单测全绿但真机 main() 启动即崩溃。
  // defaultTimer() 必须用裸调用包装；此用例锁定"默认 timer 路径"整体可用。
  {
    const events = [];
    const b = makeBattery(0.15, false);
    const w = attachBatteryWatch({
      getBattery: () => Promise.resolve(b),
      pollMs: 30000,
      onEvent: (e) => events.push(e),
    }); // 不注入 timer → 走 defaultTimer()（真实 interval，立即 stop 无副作用）
    await flush();
    t.eq(events.length, 1, '默认 timer：挂载即提醒（无 Illegal invocation）');
    t.eq(typeof w.stop, 'function', '默认 timer 下返回可停止的 watcher');
    w.stop();
    b.level = 0.1;
    b.emit('levelchange');
    t.eq(events.length, 1, '默认 timer：stop 后事件监听已解除');
  }
}
