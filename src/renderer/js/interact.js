// 手势系统（M2 / K3）：单击 / 双击 / 拖拽 / 甩出（阈值分类器，纯逻辑可测试）
export const CLICK_MAX_MOVE = 6;      // px：超过即拖拽
export const CLICK_MAX_MS = 500;      // ms：按下到抬起超过则不算点击
export const DBLCLICK_WINDOW = 400;   // ms：第二击窗口（Windows 真机双击间隔常 300-450ms；260 会把真双击拆成两次单击）
export const THROW_SPEED = 0.35;      // px/ms：超过即甩出
export const VELOCITY_WINDOW = 90;    // ms：速度采样窗口

// 纯分类器（可测试）：输入按下/移动/抬起序列，输出手势
export class GestureTracker {
  constructor({ now = () => Date.now(), onClick, onDblclick, onDragStart, onDragMove, onDragEnd, onThrow } = {}) {
    this.now = now;
    this.h = { onClick, onDblclick, onDragStart, onDragMove, onDragEnd, onThrow };
    this.reset();
  }

  reset() {
    this.down = null;          // { x, y, t }
    this.samples = [];         // [{ t, x, y }]
    this.dragging = false;
    this.lastClickAt = -Infinity;
    this._clickTimer = null;
  }

  // ---- 事件输入 ----
  pointerDown(x, y) {
    this.down = { x, y, t: this.now() };
    this.samples = [{ t: this.down.t, x, y }];
    this.dragging = false;
  }

  pointerMove(x, y) {
    if (!this.down) return;
    const t = this.now();
    this.samples.push({ t, x, y });
    // 只保留速度采样窗口
    while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_WINDOW + 30) {
      this.samples.shift();
    }
    if (!this.dragging && this._movedBeyondThreshold(x, y)) {
      this.dragging = true;
      this._cancelPendingClick();
      this.h.onDragStart?.(this.down.x, this.down.y);
    }
    if (this.dragging) {
      this.h.onDragMove?.(x, y, x - this.down.x, y - this.down.y);
    }
  }

  pointerUp(x, y) {
    if (!this.down) return;
    const t = this.now();
    const heldMs = t - this.down.t;
    if (this.dragging) {
      const v = this.velocity();
      this.down = null;
      this.dragging = false;
      if (Math.hypot(v.x, v.y) > THROW_SPEED) {
        this.h.onThrow?.(v.x, v.y);
      } else {
        this.h.onDragEnd?.(x, y);
      }
      return;
    }
    // 点击候选：位移小 + 时间短
    const moved = Math.hypot(x - this.down.x, y - this.down.y);
    this.down = null;
    if (moved <= CLICK_MAX_MOVE && heldMs <= CLICK_MAX_MS) {
      const sinceLast = t - this.lastClickAt;
      if (sinceLast <= DBLCLICK_WINDOW) {
        this._cancelPendingClick();
        this.lastClickAt = -Infinity;
        this.h.onDblclick?.(x, y);
      } else {
        this.lastClickAt = t;
        this._scheduleClick(x, y);
      }
    }
  }

  // 最近窗口内速度（px/ms）
  velocity() {
    if (this.samples.length < 2) return { x: 0, y: 0 };
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return { x: 0, y: 0 };
    return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
  }

  _movedBeyondThreshold(x, y) {
    return Math.hypot(x - this.down.x, y - this.down.y) > CLICK_MAX_MOVE;
  }

  _scheduleClick(x, y) {
    // 400ms 内无第二击 → 单击（双击优先）
    if (this._clickTimer) clearTimeout(this._clickTimer);
    const t0 = this.now();
    this._clickTimer = setTimeout(() => {
      this._clickTimer = null;
      if (this.now() - t0 >= DBLCLICK_WINDOW) this.h.onClick?.(x, y);
    }, DBLCLICK_WINDOW + 5);
  }

  _cancelPendingClick() {
    if (this._clickTimer) {
      clearTimeout(this._clickTimer);
      this._clickTimer = null;
    }
  }
}

// 渲染层接线：窗口指针事件 → 手势 → fsm
export class Interact {
  constructor({ tracker, fsm, windowctl }) {
    this.tracker = tracker;
    this.fsm = fsm;
    this.windowctl = windowctl;
    this._originWin = null;
  }

  static create({ fsm, windowctl, onDblclick, onDragStateChange }) {
    const self = new Interact({ fsm, windowctl });
    const tracker = new GestureTracker({
      onClick: () => fsm.trigger('click'),
      onDblclick: onDblclick || (() => fsm.trigger('dblclick')),
      onDragStart: () => {
        // 以 fsm 当前位置为基准（窗口可能已被闲逛移动）
        self._originWin = { x: fsm.winX, y: fsm.winY };
        fsm.trigger('drag-start');
        onDragStateChange?.(true);
      },
      onDragMove: (x, y, dx, dy) => {
        // 以按下时窗口位置为基准移动窗口
        const nx = self._originWin.x + dx;
        const ny = self._originWin.y + dy;
        fsm.trigger('drag-move', { x: nx, y: ny });
      },
      onDragEnd: () => {
        onDragStateChange?.(false);
        fsm.trigger('drag-end');
      },
      onThrow: (vxMs, vyMs) => {
        onDragStateChange?.(false);
        fsm.trigger('throw', { vx: vxMs * 1000, vy: vyMs * 1000 }); // px/ms → px/s
      },
    });
    self.tracker = tracker;

    window.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      // 菜单内点击交给菜单自身处理（HtmlMenu doc 级监听负责选中/关闭）：
      // 不进入手势跟踪，否则点菜单项会误触发角色单击（跳跃）甚至拖拽
      if (e.target && e.target.closest && e.target.closest('#menu')) return;
      tracker.pointerDown(e.screenX, e.screenY);
    });
    window.addEventListener('mousemove', (e) => {
      tracker.pointerMove(e.screenX, e.screenY);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      tracker.pointerUp(e.screenX, e.screenY);
    });
    return self;
  }

  start() { /* 事件监听已在 create 中注册 */ }
}
