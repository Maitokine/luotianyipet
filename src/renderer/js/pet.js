// 渲染层入口（M3：+成长/台词/换装解锁/冷落回归；M5：+提醒四件套/系统感知/右键菜单/动作路由）
import { Rig } from './animation.js';
import { Outfit } from './outfit.js';
import { WindowCtl } from './windowctl.js';
import { Bubble } from './bubble.js';
import { Fsm } from './fsm.js';
import { Interact } from './interact.js';
import { Dance } from './dance.js';
import { Growth, DECAY_GRACE_MS } from './growth.js';
import { Dialogue } from './dialogue.js';
import { Music } from './music.js';
import { Reminders } from './reminders.js';
import { HtmlMenu } from './menu.js';
import { Sfx } from './sfx.js';
import { SpriteLayer } from './sprite.js';
import { buildMenuModel } from '../../shared/menumodel.js';
import { attachBatteryWatch } from '../../shared/sysjudge.js';
import { idleSingChance } from './music.js';
import { runSelftest } from './selftest.js';

const api = window.petApi;

// 主进程就地执行的动作集（与 ipc.js dispatchAction 一致）：
// 右键 HTML 菜单在渲染层触发这些动作时必须经 sendAction 转发主进程，否则无反应
const MAIN_PROCESS_ACTIONS = ['win.toggle-visible', 'app.quit', 'app.autostart', 'open-settings'];

// 心情标签（设置窗成长页「心情状态」实时显示）
function moodLabel(f) {
  if (f.interrupt) {
    switch (f.interrupt.type) {
      case 'sing': return '唱歌中 ♪';
      case 'dance': return '跳舞中 ✦';
      case 'grabbed': return '被拎着…';
      case 'physics': return '飞起来了！';
      case 'click-react': return '开心！';
      default: return '互动中';
    }
  }
  switch (f.daily) {
    case 'sleep': return '睡着了 Zzz';
    case 'sit': return '乖乖坐着';
    case 'walk': return '闲逛中';
    default: return '待机中';
  }
}

// moveWindow 去抖：同坐标不重复发 IPC（闲逛 42px/s 时约每 2 帧才变 1px）
function makeMover() {
  let last = null;
  return (x, y) => {
    if (last && last.x === x && last.y === y) return;
    last = { x, y };
    api.moveWindow(x, y);
  };
}

async function main() {
  const state = await api.getState();
  const geometry = await api.getGeometry();
  let current = state; // 最新状态引用（onStateChanged 刷新，动作路由读取）

  const charEl = document.getElementById('char');
  const rig = new Rig(charEl);
  const spriteLayer = new SpriteLayer(charEl);
  // 包装 rig.play：让序列帧层与 SVG Rig 同步动作；有 sprite 资源的动作走 canvas，其余走 SVG
  const rigPlay = rig.play.bind(rig);
  rig.play = (name, opts) => {
    spriteLayer.play(name);
    return rigPlay(name, opts);
  };
  const bubble = new Bubble({});
  const dialogue = new Dialogue({});

  // 成长引擎：数值变化即落档（store 侧防抖）
  const growth = new Growth({
    state,
    onPersist: (patch) => api.setState(patch),
  });
  dialogue.setLively(growth.isUnlocked('lines_lively'));

  // 换装（校验解锁；异常存档回退默认装）
  const outfit = new Outfit(rig, state);
  if (!(await outfit.apply(state.outfit || 'default'))) {
    await outfit.apply('default');
    api.setState({ outfit: 'default' });
  }

  const moveWindow = makeMover();

  // 音效（T5.5）：jump/land/happy/alert/pomo_end，经 fsm/提醒系统触发
  const sfx = new Sfx({});

  const fsm = new Fsm({
    rig,
    bubble,
    growth,
    dialogue,
    sfx,
    moveWindow,
    rand: Math.random,
  });

  // 跳舞：不再受等级限制（用户要求——系统媒体播放即跳；手动菜单项同样默认可用）
  const dance = new Dance({ fsm });
  dance.sync(state);
  fsm.onSingEnd = () => dance.singEnded(); // A22：唱完接跳舞

  // 音乐点歌（A17/A18/A19）
  const music = new Music({ api, fsm, bubble, growth, dialogue });
  // 唱歌被拖拽/抛掷打断 → 立即停音频（否则 fsm 已退出唱歌态而声音还在放，双击切歌会叠加两首）
  fsm.onSingInterrupted = () => music.onSingInterrupted();

  // 提醒四件套（A23/A24/A25）：久坐/喝水/番茄钟/便签，全部走打断态
  const reminders = new Reminders({
    state, fsm, bubble, growth,
    onPersist: (patch) => api.setState(patch),
  });

  // 成长事件 → 表现（A15：升级庆祝 + 解锁提示；台词随档位变化 A14）
  growth.onEvent = (type, ev) => {
    if (type === 'levelup') {
      dialogue.setLively(growth.isUnlocked('lines_lively'));
      const line = dialogue.pick('levelup', growth.tierKey(), Math.random);
      const unlockTxt = ev.unlocked.length
        ? ` 解锁了「${ev.unlocked.map((u) => u.label).join('、')}」！`
        : '';
      fsm.notify({ text: `${line}${unlockTxt}`, ms: 6500, sfx: 'happy' });
    }
    // 好感档位变化不做专门气泡：后续台词自然切换风格（A14）
  };

  const windowctl = new WindowCtl({
    api, rig, charEl, state,
    onPersist: (patch) => api.setState(patch),
  });

  // 几何：地面/边界 + 当前窗口位置
  if (geometry && geometry.workArea) {
    fsm.setGeometry({
      workArea: geometry.workArea,
      winBounds: geometry.winBounds,
    });
  }

  // 手势接线（拖拽期间强制可交互，防止穿透丢拖拽；双击 = 点歌/停止）
  Interact.create({
    fsm,
    windowctl,
    onDblclick: () => music.toggle(),
    onDragStateChange: (v) => windowctl.setDragActive(v),
  });

  // ---------- 右键菜单（A6：与托盘同源 menumodel） ----------
  const menu = new HtmlMenu({
    onAction: (action, payload) => handleAction(action, payload),
    onOpen: () => windowctl.setMenuOpen(true),
    onClose: () => windowctl.setMenuOpen(false),
  });

  // 动作路由：菜单/托盘/设置窗口广播的动作 → 各模块执行
  async function handleAction(action, payload = {}) {
    switch (action) {
      case 'music.toggle':
        music.toggle();
        break;
      case 'win.always-on-top':
        api.setState({ settings: { alwaysOnTop: !current.settings.alwaysOnTop } });
        break;
      case 'win.click-through':
        api.setState({ settings: { clickThrough: !current.settings.clickThrough } });
        break;
      case 'win.game-mode':
        api.setState({ settings: { gameMode: !current.settings.gameMode } });
        break;
      case 'pet.size':
        if (Number.isFinite(payload.scale)) api.setState({ settings: { scale: payload.scale } });
        break;
      case 'pet.action': {
        fsm.manualAction(payload.name);
        break;
      }
      case 'pet.outfit':
        if (await outfit.apply(payload.id)) api.setState({ outfit: payload.id });
        break;
      case 'tools.sitting':
        api.setState({ settings: { sitting: { enabled: Boolean(payload.enabled) } } });
        break;
      case 'tools.water':
        api.setState({ settings: { water: { enabled: Boolean(payload.enabled) } } });
        break;
      case 'tools.pomodoro':
        reminders.togglePomodoro();
        break;
      default: {
        // 真机反馈根因修复：右键 HTML 菜单里"设置/成长面板/便签管理/自启/退出/隐藏小人"
        // 是主进程动作（托盘走主进程 dispatchAction 就地执行），但右键菜单在渲染层——
        // 此前落到这里直接 break，点这些项毫无反应。必须显式转发主进程。
        // 白名单转发（防死循环：主进程对未知动作会广播回渲染层）
        if (MAIN_PROCESS_ACTIONS.includes(action)) {
          api.sendAction(action, payload);
        }
        break;
      }
    }
  }
  api.onAction((msg) => {
    if (msg && msg.action) handleAction(msg.action, msg.payload);
  });

  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const onMenu = menu.contains(e.target);
    const onChar = charEl && (charEl === e.target || charEl.contains(e.target));
    // 点在菜单内部：忽略，保持菜单展开状态
    if (onMenu) return;
    // 点在角色外空白处：关闭菜单；不再重开（原菜单消失）
    if (!onChar) { menu.close(); return; }
    // 点在角色上：打开/重定位右键菜单（菜单外 mousedown 已先关闭旧菜单）
    const model = buildMenuModel({
      state: current,
      flags: { singing: fsm.singing, pomoPhase: reminders.pomodoro.phase },
    });
    menu.open(model, e.clientX, e.clientY);
  });

  // 窗口失焦（点到其他应用/桌面）时关闭菜单，避免菜单悬挂
  api.onMenuClose(() => menu.close());

  // 状态同步：成长数值 / 换装 / 窗口设置 / 跳舞开关 / 提醒配置与便签
  api.onStateChanged((s) => {
    current = s;
    growth.syncState(s);
    outfit.sync(s);
    windowctl.sync(s);
    dance.sync(s);
    reminders.sync(s);
    if (s.settings.clickThrough) menu.close(); // 穿透模式下菜单无法接收点击，避免悬挂
  });

  // SMTC 媒体状态 → 跳舞判定
  api.onMediaStatus((s) => dance.onMediaStatus(s));

  // 系统感知：CPU 高负载（主进程广播）+ 电量低（渲染层 Battery API，缺失则静默禁用）
  api.onSysEvent((e) => {
    if (e && e.type === 'cpu-high') fsm.notify({ scene: 'cpu-high', sfx: 'alert' });
  });
  // 电量监听失败（Battery API 缺失/环境异常）不应拖垮主流程：静默禁用即可（原 PRD：缺失则禁用）
  try {
    attachBatteryWatch({
      getBattery: () => (typeof navigator !== 'undefined' && navigator.getBattery
        ? navigator.getBattery()
        : null),
      onEvent: (e) => {
        if (e && e.type === 'battery-low') fsm.notify({ scene: 'battery-low', sfx: 'alert' });
      },
    });
  } catch (err) {
    console.warn('[pet] battery watch disabled:', err && err.message);
  }

  // 冷落回归：距上次互动超过 48h，见面先说一句（原 PRD 冷落回归场景）
  if (state.lastInteractionAt && Date.now() - state.lastInteractionAt > DECAY_GRACE_MS) {
    const line = dialogue.pick('return', growth.tierKey(), Math.random);
    if (line) bubble.say(line, 5000);
  }

  // 陪伴计时 + 提醒驱动：每秒 tick；UI 状态（唱歌/跳舞/番茄钟/心情/本次陪伴）变化即上报
  const sessionStart = Date.now();
  let lastUiKey = '';
  setInterval(() => {
    growth.tick(1);
    reminders.tick(1);
    const mood = moodLabel(fsm);
    const key = `${fsm.singing ? 1 : 0}|${fsm.dancing ? 1 : 0}|${reminders.pomodoro.phase}|${mood}`;
    if (key !== lastUiKey) {
      lastUiKey = key;
      api.reportUiState({
        singing: fsm.singing,
        dancing: fsm.dancing,
        pomoPhase: reminders.pomodoro.phase,
        mood,
        sessionSecs: Math.floor((Date.now() - sessionStart) / 1000),
      });
    }
  }, 1000);
  growth.applyDecay(); // 启动先补算一次冷落衰减

  // 闲逛随机真唱（DEV_PLAN T5.4 通用页，默认关）：哼唱日常态下低概率接一首真歌
  setInterval(() => {
    if (idleSingChance({
      enabled: current.settings.idleRealSing,
      daily: fsm.daily,
      singing: fsm.singing,
      dancing: fsm.dancing,
      grabbed: fsm.grabbed,
    })) music.startSing();
  }, 5000);

  rig.play('idle');
  fsm.start();
  dance.start();

  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('selftest') === '1') {
    runSelftest({ api, reminders, bubble, music, fsm, doc: document, menu, windowctl, dance });
    return; // 自检模式不走 smoke 退出流程
  }
  api.smokeReady();
}

main().catch((e) => {
  console.error('[pet] fatal:', e);
  // 致命错误必须让冒烟以非 0 退出——绝不能用无差别的 smokeReady() 兜底掩盖渲染层崩溃
  api.smokeReady('pet-fatal');
});
