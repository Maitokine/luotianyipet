// growth.js 单测：经验来源/升级解锁（A15）/好感日上限（A13）/48h 衰减/落档
import { Growth, EXP_REWARDS, AFFECTION_REWARDS, AFFECTION_DAILY_CAP,
  CLICK_GAIN_COOLDOWN_MS, DECAY_PER_DAY, DECAY_GRACE_MS, UNLOCKS, unlocksForLevel }
  from '../src/renderer/js/growth.js';
import { defaultProfile, migrate, levelFromExp } from '../src/shared/profile.js';

const HOUR = 3600000;

function setup({ nowMs = 1000000000000, stateOver = {}, onEvent } = {}) {
  // createdAt/lastInteractionAt 对齐注入时钟（defaultProfile 用真实 Date.now，会与时钟错位）
  const state = migrate({
    ...defaultProfile(),
    createdAt: nowMs,
    lastInteractionAt: nowMs,
    ...stateOver,
  });
  let clock = nowMs;
  const patches = [];
  const events = [];
  const growth = new Growth({
    state,
    now: () => clock,
    onEvent: (type, ev) => { events.push({ type, ev }); onEvent?.(type, ev); },
    onPersist: (p) => patches.push(p),
  });
  const advance = (ms) => { clock += ms; };
  growth.advance = advance; // 测试便利：推进注入时钟
  return {
    growth, state, events, patches, advance,
    set clock(v) { clock = v; },
    get clock() { return clock; },
  };
}

// 与 growth 内部一致的本地日期串
function dateStrOf(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function run(t) {
  // ---- 常量与 PRD §5.5 对齐 ----
  t.eq(EXP_REWARDS, { companionMinute: 1, click: 2, song: 15, pomodoro: 10 }, '经验四来源数值');
  t.eq(AFFECTION_REWARDS, { click: 1, song: 3, pomodoro: 2 }, '好感三来源数值');
  t.eq(AFFECTION_DAILY_CAP, 30, '单击好感日上限 30');
  t.eq(CLICK_GAIN_COOLDOWN_MS, 10000, '单击 10s 冷却');
  t.eq(DECAY_PER_DAY, 5, '冷落每天 -5');
  t.eq(DECAY_GRACE_MS, 48 * HOUR, '冷落宽限 48h');
  t.eq(unlocksForLevel(3).map((u) => u.id), ['dance', 'outfit_spring'], 'Lv3 解锁跳舞+春日裙');
  t.eq(UNLOCKS.find((u) => u.id === 'outfit_star').level, 5, '星海礼服 Lv5');
  t.eq(UNLOCKS.find((u) => u.id === 'air_spin').level, 7, '空中旋转 Lv7');

  // ---- 陪伴经验：每分钟 +1 ----
  {
    const { growth, state, patches } = setup();
    growth.tick(30);
    t.eq(state.exp, 0, '30s 无经验');
    growth.tick(30);
    t.eq(state.exp, 1, '满 60s +1 经验');
    t.eq(state.totalMinutes, 1, '陪伴分钟 +1');
    growth.tick(120);
    t.eq(state.exp, 3, '累计 3 分钟 +3');
    t.ok(patches.length > 0, 'tick 落档');
    const last = patches[patches.length - 1];
    t.eq(last.exp, 3, '落档含最新经验');
  }

  // ---- 今日陪伴分钟（T5.4 设置页成长页显示）----
  {
    const rig = setup();
    const { growth, state, patches } = rig;
    growth.tick(180);
    t.eq(state.todayMinutes.count, 3, '3 分钟陪伴 → 今日 +3');
    const today = dateStrOf(rig.clock);
    t.eq(state.todayMinutes.date, today, '日期记录为今天');
    const last = patches[patches.length - 1];
    t.eq(last.todayMinutes, { date: today, count: 3 }, '今日陪伴已落档');
    // 跨天重置（总分钟继续累计）
    growth.advance(24 * HOUR + 60000);
    growth.tick(60);
    t.ok(state.todayMinutes.date !== today, '跨天后日期更新');
    t.eq(state.todayMinutes.count, 1, '今日计数从 1 重新开始');
    t.eq(state.totalMinutes, 4, '总陪伴分钟跨天累计');
  }

  // ---- 单击：10s 冷却 + 好感日上限 ----
  {
    const { growth, state } = setup();
    const g1 = growth.onPetClick();
    t.eq(g1, { exp: 2, affection: 1 }, '首次单击 +2 经验 +1 好感');
    t.eq(state.totalClicks, 1, '互动次数 +1');
    t.eq(state.affection, 11, '好感 10→11');
    growth.onPetClick();
    growth.onPetClick();
    t.eq(state.totalClicks, 3, '连点也计数');
    t.eq(state.exp, 2, '10s 内连点不加经验');
    t.eq(state.affection, 11, '10s 内连点不加好感');
    growth.advance(10001);
    const g2 = growth.onPetClick();
    t.eq(g2, { exp: 2, affection: 1 }, '冷却后再次生效');
  }
  {
    // 日上限 30：补到 29 后只加最后一次
    const { growth, state } = setup({ stateOver: { affection: 50 } });
    state.affectionToday = { date: dateStrOf(1000000000000), count: 29 };
    const g1 = growth.onPetClick();
    t.eq(g1.affection, 1, '第 30 次仍加');
    t.eq(state.affectionToday.count, 30, '计数到 30');
    growth.advance(10001);
    const g2 = growth.onPetClick();
    t.eq(g2.affection, 0, '超上限好感 +0');
    t.eq(g2.exp, 2, '经验不受上限影响');
    // 跨天重置
    growth.advance(24 * HOUR + 10001);
    const g3 = growth.onPetClick();
    t.eq(g3.affection, 1, '次日计数重置');
    t.eq(state.affectionToday.count, 1, '新一天从 1 开始');
  }

  // ---- 听歌 / 番茄钟 ----
  {
    const { growth, state } = setup({ stateOver: { affection: 50 } });
    const g1 = growth.onSongCompleted();
    t.eq(g1, { exp: 15, affection: 3 }, '听完歌 +15 经验 +3 好感');
    t.eq(state.songsCompleted, 1, '听歌数 +1');
    // 听歌好感不受日上限约束（PRD 仅单击受限）
    state.affectionToday = { date: '', count: 30 };
    growth.advance(1000);
    const g2 = growth.onSongCompleted();
    t.eq(g2.affection, 3, '听歌好感不受日上限约束');
    const g3 = growth.onPomodoroCompleted();
    t.eq(g3, { exp: 10, affection: 2 }, '番茄钟 +10 经验 +2 好感');
    t.eq(state.pomodorosDone, 1, '番茄数 +1');
  }

  // ---- 好感封顶与档位事件 ----
  {
    const { growth, state, events } = setup({ stateOver: { affection: 78 } });
    growth.onSongCompleted();
    t.eq(state.affection, 81, '78+3 → 81');
    const tier = events.find((e) => e.type === 'tier');
    t.ok(tier, '触发档位事件');
    t.eq(tier.ev, { tier: 'beloved', prev: 'close' }, 'close → beloved');
  }
  {
    const { growth, state } = setup({ stateOver: { affection: 99 } });
    growth.onSongCompleted();
    t.eq(state.affection, 100, '好感封顶 100（不溢出）');
  }
  {
    const { growth, events } = setup({ stateOver: { affection: 19 } });
    growth._addAffection(1);
    const tier = events.find((e) => e.type === 'tier');
    t.eq(tier.ev.tier, 'familiar', 'stranger → familiar');
  }

  // ---- 升级与解锁（A15） ----
  {
    const { growth, state, events } = setup();
    growth.addExp(120);
    t.eq(state.level, 2, '经验 120 → Lv2');
    const lu = events.find((e) => e.type === 'levelup');
    t.eq(lu.ev.from, 1, 'from 1');
    t.eq(lu.ev.to, 2, 'to 2');
    t.eq(lu.ev.unlocked.map((u) => u.id), ['lines_lively'], 'Lv2 解锁活泼台词包');
    t.ok(state.unlocked.includes('lines_lively'), 'unlocked 数组更新');
    growth.addExp(180); // 300
    t.eq(state.level, 3, '经验 300 → Lv3');
    const ids = state.unlocked;
    t.ok(ids.includes('dance') && ids.includes('outfit_spring'), 'Lv3 解锁跳舞与春日裙');
  }
  {
    // 跨多级一次性补齐
    const { growth, state, events } = setup();
    growth.addExp(2800);
    t.eq(state.level, 8, '经验 2800 → Lv8');
    const lu = events.filter((e) => e.type === 'levelup');
    t.eq(lu.length, 1, '一次 addExp 只发一次事件');
    t.eq(lu[0].ev.to, 8, '事件目标等级 8');
    for (const id of ['lines_lively', 'dance', 'outfit_spring', 'outfit_star', 'dance_moves', 'air_spin']) {
      t.ok(state.unlocked.includes(id), `跨级补齐解锁 ${id}`);
    }
    t.eq(state.level, levelFromExp(state.exp), '等级与经验一致');
  }
  {
    // Lv9 曲线（2800 + 800）
    const { growth, state } = setup();
    growth.addExp(3600);
    t.eq(state.level, 9, '经验 3600 → Lv9（+800 曲线）');
  }

  // ---- 衰减（48h 宽限 → 每天 -5 → 最低 0） ----
  {
    const { growth, state } = setup({ stateOver: { affection: 100 } });
    t.eq(growth.applyDecay(), 0, '48h 内无衰减');
    growth.advance(48 * HOUR + 1);
    t.eq(growth.applyDecay(), 5, '满 48h 第一期 -5');
    t.eq(state.affection, 95, '好感 95');
    t.eq(growth.applyDecay(), 0, '同期不重复扣');
    growth.advance(24 * HOUR);
    t.eq(growth.applyDecay(), 5, '再过一天 -5');
    t.eq(state.affection, 90, '好感 90');
    // 互动重置
    growth.onActivity();
    t.eq(state.decayCharged, 0, '互动清零记账');
    t.eq(growth.applyDecay(), 0, '互动后重新计 48h');
  }
  {
    // 最低 0 不跑路
    const { growth, state } = setup({ stateOver: { affection: 3 } });
    growth.advance(48 * HOUR + 1);
    t.eq(growth.applyDecay(), 3, '只扣到 0');
    t.eq(state.affection, 0, '好感最低 0（不会跑路）');
  }
  {
    // 长期离开一次性补扣：5 天 = 48h 宽限 + 4 期
    const { growth, state } = setup({ stateOver: { affection: 100 } });
    growth.advance(120 * HOUR);
    t.eq(growth.applyDecay(), 20, '离开 5 天一次性 -20');
    t.eq(state.affection, 80, '好感 80');
  }
  {
    // 从未互动过：以创建时间为基准
    const { growth, state } = setup({ stateOver: { lastInteractionAt: 0, affection: 50 } });
    growth.advance(49 * HOUR);
    t.eq(growth.applyDecay(), 5, '未互动过按创建时间起算');
    t.eq(state.affection, 45, '好感 45');
  }

  // ---- 读取接口 ----
  {
    const { growth } = setup({ stateOver: { exp: 60, level: 1, affection: 85 } });
    const p = growth.expProgress();
    t.eq(p.cur, 0, '当前级阈值 0');
    t.eq(p.next, 120, '下一级阈值 120');
    t.close(p.pct, 0.5, 1e-9, '进度 50%');
    t.eq(growth.tierKey(), 'beloved', '档位 key');
    t.eq(growth.tierLabel(), '挚爱', '档位名');
    t.eq(growth.isUnlocked('outfit_default'), true, '默认装已解锁');
    t.eq(growth.isUnlocked('outfit_star'), false, '星海礼服未解锁');
  }

  // ---- syncState ----
  {
    const { growth } = setup();
    // migrate 强制 level/exp 一致：Lv5 对应经验阈值 1000
    const fresh = migrate({ ...defaultProfile(), level: 5, exp: 1000 });
    t.eq(fresh.level, 5, '前置：迁移后等级为 5');
    growth.syncState(fresh);
    t.eq(growth.level, 5, 'syncState 刷新状态引用');
  }
}
