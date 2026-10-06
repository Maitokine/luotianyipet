// 主进程入口：窗口、托盘、单实例、存档、IPC（K1/K2/K9）
import { app, BrowserWindow, screen, ipcMain, globalShortcut } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { registerIpc } from './ipc.js';
import { createTray } from './tray.js';
import { startMediaWatch } from './media.js';
import { startCpuWatch } from './sysinfo.js';
import { clampToWorkArea, defaultPos, isSufficientlyVisible } from '../shared/winpos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes('--smoke');
const SELFTEST = process.argv.includes('--selftest');
const DUMP = process.argv.includes('--dump-state');
// 窗口诊断：打印显示来源、bounds、可见性（排查「小人不出现」）
const WIN_DEBUG = process.argv.includes('--win-debug');
// 忽略存档位置，直接回到默认落点（找回小人的兜底手段）
const RESET_POS = process.argv.includes('--reset-pos');
// 媒体检测诊断：打印每次状态变化及其判定来源通道（smtc / audio）
const MEDIA_DEBUG = process.argv.includes('--media-debug');
const patchIdx = process.argv.indexOf('--apply-patch');
const APPLY = patchIdx > -1 ? process.argv[patchIdx + 1] : null;

// R6 预案：部分 Windows 显卡驱动/受限环境下 GPU 子进程崩溃（0xC0000005）。
// 本应用为轻量 2D 矢量动画，统一走软件渲染 + GPU 线程并入主进程，保证任何机器可运行。
// --gpu-on：跳过上述软件渲染开关，改用默认 GPU 合成——用于排查「透明窗口在个别显卡上
// 完全不绘制/不显示」。默认仍走软件渲染。
const GPU_ON = process.argv.includes('--gpu-on');
if (!GPU_ON) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('in-process-gpu');
}
// 桌宠为本地单用户应用，不加载任意远程网页（仅音频流），关闭 Chromium 沙箱提升受限环境兼容性
app.commandLine.appendSwitch('no-sandbox');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let win = null;
  let store = null;
  let tray = null;
  let ipc = null;

  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      ensureOnScreen(win, win.getBounds().width, win.getBounds().height);
      win.show();
      win.focus();
    }
  });

  // SMTC 可用性缓存（media 轮询回报；设置窗口经 app:info 读取展示「不可用」态）
  const mediaState = { available: true };

  app.whenReady().then(() => {
    store = new Store({ dir: resolveDataDir() });
    const state = store.load();
    store.startAutoSave();

    // T6.3 持久化全链路测试钩子：不创建窗口，直接 dump/应用/退出
    if (DUMP) {
      console.log('STATE:' + JSON.stringify(store.get()));
      console.log('RECOVERED:' + (store.recoveredFromBackup ? '1' : '0'));
      console.log('FRESH:' + (store.freshInstall ? '1' : '0'));
      setTimeout(() => app.exit(0), 50);
      return;
    }
    if (APPLY !== null) {
      try {
        store.apply(JSON.parse(APPLY));
        store.flush();
        console.log('APPLIED:1');
        setTimeout(() => app.exit(0), 50);
      } catch (e) {
        console.error('APPLY_FAILED:' + e.message);
        app.exit(1);
      }
      return;
    }

    const { workArea } = screen.getPrimaryDisplay();
    const W = 300;
    const H = 420;
    // 存档位置夹取到工作区内；--reset-pos 或位置非法时回到默认右下角落点。
    // 必须保证窗口整体可见：透明窗口只要落在屏外就等同于"小人消失"。
    const pos = (RESET_POS ? null : clampToWorkArea(state.pos, workArea, W, H)) || defaultPos(workArea, W, H);

    win = new BrowserWindow({
      width: W,
      height: H,
      x: pos.x,
      y: pos.y,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.loadFile(
      path.join(__dirname, '../renderer/index.html'),
      SELFTEST ? { search: 'selftest=1' } : undefined,
    );

    // 显示兜底：绝不只依赖 ready-to-show —— 该事件在部分机器/显卡环境上会永不触发
    // （官方文档注明其与 paintWhenInitiallyHidden / fullscreen / preload 等多种失效场景有关）。
    // 若只等它，窗口会永久隐藏：托盘图标在、媒体与音乐都正常，但看不到小人。
    // 这里叠加 did-finish-load、did-fail-load 与超时三重兜底，任一先到即显示；
    // 显示前先确保窗口在屏内（防止存档位置把窗口丢到屏幕外）。
    let shown = false;
    const showWindow = (reason) => {
      if (shown || !win || win.isDestroyed()) return;
      shown = true;
      const b = win.getBounds();
      ensureOnScreen(win, b.width, b.height);
      win.show();
      const nb = win.getBounds();
      console.log(
        `[app] window-shown via=${reason} bounds=${JSON.stringify(nb)} visible=${win.isVisible()}`
        + (WIN_DEBUG ? ` displays=${screen.getAllDisplays().length} primary=${JSON.stringify(screen.getPrimaryDisplay().workArea)}` : ''),
      );
    };
    win.once('ready-to-show', () => showWindow('ready-to-show'));
    win.webContents.once('did-finish-load', () => showWindow('did-finish-load'));
    win.webContents.on('did-fail-load', (_e, code, desc, url) => {
      console.error(`[app] did-fail-load code=${code} desc=${desc} url=${url}`);
      showWindow('did-fail-load');
    });
    win.webContents.on('render-process-gone', (_e, d) => {
      console.error(`[app] render-process-gone reason=${(d && d.reason) || 'unknown'}`);
    });
    setTimeout(() => showWindow('timeout-fallback'), 3000);

    win.on('closed', () => { win = null; });
    win.on('blur', () => { if (ipc) ipc.broadcast('ui:close-menu'); });

    ipc = registerIpc({ win, store, app, mediaState });
    tray = createTray({ win, store, ipc });
    ipc.onTrayReady(() => tray.rebuild()); // 状态变化（设置写入/UI 上报）后刷新托盘菜单

    // 全局快捷键 Ctrl+Shift+G：切换「游戏模式」——整窗可交互，解决游戏内无法点击小人
    const toggleGameMode = () => {
      const s = store.get();
      const next = { settings: { gameMode: !s.settings.gameMode } };
      const applied = store.apply(next);
      store.flush();
      ipc.broadcast('state:changed', applied);
      tray.rebuild();
    };
    globalShortcut.register('Ctrl+Shift+G', toggleGameMode);
    app.on('will-quit', () => { globalShortcut.unregisterAll(); });

    // 系统媒体监听（双通道：SMTC + 音频会话）：
    // 状态变化推送给渲染层驱动跳舞（K8：失败自动禁用跳舞，不影响其他功能）
    const selfExe = path.basename(process.execPath).replace(/\.exe$/i, '').toLowerCase();
    startMediaWatch({
      selfName: selfExe,
      onStatus: (s) => {
        mediaState.available = s.available !== false;
        if (SELFTEST || MEDIA_DEBUG) {
          console.log(`[media] playing=${s.playing ? 1 : 0} available=${s.available ? 1 : 0} via=${s.via || '-'}`);
        }
        if (ipc) ipc.broadcast('media:status', s);
      },
    });

    // 系统感知·CPU：>85% 持续 30s 吐槽一次（10 分钟冷却），推送给渲染层（T5.2）
    startCpuWatch({
      onEvent: (e) => {
        if (ipc) ipc.broadcast('sys:event', e);
      },
    });

    if (SELFTEST) {
      // 自检模式：渲染层逐步上报结果，DONE 后退出；超时兜底
      const t = setTimeout(() => {
        console.error('[selftest] timeout');
        app.exit(3);
      }, 45000);
      ipcMain.on('selftest:log', (_e, msg) => console.log(`[selftest] ${msg}`));
      ipcMain.on('selftest:done', () => {
        setTimeout(() => { clearTimeout(t); app.exit(0); }, 600);
      });
    }

    if (SMOKE) {
      // 冒烟：主窗渲染就绪 → 再打开设置窗验证其启动链路 → 双就绪后退出
      const t = setTimeout(() => {
        console.error('[smoke] timeout waiting renderer ready');
        app.exit(2);
      }, 15000);
      let petReady = false;
      let settingsReady = false;
      let settingsOpened = false;
      const maybeDone = () => {
        if (petReady && settingsReady) {
          clearTimeout(t);
          console.log('[smoke] renderer ready, exit 0');
          setTimeout(() => app.exit(0), 300);
        }
      };
      ipcMain.on('smoke:ready', (_e, name) => {
        if (name === 'pet-fatal') {
          // 渲染层主流程致命崩溃：冒烟必须失败（exit 1），绝不掩盖
          clearTimeout(t);
          console.error('[smoke] pet renderer fatal, exit 1');
          setTimeout(() => app.exit(1), 300);
          return;
        }
        if (name === 'settings') settingsReady = true;
        else {
          petReady = true;
          if (!settingsOpened) {
            settingsOpened = true;
            ipc.openSettings('general');
          }
        }
        maybeDone();
      });
    }

    app.on('before-quit', () => {
      try {
        if (ipc) ipc.captureWindowPos();
        if (store) { store.flush(); store.stop(); }
      } catch { /* 尽力保存 */ }
    });
  });
}

// K9：存档目录优先级 portable 同目录 → 开发同目录 → userData
function resolveDataDir() {
  const candidates = [];
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    candidates.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'data'));
  }
  candidates.push(path.join(__dirname, '../../data'));
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch { /* 尝试下一个 */ }
  }
  return path.join(app.getPath('userData'), 'data');
}

// 显示前确保窗口足够可见：若大部分落在所有屏幕之外，拉回默认落点。
// 透明窗口一旦跑到屏外就完全看不见，这是「小人不出现」的另一条成因。
function ensureOnScreen(win, W, H) {
  try {
    const bounds = win.getBounds();
    if (isSufficientlyVisible(bounds, screen.getAllDisplays())) return;
    const { workArea } = screen.getPrimaryDisplay();
    const p = defaultPos(workArea, W, H);
    console.warn(`[app] off-screen bounds=${JSON.stringify(bounds)} → reset to ${JSON.stringify(p)}`);
    win.setPosition(p.x, p.y);
  } catch { /* 尽力而为，不影响启动 */ }
}
