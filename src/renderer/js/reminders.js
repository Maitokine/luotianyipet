// 提醒四件套（M5 / T5.1，A23/A24/A25）：久坐 / 喝水 / 番茄钟 / 便签
// 纯 tick 驱动、now 可注入（Node 可测）。
// 语义要点：
// - 久坐/喝水：应用运行期累加器（重启后重新计时，不追账关机期间的时间）
// - 便签：按本地时刻触发；lastFire 记录最后触发日（YYYY-M-D），支持每天重复；一次性便签触发后从列表移除
// - 番茄钟：focus → rest 状态机；专注阶段完成即结算奖励（growth.onPomodoroCompleted），
//   随后进入休息倒计时；徽章每秒刷新；运行状态仅存内存（PRD §5.14 存档字段不含番茄钟）
// - 触发走 fsm.notify 打断态（优先级最低，唱歌/跳舞不被打断，但气泡与音效照常）
export const NOTE_TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// 本地日期串 YYYY-M-D（与 growth 的 affectionToday.date 同格式）
export function todayStr(nowMs) {
  const d = new Date(nowMs);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// 今天 timeStr(HH:MM) 的时间戳；非法时间返回 null
export function slotToday(timeStr, nowMs) {
  if (typeof timeStr !== 'string') return null;
  const m = NOTE_TIME_RE.exec(timeStr.trim());
  if (!m) return null;
  const d = new Date(nowMs);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

// 用户新建便签 / 修改时间时调用：若今天该时刻已过，标记今天已消费，
// 避免一创建就立即触发（等下一次出现：每天重复→明天；一次性→明天）
export function stampNote(note, nowMs) {
  const slot = slotToday(note.time, nowMs);
  const today = todayStr(nowMs);
  if (slot != null && nowMs >= slot && note.lastFire !== today) {
    return { ...note, lastFire: today };
  }
  return note;
}

export function makeNoteId(nowMs = Date.now(), rand = Math.random) {
  return `n${nowMs.toString(36)}${Math.floor(rand() * 46656).toString(36)}`;
}

// 设置页「添加便签」表单校验 + 构造（含创建时戳记：今天时刻已过则跳过今天）
export function createNote({ text, time, repeatDaily = false, nowMs = Date.now(), rand = Math.random } = {}) {
  const txt = typeof text === 'string' ? text.trim() : '';
  if (!txt) return { ok: false, error: '请填写提醒内容' };
  if (txt.length > 40) return { ok: false, error: '提醒内容最多 40 字' };
  if (slotToday(time, nowMs) == null) return { ok: false, error: '请选择有效的提醒时间' };
  const note = {
    id: makeNoteId(nowMs, rand),
    text: txt,
    time: String(time).trim(),
    repeatDaily: Boolean(repeatDaily),
    lastFire: '',
  };
  return { ok: true, note: stampNote(note, nowMs) };
}

function cloneNote(n) {
  return {
    id: String(n.id || ''),
    text: String(n.text || ''),
    time: String(n.time || ''),
    repeatDaily: Boolean(n.repeatDaily),
    lastFire: String(n.lastFire || ''),
  };
}

export class Reminders {
  constructor({
    state,
    fsm = null,
    bubble = null,
    growth = null,
    now = () => Date.now(),
    onPersist = () => {},
    onPomoChange = () => {},
  } = {}) {
    this.state = state;
    this.fsm = fsm;
    this.bubble = bubble;
    this.growth = growth;
    this.now = now;
    this.onPersist = onPersist;
    this.onPomoChange = onPomoChange;
    this._sitAcc = 0;   // 久坐累计秒（仅运行期、仅开启时累计）
    this._waterAcc = 0; // 喝水累计秒
    this._pomo = { phase: 'idle', remain: 0, total: 0 }; // idle | focus | rest
  }

  // 状态广播刷新（FIFO 广播保证不回退）
  sync(s) { if (s) this.state = s; }

  get pomodoro() { return { ...this._pomo }; }

  // ---------- 主循环（pet.js 每秒驱动一次） ----------
  tick(dtSec) {
    const now = this.now();
    const s = this.state.settings;

    // 久坐：开启时累计，关闭时清零（重新开始计）
    if (s.sitting && s.sitting.enabled) {
      this._sitAcc += dtSec;
      if (this._sitAcc >= s.sitting.minutes * 60) {
        this._sitAcc = 0;
        this._fireInterval('sit-long', 'sittingLastFire', now);
      }
    } else {
      this._sitAcc = 0;
    }

    // 喝水
    if (s.water && s.water.enabled) {
      this._waterAcc += dtSec;
      if (this._waterAcc >= s.water.minutes * 60) {
        this._waterAcc = 0;
        this._fireInterval('water', 'waterLastFire', now);
      }
    } else {
      this._waterAcc = 0;
    }

    this._tickNotes(now);
    if (this._pomo.phase !== 'idle') this._tickPomo(dtSec);
  }

  _fireInterval(scene, field, now) {
    this.state[field] = now;
    this.onPersist({ [field]: now });
    this.fsm?.notify({ scene, sfx: 'alert' });
  }

  // ---------- 便签 ----------
  _tickNotes(now) {
    const notes = this.state.notes;
    if (!Array.isArray(notes) || notes.length === 0) return;
    const today = todayStr(now);
    let changed = false;
    for (const note of [...notes]) {
      const slot = slotToday(note.time, now);
      if (slot == null || now < slot) continue;    // 非法时间 / 未到点
      if (note.lastFire === today) continue;       // 今天已触发
      this.fsm?.notify({ text: `便签：${note.text}`, sfx: 'alert' });
      if (note.repeatDaily) {
        note.lastFire = today;
        changed = true;
      } else {
        const idx = notes.indexOf(note);
        if (idx >= 0) notes.splice(idx, 1);
        changed = true;
      }
    }
    if (changed) this.onPersist({ notes: notes.map(cloneNote) });
  }

  // ---------- 番茄钟 ----------
  startPomodoro() {
    if (this._pomo.phase !== 'idle') return false;
    const p = this.state.settings.pomodoro || { focus: 25, rest: 5 };
    this._pomo = { phase: 'focus', remain: p.focus * 60, total: p.focus * 60 };
    this._renderBadge();
    this.fsm?.notify({ scene: 'pomo-start', sfx: 'alert' });
    this.onPomoChange(this.pomodoro);
    return true;
  }

  stopPomodoro() {
    if (this._pomo.phase === 'idle') return false;
    this._pomo = { phase: 'idle', remain: 0, total: 0 };
    this.bubble?.hideBadge();
    this.bubble?.say('番茄钟已停止～', 3000);
    this.onPomoChange(this.pomodoro);
    return true;
  }

  togglePomodoro() {
    return this._pomo.phase === 'idle' ? this.startPomodoro() : this.stopPomodoro();
  }

  _tickPomo(dtSec) {
    this._pomo.remain -= dtSec;
    if (this._pomo.remain > 0) {
      this._renderBadge();
      return;
    }
    if (this._pomo.phase === 'focus') {
      // 专注阶段完成：结算奖励（+10 经验 / +2 好感）→ 转休息
      this.growth?.onPomodoroCompleted();
      const rest = (this.state.settings.pomodoro && this.state.settings.pomodoro.rest) || 5;
      this._pomo = { phase: 'rest', remain: rest * 60, total: rest * 60 };
      this.fsm?.notify({ scene: 'pomo-end', sfx: 'pomo_end' });
    } else {
      // 休息结束：回空闲
      this._pomo = { phase: 'idle', remain: 0, total: 0 };
      this.bubble?.hideBadge();
      this.bubble?.say('休息结束，元气满满！', 4000);
    }
    this._renderBadge();
    this.onPomoChange(this.pomodoro);
  }

  _renderBadge() {
    if (this._pomo.phase === 'idle') return;
    const sec = Math.max(0, Math.ceil(this._pomo.remain));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    const label = this._pomo.phase === 'focus' ? '番茄' : '休息';
    this.bubble?.badge(`${label} ${mm}:${ss}`);
  }
}
