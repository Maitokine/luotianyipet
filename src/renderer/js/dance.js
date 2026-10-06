// 跳舞模块（M2 / T2.6 / K8）：消费 SMTC 媒体状态 → 判定 → 驱动 fsm
// DanceJudge 纯逻辑（可注入阈值，Node 可测）；Dance 与 fsm/设置集成
export const PLAY_SUSTAIN_S = 5;   // 外部音乐持续播放 ≥5s → 开始跳舞（A20）
export const STOP_SUSTAIN_S = 10;  // 外部音乐停止 ≥10s → 结束跳舞（A21）

export class DanceJudge {
  constructor({ enabled = true, playSustain = PLAY_SUSTAIN_S, stopSustain = STOP_SUSTAIN_S } = {}) {
    this.enabled = enabled;
    this.playSustain = playSustain;
    this.stopSustain = stopSustain;
    this.playSecs = 0;
    this.stopSecs = 0;
    this.dancing = false;
  }

  setEnabled(v) {
    this.enabled = Boolean(v);
    if (!this.enabled && this.dancing) {
      this.dancing = false;
      this.playSecs = 0;
      this.stopSecs = 0;
      return 'stop'; // 跳舞中途被关闭 → 立即停
    }
    return null;
  }

  // 每帧喂入当前是否在播放，返回 'start' | 'stop' | null
  update(playing, dt) {
    if (playing) {
      this.playSecs += dt;
      this.stopSecs = 0;
      if (this.enabled && !this.dancing && this.playSecs >= this.playSustain) {
        this.dancing = true;
        return 'start';
      }
    } else {
      this.stopSecs += dt;
      this.playSecs = 0;
      if (this.dancing && this.stopSecs >= this.stopSustain) {
        this.dancing = false;
        this.stopSecs = 0;
        return 'stop';
      }
    }
    return null;
  }
}

// 集成层：媒体状态 → 判定 → fsm
export class Dance {
  constructor({ fsm, judge = new DanceJudge(), onUnavailable = null, canDance = null } = {}) {
    this.fsm = fsm;
    this.judge = judge;
    this.onUnavailable = onUnavailable;
    // 门控钩子（默认放行）：产品层已解除跳舞的等级限制
    // （用户要求——系统媒体播放即跳），保留该能力供后续按需扩展。
    this.canDance = canDance || (() => true);
    this.status = { playing: false, available: true };
    this._raf = null;
    this._lastTs = null;
    this._running = false;
  }

  // preload onMediaStatus 回调
  onMediaStatus(s) {
    if (!s) return;
    this.status = { playing: Boolean(s.playing), available: s.available !== false };
    if (!this.status.available && this.onUnavailable) this.onUnavailable();
  }

  // 状态变更（settings.danceWithMusic 开关）
  sync(state) {
    if (!state || !state.settings) return;
    const ev = this.judge.setEnabled(state.settings.danceWithMusic !== false);
    if (ev === 'stop') this.fsm.endDance();
  }

  tick(dt) {
    if (!this.canDance()) {
      // 门控拒绝：不进入跳舞；已在跳（刚被禁用/读档异常）则立即退出
      if (this.judge.dancing) {
        this.judge.dancing = false;
        this.judge.playSecs = 0;
        this.fsm.endDance();
      }
      return;
    }
    const playing = this.status.available && this.status.playing;
    const ev = this.judge.update(playing, dt);
    if (ev === 'start') {
      if (!this.fsm.beginDance({ source: 'music' })) {
        this.judge.dancing = false; // fsm 忙（唱歌/被抓）→ 下帧重试
      }
    } else if (ev === 'stop') {
      this.fsm.endDance();
    }
  }

  // A22：唱完歌后若系统音乐仍在播放 → 无缝转跳舞（music 模块在 fsm onSingEnd 里调用）
  singEnded() {
    if (!this.canDance()) return false;
    if (this.status.available && this.status.playing) {
      return this.fsm.beginDance({ source: 'handover' });
    }
    return false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = (ts) => {
      if (this._lastTs == null) this._lastTs = ts;
      const dt = Math.min(0.05, (ts - this._lastTs) / 1000);
      this._lastTs = ts;
      this.tick(dt);
      if (this._running) this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }
}
