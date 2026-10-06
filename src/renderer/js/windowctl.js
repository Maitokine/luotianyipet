// 悬浮窗控制（M1 / K1 / T1.4）：动态鼠标穿透 + 滚轮缩放 + Ctrl滚轮透明度 + 置顶同步
import { pointOnCharacter } from './geo.js';
import { CANVAS_W, CANVAS_H } from './animation.js';

const SCALE_STEP = 0.05;
const OPACITY_STEP = 0.05;

export class WindowCtl {
  constructor({ api, rig, charEl, state, onPersist }) {
    this.api = api;
    this.rig = rig;
    this.charEl = charEl;
    this.onPersist = onPersist || (() => {});
    this.interactive = false;
    this.menuOpen = false;
    this.dragActive = false;
    this._hoverHit = false;
    this._persistTimer = null;

    this.scale = state.settings.scale;
    this.opacity = state.settings.opacity;
    this.clickThrough = Boolean(state.settings.clickThrough);
    this.gameMode = Boolean(state.settings.gameMode);

    this._applyScale();
    this._applyOpacity();
    this.api.setAlwaysOnTop(state.settings.alwaysOnTop);
    // 穿透模式必须显式通知主进程忽略鼠标；游戏模式则交给 _updateInteractive 强制可交互
    if (this.clickThrough && !this.gameMode) this.api.setIgnoreMouse(true);
    this._updateInteractive(this._desired());

    window.addEventListener('mousemove', (e) => this._onMouseMove(e), { passive: true });
    window.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  sync(state) {
    const s = state.settings;
    if (s.scale !== this.scale) { this.scale = s.scale; this._applyScale(); }
    if (s.opacity !== this.opacity) { this.opacity = s.opacity; this._applyOpacity(); }
    this.api.setAlwaysOnTop(s.alwaysOnTop);
    // 穿透开关（菜单/设置页切换）：开启=强制全窗穿透；关闭=恢复动态命中
    // 游戏模式：强制整窗可交互，覆盖穿透态，用于游戏/全屏场景下无法悬停命中时仍可操作小人
    const ct = Boolean(s.clickThrough);
    const gm = Boolean(s.gameMode);
    const changed = ct !== this.clickThrough || gm !== this.gameMode;
    this.clickThrough = ct;
    this.gameMode = gm;
    if (changed) this._updateInteractive(this._desired());
  }

  setMenuOpen(v) {
    this.menuOpen = Boolean(v);
    this._updateInteractive(this._desired());
  }

  // 拖拽期间强制可交互：鼠标快速移出角色轮廓（透明区）时不丢失拖拽
  setDragActive(v) {
    this.dragActive = Boolean(v);
    this._updateInteractive(this._desired());
  }

  _onMouseMove(e) {
    this._hoverHit = this._hitTest(e);
    // 菜单打开期间必须保持可交互：鼠标从角色移向菜单项（常经过透明区）时
    // _hoverHit 会变 false，若此刻关交互，窗口切回穿透 → 菜单点击全部漏到下层窗口
    this._updateInteractive(this._desired());
  }

  // 当前期望的可交互状态：拖拽 / 悬停命中 / 菜单打开 / 游戏模式 任一为真
  _desired() {
    return this.dragActive || this._hoverHit || this.menuOpen || this.gameMode;
  }

  _hitTest(e) {
    const rect = this.charEl.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_W;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_H;
    return pointOnCharacter(x, y, 1);
  }

  _updateInteractive(want) {
    // 游戏模式强制可交互，覆盖穿透态；否则穿透模式永远不可交互
    if (this.clickThrough && !this.gameMode) want = false;
    if (this.interactive === want) return;
    this.interactive = want;
    this.api.setIgnoreMouse(!want);
    document.body.style.cursor = want ? 'grab' : 'default';
  }

  _onWheel(e) {
    // 仅当悬停在角色上（可交互）时生效
    if (!this.interactive) return;
    e.preventDefault();
    const up = e.deltaY < 0;
    if (e.ctrlKey) {
      this.opacity = clamp(round2(this.opacity + (up ? OPACITY_STEP : -OPACITY_STEP)), 0.2, 1.0);
      this._applyOpacity();
    } else {
      this.scale = clamp(round2(this.scale + (up ? SCALE_STEP : -SCALE_STEP)), 0.5, 2.0);
      this._applyScale();
    }
    this._persist();
  }

  _applyScale() {
    this.rig.setZoom(this.scale);
  }

  _applyOpacity() {
    document.body.style.opacity = String(this.opacity);
  }

  _persist() {
    clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      this.onPersist({ settings: { scale: this.scale, opacity: this.opacity } });
    }, 400);
  }
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round2(v) { return Math.round(v * 100) / 100; }
