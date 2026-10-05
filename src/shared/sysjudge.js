// 系统感知纯判定器（M5 / T5.2，PRD §5.10）——主进程（CPU）与渲染层（电池）共用
// 无 Electron/DOM 依赖，全部可注入，Node 可测
//
// 规则（PRD §5.10）：
// - 电量 ≤20% 且未充电 → 提醒一次（插电后重置，可再次提醒）
// - CPU 持续 >85% 达 30 秒 → 吐槽一次（每 10 分钟最多一次，防刷屏）

// ---------- 电量 ----------
export class BatteryJudge {
  constructor({ threshold = 20 } = {}) {
    this.threshold = threshold;
    this._warned = false;
  }

  // percent: 0-100；charging: 是否充电中
  update({ percent, charging }) {
    if (charging) {
      this._warned = false; // 插电重置：下次再掉到阈值下会重新提醒
      return null;
    }
    if (!this._warned && Number(percent) <= this.threshold) {
      this._warned = true;
      return 'battery-low';
    }
    return null;
  }
}

// ---------- CPU ----------
export class CpuJudge {
  constructor({ threshold = 85, sustainSec = 30, cooldownMs = 600000, now = () => Date.now() } = {}) {
    this.threshold = threshold;
    this.sustainSec = sustainSec;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this._acc = 0;            // 持续超阈值累计秒
    this._cooldownUntil = 0;  // 冷却截止时间戳
  }

  // pct: 0-100 滚动均值；dtSec: 本采样间隔秒数
  sample(pct, dtSec) {
    if (Number(pct) > this.threshold) {
      this._acc += dtSec;
      if (this._acc >= this.sustainSec && this.now() >= this._cooldownUntil) {
        this._acc = 0;
        this._cooldownUntil = this.now() + this.cooldownMs;
        return 'cpu-high';
      }
    } else {
      this._acc = 0; // 回落即重新计持续时长
    }
    return null;
  }
}

// 两份 os.cpus() 快照 → 忙时占比 0-100（跨核聚合；无有效增量返回 0）
export function sampleCpuPercent(prev, cur) {
  if (!Array.isArray(prev) || !Array.isArray(cur) || prev.length === 0 || cur.length === 0) return 0;
  let busyD = 0;
  let totalD = 0;
  const n = Math.min(prev.length, cur.length);
  const f = (x) => (Number.isFinite(x) ? x : 0); // 缺失/异常字段按 0 处理
  for (let i = 0; i < n; i += 1) {
    const p = prev[i] && prev[i].times;
    const c = cur[i] && cur[i].times;
    if (!p || !c) continue;
    const pTotal = f(p.user) + f(p.nice) + f(p.sys) + f(p.idle) + f(p.irq);
    const cTotal = f(c.user) + f(c.nice) + f(c.sys) + f(c.idle) + f(c.irq);
    const dTotal = cTotal - pTotal;
    const dIdle = f(c.idle) - f(p.idle);
    if (dTotal > 0) {
      busyD += dTotal - dIdle;
      totalD += dTotal;
    }
  }
  if (totalD <= 0) return 0;
  return Math.max(0, Math.min(100, (busyD / totalD) * 100));
}

// ---------- 电池监听装配（渲染层：navigator.getBattery，可注入可测） ----------
// getBattery: () => Promise<BatteryManager>（真实环境 navigator.getBattery；缺失/拒绝则功能静默禁用）
// 注意：Chromium 的 window.setInterval 是 unforgeable 方法，摘出后绑定普通对象调用
// 会抛 "Illegal invocation"（Node 无此限制）——默认 timer 必须用裸调用包装，两端兼容。
const defaultTimer = () => ({
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
});

export function attachBatteryWatch({
  getBattery = null,
  judge = null,
  pollMs = 30000,
  onEvent = () => {},
  timer = null,
} = {}) {
  const j = judge || new BatteryJudge();
  const t = timer || defaultTimer();
  let mgr = null;
  let stopped = false;

  const check = () => {
    if (stopped || !mgr) return;
    const ev = j.update({ percent: mgr.level * 100, charging: Boolean(mgr.charging) });
    if (ev) onEvent({ type: ev, percent: Math.round(mgr.level * 100) });
  };

  const id = t.setInterval(check, pollMs);

  if (typeof getBattery === 'function') {
    Promise.resolve()
      .then(() => getBattery())
      .then((m) => {
        if (stopped || !m) return;
        mgr = m;
        if (typeof m.addEventListener === 'function') {
          m.addEventListener('levelchange', check);
          m.addEventListener('chargingchange', check);
        }
        check();
      })
      .catch(() => { /* 无电池或 API 不可用：功能静默禁用 */ });
  }

  return {
    stop() {
      stopped = true;
      t.clearInterval(id);
      if (mgr && typeof mgr.removeEventListener === 'function') {
        mgr.removeEventListener('levelchange', check);
        mgr.removeEventListener('chargingchange', check);
      }
    },
  };
}
