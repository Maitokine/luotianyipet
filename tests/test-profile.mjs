// M0 测试：档案默认值 / 迁移 / 校验 / 经验等级表 / 好感档位
import {
  defaultProfile, migrate, validate, expThreshold, levelFromExp, affectionTier,
} from '../src/shared/profile.js';

export async function run(t) {
  const p = defaultProfile();
  t.ok(p.version === 1, 'defaultProfile version = 1');
  t.ok(p.level === 1 && p.exp === 0, '初始等级 1 / 经验 0');
  t.ok(p.affection === 10, '初始好感 10（陌生档）');
  t.ok(p.settings.alwaysOnTop === true, '默认置顶');
  t.ok(p.settings.clickThrough === false, '默认不穿透');
  t.ok(p.settings.danceWithMusic === true, '默认开启跟音乐跳舞');
  t.ok(p.settings.sitting.minutes === 60, '久坐默认 60 分钟');
  t.ok(p.settings.water.minutes === 90, '喝水默认 90 分钟');
  t.ok(p.settings.pomodoro.focus === 25 && p.settings.pomodoro.rest === 5, '番茄钟默认 25+5');
  t.ok(Array.isArray(p.unlocked) && p.unlocked.includes('outfit_default'), '默认解锁初始服装');

  // 经验阈值表（PRD §5.5）
  t.eq(expThreshold(1), 0, 'Lv1 阈值 0');
  t.eq(expThreshold(2), 120, 'Lv2 阈值 120');
  t.eq(expThreshold(3), 300, 'Lv3 阈值 300');
  t.eq(expThreshold(8), 2800, 'Lv8 阈值 2800');
  t.eq(expThreshold(9), 3600, 'Lv9 阈值 3600（+800）');
  t.eq(expThreshold(10), 4400, 'Lv10 阈值 4400');

  t.eq(levelFromExp(0), 1, 'exp 0 → Lv1');
  t.eq(levelFromExp(119), 1, 'exp 119 → Lv1');
  t.eq(levelFromExp(120), 2, 'exp 120 → Lv2');
  t.eq(levelFromExp(299), 2, 'exp 299 → Lv2');
  t.eq(levelFromExp(300), 3, 'exp 300 → Lv3');
  t.eq(levelFromExp(2800), 8, 'exp 2800 → Lv8');
  t.eq(levelFromExp(3600), 9, 'exp 3600 → Lv9');

  // 好感档位（PRD §5.5 五档边界）
  t.eq(affectionTier(0).key, 'stranger', '0 → 陌生');
  t.eq(affectionTier(19).key, 'stranger', '19 → 陌生');
  t.eq(affectionTier(20).key, 'familiar', '20 → 熟悉');
  t.eq(affectionTier(59).key, 'friend', '59 → 朋友');
  t.eq(affectionTier(60).key, 'close', '60 → 亲密');
  t.eq(affectionTier(80).key, 'beloved', '80 → 挚爱');
  t.eq(affectionTier(100).key, 'beloved', '100 → 挚爱');

  // 迁移：空对象 → 完整默认结构
  const m = migrate({});
  t.ok(m.settings && m.settings.sitting.minutes === 60, 'migrate({}) 补齐 settings');
  t.ok(Array.isArray(m.notes) && Array.isArray(m.unlocked), 'migrate({}) 补齐数组字段');

  // 迁移：老档案保留有效值、补齐缺失字段
  const old = migrate({ level: 3, exp: 300, affection: 55, settings: { scale: 1.4 } });
  t.ok(old.level === 3 && old.exp === 300, '老档案有效值保留');
  t.ok(old.settings.scale === 1.4, '老档案已有设置保留');
  t.ok(old.settings.water.minutes === 90, '老档案缺失设置补默认');

  // 校验：越界值清洗
  const v = validate({
    ...defaultProfile(), affection: 150, outfit: 'hacker',
    settings: { ...defaultProfile().settings, scale: 3, opacity: 0.05 },
    notes: [{ text: 'ok' }, null, { text: '  ' }, { noText: 1 }],
  });
  t.eq(v.affection, 100, '好感越界钳制 100');
  t.eq(v.outfit, 'default', '非法服装回退 default');
  t.eq(v.settings.scale, 2.0, '缩放越界钳制 2.0');
  t.eq(v.settings.opacity, 0.2, '透明度越界钳制 0.2');
  t.eq(v.notes.length, 1, '无效便签被过滤');

  // 等级与经验不一致时以经验为准
  const v2 = validate({ ...defaultProfile(), level: 1, exp: 300 });
  t.eq(v2.level, 3, '等级按经验重算');

  // 今日陪伴分钟（T5.4）：缺失兜底 + 越界清洗
  {
    const p1 = migrate({ ...defaultProfile(), todayMinutes: null });
    t.eq(p1.todayMinutes, { date: '', count: 0 }, '缺失 todayMinutes 补默认');
    const p2 = migrate({ ...defaultProfile(), todayMinutes: { date: '2026-1-10', count: -7 } });
    t.eq(p2.todayMinutes, { date: '2026-1-10', count: 0 }, '负数分钟钳制为 0');
    const p3 = migrate({ ...defaultProfile(), todayMinutes: { date: 'x', count: '12' } });
    t.eq(p3.todayMinutes.count, 12, '字符串数字被规整');
  }
}
