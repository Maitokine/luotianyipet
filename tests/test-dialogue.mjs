// dialogue.js 单测：台词库结构完整性（17 场景 × 5 档 × ≥5 句）、抽取器不重复、活泼包（A14）
import { LINES, LIVELY_LINES, SCENES, TIERS, Dialogue } from '../src/renderer/js/dialogue.js';

export function run(t) {
  // ---- 结构完整性（防内容损坏：每格必须是 ≥5 句的非空字符串数组） ----
  const expectedScenes = [
    'click', 'thrown', 'sing-start', 'sing-end', 'wake', 'battery-low', 'cpu-high',
    'sit-long', 'water', 'pomo-start', 'pomo-end', 'note-due', 'dance', 'levelup',
    'return', 'hum-start', 'sleep-start',
  ];
  t.eq(SCENES.length, expectedScenes.length, `场景数 ${expectedScenes.length}`);
  for (const s of expectedScenes) {
    t.ok(SCENES.includes(s), `场景存在：${s}`);
  }
  let cellCount = 0;
  for (const scene of SCENES) {
    const cell = LINES[scene];
    t.ok(cell && typeof cell === 'object', `${scene}：有词条`);
    for (const tier of TIERS) {
      const arr = cell[tier];
      cellCount += 1;
      t.ok(Array.isArray(arr), `${scene}/${tier}：是数组`);
      t.ok(arr.length >= 5, `${scene}/${tier}：≥5 句（实际 ${arr?.length}）`);
      t.ok(arr.every((l) => typeof l === 'string' && l.trim().length > 0), `${scene}/${tier}：句子非空`);
      t.eq(new Set(arr).size, arr.length, `${scene}/${tier}：无重复句`);
    }
  }
  t.eq(cellCount, SCENES.length * 5, '基础包格子总数');

  // 活泼包：场景必须是基础包子集，每格 ≥2 句
  for (const scene of Object.keys(LIVELY_LINES)) {
    t.ok(SCENES.includes(scene), `活泼包场景在基础包内：${scene}`);
    for (const tier of TIERS) {
      const arr = LIVELY_LINES[scene][tier];
      t.ok(Array.isArray(arr) && arr.length >= 2, `活泼包 ${scene}/${tier}：≥2 句`);
      const base = LINES[scene][tier];
      t.ok(arr.every((l) => !base.includes(l)), `活泼包 ${scene}/${tier}：不与基础包重复`);
    }
  }

  // ---- A14：不同档位台词风格明显不同（池不相交） ----
  for (const scene of ['click', 'thrown', 'wake', 'return']) {
    const stranger = LINES[scene].stranger;
    const beloved = LINES[scene].beloved;
    const overlap = stranger.filter((l) => beloved.includes(l));
    t.eq(overlap.length, 0, `${scene}：陌生与挚爱台词无重叠`);
  }

  // ---- Dialogue 抽取器 ----
  {
    const d = new Dialogue({});
    const line = d.pick('click', 'stranger', () => 0);
    t.ok(LINES.click.stranger.includes(line), 'pick 返回池内句子');
    t.eq(line, LINES.click.stranger[0], 'rand=0 取第一句');
    const last = d.pick('click', 'stranger', () => 0.999);
    t.eq(last, LINES.click.stranger[LINES.click.stranger.length - 1], 'rand→1 取末句');
  }
  {
    // 短期不重复：rand=0 时顺序消费池子，最近 3 句不重出
    const d = new Dialogue({});
    const pool = LINES.water.friend; // 5 句
    const picks = [];
    for (let i = 0; i < 4; i++) picks.push(d.pick('water', 'friend', () => 0));
    t.eq(new Set(picks).size, 4, '连续 4 次抽取互不重复');
    t.ok(picks.every((p) => pool.includes(p)), '均在池内');
    // 用尽候选后放宽（池 5 句、最近 3 句 → 始终有候选，但 6 连抽后必然复用）
    const more = [];
    for (let i = 0; i < 6; i++) more.push(d.pick('water', 'friend', () => 0));
    t.ok(more.length === 6, '池耗尽后仍能出句（放宽限制）');
  }
  {
    // 场景间互不影响
    const d = new Dialogue({});
    d.pick('click', 'friend', () => 0);
    const line = d.pick('dance', 'friend', () => 0);
    t.eq(line, LINES.dance.friend[0], '场景间不重复记录独立');
  }
  {
    // 未知场景 / 未知档位
    const d = new Dialogue({});
    t.eq(d.pick('nope', 'friend'), null, '未知场景返回 null');
    t.eq(d.pool('click', 'bogus'), LINES.click.friend, '未知档位回退 friend 池');
  }
  {
    // 活泼台词包开关（Lv2 解锁）
    const d = new Dialogue({});
    t.eq(d.pool('click', 'stranger').length, 5, '默认基础池 5 句');
    d.setLively(true);
    t.eq(d.pool('click', 'stranger').length, 7, '活泼包 +2 句');
    t.ok(d.pool('click', 'stranger').includes(LIVELY_LINES.click.stranger[0]), '含活泼句');
    d.setLively(false);
    t.eq(d.pool('click', 'stranger').length, 5, '关闭后回到基础池');
    t.eq(d.pool('wake', 'stranger').length, 5, '无活泼包场景不受影响');
  }
}
