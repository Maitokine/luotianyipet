// 气泡/歌词条/徽章/特效 UI（M2 / T2.5）
// doc 与 timer 可注入：Node 单测用假 DOM + 手动时钟
export const SAY_MS = 4000;        // 台词气泡默认时长
export const FX_LIFE_MS = 1700;    // 特效粒子存活时长（略长于 CSS 动画 1.6s）
export const FX_MAX = 8;           // 同屏特效粒子上限

export class Bubble {
  constructor({ doc, timer } = {}) {
    this.doc = doc || (typeof document !== 'undefined' ? document : null);
    this.timer = timer || {
      set: (fn, ms) => setTimeout(fn, ms),
      clear: (id) => clearTimeout(id),
    };
    const d = this.doc;
    this.el = {
      bubble: d.getElementById('bubble'),
      lyric: d.getElementById('lyric'),
      lyricText: d.getElementById('lyric-text'),
      lyricSong: d.getElementById('lyric-song'),
      badge: d.getElementById('badge'),
      fx: d.getElementById('fx'),
    };
    this._sayTimer = null;
    this._fxTimers = new Set();
  }

  // ---------- 台词气泡 ----------
  say(text, ms = SAY_MS) {
    const el = this.el.bubble;
    if (!el) return;
    if (this._sayTimer) { this.timer.clear(this._sayTimer); this._sayTimer = null; }
    el.textContent = String(text);
    el.classList.remove('hidden');
    if (ms > 0) {
      this._sayTimer = this.timer.set(() => {
        this._sayTimer = null;
        el.classList.add('hidden');
      }, ms);
    }
  }

  hideSay() {
    if (this._sayTimer) { this.timer.clear(this._sayTimer); this._sayTimer = null; }
    this.el.bubble?.classList.add('hidden');
  }

  // ---------- 歌词条（M4 music 驱动） ----------
  lyric(text, song = '') {
    const el = this.el.lyric;
    if (!el) return;
    if (this.el.lyricText) this.el.lyricText.textContent = String(text || '');
    if (this.el.lyricSong) this.el.lyricSong.textContent = String(song || '');
    el.classList.remove('hidden');
    // 歌词条占据窗口中部，给 #stage 打标记 → CSS 把台词气泡上移一层避开它
    this._stageClass(el, 'add');
  }

  hideLyric() {
    this.el.lyric?.classList.add('hidden');
    this._stageClass(this.el.lyric, 'remove');
  }

  // 歌词条的父节点（真实 DOM 里即 #stage）；假 DOM 无父节点时静默跳过
  _stageClass(el, op) {
    const stage = el && el.parentElement;
    if (stage && stage.classList) stage.classList[op]('lyric-on');
  }

  // ---------- 徽章（M5 番茄钟） ----------
  badge(text) {
    const el = this.el.badge;
    if (!el) return;
    if (text == null || text === '') { this.hideBadge(); return; }
    el.textContent = String(text);
    el.classList.remove('hidden');
  }

  hideBadge() {
    this.el.badge?.classList.add('hidden');
  }

  // ---------- 特效粒子（音符 / ZZZ / 星星） ----------
  fx(kind = 'note') {
    const host = this.el.fx;
    if (!host) return;
    if (host.children.length >= FX_MAX) return; // 上限保护，防止 DOM 堆积
    const item = this.doc.createElement('span');
    item.classList.add('fx-item');
    if (kind === 'zzz') item.classList.add('zzz');
    item.textContent = FX_GLYPHS[kind] || FX_GLYPHS.note;
    // 水平随机偏移 + 轻微上下错落
    item.style.left = `${30 + Math.random() * 40}%`;
    item.style.top = `${20 + Math.random() * 30}%`;
    host.appendChild(item);
    const t = this.timer.set(() => {
      this._fxTimers.delete(t);
      try { host.removeChild(item); } catch { /* 已被清空 */ }
    }, FX_LIFE_MS);
    this._fxTimers.add(t);
  }

  clearFx() {
    const host = this.el.fx;
    if (!host) return;
    for (const t of this._fxTimers) this.timer.clear(t);
    this._fxTimers.clear();
    while (host.firstChild) host.removeChild(host.firstChild);
  }
}

export const FX_GLYPHS = { note: '♪', zzz: 'Zzz', star: '✦' };
