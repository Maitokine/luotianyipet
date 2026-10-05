// 托盘：图标 + 原生菜单（M5：全量 12 项四组，与角色右键 HTML 菜单共用 menumodel 数据源，A6）
import { Tray, Menu, nativeImage, app } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMenuModel, itemAction } from '../shared/menumodel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createTray({ win, store, ipc }) {
  // 托盘图标使用 M6 生成的 32px 洛天依头像，打包后路径在 asar 内仍可读
  let trayIcon;
  try {
    const iconPath = path.join(__dirname, '../assets/icon-tray.png');
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  } catch {
    // fallback：透明青绿圆点
    const iconPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR4nKWTwQ3AIAwEz50NcyZgJ' +
      '8/ChIqiiCAMwTcvfjZbIH7IgCoqggDJz7/6Z0BDwI4BpSFoQAmcnEGBqzHgx9BIAdANwHwDgS6mfkm+' +
      'SCl/BQU+0NDDAAAAAElFTkSuQmCC', 'base64');
    trayIcon = nativeImage.createFromBuffer(iconPng).resize({ width: 16, height: 16 });
  }
  const tray = new Tray(trayIcon);
  tray.setToolTip('洛天依桌宠');

  const toNativeItem = (item) => {
    const base = {
      label: String(item.label || '') + (item.hint ? `（${item.hint}）` : ''),
      enabled: !item.disabled,
    };
    if (item.type === 'submenu' && Array.isArray(item.items)) {
      base.submenu = item.items.map(toNativeItem);
      return base;
    }
    if (item.type === 'check') { base.type = 'checkbox'; base.checked = Boolean(item.checked); }
    if (item.type === 'radio') { base.type = 'radio'; base.checked = Boolean(item.checked); }
    base.click = () => {
      const { action, payload } = itemAction(item);
      ipc.dispatchAction(action, payload);
    };
    return base;
  };

  const rebuild = () => {
    const state = store.get();
    const flags = {
      ...ipc.getUiReport(),
      autoStart: Boolean(state.settings.autoStart),
    };
    const model = buildMenuModel({ state, flags });
    const template = [];
    model.forEach((group, gi) => {
      if (gi > 0) template.push({ type: 'separator' });
      for (const item of group.items) template.push(toNativeItem(item));
    });
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  rebuild();
  return { tray, rebuild };
}
