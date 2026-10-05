// 轻量事件总线：模块解耦（状态变更 / 动作 / 成长事件）
export class AppBus {
  constructor() {
    this._handlers = new Map();
  }
  on(event, fn) {
    if (!this._handlers.has(event)) this._handlers.set(event, new Set());
    this._handlers.get(event).add(fn);
    return () => this._handlers.get(event)?.delete(fn);
  }
  emit(event, ...args) {
    const set = this._handlers.get(event);
    if (set) for (const fn of [...set]) {
      try { fn(...args); } catch (e) { console.error(`[bus] ${event} handler error:`, e); }
    }
  }
}
