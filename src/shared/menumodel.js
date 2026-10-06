// 菜单数据模型（M5 / T5.3，PRD §3.2）：角色右键 HTML 菜单与托盘原生菜单的共用数据源
// 纯数据构建（无 Electron/DOM 依赖，Node 可测）；执行路由见 itemAction + 各端分发器
//
// 12 项四组：音乐(唱首歌/停止) 窗口(显示隐藏/置顶/穿透) 互动(尺寸/做动作/换装/提醒工具) 系统(成长面板/设置/自启/退出)

export const SIZE_PRESETS = [
  { id: 'small', label: '小', scale: 0.7 },
  { id: 'medium', label: '中', scale: 1.0 },
  { id: 'large', label: '大', scale: 1.4 },
];

export const MANUAL_ACTIONS = [
  { id: 'sit', label: '坐下' },
  { id: 'sleep', label: '睡觉' },
  { id: 'dance', label: '跳舞', unlockId: 'dance', level: 3 },
];

export const OUTFIT_ITEMS = [
  { id: 'default', label: '洛天依 · 默认装', unlockId: 'outfit_default', level: 1 },
];

// 叶项点击 → 要分发的动作与载荷
// 勾选项未显式给 payload 时，按「取反当前勾选」生成 { enabled }（主/渲染两端同一语义）
export function itemAction(item) {
  const action = item.action || item.id;
  let payload = item.payload;
  if (payload === undefined && item.type === 'check') payload = { enabled: !item.checked };
  return { action, payload };
}

// flags: { singing, pomoPhase, autoStart }
export function buildMenuModel({ state, flags = {} } = {}) {
  const s = (state && state.settings) || {};
  const singing = Boolean(flags.singing);
  const pomoPhase = flags.pomoPhase || 'idle';
  const unlocked = (state && state.unlocked) || [];
  const has = (id) => unlocked.includes(id);
  const curOutfit = (state && state.outfit) || 'default';
  const curSize = SIZE_PRESETS.find((p) => Math.abs(p.scale - Number(s.scale)) < 0.001) || null;

  return [
    {
      label: '音乐',
      items: [
        { id: 'music.toggle', label: singing ? '停止' : '唱首歌' },
      ],
    },
    {
      label: '窗口',
      items: [
        { id: 'win.toggle-visible', label: '显示 / 隐藏' },
        { id: 'win.always-on-top', label: '置顶显示', type: 'check', checked: Boolean(s.alwaysOnTop) },
        { id: 'win.click-through', label: '鼠标穿透', type: 'check', checked: Boolean(s.clickThrough) },
      ],
    },
    {
      label: '互动',
      items: [
        {
          id: 'pet.size',
          label: '尺寸',
          type: 'submenu',
          items: SIZE_PRESETS.map((p) => ({
            id: `pet.size.${p.id}`,
            label: p.label,
            type: 'radio',
            checked: curSize ? curSize.id === p.id : false,
            action: 'pet.size',
            payload: { scale: p.scale },
          })),
        },
        {
          id: 'pet.action',
          label: '让她做动作',
          type: 'submenu',
          items: MANUAL_ACTIONS.map((a) => ({
            id: `pet.action.${a.id}`,
            label: a.label,
            disabled: a.unlockId ? !has(a.unlockId) : false,
            hint: a.unlockId && !has(a.unlockId) ? `Lv.${a.level} 解锁` : null,
            action: 'pet.action',
            payload: { name: a.id },
          })),
        },
        {
          id: 'pet.outfit',
          label: '换装',
          type: 'submenu',
          items: OUTFIT_ITEMS.map((o) => ({
            id: `pet.outfit.${o.id}`,
            label: o.label,
            type: 'radio',
            checked: curOutfit === o.id,
            disabled: !has(o.unlockId),
            hint: has(o.unlockId) ? null : `Lv.${o.level} 解锁`,
            action: 'pet.outfit',
            payload: { id: o.id },
          })),
        },
        {
          id: 'tools.reminders',
          label: '提醒工具',
          type: 'submenu',
          items: [
            {
              id: 'tools.sitting',
              label: '久坐提醒',
              type: 'check',
              checked: Boolean(s.sitting && s.sitting.enabled),
            },
            {
              id: 'tools.water',
              label: '喝水提醒',
              type: 'check',
              checked: Boolean(s.water && s.water.enabled),
            },
            {
              id: 'tools.pomodoro',
              label: pomoPhase === 'idle' ? '开始番茄钟' : '停止番茄钟',
            },
            {
              id: 'tools.notes',
              label: '便签管理…',
              action: 'open-settings',
              payload: { tab: 'reminders' },
            },
          ],
        },
      ],
    },
    {
      label: '系统',
      items: [
        { id: 'app.growth', label: '成长面板', action: 'open-settings', payload: { tab: 'growth' } },
        { id: 'app.settings', label: '设置', action: 'open-settings', payload: { tab: 'general' } },
        { id: 'app.autostart', label: '开机自启', type: 'check', checked: Boolean(flags.autoStart) },
        { id: 'app.quit', label: '退出' },
      ],
    },
  ];
}
