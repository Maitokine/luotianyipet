// reminders.js 单测：久坐/喝水累计器、便签到点/每天重复/一次性、番茄钟状态机与徽章（A23/A24/A25）
import {
  Reminders, todayStr, slotToday, stampNote, makeNoteId, createNote, NOTE_TIME_RE,
} from '../src/renderer/js/reminders.js';
import { defaultProfile } from '../src/shared/profile.js';

const BASE = new Date(2026, 0, 10, 10, 0, 0).getTime(); // 2026-01-10 10:00 本地
const DAY = 86400000;

function makeClock(start = BASE) {
  let nowMs = start;
  return { now: () => nowMs, set: (v) => { nowMs = v; }, add: (v) => { nowMs += v; } };
}

function makeFsm() {
  const calls = { notify: [] };
  return { calls, notify(opts) { calls.notify.push({ ...opts }); return true; } };
}

function makeBubble() {
  const calls = { badge: [], say: [], hideBadge: 0 };
  return {
    calls,
    badge(text) { calls.badge.push(text); },
    hideBadge() { calls.hideBadge += 1; },
    say(text, ms) { calls.say.push({ text, ms }); },
  };
}

function makeGrowth() {
  return { pomo: 0, onPomodoroCompleted() { this.pomo += 1; return true; } };
}

function makeRig({ state = defaultProfile(), now, notes } = {}) {
  if (notes) state.notes = notes;
  // 默认关闭久坐/喝水，避免各测试互相污染；对应测试自行开启
  state.settings.sitting.enabled = false;
  state.settings.water.enabled = false;
  const fsm = makeFsm();
  const bubble = makeBubble();
  const growth = makeGrowth();
  const patches = [];
  const pomoChanges = [];
  const r = new Reminders({
    state, fsm, bubble, growth,
    now: now || (() => BASE),
    onPersist: (p) => patches.push(p),
    onPomoChange: (p) => pomoChanges.push(p),
  });
  return { r, state, fsm, bubble, growth, patches, pomoChanges };
}

function tickN(r, n, dt = 1) { for (let i = 0; i < n; i += 1) r.tick(dt); }

export function run(t) {
  // ---------- 纯函数 ----------

  // slotToday：合法时间
  {
    const want = new Date(2026, 0, 10, 12, 0, 0).getTime();
    t.eq(slotToday('12:00', BASE), want, 'slotToday 12:00 → 今天 12:00 时间戳');
    t.eq(slotToday('9:05', BASE), new Date(2026, 0, 10, 9, 5).getTime(), '单位数小时 9:05 合法');
    t.eq(slotToday('0:00', BASE), new Date(2026, 0, 10, 0, 0).getTime(), '0:00 合法');
    t.eq(slotToday('23:59', BASE), new Date(2026, 0, 10, 23, 59).getTime(), '23:59 合法');
    t.eq(slotToday(' 12:00 ', BASE), new Date(2026, 0, 10, 12, 0).getTime(), '容忍首尾空格');
  }
  // slotToday：非法时间
  {
    t.eq(slotToday('24:00', BASE), null, '24:00 非法');
    t.eq(slotToday('12:60', BASE), null, '12:60 非法');
    t.eq(slotToday('12', BASE), null, '缺分钟非法');
    t.eq(slotToday('', BASE), null, '空串非法');
    t.eq(slotToday(null, BASE), null, 'null 非法');
    t.eq(slotToday('ab:cd', BASE), null, '非数字非法');
    t.ok(NOTE_TIME_RE.test('09:30'), '正则接受 09:30');
    t.ok(!NOTE_TIME_RE.test('9:30:00'), '正则拒绝多余段');
  }
  // todayStr
  t.eq(todayStr(BASE), '2026-1-10', 'todayStr 输出 YYYY-M-D');
  t.eq(todayStr(BASE + DAY), '2026-1-11', 'todayStr 跨天正确');

  // stampNote：今天时刻已过 → 标记今天已消费
  {
    const n = stampNote({ text: 'a', time: '08:00' }, BASE); // 现在 10:00
    t.eq(n.lastFire, '2026-1-10', '已过时刻补今天戳');
    const n2 = stampNote({ text: 'a', time: '15:00' }, BASE);
    t.eq(n2.lastFire, undefined, '未来时刻不补戳');
    const n3 = stampNote({ text: 'a', time: '08:00', lastFire: '2026-1-10' }, BASE);
    t.eq(n3.lastFire, '2026-1-10', '已有今日戳不重复处理');
    const n4 = stampNote({ text: 'a', time: '99:99' }, BASE);
    t.eq(n4.lastFire, undefined, '非法时间不补戳');
  }
  // makeNoteId
  {
    const id1 = makeNoteId(BASE, () => 0.1);
    const id2 = makeNoteId(BASE, () => 0.9);
    t.ok(typeof id1 === 'string' && id1.length > 0, '便签 id 为非空字符串');
    t.ok(id1 !== id2, '不同 rand 生成不同 id');
  }

  // createNote：设置页表单校验 + 构造（T5.4）
  {
    const r = createNote({ text: '  开会  ', time: '15:00', repeatDaily: true, nowMs: BASE });
    t.eq(r.ok, true, '合法输入通过');
    t.eq(r.note.text, '开会', '内容去首尾空格');
    t.eq(r.note.time, '15:00', '时间保留');
    t.eq(r.note.repeatDaily, true, '每天重复保留');
    t.eq(r.note.lastFire, '', '未来时刻不戳记');
    t.ok(typeof r.note.id === 'string' && r.note.id.length > 0, '自动生成 id');

    t.eq(createNote({ text: '   ', time: '15:00', nowMs: BASE }),
      { ok: false, error: '请填写提醒内容' }, '空内容报错');
    t.eq(createNote({ text: 'x'.repeat(41), time: '15:00', nowMs: BASE }),
      { ok: false, error: '提醒内容最多 40 字' }, '超 40 字报错');
    t.eq(createNote({ text: 'x', time: '', nowMs: BASE }),
      { ok: false, error: '请选择有效的提醒时间' }, '空时间报错');
    t.eq(createNote({ text: 'x', time: '25:00', nowMs: BASE }),
      { ok: false, error: '请选择有效的提醒时间' }, '非法时间报错');

    const past = createNote({ text: 'x', time: '08:00', nowMs: BASE });
    t.eq(past.note.lastFire, '2026-1-10', '已过时刻创建即戳记今天（次日再触发）');

    const a = createNote({ text: 'x', time: '15:00', nowMs: BASE, rand: () => 0.1 });
    const b = createNote({ text: 'x', time: '15:00', nowMs: BASE, rand: () => 0.9 });
    t.ok(a.note.id !== b.note.id, '两次创建 id 不同');
  }

  // ---------- 久坐提醒（累计器模型） ----------

  // 满 60 分钟触发一次
  {
    const { r, fsm, state, patches } = makeRig();
    state.settings.sitting.enabled = true;
    tickN(r, 3599);
    t.eq(fsm.calls.notify.length, 0, '久坐 59:59 未触发');
    r.tick(1);
    t.eq(fsm.calls.notify.length, 1, '满 60 分钟触发');
    t.eq(fsm.calls.notify[0].scene, 'sit-long', '触发 sit-long 场景台词');
    t.eq(fsm.calls.notify[0].sfx, 'alert', '触发 alert 音效');
    t.eq(state.sittingLastFire, BASE, 'sittingLastFire 记录触发时刻');
    t.eq(patches[patches.length - 1], { sittingLastFire: BASE }, '触发时间已落档');
    // 触发后重新计数
    tickN(r, 3599);
    t.eq(fsm.calls.notify.length, 1, '触发后重新累计，未到间隔不再触发');
    r.tick(1);
    t.eq(fsm.calls.notify.length, 2, '下一间隔再次触发');
  }

  // 关闭开关：不触发且清零累计
  {
    const { r, fsm, state } = makeRig();
    state.settings.sitting.enabled = true;
    tickN(r, 3000); // 累计 50 分钟
    state.settings.sitting.enabled = false;
    tickN(r, 100);  // 关闭期间累计清零
    state.settings.sitting.enabled = true;
    tickN(r, 3000);
    t.eq(fsm.calls.notify.length, 0, '关闭过开关后从零重新计（3000s < 3600s）');
    tickN(r, 600);
    t.eq(fsm.calls.notify.length, 1, '重新计满 60 分钟触发');
  }

  // 缩短间隔：立即按新间隔触发
  {
    const { r, fsm, state } = makeRig();
    state.settings.sitting.enabled = true;
    tickN(r, 1700);
    state.settings.sitting.minutes = 30;
    tickN(r, 100);
    t.eq(fsm.calls.notify.length, 1, '间隔 60→30 后累计满 30 分钟即触发');
  }

  // ---------- 喝水提醒 ----------

  {
    const { r, fsm, state, patches } = makeRig();
    state.settings.water.enabled = true;
    tickN(r, 90 * 60);
    t.eq(fsm.calls.notify.length, 1, '满 90 分钟触发喝水');
    t.eq(fsm.calls.notify[0].scene, 'water', '触发 water 场景');
    t.eq(state.waterLastFire, BASE, 'waterLastFire 记录触发时刻');
    t.eq(patches[patches.length - 1], { waterLastFire: BASE }, '喝水触发时间已落档');
    state.settings.water.enabled = false;
    tickN(r, 200 * 60);
    t.eq(fsm.calls.notify.length, 1, '关闭喝水后不再触发');
  }

  // ---------- 便签 ----------

  // 未到点不触发
  {
    const { r, fsm } = makeRig({ notes: [{ id: 'a', text: '开会', time: '15:00', repeatDaily: true }] });
    r.tick(1);
    t.eq(fsm.calls.notify.length, 0, '15:00 的便签在 10:00 不触发');
  }

  // 到点触发（每天重复）：记录 lastFire，同日不重复，次日再触发
  {
    const clock = makeClock();
    const { r, fsm, state, patches } = makeRig({
      now: clock.now,
      notes: [{ id: 'a', text: '喝水打卡', time: '12:00', repeatDaily: true }],
    });
    clock.set(new Date(2026, 0, 10, 12, 0, 30).getTime());
    r.tick(1);
    t.eq(fsm.calls.notify.length, 1, '到点触发便签');
    t.eq(fsm.calls.notify[0].text, '便签：喝水打卡', '气泡内容为便签文本');
    t.eq(fsm.calls.notify[0].sfx, 'alert', '便签触发 alert 音效');
    t.eq(state.notes[0].lastFire, '2026-1-10', '重复便签记录触发日');
    t.eq(patches[patches.length - 1].notes[0].id, 'a', '便签列表已落档且保留 id');
    r.tick(1);
    r.tick(1);
    t.eq(fsm.calls.notify.length, 1, '同一天不重复触发');
    // 次日 12:00 再触发
    clock.set(new Date(2026, 0, 11, 12, 0, 5).getTime());
    r.tick(1);
    t.eq(fsm.calls.notify.length, 2, '每天重复的便签次日再次触发（A25）');
    t.eq(state.notes[0].lastFire, '2026-1-11', 'lastFire 更新为次日');
  }

  // 一次性便签：触发后从列表移除
  {
    const clock = makeClock();
    const { r, fsm, state, patches } = makeRig({
      now: clock.now,
      notes: [
        { id: 'once', text: '取快递', time: '12:00', repeatDaily: false },
        { id: 'keep', text: '日报', time: '12:00', repeatDaily: true },
      ],
    });
    clock.set(new Date(2026, 0, 10, 12, 0, 30).getTime());
    r.tick(1);
    t.eq(fsm.calls.notify.length, 2, '同一时刻的两条便签都触发');
    t.eq(
      fsm.calls.notify.map((n) => n.text),
      ['便签：取快递', '便签：日报'],
      '两条便签按列表顺序触发',
    );
    t.eq(state.notes.length, 1, '一次性便签触发后被移除');
    t.eq(state.notes[0].id, 'keep', '每天重复的便签保留');
    const persisted = patches[patches.length - 1].notes;
    t.eq(persisted.length, 1, '落档的便签列表已不含一次性便签');
    t.eq(persisted[0].repeatDaily, true, '落档字段完整');
  }

  // 已过时刻新建（stampNote 语义）：今天不触发，明天照常
  {
    const clock = makeClock();
    const note = stampNote({ id: 'x', text: '晨会', time: '08:00', repeatDaily: true }, BASE);
    const { r, fsm } = makeRig({ now: clock.now, notes: [note] });
    clock.set(new Date(2026, 0, 10, 10, 30).getTime());
    tickN(r, 5);
    t.eq(fsm.calls.notify.length, 0, '今天时刻已过的便签不立即触发');
    clock.set(new Date(2026, 0, 11, 8, 0, 10).getTime());
    r.tick(1);
    t.eq(fsm.calls.notify.length, 1, '次日到点正常触发');
  }

  // 非法时间：忽略不崩溃
  {
    const { r, fsm } = makeRig({ notes: [{ id: 'bad', text: '??', time: '99:99' }] });
    tickN(r, 100);
    t.eq(fsm.calls.notify.length, 0, '非法时间便签被忽略');
  }

  // 关机期间错过的便签：启动后补触发一次
  {
    const clock = makeClock(new Date(2026, 0, 10, 15, 0, 0).getTime());
    const { r, fsm } = makeRig({
      now: clock.now,
      notes: [{ id: 'miss', text: '午饭', time: '12:00', repeatDaily: true, lastFire: '2026-1-9' }],
    });
    r.tick(1);
    t.eq(fsm.calls.notify.length, 1, '错过今天 12:00 的重复便签启动即补提醒');
  }

  // ---------- 番茄钟 ----------

  // 启动：徽章 + 台词 + 状态上报
  {
    const { r, fsm, bubble, pomoChanges } = makeRig();
    t.eq(r.startPomodoro(), true, '空闲时启动成功');
    t.eq(r.pomodoro.phase, 'focus', '进入专注阶段');
    t.eq(bubble.calls.badge[bubble.calls.badge.length - 1], '番茄 25:00', '徽章初始 25:00');
    t.eq(fsm.calls.notify[0].scene, 'pomo-start', 'pomo-start 场景台词');
    t.eq(fsm.calls.notify[0].sfx, 'alert', '启动 alert 音效');
    t.eq(pomoChanges.length, 1, '阶段变化上报一次');
    t.eq(pomoChanges[0].phase, 'focus', '上报专注阶段');
    t.eq(r.startPomodoro(), false, '运行中不可重复启动');
  }

  // 每秒倒计时刷新徽章
  {
    const { r, bubble } = makeRig();
    r.startPomodoro();
    r.tick(1);
    t.eq(bubble.calls.badge[bubble.calls.badge.length - 1], '番茄 24:59', '倒计时 24:59（A24）');
    tickN(r, 60);
    t.eq(bubble.calls.badge[bubble.calls.badge.length - 1], '番茄 23:59', '倒计时 23:59');
  }

  // 专注完成：结算奖励 → 转休息
  {
    const { r, fsm, bubble, growth, pomoChanges } = makeRig();
    r.startPomodoro();
    tickN(r, 1499);
    t.eq(r.pomodoro.phase, 'focus', '24:59 仍在专注');
    r.tick(1);
    t.eq(growth.pomo, 1, '专注完成结算一次番茄奖励（+10经验/+2好感）');
    t.eq(r.pomodoro.phase, 'rest', '转入休息阶段');
    t.eq(bubble.calls.badge[bubble.calls.badge.length - 1], '休息 05:00', '休息徽章 05:00');
    t.eq(fsm.calls.notify[fsm.calls.notify.length - 1].scene, 'pomo-end', 'pomo-end 场景台词');
    t.eq(fsm.calls.notify[fsm.calls.notify.length - 1].sfx, 'pomo_end', 'pomo_end 音效');
    t.eq(pomoChanges.length, 2, 'focus→rest 上报阶段变化');
    tickN(r, 300);
    t.eq(growth.pomo, 1, '休息阶段不重复结算');
  }

  // 休息结束：徽章消失 + 气泡
  {
    const { r, bubble, pomoChanges } = makeRig();
    r.startPomodoro();
    tickN(r, 1500);
    t.eq(r.pomodoro.phase, 'rest', '专注完进入休息');
    tickN(r, 300);
    t.eq(r.pomodoro.phase, 'idle', '休息结束回空闲');
    t.ok(bubble.calls.hideBadge >= 1, '休息结束隐藏徽章');
    t.eq(bubble.calls.say[bubble.calls.say.length - 1].text, '休息结束，元气满满！', '休息结束气泡提示');
    t.eq(pomoChanges.length, 3, 'rest→idle 上报阶段变化');
    t.eq(r.stopPomodoro(), false, '空闲时停止返回 false');
  }

  // 手动停止：不结算奖励
  {
    const { r, bubble, growth, pomoChanges } = makeRig();
    r.startPomodoro();
    tickN(r, 1000);
    t.eq(r.stopPomodoro(), true, '运行中停止成功');
    t.eq(r.pomodoro.phase, 'idle', '停止后回空闲');
    t.eq(growth.pomo, 0, '未完成专注不给奖励');
    t.ok(bubble.calls.hideBadge >= 1, '停止隐藏徽章');
    t.eq(bubble.calls.say[bubble.calls.say.length - 1].text, '番茄钟已停止～', '停止气泡提示');
    t.eq(pomoChanges.length, 2, 'start + stop 各上报一次');
  }

  // toggle 与自定义时长
  {
    const { r, state, bubble } = makeRig();
    state.settings.pomodoro = { focus: 5, rest: 1 };
    t.eq(r.togglePomodoro(), true, 'toggle 启动');
    t.eq(bubble.calls.badge[0], '番茄 05:00', '自定义专注 5 分钟');
    tickN(r, 300);
    t.eq(bubble.calls.badge[bubble.calls.badge.length - 1], '休息 01:00', '自定义休息 1 分钟');
    tickN(r, 60);
    t.eq(r.pomodoro.phase, 'idle', '自定义周期完整走完');
    t.eq(r.togglePomodoro(), true, '结束后可再次 toggle 启动');
  }

  // 运行状态不受提醒触发影响（久坐提醒不打断番茄钟）
  {
    const { r, fsm, state } = makeRig();
    state.settings.sitting.enabled = true;
    r.startPomodoro();
    tickN(r, 3600); // 穿越一个久坐周期
    t.ok(fsm.calls.notify.some((n) => n.scene === 'sit-long'), '久坐提醒正常触发');
    t.ok(r.pomodoro.phase === 'rest' || r.pomodoro.phase === 'idle', '番茄钟不受久坐提醒影响');
  }

  // pomodoro getter 返回副本
  {
    const { r, fsm } = makeRig();
    r.startPomodoro();
    const info = r.pomodoro;
    info.phase = 'hacked';
    t.eq(r.pomodoro.phase, 'focus', 'getter 返回副本，外部修改不影响内部');

    // sync 刷新状态引用
    const s2 = defaultProfile();
    s2.settings.sitting.enabled = false;
    r.sync(s2);
    tickN(r, 10000);
    t.eq(r.state, s2, 'sync 更新状态引用');
    t.eq(fsm.calls.notify.filter((n) => n.scene === 'sit-long').length, 0, '同步后按新状态（关闭久坐）工作');
  }
}
