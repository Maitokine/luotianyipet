// 系统感知·主进程侧（M5 / T5.2）：CPU 滚动均值采样 + 高负载事件
// 电池感知在渲染层（navigator.getBattery，见 shared/sysjudge.js）
import os from 'node:os';
import { CpuJudge, sampleCpuPercent } from '../shared/sysjudge.js';

// 滚动均值窗口：4 个样本 × 5s 间隔 = 20 秒均值（抗瞬时毛刺）
export class CpuWatch {
  constructor({
    getCpuSnapshot = () => os.cpus(),
    windowSize = 4,
    intervalMs = 5000,
    onEvent = () => {},
    now = () => Date.now(),
    judge = null,
  } = {}) {
    this.getCpuSnapshot = getCpuSnapshot;
    this.windowSize = windowSize;
    this.dtSec = intervalMs / 1000;
    this.onEvent = onEvent;
    this.judge = judge || new CpuJudge({ now });
    this._prev = null;
    this._window = [];
  }

  tick() {
    const cur = this.getCpuSnapshot();
    if (!Array.isArray(cur) || cur.length === 0) {
      this._prev = null; // 快照异常：放弃本轮，下轮重建基准
      return null;
    }
    if (this._prev) {
      const pct = sampleCpuPercent(this._prev, cur);
      this._window.push(pct);
      if (this._window.length > this.windowSize) this._window.shift();
      const mean = this._window.reduce((a, b) => a + b, 0) / this._window.length;
      if (this.judge.sample(mean, this.dtSec)) {
        this.onEvent({ type: 'cpu-high', cpuPercent: Math.round(mean) });
      }
    }
    this._prev = cur;
    return true;
  }
}

// 薄胶水：定时驱动 CpuWatch（interval 仅此一处，判定逻辑全在可注入的 tick 内）
export function startCpuWatch({ intervalMs = 5000, ...rest } = {}) {
  const watch = new CpuWatch({ intervalMs, ...rest });
  const timer = setInterval(() => watch.tick(), intervalMs);
  return {
    watch,
    stop() { clearInterval(timer); },
  };
}
