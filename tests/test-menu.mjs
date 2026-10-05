// HtmlMenu 单测（T5.3，A6）：渲染结构、点击分发、手风琴二级菜单、外部点击/Esc 关闭、位置钳制
// 用最小假 DOM（classList/textContent/appendChild/addEventListener/click）
import { HtmlMenu } from '../src/renderer/js/menu.js';
import { buildMenuModel } from '../src/shared/menumodel.js';
import { defaultProfile } from '../src/shared/profile.js';

function fakeEl(tag) {
  const el = {
    tagName: tag,
    children: [],
    parentNode: null,
    style: {},
    _listeners: {},
    textContent: '',
    offsetWidth: 0,
    offsetHeight: 0,
    classList: {
      _set: new Set(),
      add(...cs) { for (const c of cs) this._set.add(c); },
      remove(...cs) { for (const c of cs) this._set.delete(c); },
      toggle(c) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    removeEventListener() {},
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    removeChild(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    get firstChild() { return this.children[0] || null; },
    fire(ev, event = {}) { for (const fn of this._listeners[ev] || []) fn({ target: this, ...event }); },
  };
  return el;
}

function fakeDoc() {
  const els = { menu: fakeEl('div') };
  const listeners = {};
  return {
    els,
    _listeners: listeners,
    createElement: (tag) => fakeEl(tag),
    getElementById: (id) => els[id] || null,
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire(ev, event) { for (const fn of listeners[ev] || []) fn(event); },
  };
}

// 深度遍历找 class 含 cls 的元素
function findAll(node, cls, out = []) {
  if (node.classList && node.classList.contains(cls)) out.push(node);
  for (const c of node.children || []) findAll(c, cls, out);
  return out;
}

// 按标签文本找菜单行（menu-item 的第二个子元素是文本 span；前缀匹配以兼容「跳舞（Lv.3 解锁）」带提示文本）
function findRow(menuEl, text) {
  return findAll(menuEl, 'menu-item').find((row) => row.children[1] && row.children[1].textContent.startsWith(text));
}

function makeMenu({ onAction, win } = {}) {
  const doc = fakeDoc();
  const actions = [];
  const events = { open: 0, close: 0 };
  const m = new HtmlMenu({
    doc,
    win: win || { innerWidth: 300, innerHeight: 420 },
    onAction: onAction || ((a, p) => actions.push({ a, p })),
    onOpen: () => { events.open += 1; },
    onClose: () => { events.close += 1; },
  });
  return { m, doc, actions, events };
}

function openDefault(m) {
  m.open(buildMenuModel({ state: defaultProfile() }), 10, 10);
}

export function run(t) {
  // ---------- 渲染结构 ----------
  {
    const { m, doc } = makeMenu();
    t.eq(m.isOpen, false, '初始关闭');
    openDefault(m);
    t.eq(m.isOpen, true, 'open 后进入打开态');
    t.ok(!doc.els.menu.classList.contains('hidden'), '打开时移除 hidden');
    t.eq(findAll(doc.els.menu, 'menu-group').length, 4, '渲染四个分组');
    t.eq(findAll(doc.els.menu, 'menu-node').filter((n) => n.parentNode.classList.contains('menu-group')).length, 12, '顶层 12 个节点');
    // 顶层 menu-node = 4 个 submenu 节点 + 8 个普通节点；二级行：尺寸3 + 动作4 + 换装3 + 提醒4
    t.eq(findAll(doc.els.menu, 'menu-item').length, 12 + 3 + 4 + 3 + 4, '含二级菜单总行数齐全（12+14）');
    t.eq(findAll(doc.els.menu, 'menu-sub').length, 4, '四个二级容器');
  }

  // ---------- 叶项点击：分发动作并关闭 ----------
  {
    const { m, doc, actions, events } = makeMenu();
    openDefault(m);
    const row = findRow(doc.els.menu, '唱首歌');
    t.ok(row, '找到「唱首歌」行');
    row.fire('click');
    t.eq(actions.length, 1, '点击分发一次');
    t.eq(actions[0].a, 'music.toggle', '分发 music.toggle');
    t.eq(actions[0].p, undefined, '无载荷');
    t.eq(m.isOpen, false, '点击后关闭');
    t.ok(doc.els.menu.classList.contains('hidden'), '关闭时加回 hidden');
    t.eq(events.close, 1, 'onClose 回调一次');
    t.eq(events.open, 1, 'onOpen 回调一次');
  }

  // ---------- 勾选项点击：生成取反载荷 ----------
  {
    const { m, doc, actions } = makeMenu();
    openDefault(m);
    findRow(doc.els.menu, '置顶显示').fire('click'); // 默认 checked:true
    t.eq(actions[0], { a: 'win.always-on-top', p: { enabled: false } }, '勾选项生成取反载荷');
    // 重新打开（模拟状态未变）再点穿透（默认未勾选）
    openDefault(m);
    findRow(doc.els.menu, '鼠标穿透').fire('click');
    t.eq(actions[1], { a: 'win.click-through', p: { enabled: true } }, '未勾选项生成开启载荷');
  }

  // ---------- 禁用项：不分发、不关闭 ----------
  {
    const { m, doc, actions } = makeMenu();
    openDefault(m);
    // 展开二级再点禁用的「跳舞」
    findRow(doc.els.menu, '让她做动作').fire('click');
    const dance = findRow(doc.els.menu, '跳舞');
    t.ok(dance, '找到「跳舞」行');
    t.ok(dance.classList.contains('disabled'), '跳舞行带禁用样式');
    dance.fire('click');
    t.eq(actions.length, 0, '禁用项不分发');
    t.eq(m.isOpen, true, '禁用项点击不关闭菜单');
    t.ok(dance.children[1].textContent.includes('Lv.3 解锁'), '禁用行展示解锁提示');
  }

  // ---------- 手风琴二级菜单 ----------
  {
    const { m, doc } = makeMenu();
    openDefault(m);
    const sizeNode = findRow(doc.els.menu, '尺寸').parentNode;
    const outfitNode = findRow(doc.els.menu, '换装').parentNode;
    findRow(doc.els.menu, '尺寸').fire('click');
    t.ok(sizeNode.classList.contains('open'), '点击展开尺寸二级');
    findRow(doc.els.menu, '换装').fire('click');
    t.ok(!sizeNode.classList.contains('open'), '展开换装时尺寸收起（手风琴）');
    t.ok(outfitNode.classList.contains('open'), '换装展开');
    findRow(doc.els.menu, '换装').fire('click');
    t.ok(!outfitNode.classList.contains('open'), '再点换装收起');
  }

  // ---------- 二级叶项点击 ----------
  {
    const { m, doc, actions } = makeMenu();
    openDefault(m);
    findRow(doc.els.menu, '尺寸').fire('click');
    findRow(doc.els.menu, '大').fire('click');
    t.eq(actions[0], { a: 'pet.size', p: { scale: 1.4 } }, '尺寸「大」分发 scale 1.4');
    t.eq(m.isOpen, false, '点击后关闭');

    openDefault(m);
    findRow(doc.els.menu, '让她做动作').fire('click');
    findRow(doc.els.menu, '坐下').fire('click');
    t.eq(actions[1], { a: 'pet.action', p: { name: 'sit' } }, '动作项分发 name');

    openDefault(m);
    findRow(doc.els.menu, '提醒工具').fire('click');
    findRow(doc.els.menu, '久坐提醒').fire('click');
    t.eq(actions[2], { a: 'tools.sitting', p: { enabled: false } }, '久坐开关取反载荷');
    t.eq(actions[2].a, 'tools.sitting', '久坐动作 id');
  }

  // ---------- 外部点击 / Esc 关闭 ----------
  {
    const { m, doc } = makeMenu();
    openDefault(m);
    const outside = doc.createElement('div');
    doc.fire('mousedown', { target: outside });
    t.eq(m.isOpen, false, '点击菜单外关闭');

    openDefault(m);
    const inside = findAll(doc.els.menu, 'menu-item')[0];
    doc.fire('mousedown', { target: inside });
    t.eq(m.isOpen, true, '点击菜单内不关闭');

    doc.fire('keydown', { key: 'Escape' });
    t.eq(m.isOpen, false, 'Esc 关闭');

    openDefault(m);
    doc.fire('keydown', { key: 'Enter' });
    t.eq(m.isOpen, true, '其他按键不关闭');
  }

  // ---------- 位置钳制 ----------
  {
    const { m, doc } = makeMenu({ win: { innerWidth: 300, innerHeight: 420 } });
    doc.els.menu.offsetWidth = 180; // 假 DOM 提供测量值
    doc.els.menu.offsetHeight = 320;
    openDefault(m);
    m.open(buildMenuModel({ state: defaultProfile() }), 250, 400);
    t.eq(doc.els.menu.style.left, '116px', 'x 钳制在窗口内（300-180-4）');
    t.eq(doc.els.menu.style.top, '96px', 'y 钳制在窗口内（420-320-4）');
    m.open(buildMenuModel({ state: defaultProfile() }), 5, 5);
    t.eq(doc.els.menu.style.left, '5px', '原点附近不越界到负值');
  }

  // ---------- 无 menu 元素时安全降级 ----------
  {
    const doc = fakeDoc();
    doc.els.menu = null; // 移除挂载点
    const m = new HtmlMenu({ doc });
    m.open(buildMenuModel({ state: defaultProfile() }), 0, 0);
    t.eq(m.isOpen, false, '无挂载点不进入打开态');
    m.close(); // 不应抛错
    t.ok(true, '无挂载点 close 不抛错');
  }
}
