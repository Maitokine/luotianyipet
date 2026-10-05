// 音效播放（M5 / T5.5）：5 个 8-bit 短音效（src/assets/sfx/），懒加载缓存
// createAudio 可注入（Node 单测用假 Audio）；资源缺失/播放失败静默降级，不影响任何功能
export const SFX_NAMES = ['jump', 'land', 'happy', 'alert', 'pomo_end'];

export class Sfx {
  constructor({ createAudio = null, base = '../assets/sfx', volume = 0.5 } = {}) {
    this.createAudio = createAudio || ((url) => new Audio(url));
    this.base = base;
    this.volume = volume;
    this._cache = new Map();
  }

  play(name) {
    if (!SFX_NAMES.includes(name)) return false;
    let a = this._cache.get(name);
    if (!a) {
      try {
        a = this.createAudio(`${this.base}/${name}.wav`);
      } catch {
        return false; // 资源不可用：静默
      }
      if (!a) return false;
      if (typeof a.volume === 'number' || a.volume !== undefined) a.volume = this.volume;
      this._cache.set(name, a);
    }
    try {
      a.currentTime = 0; // 重播：同一实例从头开始
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}
