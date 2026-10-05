// HTML 右键菜单（M5 / T5.3，A6）：渲染 menumodel，手风琴式二级菜单
// doc 可注入（Node 单测用假 DOM）；点击叶项 → onAction(action, payload) 并关闭
import { itemAction } from '../../shared/menumodel.js';

export class HtmlMenu {
  constructor({
    doc = null,
    win = null,
    onAction = () => {},
    onOpen = () => {},
    onClose = () => {},
  } = {}) {
    this.doc = doc || (typeof document !== 'undefined' ? document : null);
    this.win = win || (typeof window !== 'undefined' ? window : null);
    this.onAction = onAction;
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.el = this.doc ? this.doc.getElementById('menu') : null;
    this.isOpen = false;
    this._openNodes = [];

    this._outsideHandler = (e) => {
      if (!this.isOpen) return;
      if (this.el && e && e.target && this._contains(this.el, e.target)) return;
      this.close();
    };
    this._keyHandler = (e) => {
      if (this.isOpen && e && e.key === 'Escape') this.close();
    };
    if (this.doc && typeof this.doc.addEventListener === 'function') {
      this.doc.addEventListener('mousedown', this._outsideHandler);
      this.doc.addEventListener('keydown', this._keyHandler);
    }
  }

  open(model, x = 0, y = 0) {
    if (!this.el || !Array.isArray(model)) return;
    this._render(model);
    this.el.classList.remove('hidden');
    this.isOpen = true;
    // 位置钳制在窗口内（菜单宽高未知时按典型值估算）
    const w = this.el.offsetWidth || 200;
    const h = this.el.offsetHeight || 300;
    const vw = (this.win && this.win.innerWidth) || 300;
    const vh = (this.win && this.win.innerHeight) || 420;
    const px = Math.max(0, Math.min(x, vw - w - 4));
    const py = Math.max(0, Math.min(y, vh - h - 4));
    this.el.style.left = `${Math.round(px)}px`;
    this.el.style.top = `${Math.round(py)}px`;
    this.onOpen();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    if (this.el) {
      this.el.classList.add('hidden');
      this._clear();
    }
    this.onClose();
  }

  // ---------- 渲染 ----------
  _render(model) {
    this._clear();
    for (const group of model) {
      const g = this.doc.createElement('div');
      g.classList.add('menu-group');
      const label = this.doc.createElement('div');
      label.classList.add('menu-group-label');
      label.textContent = String(group.label || '');
      g.appendChild(label);
      for (const item of group.items || []) g.appendChild(this._renderNode(item));
      this.el.appendChild(g);
    }
  }

  // 一个节点 = 行 + （可选）内嵌二级容器
  _renderNode(item) {
    const node = this.doc.createElement('div');
    node.classList.add('menu-node');

    const row = this.doc.createElement('div');
    row.classList.add('menu-item');
    if (item.disabled) row.classList.add('disabled');

    const check = this.doc.createElement('span');
    check.classList.add('menu-check');
    if (item.type === 'check') check.textContent = item.checked ? '✓' : '';
    if (item.type === 'radio') check.textContent = item.checked ? '●' : '';
    row.appendChild(check);

    const text = this.doc.createElement('span');
    text.classList.add('menu-label');
    text.textContent = String(item.label || '') + (item.hint ? `（${item.hint}）` : '');
    row.appendChild(text);

    if (item.type === 'submenu' && Array.isArray(item.items)) {
      row.classList.add('has-sub');
      const chev = this.doc.createElement('span');
      chev.classList.add('menu-chev');
      chev.textContent = '▸';
      row.appendChild(chev);
      const sub = this.doc.createElement('div');
      sub.classList.add('menu-sub');
      for (const child of item.items) sub.appendChild(this._renderNode(child));
      node.appendChild(row);
      node.appendChild(sub);
      row.addEventListener('click', () => this._toggleSub(item, node));
    } else {
      node.appendChild(row);
      row.addEventListener('click', () => this._fire(item));
    }
    return node;
  }

  // 手风琴：同一时间只展开一个二级菜单
  _toggleSub(item, node) {
    const wasOpen = node.classList.contains('open');
    for (const n of this._openNodes) n.classList.remove('open');
    this._openNodes = [];
    if (!wasOpen) {
      node.classList.add('open');
      this._openNodes.push(node);
    }
  }

  _fire(item) {
    if (item.disabled) return; // 禁用项：不分发、不关闭
    const { action, payload } = itemAction(item);
    this.close();
    this.onAction(action, payload);
  }

  _clear() {
    if (!this.el) return;
    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    this._openNodes = [];
  }

  _contains(root, target) {
    let n = target;
    while (n) {
      if (n === root) return true;
      n = n.parentNode;
    }
    return false;
  }
}
