// IPC 通道注册表（主进程）
import { ipcMain, screen, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickSong, fetchLyric } from './netease.js';
import { applyAutoStart } from './autostart.js';
import { clampToWorkArea, defaultPos } from '../shared/winpos.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerIpc({ win, store, app: appRef, mediaState = { available: true } }) {
  let settingsWin = null;
  // 渲染层上报的实时 UI 状态（唱歌/跳舞/番茄钟），供托盘菜单勾选与标签
  let uiReport = { singing: false, dancing: false, pomoPhase: 'idle' };
  let rebuildTray = () => {};

  const broadcast = (channel, payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };

  function openSettings(tab = 'general') {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show();
      settingsWin.focus();
      settingsWin.webContents.send('settings:tab', tab);
      return;
    }
    settingsWin = new BrowserWindow({
      width: 720,
      height: 560,
      useContentSize: true,
      title: '洛天依 · 设置',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    settingsWin.loadFile(path.join(__dirname, '../renderer/settings.html'));
    settingsWin.once('ready-to-show', () => {
      settingsWin.webContents.send('settings:tab', tab);
    });
    settingsWin.on('closed', () => { settingsWin = null; });
  }

  // ---------- 动作分发（菜单/托盘/设置窗口共用；主进程动作就地执行，其余广播给桌宠窗口） ----------
  function setAutoStart(enabled) {
    // portable 场景注册真实 exe 路径（T6.1）；注册失败则不落档，保持 UI 与系统一致
    const r = applyAutoStart({ app: appRef, enabled });
    if (!r.ok) {
      console.error('[ipc] setLoginItemSettings failed:', r.error);
      return;
    }
    const next = store.apply({ settings: { autoStart: Boolean(enabled) } });
    broadcast('state:changed', next);
    rebuildTray();
  }

  function dispatchAction(action, payload) {
    switch (action) {
      case 'win.toggle-visible':
        if (win && !win.isDestroyed()) {
          if (win.isVisible()) win.hide();
          else win.show();
        }
        break;
      // 找回小人：把窗口拉回主屏右下角默认落点并强制显示。
      // 透明窗口若被摆到屏外/边缘，用户会完全看不到它（托盘菜单是唯一入口）。
      case 'win.reset-pos': {
        if (win && !win.isDestroyed()) {
          const { workArea } = screen.getPrimaryDisplay();
          const b = win.getBounds();
          const p = defaultPos(workArea, b.width, b.height);
          win.setPosition(p.x, p.y);
          win.show();
          win.focus();
          store.apply({ pos: { x: p.x, y: p.y } });
          store.flush();
          broadcast('state:changed', store.get());
        }
        break;
      }
      case 'app.quit':
        appRef.quit();
        break;
      case 'app.autostart':
        setAutoStart(Boolean(payload && payload.enabled));
        break;
      case 'open-settings':
        openSettings(payload && payload.tab ? String(payload.tab) : 'general');
        break;
      default:
        broadcast('ui:action', { action, payload });
    }
  }

  // 渲染层（含设置窗口）发起的动作
  ipcMain.on('ui:action', (_e, msg) => {
    if (msg && msg.action) dispatchAction(msg.action, msg.payload);
  });

  // 桌宠渲染层上报实时 UI 状态（唱歌/跳舞/番茄钟/心情/本次陪伴）→ 托盘刷新 + 设置窗口联动
  ipcMain.on('ui:report', (_e, msg) => {
    if (msg && typeof msg === 'object') {
      uiReport = {
        singing: Boolean(msg.singing),
        dancing: Boolean(msg.dancing),
        pomoPhase: msg.pomoPhase || 'idle',
      };
      broadcast('ui:state', msg);
      rebuildTray();
    }
  });

  ipcMain.handle('state:get', () => store.get());

  ipcMain.handle('state:set', (_e, patch) => {
    const next = store.apply(patch);
    broadcast('state:changed', next);
    rebuildTray();
    return next;
  });

  // 设置窗口/关于信息：数据目录、跳舞可用性（SMTC 健康）、自启状态
  ipcMain.handle('app:info', () => ({
    dataDir: store.dir,
    danceAvailable: mediaState ? mediaState.available !== false : true,
    autoStart: store.get().settings.autoStart,
    version: appRef.getVersion(),
  }));

  ipcMain.on('win:move', (_e, x, y) => {
    if (!win || win.isDestroyed()) return;
    const { workArea } = screen.getPrimaryDisplay();
    const b = win.getBounds();
    // 拖动落点同样夹取到工作区内：透明窗口一旦被拖出屏幕就再也看不到，
    // 只能靠托盘「找回小人」救回。这里直接禁止整体离屏。
    const p = clampToWorkArea({ x: Math.round(x), y: Math.round(y) }, workArea, b.width, b.height);
    if (p) win.setPosition(p.x, p.y);
  });

  ipcMain.on('win:ignore-mouse', (_e, v) => {
    if (!win || win.isDestroyed()) return;
    win.setIgnoreMouseEvents(Boolean(v), { forward: true });
  });

  ipcMain.on('win:always-on-top', (_e, v) => {
    if (!win || win.isDestroyed()) return;
    if (v) win.setAlwaysOnTop(true, 'screen-saver');
    else win.setAlwaysOnTop(false);
  });

  ipcMain.handle('win:geometry', () => {
    const { workArea } = screen.getPrimaryDisplay();
    const b = win && !win.isDestroyed() ? win.getBounds() : null;
    return { workArea, winBounds: b };
  });

  ipcMain.on('app:quit', () => appRef.quit());

  ipcMain.on('app:open-settings', (_e, tab) => openSettings(tab));

  // 音乐（M4 / K7）：选歌（含 24h 缓存写入）与歌词
  ipcMain.handle('music:pick', async () => {
    const state = store.get();
    const r = await pickSong({ cache: state.netease || {} });
    if (r.patch) store.apply({ netease: r.patch });
    return { source: r.source, song: r.song };
  });

  ipcMain.handle('music:lyric', async (_e, songId) => {
    const lrc = await fetchLyric(songId);
    return { ok: Boolean(lrc), lrc: lrc || '' };
  });

  return {
    broadcast,
    openSettings,
    dispatchAction,
    getUiReport: () => ({ ...uiReport }),
    onTrayReady(fn) { if (typeof fn === 'function') rebuildTray = fn; },
    captureWindowPos() {
      if (win && !win.isDestroyed()) {
        const b = win.getBounds();
        store.apply({ pos: { x: b.x, y: b.y } });
        store.flush();
      }
    },
  };
}
