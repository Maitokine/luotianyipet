// 序列帧动画层（M1 扩展）：在现有 SVG Rig 之上叠加逐帧动画。
// 与 Rig 同接口（play / setZoom / setFlip / setPalette），但只接管有序列帧资源动作的渲染。
// 设计原则：不破坏 Rig，无 sprite 资源时回退 SVG；有资源时隐藏 SVG 显示 canvas。

// 动作 → 序列帧资源配置。fps 是播放帧率，loop 是否循环。
export const SPRITE_ACTIONS = {
  walk: { fps: 8, loop: true, dir: '../assets/sprites/walk' },
};

export class SpriteLayer {
  constructor(container) {
    if (typeof document === 'undefined') throw new Error('SpriteLayer requires DOM');
    this.container = container;

    // 内部使用 360x400（CSS 显示 180x200），留 2x 像素余量，缩放 1.4 仍清晰
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'sprite-layer';
    this.canvas.width = 360;
    this.canvas.height = 400;
    this.canvas.style.cssText = `
      position: absolute; inset: 0; width: 100%; height: 100%;
      image-rendering: pixelated; image-rendering: crisp-edges;
      pointer-events: none; display: none;
    `;
    container.appendChild(this.canvas);

    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.current = null;
    this.elapsed = 0;
    this.frameIndex = 0;
    this.frames = [];
    this.cfg = null;
    this._cache = {}; // actionName -> Image[]
    this._last = null;
    this._raf = null;

    this._tick = (ts) => {
      if (this._last == null) this._last = ts;
      const dt = Math.min(0.05, (ts - this._last) / 1000);
      this._last = ts;
      if (this.current && this.frames.length && this.cfg) {
        this.elapsed += dt;
        const fps = this.cfg.fps || 8;
        const idx = this.cfg.loop
          ? Math.floor(this.elapsed * fps) % this.frames.length
          : Math.min(Math.floor(this.elapsed * fps), this.frames.length - 1);
        if (idx !== this.frameIndex) {
          this.frameIndex = idx;
          this._draw();
        }
      }
      this._raf = requestAnimationFrame(this._tick);
    };
    this._raf = requestAnimationFrame(this._tick);
  }

  // 探测目录下 frame_001.png ... frame_NNN.png
  async _loadAction(name) {
    if (this._cache[name]) return this._cache[name];
    const cfg = SPRITE_ACTIONS[name];
    if (!cfg) return [];

    const frames = [];
    for (let i = 1; ; i++) {
      const src = `${cfg.dir}/frame_${String(i).padStart(3, '0')}.png`;
      try {
        const img = await this._loadFrame(src);
        frames.push(img);
      } catch (e) {
        if (i === 1) {
          // 第一张就失败：记录路径，便于排查
          // eslint-disable-next-line no-console
          console.warn('[sprite] failed to load first frame for', name, src, e && e.message);
        }
        break;
      }
    }
    this._cache[name] = frames;
    return frames;
  }

  _loadFrame(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${src}`));
      img.src = src;
    });
  }

  async play(name) {
    this.current = name;
    this.elapsed = 0;
    this.frameIndex = 0;
    this.cfg = SPRITE_ACTIONS[name] || null;
    const svg = this.container.querySelector('svg');

    if (this.cfg) {
      // 有 sprite 资源：显示 canvas，隐藏 svg
      this.canvas.style.display = 'block';
      if (svg) svg.style.display = 'none';

      // 异步加载（首次）
      if (!this._cache[name]) {
        this.frames = await this._loadAction(name);
      } else {
        this.frames = this._cache[name];
      }
      this._draw();
    } else {
      // 无 sprite 资源：回退 SVG
      this.canvas.style.display = 'none';
      if (svg) svg.style.display = 'block';
      this.frames = [];
    }
  }

  // 保持与 Rig 同接口，但 sprite 不受缩放/调色板影响
  setZoom(v) { /* char 容器整体缩放已作用于 canvas */ }
  setFlip(v) { /* char 容器整体缩放已作用于 canvas */ }
  setPalette(vars) {
    const svg = this.container.querySelector('svg');
    if (svg) {
      for (const [k, val] of Object.entries(vars)) {
        svg.style.setProperty(k, val);
      }
    }
  }

  _draw() {
    if (!this.frames.length || this.frameIndex >= this.frames.length) return;
    const img = this.frames[this.frameIndex];
    const ctx = this.ctx;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    // contain：保持比例，居中，底部对齐（让脚底贴地）
    const scale = Math.min(cw / img.width, ch / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = (cw - dw) / 2;
    const dy = ch - dh;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }
}
