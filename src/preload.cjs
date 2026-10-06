// preload（CJS）：向渲染层暴露白名单 API
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petApi', {
  // 状态
  getState: () => ipcRenderer.invoke('state:get'),
  setState: (patch) => ipcRenderer.invoke('state:set', patch),
  onStateChanged: (cb) => ipcRenderer.on('state:changed', (_e, s) => cb(s)),
  // 窗口
  moveWindow: (x, y) => ipcRenderer.send('win:move', Math.round(x), Math.round(y)),
  setIgnoreMouse: (v) => ipcRenderer.send('win:ignore-mouse', Boolean(v)),
  setAlwaysOnTop: (v) => ipcRenderer.send('win:always-on-top', Boolean(v)),
  getGeometry: () => ipcRenderer.invoke('win:geometry'),
  // 动作路由（菜单/设置窗口 → 桌宠窗口）
  sendAction: (action, payload) => ipcRenderer.send('ui:action', { action, payload }),
  onAction: (cb) => ipcRenderer.on('ui:action', (_e, msg) => cb(msg)),
  // 实时 UI 状态上报（唱歌/跳舞/番茄钟 → 托盘菜单勾选与标签）
  reportUiState: (s) => ipcRenderer.send('ui:report', s),
  // 实时 UI 状态广播（设置窗口显示心情/番茄钟状态/本次陪伴）
  onUiState: (cb) => ipcRenderer.on('ui:state', (_e, s) => cb(s)),
  // 设置窗口页签切换指令（openSettings 指定页签）
  onSettingsTab: (cb) => ipcRenderer.on('settings:tab', (_e, tab) => cb(tab)),
  // 主进程通知渲染层关闭菜单（窗口失焦时广播）
  onMenuClose: (cb) => ipcRenderer.on('ui:close-menu', (_e) => cb()),
  // 应用信息（数据目录/跳舞可用性/自启状态，设置窗口用）
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  // 应用
  openSettings: (tab) => ipcRenderer.send('app:open-settings', tab),
  quit: () => ipcRenderer.send('app:quit'),
  // 音乐（M4）
  pickSong: () => ipcRenderer.invoke('music:pick'),
  getLyric: (songId) => ipcRenderer.invoke('music:lyric', songId),
  // 系统媒体状态（SMTC）
  onMediaStatus: (cb) => ipcRenderer.on('media:status', (_e, s) => cb(s)),
  // 系统感知事件（CPU 高负载；电池在渲染层直接读 navigator.getBattery）
  onSysEvent: (cb) => ipcRenderer.on('sys:event', (_e, s) => cb(s)),
  // 冒烟（name='settings' 表示设置窗口就绪）
  smokeReady: (name) => ipcRenderer.send('smoke:ready', name),
  // 真实环境自检（--selftest）
  selftestLog: (msg) => ipcRenderer.send('selftest:log', msg),
  selftestDone: () => ipcRenderer.send('selftest:done'),
});
