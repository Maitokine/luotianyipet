// windowctl 单测（真机修复回归）：动态穿透状态机 + 菜单打开期间保持可交互
// 背景（真机反馈 bug1"右键菜单点击无反应"）：鼠标从角色移向菜单项会经过透明区，
// _hoverHit 变 false 时若切回穿透，菜单点击全部漏到下层窗口 → _desired 必须并入 menuOpen。
import { WindowCtl } from '../src/renderer/js/windowctl.js';
import { CANVAS_W, CANVAS_H } from '../src/renderer/js/animation.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Node 打桩：WindowCtl 构造需要 window.addEventListener / document.body.style
function stubDom() {
  const listeners = {};
  globalThis.window = {
    addEventListener: (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); },
  };
  globalThis.document = { body: { style: {} } };
  return {
    dispatch: (ev, e) => { for (const fn of [...(listeners[ev] || [])]) fn(e); },
  };
}

function makeEnv({ clickThrough = false } = {}) {
  const dom = stubDom();
  const calls = { ignore: [], alwaysOnTop: [], persist: [] };
  const api = {
    setIgnoreMouse: (v) => calls.ignore.push(v),
    setAlwaysOnTop: (v) => calls.alwaysOnTop.push(v),
  };
  const ctl = new WindowCtl({
    api,
    rig: { setZoom() {} },
    charEl: { getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) },
    state: { settings: { scale: 1, opacity: 1, alwaysOnTop: true, clickThrough } },
    onPersist: (p) => calls.persist.push(p),
  });
  return { ctl, calls, dom };
}

// 画布坐标（1:1 映射）：命中点在头部椭圆内；未命中点在左上角空白
const HIT = { clientX: 90, clientY: 100 };
const MISS = { clientX: 5, clientY: 5 };

export async function run(t) {
  // ---- 基础：悬停命中开交互，离开关交互 ----
  {
    const { ctl, calls, dom } = makeEnv();
    t.eq(calls.ignore.length, 0, '初始（未触发）不调用穿透接口');
    dom.dispatch('mousemove', HIT);
    t.eq(calls.ignore[calls.ignore.length - 1], false, '悬停命中 → 可交互（不穿透）');
    dom.dispatch('mousemove', MISS);
    t.eq(calls.ignore[calls.ignore.length - 1], true, '离开角色 → 恢复穿透');
  }

  // ---- 真机 bug1 回归：菜单打开期间 mousemove 经过透明区不切回穿透 ----
  {
    const { ctl, calls, dom } = makeEnv();
    ctl.setMenuOpen(true);
    t.eq(ctl.menuOpen, true, '菜单标记打开');
    dom.dispatch('mousemove', MISS); // 鼠标从角色移向菜单项（透明区）
    t.eq(ctl.interactive, true, '菜单期间透明区保持可交互（点击可达菜单）');
    t.ok(!calls.ignore.includes(true), '菜单期间从未切回穿透');
    ctl.setMenuOpen(false);
    dom.dispatch('mousemove', MISS);
    t.eq(calls.ignore[calls.ignore.length - 1], true, '菜单关闭后离开角色 → 恢复穿透');
    t.eq(ctl.interactive, false, '恢复动态穿透态');
  }

  // ---- 菜单期间先命中再离开：仍保持交互 ----
  {
    const { ctl, dom } = makeEnv();
    ctl.setMenuOpen(true);
    dom.dispatch('mousemove', HIT);
    dom.dispatch('mousemove', MISS);
    t.eq(ctl.interactive, true, '命中→离开后菜单仍保持交互');
  }

  // ---- 拖拽期间经过透明区保持可交互（原有行为回归） ----
  {
    const { ctl, dom } = makeEnv();
    ctl.setDragActive(true);
    dom.dispatch('mousemove', MISS);
    t.eq(ctl.interactive, true, '拖拽经过透明区不丢交互');
    ctl.setDragActive(false);
    dom.dispatch('mousemove', MISS);
    t.eq(ctl.interactive, false, '拖拽结束离开角色 → 恢复穿透');
  }

  // ---- 拖拽 + 菜单同时为真 → 关一个仍保持（_desired 为或逻辑） ----
  {
    const { ctl, dom } = makeEnv();
    ctl.setDragActive(true);
    ctl.setMenuOpen(true);
    ctl.setDragActive(false); // 拖拽先结束
    dom.dispatch('mousemove', MISS);
    t.eq(ctl.interactive, true, '菜单仍打开 → 保持可交互');
    ctl.setMenuOpen(false);
    dom.dispatch('mousemove', MISS);
    t.eq(ctl.interactive, false, '全部释放后恢复穿透');
  }

  // ---- 穿透模式优先：即使菜单打开也全窗穿透 ----
  {
    const { ctl, calls } = makeEnv({ clickThrough: true });
    t.eq(calls.ignore[0], true, '穿透模式构造即全窗穿透');
    ctl.setMenuOpen(true);
    t.eq(ctl.interactive, false, '穿透模式下菜单打开也不可交互（pet.js 会直接关菜单兜底）');
  }

  // ---- 游戏模式：强制整窗可交互，覆盖穿透态 ----
  {
    const { ctl, calls, dom } = makeEnv({ clickThrough: true });
    t.eq(ctl.interactive, false, '穿透模式初始不可交互');
    ctl.sync({ settings: { scale: 1, opacity: 1, alwaysOnTop: true, clickThrough: true, gameMode: true } });
    t.eq(ctl.interactive, true, '开启游戏模式后强制可交互');
    t.ok(calls.ignore.includes(false), '已向主进程取消鼠标穿透');
    ctl.sync({ settings: { scale: 1, opacity: 1, alwaysOnTop: true, clickThrough: true, gameMode: false } });
    t.eq(ctl.interactive, false, '关闭游戏模式后恢复穿透态');
  }
  {
    // 游戏模式下即使鼠标移出角色/无菜单仍保持可交互
    const { ctl, dom } = makeEnv({ clickThrough: false });
    ctl.sync({ settings: { scale: 1, opacity: 1, alwaysOnTop: true, clickThrough: false, gameMode: true } });
    dom.dispatch('mousemove', MISS);
    t.eq(ctl.interactive, true, '游戏模式下透明区仍保持可交互');
  }

  // ---- sync 关闭穿透恢复动态命中 ----
  {
    const { ctl, calls, dom } = makeEnv({ clickThrough: true });
    dom.dispatch('mousemove', HIT);
    t.eq(ctl.interactive, false, '穿透中命中也不开交互');
    ctl.sync({ settings: { scale: 1, opacity: 1, alwaysOnTop: true, clickThrough: false } });
    dom.dispatch('mousemove', HIT);
    t.eq(ctl.interactive, true, '关闭穿透后命中开交互');
    t.ok(calls.ignore.includes(false), '已发出取消穿透');
  }

  // ---- 滚轮缩放仅交互时生效（顺带回归 K1） ----
  {
    const { ctl, calls, dom } = makeEnv();
    dom.dispatch('wheel', { deltaY: -100, ctrlKey: false, preventDefault() {} });
    t.eq(calls.persist.length, 0, '非交互时滚轮不生效');
    dom.dispatch('mousemove', HIT);
    dom.dispatch('wheel', { deltaY: -100, ctrlKey: false, preventDefault() {} });
    await sleep(460); // 400ms 落档去抖
    t.eq(calls.persist.length, 1, '交互时滚轮缩放落档');
    t.close(calls.persist[0].settings.scale, 1.05, 1e-9, '向上滚放大 5%');
  }

  // 清理全局桩，避免影响同进程后续测试模块
  delete globalThis.window;
  delete globalThis.document;
}
