// 主进程入口：窗口、托盘、单实例、存档、IPC（K1/K2/K9）
import { app, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { registerIpc } from './ipc.js';
import { createTray } from './tray.js';
import { startMediaWatch } from './media.js';
import { startCpuWatch } from './sysinfo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes('--smoke');
const SELFTEST = process.argv.includes('--selftest');
const DUMP = process.argv.includes('--dump-state');
// 媒体检测诊断：打印每次状态变化及其判定来源通道（smtc / audio）
const MEDIA_DEBUG = process.argv.includes('--media-debug');
const patchIdx = process.argv.indexOf('--apply-patch');
const APPLY = patchIdx > -1 ? process.argv[patchIdx + 1] : null;

// R6 预案：部分 Windows 显卡驱动/受限环境下 GPU 子进程崩溃（0xC0000005）。
// 本应用为轻量 2D 矢量动画，统一走软件渲染 + GPU 线程并入主进程，保证任何机器可运行。
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
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
    if (win) {
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
    const defaultX = workArea.x + workArea.width - W - 60;
    const defaultY = workArea.y + workArea.height - H;
    const pos = sanitizePos(state.pos, workArea, W, H) || { x: defaultX, y: defaultY };

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
    win.once('ready-to-show', () => {
      win.show();
      console.log('[app] window-shown');
    });
    win.on('closed', () => { win = null; });

    ipc = registerIpc({ win, store, app, mediaState });
    tray = createTray({ win, store, ipc });
    ipc.onTrayReady(() => tray.rebuild()); // 状态变化（设置写入/UI 上报）后刷新托盘菜单

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

// 位置合法性：确保窗口在主屏工作区可见范围内
function sanitizePos(pos, workArea, W, H) {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  const x = Math.min(Math.max(Math.round(pos.x), workArea.x - W + 60), workArea.x + workArea.width - 60);
  const y = Math.min(Math.max(Math.round(pos.y), workArea.y), workArea.y + workArea.height - 40);
  return { x, y };
}
