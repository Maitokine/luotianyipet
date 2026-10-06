// 成长引擎（M3 / T3.1）：经验四来源 + 升级解锁 + 好感五档/日上限/48h 衰减
// 纯逻辑（now/rand 可注入，Node 可测）；状态变更经 onPersist 落档（store 防抖）
import { expThreshold, levelFromExp, affectionTier, AFFECTION_TIERS } from '../../shared/profile.js';

export const DAY_MS = 86400000;
export const DECAY_GRACE_MS = 48 * 3600000;  // 连续 48h 无互动后开始衰减
export const DECAY_PER_DAY = 5;              // 每天衰减量
export const AFFECTION_DAILY_CAP = 30;       // 单击好感日上限
export const CLICK_GAIN_COOLDOWN_MS = 10000; // 10s 内连点不重复计（A13）

export const EXP_REWARDS = { companionMinute: 1, click: 2, song: 15, pomodoro: 10 };
export const AFFECTION_REWARDS = { click: 1, song: 3, pomodoro: 2 };

// 解锁表（PRD §5.5）——当前仅保留默认装
// 注：跳舞（dance）已按用户要求解除等级限制（检测到系统媒体播放即跳），不再作为 Lv.3 解锁项
export const UNLOCKS = [
  { level: 1, id: 'outfit_default', label: '洛天依 · 默认装' },
  { level: 2, id: 'lines_lively', label: '活泼台词包' },
  { level: 6, id: 'dance_moves', label: '花式舞步包' },
  { level: 7, id: 'air_spin', label: '空中旋转特技' },
];

export function unlocksForLevel(level) {
  return UNLOCKS.filter((u) => u.level === level);
}

function localDateStr(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export class Growth {
  constructor({ state, now = () => Date.now(), rand = Math.random, onEvent = null, onPersist = null } = {}) {
    this.state = state;
    this.now = now;
    this.rand = rand;
    this.onEvent = onEvent || (() => {});
    this.onPersist = onPersist || (() => {});
    this._minuteAcc = 0;     // 陪伴分钟累加器（秒）
    this._lastClickGainAt = 0;
    this._hourAcc = 0;       // 衰减检查小时累加器
  }

  // ---------- 读取 ----------
  get level() { return this.state.level; }
  get exp() { return this.state.exp; }
  get affection() { return this.state.affection; }
  tierKey() { return affectionTier(this.state.affection).key; }
  tierLabel() { return affectionTier(this.state.affection).label; }
  expProgress() {
    const lv = this.state.level;
    const cur = expThreshold(lv);
    const next = expThreshold(lv + 1);
    if (next <= cur) return { cur, next: cur, pct: 1 };
    return { cur, next, pct: (this.state.exp - cur) / (next - cur) };
  }
  isUnlocked(id) { return this.state.unlocked.includes(id); }

  // 状态广播刷新（FIFO 广播保证不回退）
  syncState(s) { if (s) this.state = s; }

  // ---------- 主循环：陪伴经验 + 定期衰减 ----------
  tick(dtSec) {
    this._minuteAcc += dtSec;
    this._hourAcc += dtSec;
    while (this._minuteAcc >= 60) {
      this._minuteAcc -= 60;
      this.state.totalMinutes += 1;
      this._tickTodayMinutes(); // 今日陪伴统计（设置页成长页显示）
      this.addExp(EXP_REWARDS.companionMinute);
    }
    if (this._hourAcc >= 3600) {
      this._hourAcc = 0;
      this.applyDecay();
    }
    if (this._dirty) this._flush();
  }

  _tickTodayMinutes() {
    const today = localDateStr(this.now());
    if (this.state.todayMinutes.date !== today) {
      this.state.todayMinutes = { date: today, count: 0 };
    }
    this.state.todayMinutes.count += 1;
  }

  // ---------- 互动来源 ----------

  // 任何用户互动（点击/拖拽/双击）：重置衰减计时（fsm._markInteraction 调用）
  onActivity() {
    this.state.lastInteractionAt = this.now();
    this.state.decayCharged = 0;
    this._flush();
  }

  // 单击（A13）：10s 内连点不重复计；好感受日上限 30 约束
  onPetClick() {
    const now = this.now();
    this.state.totalClicks += 1;
    this.onActivity();
    let gained = null;
    if (now - this._lastClickGainAt >= CLICK_GAIN_COOLDOWN_MS) {
      this._lastClickGainAt = now;
      const aff = this._gainAffectionToday(AFFECTION_REWARDS.click);
      this.addExp(EXP_REWARDS.click);
      gained = { exp: EXP_REWARDS.click, affection: aff };
    }
    this._flush();
    return gained;
  }

  // 听完一首歌（播放 ≥60%，music 模块调用）
  onSongCompleted() {
    this.state.songsCompleted += 1;
    this.onActivity();
    const aff = this._addAffection(AFFECTION_REWARDS.song);
    this.addExp(EXP_REWARDS.song);
    this._flush();
    return { exp: EXP_REWARDS.song, affection: aff };
  }

  // 完成番茄钟
  onPomodoroCompleted() {
    this.state.pomodorosDone += 1;
    this.onActivity();
    const aff = this._addAffection(AFFECTION_REWARDS.pomodoro);
    this.addExp(EXP_REWARDS.pomodoro);
    this._flush();
    return { exp: EXP_REWARDS.pomodoro, affection: aff };
  }

  // ---------- 衰减（48h 无互动 → 每天 -5，最低 0） ----------
  // 记账模型：decayCharged = 本轮冷落已计费期数；任何互动清零重新计 48h
  applyDecay(atMs = null) {
    const now = atMs ?? this.now();
    const s = this.state;
    const baseline = s.lastInteractionAt || s.createdAt || now;
    const sinceMs = now - baseline - DECAY_GRACE_MS;
    if (sinceMs < 0) return 0;
    const owed = Math.floor(sinceMs / DAY_MS) + 1; // 满 48h 即计第一期，其后每 24h 一期
    const uncharged = owed - (s.decayCharged || 0);
    if (uncharged <= 0) return 0;
    const amount = Math.min(uncharged * DECAY_PER_DAY, s.affection);
    if (amount <= 0) return 0;
    const before = s.affection;
    s.affection -= amount;
    s.decayCharged = owed;
    this._dirty = true;
    this.onEvent('decay', { amount: before - s.affection, affection: s.affection });
    this._flush();
    return before - s.affection;
  }

  // ---------- 数值核心 ----------
  addExp(n) {
    if (n <= 0) return null;
    const s = this.state;
    s.exp += n;
    const newLevel = levelFromExp(s.exp);
    let result = null;
    if (newLevel > s.level) {
      const from = s.level;
      s.level = newLevel;
      // 逐级解锁（跨多级时全部补齐）
      const gained = [];
      for (let lv = from + 1; lv <= newLevel; lv += 1) {
        for (const u of unlocksForLevel(lv)) {
          if (!s.unlocked.includes(u.id)) { s.unlocked.push(u.id); gained.push(u); }
        }
      }
      result = { from, to: newLevel, unlocked: gained };
      this.onEvent('levelup', result);
    }
    this._dirty = true;
    return result;
  }

  _addAffection(n) {
    const s = this.state;
    const before = s.affection;
    s.affection = Math.min(100, s.affection + n);
    const gained = s.affection - before;
    if (gained > 0) {
      const tier = affectionTier(s.affection).key;
      const prev = affectionTier(before).key;
      if (tier !== prev) this.onEvent('tier', { tier, prev });
      this._dirty = true;
    }
    return gained;
  }

  // 单击好感：受每日上限（仅单击来源受限）
  _gainAffectionToday(n) {
    const s = this.state;
    const today = localDateStr(this.now());
    if (s.affectionToday.date !== today) {
      s.affectionToday = { date: today, count: 0 };
    }
    if (s.affectionToday.count >= AFFECTION_DAILY_CAP) return 0;
    const before = s.affection;
    const gained = this._addAffection(n);
    s.affectionToday.count += gained;
    if (s.affectionToday.count > AFFECTION_DAILY_CAP) s.affectionToday.count = AFFECTION_DAILY_CAP;
    return gained;
  }

  // ---------- 落档 ----------
  _flush() {
    this._dirty = false;
    const s = this.state;
    this.onPersist({
      level: s.level,
      exp: s.exp,
      affection: s.affection,
      totalMinutes: s.totalMinutes,
      totalClicks: s.totalClicks,
      songsCompleted: s.songsCompleted,
      pomodorosDone: s.pomodorosDone,
      unlocked: [...s.unlocked],
      affectionToday: { ...s.affectionToday },
      todayMinutes: { ...s.todayMinutes },
      lastInteractionAt: s.lastInteractionAt,
      decayCharged: s.decayCharged,
    });
  }
}
