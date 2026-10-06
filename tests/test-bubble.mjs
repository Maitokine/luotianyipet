// bubble.js 单测：假 DOM + 手动时钟，验证气泡/歌词/徽章/特效的生命周期
import { Bubble, SAY_MS, FX_LIFE_MS, FX_MAX } from '../src/renderer/js/bubble.js';

class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this._cls = new Set();
    this._text = '';
    this.children = [];
    this.style = {};
    this.parentElement = null;
  }
  get classList() {
    const self = this;
    return {
      add: (c) => self._cls.add(c),
      remove: (c) => self._cls.delete(c),
      contains: (c) => self._cls.has(c),
    };
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  appendChild(el) { this.children.push(el); return el; }
  removeChild(el) {
    const i = this.children.indexOf(el);
    if (i >= 0) this.children.splice(i, 1);
    return el;
  }
  get firstChild() { return this.children[0] || null; }
}

function fakeDoc() {
  const els = new Map();
  for (const id of ['stage', 'bubble', 'lyric', 'lyric-text', 'lyric-song', 'badge', 'fx']) {
    els.set(id, new FakeEl(id));
  }
  els.get('lyric').parentElement = els.get('stage'); // 真实 DOM 中 #lyric 的父节点即 #stage
  return {
    getElementById: (id) => els.get(id) || null,
    createElement: (tag) => new FakeEl(tag),
  };
}

function fakeTimer() {
  let seq = 0;
  let now = 0;
  const pending = new Map();
  const t = {
    set(fn, ms) { const id = ++seq; pending.set(id, { fn, at: now + ms }); return id; },
    clear(id) { pending.delete(id); },
    advance(ms) {
      now += ms;
      for (;;) {
        let dueId = null;
        let dueAt = Infinity;
        for (const [id, v] of pending) if (v.at <= now && v.at < dueAt) { dueAt = v.at; dueId = id; }
        if (dueId == null) break;
        const v = pending.get(dueId);
        pending.delete(dueId);
        v.fn();
      }
    },
    get size() { return pending.size; },
  };
  return t;
}

function setup() {
  const doc = fakeDoc();
  const timer = fakeTimer();
  const bubble = new Bubble({ doc, timer });
  return { doc, timer, bubble, el: (id) => doc.getElementById(id) };
}

export function run(t) {
  // ---- 台词气泡 ----
  {
    const { timer, bubble, el } = setup();
    bubble.say('你好呀~');
    t.ok(!el('bubble').classList.contains('hidden'), 'say 立即显示气泡');
    t.eq(el('bubble').textContent, '你好呀~', 'say 设置文本');
    timer.advance(SAY_MS - 10);
    t.ok(!el('bubble').classList.contains('hidden'), '到期前仍显示');
    timer.advance(20);
    t.ok(el('bubble').classList.contains('hidden'), 'SAY_MS 后自动隐藏');
  }
  {
    const { timer, bubble, el } = setup();
    bubble.say('第一句', 3000);
    timer.advance(2000);
    bubble.say('第二句', 3000); // 重置计时器
    timer.advance(2000);
    t.ok(!el('bubble').classList.contains('hidden'), '新 say 重置隐藏计时');
    t.eq(el('bubble').textContent, '第二句', '新 say 覆盖文本');
    timer.advance(1100);
    t.ok(el('bubble').classList.contains('hidden'), '重置后按新时长隐藏');
  }
  {
    const { timer, bubble, el } = setup();
    bubble.say('长台词', 60000);
    bubble.hideSay();
    t.ok(el('bubble').classList.contains('hidden'), 'hideSay 立即隐藏');
    timer.advance(70000);
    t.eq(timer.size, 0, 'hideSay 取消了挂起的隐藏定时器');
  }
  {
    const { bubble, el } = setup();
    bubble.say('不消失', 0); // ms=0 → 常驻（手动 hideSay 控制）
    t.ok(!el('bubble').classList.contains('hidden'), 'ms=0 常驻显示');
  }

  // ---- 歌词条 ----
  {
    const { bubble, el } = setup();
    bubble.lyric('牵着我的手', '洛天依 - 普通DISCO');
    t.ok(!el('lyric').classList.contains('hidden'), 'lyric 显示歌词条');
    t.eq(el('lyric-text').textContent, '牵着我的手', 'lyric 设置歌词文本');
    t.eq(el('lyric-song').textContent, '洛天依 - 普通DISCO', 'lyric 设置歌名');
    bubble.hideLyric();
    t.ok(el('lyric').classList.contains('hidden'), 'hideLyric 隐藏歌词条');
  }
  {
    // 布局联动：歌词条显示时给 #stage 打 lyric-on，让气泡上移避开歌词
    const { bubble, el } = setup();
    t.ok(!el('stage').classList.contains('lyric-on'), '初始未标记 lyric-on');
    bubble.lyric('第一句', '歌名');
    t.ok(el('stage').classList.contains('lyric-on'), 'lyric 显示时标记 lyric-on（气泡让位）');
    bubble.say('点击台词', 4000);
    t.ok(el('stage').classList.contains('lyric-on'), '气泡出现不影响 lyric-on 标记');
    bubble.hideLyric();
    t.ok(!el('stage').classList.contains('lyric-on'), 'hideLyric 清除 lyric-on');
  }
  {
    // 容错：歌词条没有父节点（极端/假 DOM）时不得抛错
    const lyric = new FakeEl('lyric');
    const doc = {
      getElementById: (id) => (id === 'lyric' ? lyric : null),
      createElement: (tag) => new FakeEl(tag),
    };
    const bubble = new Bubble({ doc, timer: fakeTimer() });
    let threw = false;
    try { bubble.lyric('孤立的歌词'); bubble.hideLyric(); } catch { threw = true; }
    t.ok(!threw, '无父节点时 lyric/hideLyric 不抛错');
  }

  // ---- 徽章 ----
  {
    const { bubble, el } = setup();
    bubble.badge('番茄 24:31');
    t.ok(!el('badge').classList.contains('hidden'), 'badge 显示徽章');
    t.eq(el('badge').textContent, '番茄 24:31', 'badge 设置文本');
    bubble.badge('');
    t.ok(el('badge').classList.contains('hidden'), '空文本隐藏徽章');
    bubble.badge('喝水');
    bubble.hideBadge();
    t.ok(el('badge').classList.contains('hidden'), 'hideBadge 隐藏徽章');
  }

  // ---- 特效粒子 ----
  {
    const { timer, bubble, el } = setup();
    bubble.fx('note');
    t.eq(el('fx').children.length, 1, 'fx 添加一个粒子');
    const item = el('fx').children[0];
    t.ok(item.classList.contains('fx-item'), 'fx 粒子有 fx-item 类');
    t.eq(item.textContent, '♪', 'note 粒子为音符');
    t.ok(item.style.left && item.style.top, 'fx 粒子有随机定位');
    timer.advance(FX_LIFE_MS + 10);
    t.eq(el('fx').children.length, 0, 'FX_LIFE_MS 后粒子被移除');
    t.eq(timer.size, 0, '粒子定时器已清理');
  }
  {
    const { bubble, el } = setup();
    bubble.fx('zzz');
    t.ok(el('fx').children[0].classList.contains('zzz'), 'zzz 粒子有 zzz 修饰类');
    t.eq(el('fx').children[0].textContent, 'Zzz', 'zzz 粒子文本');
  }
  {
    const { bubble, el } = setup();
    for (let i = 0; i < FX_MAX + 5; i++) bubble.fx('note');
    t.eq(el('fx').children.length, FX_MAX, `fx 同屏上限 ${FX_MAX}`);
  }
  {
    const { timer, bubble, el } = setup();
    for (let i = 0; i < 3; i++) bubble.fx('note');
    bubble.clearFx();
    t.eq(el('fx').children.length, 0, 'clearFx 清空所有粒子');
    t.eq(timer.size, 0, 'clearFx 取消所有粒子定时器');
  }
}
