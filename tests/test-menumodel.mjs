// menumodel 单测（T5.3，PRD §3.2）：12 项四组结构、勾选/单选态、解锁门控、动作分发语义
import { buildMenuModel, itemAction, SIZE_PRESETS } from '../src/shared/menumodel.js';
import { defaultProfile } from '../src/shared/profile.js';

function topItems(model) { return model.flatMap((g) => g.items); }
function find(model, id) { return topItems(model).find((i) => i.id === id); }
function sub(model, id) { return find(model, id).items; }

export function run(t) {
  const base = defaultProfile();

  // ---------- 结构：四组十二项 ----------
  {
    const m = buildMenuModel({ state: base });
    t.eq(m.map((g) => g.label), ['音乐', '窗口', '互动', '系统'], '四组标签顺序正确');
    t.eq(topItems(m).length, 12, '顶层共 12 项（PRD §3.2）');
    t.eq(
      topItems(m).map((i) => i.id),
      [
        'music.toggle', 'win.toggle-visible', 'win.always-on-top', 'win.click-through',
        'pet.size', 'pet.action', 'pet.outfit', 'tools.reminders',
        'app.growth', 'app.settings', 'app.autostart', 'app.quit',
      ],
      '12 项 id 完整且分组正确',
    );
    t.eq(topItems(m).filter((i) => i.type === 'submenu').length, 4, '互动组四项均为二级菜单');
  }

  // ---------- 音乐：唱歌状态切换标签 ----------
  {
    t.eq(find(buildMenuModel({ state: base }), 'music.toggle').label, '唱首歌', '未唱歌显示「唱首歌」');
    t.eq(
      find(buildMenuModel({ state: base, flags: { singing: true } }), 'music.toggle').label,
      '停止',
      '唱歌中显示「停止」',
    );
  }

  // ---------- 窗口：勾选态随设置 ----------
  {
    const s = JSON.parse(JSON.stringify(base));
    s.settings.alwaysOnTop = false;
    s.settings.clickThrough = true;
    const m = buildMenuModel({ state: s });
    t.eq(find(m, 'win.always-on-top').checked, false, '置顶关闭时勾选态为假');
    t.eq(find(m, 'win.click-through').checked, true, '穿透开启时勾选态为真');
  }

  // ---------- 尺寸：单选态 ----------
  {
    let m = buildMenuModel({ state: base }); // 默认 scale 1.0
    let items = sub(m, 'pet.size');
    t.eq(items.map((i) => i.checked), [false, true, false], '默认尺寸=中 勾选');
    t.eq(items.map((i) => i.label), ['小', '中', '大'], '尺寸三档标签');

    const s = JSON.parse(JSON.stringify(base));
    s.settings.scale = 0.7;
    m = buildMenuModel({ state: s });
    t.eq(sub(m, 'pet.size').map((i) => i.checked), [true, false, false], 'scale 0.7 → 小 勾选');

    s.settings.scale = 0.85; // 滚轮微调的中间值
    m = buildMenuModel({ state: s });
    t.eq(sub(m, 'pet.size').filter((i) => i.checked).length, 0, '非预设值无勾选（诚实显示）');

    // 分发：预设项 → pet.size + scale 载荷
    const act = itemAction(sub(m, 'pet.size')[0]);
    t.eq(act, { action: 'pet.size', payload: { scale: SIZE_PRESETS[0].scale } }, '尺寸项分发 pet.size');
  }

  // ---------- 让她做动作：三项均默认可用（跳舞已解除等级限制） ----------
  {
    const m = buildMenuModel({ state: base }); // unlocked: ['outfit_default']
    const items = sub(m, 'pet.action');
    t.eq(items.map((i) => i.label), ['坐下', '睡觉', '跳舞'], '三个动作');
    t.eq(items.map((i) => i.disabled), [false, false, false], '三项均可用（跳舞不再需要 Lv.3）');
    t.eq(items[2].hint, null, '跳舞无解锁等级提示');
  }

  // ---------- 换装：当前仅保留默认装 ----------
  {
    let m = buildMenuModel({ state: base });
    let items = sub(m, 'pet.outfit');
    t.eq(items.length, 1, '当前仅一套服装');
    t.eq(items.map((i) => i.disabled), [false], '默认装可用');
    t.eq(items.map((i) => i.checked), [true], '默认装勾选');

    const s = JSON.parse(JSON.stringify(base));
    s.outfit = 'default';
    m = buildMenuModel({ state: s });
    items = sub(m, 'pet.outfit');
    t.eq(items.map((i) => i.checked), [true], '穿着 default 勾选');
  }

  // ---------- 提醒工具快捷配置 ----------
  {
    let m = buildMenuModel({ state: base });
    const items = sub(m, 'tools.reminders');
    t.eq(items.map((i) => i.label), ['久坐提醒', '喝水提醒', '开始番茄钟', '便签管理…'], '四件套快捷项');
    t.eq(items[0].checked, true, '久坐默认开启');
    t.eq(items[1].checked, true, '喝水默认开启');
    t.eq(items[3].action, 'open-settings', '便签管理跳设置页');
    t.eq(items[3].payload, { tab: 'reminders' }, '跳提醒页签');

    for (const phase of ['focus', 'rest']) {
      const mm = buildMenuModel({ state: base, flags: { pomoPhase: phase } });
      t.eq(
        sub(mm, 'tools.reminders')[2].label,
        '停止番茄钟',
        `番茄钟 ${phase} 阶段显示「停止」`,
      );
    }
  }

  // ---------- 系统组 ----------
  {
    let m = buildMenuModel({ state: base, flags: { autoStart: true } });
    t.eq(find(m, 'app.autostart').checked, true, '自启勾选随 flags');
    t.eq(find(m, 'app.growth').action, 'open-settings', '成长面板打开设置');
    t.eq(find(m, 'app.growth').payload, { tab: 'growth' }, '成长页签');
    t.eq(find(m, 'app.settings').payload, { tab: 'general' }, '通用页签');
    m = buildMenuModel({ state: base, flags: { autoStart: false } });
    t.eq(find(m, 'app.autostart').checked, false, '自启关闭无勾选');
  }

  // ---------- itemAction 分发语义 ----------
  {
    t.eq(itemAction({ id: 'win.always-on-top', type: 'check', checked: true }),
      { action: 'win.always-on-top', payload: { enabled: false } }, '勾选项 → 取反开关');
    t.eq(itemAction({ id: 'x', type: 'check', checked: false }),
      { action: 'x', payload: { enabled: true } }, '未勾选项 → 开启');
    t.eq(itemAction({ id: 'music.toggle' }),
      { action: 'music.toggle', payload: undefined }, '普通项无载荷');
    t.eq(itemAction({ id: 'tools.notes', action: 'open-settings', payload: { tab: 'reminders' } }),
      { action: 'open-settings', payload: { tab: 'reminders' } }, '显式载荷原样分发');
    t.eq(itemAction({ id: 'pet.outfit.default', type: 'radio', action: 'pet.outfit', payload: { id: 'default' } }),
      { action: 'pet.outfit', payload: { id: 'default' } }, '单选项用显式载荷（不生成 enabled）');
  }
}
