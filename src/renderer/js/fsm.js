// 行为状态机（M2 / K5）：日常循环 + 打断（快照恢复）
// 纯 tick 驱动（不依赖 setTimeout 做状态转移），随机数可注入，可在 Node 中测试
import { computeGroundY, clampWalkX } from './geo.js';
import { Physics } from './physics.js';

export const IDLE_PICK_AFTER = 30;   // 闲置 30 秒后随机切日常小动作
export const SLEEP_AFTER = 120;      // 2 分钟无操作 → 睡觉
export const CLICK_REACT_MS = 2000;  // 单击互动时长
export const NOTIFY_MS = 5000;       // 系统提醒气泡时长
export const WALK_SPEED = 42;        // 闲逛速度 px/s
export const PACE_RANGE = 26;        // 踱步半径

// 打断优先级（高抢占低）
export const PRIORITY = { physics: 5, grabbed: 5, sing: 4, dance: 3, 'click-react': 2, notify: 1 };

export class Fsm {
  constructor(deps) {
    // deps: { rig, bubble, growth, dialogue, sfx, moveWindow, rand, onSingEnd }
    this.deps = deps;
    this.rand = deps.rand || Math.random;
    this.rig = deps.rig;
    this.bubble = deps.bubble;
    this.growth = deps.growth || null;
    this.dialogue = deps.dialogue || null;
    this.sfx = deps.sfx || null;
    this.moveWindow = deps.moveWindow || (() => {});
    this.onSingEnd = deps.onSingEnd || null;
    // 唱歌被更高优先级打断（拖拽/抛掷）时通知 music 模块停音频（否则音频会在 fsm 已退出唱歌态后继续播）
    this.onSingInterrupted = deps.onSingInterrupted || null;

    this.daily = 'walk';            // walk/daze/pace/hum/sleep/sit
    this.interrupt = null;          // { type, data, elapsed }
    this.idleSecs = 0;              // 距上次用户互动
    this.dailySecs = 0;             // 当前日常状态持续
    this.actionLeft = 0;            // 定时日常剩余秒数
    this.pickCooldown = 0;          // 闲置小动作冷却（避免连触）
    this.clock = 0;

    this.winX = 0;
    this.winY = 0;
    this.groundY = 0;
    this.workArea = { x: 0, y: 0, width: 1920, height: 1040 };
    this.winW = 300;
    this.winH = 420;
    this.walkDir = this.rand() < 0.5 ? -1 : 1;
    this.paceAnchor = 0;
    this._fxAcc = 0;
    this._resume = null;            // 打断前日常快照
    this._raf = null;
    this._lastTs = null;
    this._running = false;

    this.physics = new Physics({
      onMove: (x, y) => this._setWinPos(x, y),
    });
  }

  // ---------- 生命周期 ----------
  setGeometry({ workArea, winBounds, winW = 300, winH = 420 }) {
    if (workArea) {
      this.workArea = workArea;
      this.winW = winW;
      this.winH = winH;
      this.groundY = computeGroundY(workArea, this.winH);
    }
    if (winBounds) {
      this.winX = winBounds.x;
      this.winY = winBounds.y;
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._enterDaily('walk');
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

  // ---------- 主循环 ----------
  tick(dt) {
    this.clock += dt;
    if (this.interrupt) {
      this.interrupt.elapsed += dt;
      this._tickInterrupt(dt);
      return;
    }
    this.idleSecs += dt;
    this.dailySecs += dt;
    this._tickDaily(dt);
  }

  _tickDaily(dt) {
    switch (this.daily) {
      case 'walk': {
        this.winX += this.walkDir * WALK_SPEED * dt;
        this._clampAndMove();
        if (this.pickCooldown > 0) this.pickCooldown -= dt;
        else if (this.idleSecs >= IDLE_PICK_AFTER) this._pickIdleBehavior();
        break;
      }
      case 'daze': {
        this.actionLeft -= dt;
        if (this.actionLeft <= 0) this._enterDaily('walk');
        break;
      }
      case 'hum': {
        this.actionLeft -= dt;
        this._fxAcc += dt;
        if (this._fxAcc >= 0.8) { this._fxAcc = 0; this.bubble?.fx('note'); }
        if (this.actionLeft <= 0) this._enterDaily('walk');
        break;
      }
      case 'pace': {
        this.actionLeft -= dt;
        const target = this.paceAnchor + Math.sin(this.dailySecs * 2.2) * PACE_RANGE;
        this.winX = clampWalkX(target, this.workArea, this.winW);
        this._moveNow();
        if (this.actionLeft <= 0) this._enterDaily('walk');
        break;
      }
      case 'sleep': {
        this._fxAcc += dt;
        if (this._fxAcc >= 2.0) { this._fxAcc = 0; this.bubble?.fx('zzz'); }
        break;
      }
      case 'sit':
      default:
        break;
    }
    if (this.idleSecs >= SLEEP_AFTER && this.daily !== 'sleep' && this.daily !== 'sit') {
      this._enterDaily('sleep');
    }
  }

  _pickIdleBehavior() {
    const roll = this.rand();
    if (roll < 0.4) this._enterDaily('daze', 4 + this.rand() * 6);
    else if (roll < 0.7) this._enterDaily('pace', 8);
    else this._enterDaily('hum', 10 + this.rand() * 10);
  }

  _enterDaily(name, duration = 0) {
    const changed = name !== this.daily;
    this.daily = name;
    this.dailySecs = 0;
    this.actionLeft = duration;
    this._fxAcc = 0;
    if (!changed && name !== 'walk') return; // 恢复同名状态不重播动画
    switch (name) {
      case 'walk':
        this.pickCooldown = 15 + this.rand() * 10;
        this.rig?.play('walk');
        this.rig?.setFlip(this.walkDir < 0);
        break;
      case 'daze':
        this.rig?.play('daze');
        break;
      case 'pace':
        this.rig?.play('pace');
        this.paceAnchor = this.winX;
        break;
      case 'hum':
        this.rig?.play('hum');
        this._sayScene('hum-start');
        break;
      case 'sleep':
        this.rig?.play('sleep');
        this._sayScene('sleep-start');
        break;
      case 'sit':
        this.rig?.play('sit');
        break;
      default:
        break;
    }
  }

  // ---------- 打断管理 ----------
  canInterrupt(type) {
    if (!this.interrupt) return true;
    return (PRIORITY[type] || 0) >= (PRIORITY[this.interrupt.type] || 0);
  }

  _enterInterrupt(type, data = {}) {
    const prev = this.interrupt;
    if (!prev) {
      this._resume = {
        daily: this.daily,
        actionLeft: this.actionLeft,
        dailySecs: this.dailySecs,
      };
    }
    // 唱歌态被更高优先级打断（grabbed/physics 优先级 5 > sing 4）：
    // music 模块的音频不会自己停，必须显式通知（真机反馈：拖拽后双击切歌两首叠加的根因）
    if (prev && prev.type === 'sing' && type !== 'sing' && this.onSingInterrupted) {
      this.onSingInterrupted();
    }
    this.interrupt = { type, data, elapsed: 0 };
    this._fxAcc = 0;
  }

  _exitInterrupt() {
    const it = this.interrupt;
    this.interrupt = null;
    if (this._resume) {
      const r = this._resume;
      this._resume = null;
      this._enterDaily(r.daily); // 同名不重播；walk 重进会重置冷却
      // 恢复计时必须在 _enterDaily 之后（否则被其默认参数 actionLeft=0 覆盖）
      this.actionLeft = r.actionLeft;
      this.dailySecs = r.dailySecs;
    } else {
      this._enterDaily(this.daily);
    }
    // 唱歌结束后：若系统音乐仍在放 → 由 dance 模块接管（A22）
    if (it && it.type === 'sing' && this.onSingEnd) this.onSingEnd();
  }

  _tickInterrupt(dt) {
    const it = this.interrupt;
    switch (it.type) {
      case 'click-react': {
        if (it.elapsed * 1000 >= CLICK_REACT_MS) this._exitInterrupt();
        break;
      }
      case 'notify': {
        if (it.elapsed * 1000 >= (it.data.ms || NOTIFY_MS)) this._exitInterrupt();
        break;
      }
      case 'dance': {
        const d = it.data;
        if (d.duration && it.elapsed >= d.duration) {
          this._exitInterrupt();
          break;
        }
        // 每 6 秒轮换舞步
        const want = `dance${(Math.floor(it.elapsed / 6) % 3) + 1}`;
        if (this.rig && this.rig.action !== want) this.rig.play(want);
        this._fxAcc += dt;
        if (this._fxAcc >= 1.4) { this._fxAcc = 0; this.bubble?.fx('note'); }
        break;
      }
      case 'grabbed':
        break; // 位置由 interact 直接驱动
      case 'sing': {
        this._fxAcc += dt;
        if (this._fxAcc >= 0.7) { this._fxAcc = 0; this.bubble?.fx('note'); }
        break;
      }
      case 'physics': {
        if (it.data.landing) {
          if (this.clock >= it.data.landDeadline) this._exitInterrupt();
          break;
        }
        const landed = this.physics.step(dt);
        if (landed) {
          it.data.landing = true;
          it.data.landDeadline = this.clock + 1.0;
          this.rig?.play('land', {
            onDone: () => { if (this.interrupt?.type === 'physics') this._exitInterrupt(); },
          });
          this.sfx?.play('land');
        }
        break;
      }
      default:
        this._exitInterrupt();
    }
  }

  // ---------- 事件 ----------
  trigger(event, data = {}) {
    switch (event) {
      case 'click': {
        const wasSleeping = this.daily === 'sleep' && !this.interrupt;
        this._markInteraction();
        this.growth?.onPetClick?.(); // A13：单击经验/好感（growth 内部做 10s 去重与日上限）
        if (wasSleeping) {
          // 惊醒（A9）：闹小脾气
          this.daily = 'walk';
          this._enterInterrupt('click-react');
          this.rig?.play('wake');
          this._sayScene('wake');
          return 'woken';
        }
        if (!this.canInterrupt('click-react')) return 'ignored';
        this._enterInterrupt('click-react');
        const act = this.rand() < 0.5 ? 'jump' : 'shake';
        this.rig?.play(act);
        if (act === 'jump') this.sfx?.play('jump');
        this._sayScene('click');
        return 'react';
      }
      case 'dblclick': {
        this._markInteraction();
        this._wakeIfSleeping();
        return 'sing-request'; // music 模块处理
      }
      case 'drag-start': {
        this._markInteraction();
        this._wakeIfSleeping();
        if (!this.canInterrupt('grabbed')) return 'ignored';
        this._enterInterrupt('grabbed');
        this.rig?.play('grabbed');
        return 'grabbed';
      }
      case 'drag-move': {
        this.winX = data.x;
        this.winY = data.y;
        this._moveNow();
        return 'moved';
      }
      case 'drag-end': {
        this._enterInterrupt('physics');
        this.physics.settle(this.winX, this.winY, this._bounds());
        this.rig?.play('fly');
        return 'settling';
      }
      case 'throw': {
        this._markInteraction();
        this._enterInterrupt('physics');
        this.physics.launch(data.vx || 0, data.vy || 0, this.winX, this.winY, this._bounds());
        this.rig?.play('fly');
        this._sayScene('thrown');
        return 'thrown';
      }
      default:
        return 'unknown';
    }
  }

  // 唱歌/跳舞（music / dance 模块调用）
  beginSing() {
    if (!this.canInterrupt('sing')) return false;
    this._enterInterrupt('sing');
    this.rig?.play('sing');
    return true;
  }

  endSing() {
    if (this.interrupt?.type === 'sing') this._exitInterrupt();
  }

  beginDance({ source = 'music', duration = 0 } = {}) {
    if (!this.canInterrupt('dance')) return false;
    this._enterInterrupt('dance', { source, duration });
    this.rig?.play('dance1');
    this._sayScene('dance');
    return true;
  }

  endDance() {
    if (this.interrupt?.type === 'dance') this._exitInterrupt();
  }

  get singing() { return this.interrupt?.type === 'sing'; }
  get dancing() { return this.interrupt?.type === 'dance'; }
  get grabbed() {
    return this.interrupt?.type === 'grabbed' || this.interrupt?.type === 'physics';
  }

  // 提醒/感知（A23-A25）
  notify({ text, ms = NOTIFY_MS, sfx = 'alert', scene = null } = {}) {
    if (text) this.bubble?.say(text, ms + 1500);
    this.sfx?.play(sfx);
    if (scene) this._sayScene(scene);
    if (!this.canInterrupt('notify')) return false;
    this._enterInterrupt('notify', { ms });
    this.rig?.play('happy');
    return true;
  }

  // 菜单"让她做动作"
  manualAction(name) {
    if (this.grabbed || this.singing) return false;
    if (name === 'dance') {
      this.interrupt = null;
      this._resume = null;
      return this.beginDance({ source: 'manual', duration: 10 });
    }
    if (['sit', 'daze', 'sleep'].includes(name)) {
      this.interrupt = null;
      this._resume = null;
      this.idleSecs = 0;
      this._enterDaily(name, name === 'daze' ? 30 : 0);
      return true;
    }
    return false;
  }

  sync() { /* 预留：设置变化钩子 */ }

  // ---------- 内部 ----------
  _markInteraction() {
    this.idleSecs = 0;
    this.growth?.onActivity?.(); // 任何互动：重置冷落衰减计时
  }

  _wakeIfSleeping() {
    if (this.daily === 'sleep') {
      this.daily = 'walk';
      this._sayScene('wake');
    }
  }

  _sayScene(scene) {
    if (!this.dialogue) return;
    const tier = this.growth ? this.growth.tierKey() : 'stranger';
    const line = this.dialogue.pick(scene, tier, this.rand);
    if (line) this.bubble?.say(line, 4000);
  }

  _bounds() {
    const wa = this.workArea;
    return {
      minX: wa.x - this.winW + 80,
      maxX: wa.x + wa.width - 80,
      minY: wa.y - this.winH + 120,
      groundY: this.groundY,
    };
  }

  _clampAndMove() {
    const clamped = clampWalkX(this.winX, this.workArea, this.winW);
    if (clamped !== this.winX) {
      this.winX = clamped;
      this.walkDir *= -1; // 到边缘折返（A7）
    }
    this.rig?.setFlip(this.walkDir < 0);
    this._moveNow();
  }

  _moveNow() {
    this.moveWindow(Math.round(this.winX), Math.round(this.winY || this.groundY));
  }

  _setWinPos(x, y) {
    this.winX = x;
    this.winY = y;
    this.moveWindow(Math.round(x), Math.round(y));
  }
}
