// 播放控制（M4 / T4.2）：随机点歌 + 流式播放 + ≥60% 结算 + 与 FSM 互斥 + 降级哼唱
// createAudio / api 可注入（Node 单测用假 <audio> 与假 IPC）
import { parseLrc, LyricSync } from '../../shared/lrc.js';

export const REWARD_RATIO = 0.6;   // 播放 ≥60% 视为听完（PRD §5.5）
export const HUM_MS = 20000;       // 哼唱模式时长
export const IDLE_SING_CHANCE = 0.15; // 闲逛哼唱时触发真唱的概率（每 5s 判定一次）
// 歌词轮询兜底周期：timeupdate 在部分流媒体/后台节流场景下会稀疏甚至缺失，
// 仅靠它会让歌词"卡住不动"；此处额外定时按 currentTime 推进，双保险。
export const LYRIC_POLL_MS = 250;

// 闲逛随机真唱判定（PRD §3.3 通用页开关，默认关）：仅在哼唱日常态且不忙时可触发
export function idleSingChance({
  enabled = false, daily = '', singing = false, dancing = false, grabbed = false, rand = Math.random,
} = {}) {
  if (!enabled) return false;
  if (daily !== 'hum') return false;
  if (singing || dancing || grabbed) return false;
  return rand() < IDLE_SING_CHANCE;
}

export class Music {
  constructor({
    api, fsm, bubble, growth, dialogue,
    rand = Math.random,
    createAudio = null,
    humMs = HUM_MS,
    lyricPollMs = LYRIC_POLL_MS,
  } = {}) {
    this.api = api;
    this.fsm = fsm;
    this.bubble = bubble;
    this.growth = growth || null;
    this.dialogue = dialogue || null;
    this.rand = rand;
    this.createAudio = createAudio || ((url) => new Audio(url));
    this.humMs = humMs;
    this.lyricPollMs = lyricPollMs;

    this.audio = null;
    this.sync = null;
    this.song = null;
    this.source = null;
    this._busy = false;
    this._humTimer = null;
    this._maxRatio = 0;
    this._lyricTimer = null;   // 歌词轮询兜底计时器
    this._lastLine = null;     // 上次显示的歌词行（段落间隙时保持显示）
    this._token = 0;           // 歌曲令牌：丢弃切歌后到达的过期歌词结果
  }

  get singing() { return this.fsm.singing; }

  // 本模块是否真有声音在放（audio 或哼唱计时器）——fsm 打断后 singing 会变 false 但音频可能残留
  get playing() { return Boolean(this.audio) || Boolean(this._humTimer); }

  // fsm 打断唱歌态（拖拽/抛掷优先级更高）时回调：立即停掉声音，防止状态不同步后双击叠加两首
  onSingInterrupted() {
    if (this.playing || this.song) {
      this._finish(this._maxRatio >= REWARD_RATIO);
    }
  }

  // 双击入口（A17 点歌 / A18 停止）
  async toggle() {
    if (this._busy) return;
    // 用自身播放状态判断（fsm.singing 可能因打断与音频不同步）：有声音在放 → 停
    if (this.singing || this.playing) {
      this.stopSing(); // 手动停止：按已达比例结算
      return;
    }
    await this.startSing();
  }

  async startSing() {
    this._busy = true;
    try {
      // 防御清场：任何残留的旧音频/哼唱先停再点新歌（兜底所有状态不同步路径，绝不叠加两首）
      if (this.playing || this.song) this._finish(this._maxRatio >= REWARD_RATIO);
      // 即时反馈（真机反馈修复）：网络点歌可能要等数秒，先惊醒+标记互动并提示，
      // 避免用户双击后长时间无任何变化、以为"双击没反应"
      this.fsm.trigger('dblclick');
      this.bubble?.say('我去挑首歌～', 3000);
      let r;
      try {
        r = await this.api.pickSong();
      } catch {
        r = null;
      }
      if (!r || !r.song || r.source === 'hum') {
        this._startHum(); // A19：兜底也拿不到 → 哼唱
        return;
      }
      if (!this.fsm.beginSing()) return; // 被抓/被抛中 → 放弃
      this.song = r.song;
      this.source = r.source;
      this._maxRatio = 0;
      this.sync = null;      // 清掉上一首的歌词，避免新歌前奏期间显示旧词
      this._lastLine = null;
      this._sayScene('sing-start');

      const url = `https://music.163.com/song/media/outer/url?id=${r.song.id}.mp3`;
      const audio = this.createAudio(url);
      audio.addEventListener('ended', () => this._onEnded());
      audio.addEventListener('error', () => this._onError());
      audio.addEventListener('timeupdate', () => this._syncLyric());
      this.audio = audio;
      const p = audio.play();
      if (p && p.catch) p.catch(() => this._onError()); // 自动播放失败 → 哼唱
      this._loadLyric(r.song.id);
      this._startLyricPoll(); // 歌词兜底轮询（timeupdate 缺失时仍能推进）
    } catch {
      this._startHum();
    } finally {
      this._busy = false;
    }
  }

  async _loadLyric(songId) {
    const token = ++this._token;
    let lines = [];
    try {
      const r = await this.api.getLyric(songId);
      if (r && r.ok && r.lrc) lines = parseLrc(r.lrc);
    } catch { /* 歌词失败不影响演唱 */ }
    if (token !== this._token) return; // 已切歌 / 已结束 → 丢弃过期结果
    this.sync = new LyricSync(lines);
    this._lastLine = null;
    if (lines.length === 0 && this.fsm.singing) {
      // 无歌词（纯音乐/拿取失败）：显示歌名而非干巴巴的"♪ ～"
      const name = this.song ? this.song.name : '';
      this.bubble.lyric(name ? `♪ ${name} ♪` : '♪ ～', this._songLabel());
    }
  }

  // ---------- 歌词推进（timeupdate 与轮询兜底共用） ----------
  _startLyricPoll() {
    this._stopLyricPoll();
    if (typeof setInterval !== 'function') return;
    this._lyricTimer = setInterval(() => this._syncLyric(), this.lyricPollMs);
    // Node 测试环境：不要让兜底计时器阻止进程退出（浏览器下返回数字，无 unref）
    if (this._lyricTimer && typeof this._lyricTimer.unref === 'function') this._lyricTimer.unref();
  }

  _stopLyricPoll() {
    if (this._lyricTimer) {
      try { clearInterval(this._lyricTimer); } catch { /* ignore */ }
      this._lyricTimer = null;
    }
  }

  _syncLyric() {
    if (!this.fsm.singing) return;
    const audio = this.audio;
    if (!audio) return; // 哼唱模式 / 已结束：无音频可同步
    const cur = audio.currentTime || 0;
    const dur = audio.duration || 0;
    if (Number.isFinite(dur) && dur > 0) this._maxRatio = Math.max(this._maxRatio, cur / dur);
    let line = this.sync ? this.sync.at(cur) : null;
    if (line == null) {
      // 前奏 / 段落间隙 / 歌词尚未加载：保持上一句（或先显示歌名），
      // 避免歌词条长时间停在空白/陈旧内容上看起来"不动"
      line = this._lastLine != null
        ? this._lastLine
        : (this.song && this.song.name ? `♪ ${this.song.name} ♪` : null);
    } else {
      this._lastLine = line;
    }
    if (line != null) this.bubble.lyric(line, this._songLabel());
  }

  _onEnded() {
    if (!this.fsm.singing) return;
    this._finish(true); // 自然播完 = 100% ≥ 60%
  }

  _onError() {
    if (!this.fsm.singing) return;
    // 音频不可播（VIP 误判/版权/断网）→ 降级哼唱（A19）
    this._teardownAudio();
    this._startHum();
  }

  _startHum() {
    this.fsm.trigger('dblclick');
    if (!this.fsm.beginSing()) return;
    this._stopLyricPoll(); // 哼唱无音频，无需轮询
    this.source = 'hum';
    this.song = { id: 0, name: '哼唱' };
    this._sayScene('sing-start');
    this.bubble.say('网络好像不太听话……那就清唱一段吧！', 4200);
    this.bubble.lyric('♪ 哼唱中 ♪', '洛天依 · 哼唱');
    this._humTimer = setTimeout(() => {
      this._humTimer = null;
      if (this.fsm.singing) this._finish(false);
    }, this.humMs);
  }

  stopSing() {
    this._finish(this._maxRatio >= REWARD_RATIO);
  }

  _finish(completed) {
    this._token += 1; // 使在途的歌词加载失效，防止结束后被写回
    this._stopLyricPoll();
    if (this._humTimer) { clearTimeout(this._humTimer); this._humTimer = null; }
    this._teardownAudio();
    this.bubble.hideLyric();
    if (completed) {
      this.growth?.onSongCompleted?.();
      this._sayScene('sing-end');
    }
    this.song = null;
    this.source = null;
    this.sync = null;
    this._lastLine = null;
    this._maxRatio = 0;
    this.fsm.endSing(); // → fsm.onSingEnd → dance.singEnded()（A22 唱完接跳舞）
  }

  _teardownAudio() {
    this._stopLyricPoll();
    if (this.audio) {
      try { this.audio.pause(); } catch { /* ignore */ }
      try { this.audio.src = ''; } catch { /* ignore */ }
      this.audio = null;
    }
  }

  _sayScene(scene) {
    if (!this.dialogue || !this.growth) return;
    const line = this.dialogue.pick(scene, this.growth.tierKey(), this.rand);
    if (line) this.bubble.say(line, 4000);
  }

  _songLabel() {
    return this.song ? `洛天依 · ${this.song.name}` : '';
  }
}
