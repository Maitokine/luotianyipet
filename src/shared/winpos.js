// 共享：桌宠窗口位置计算（主进程建窗 / 拖动 / 「找回小人」共用；纯函数，Node 可测）
//
// 背景：桌宠是 300×420 的**透明无边框**窗口。一旦它大部分落在屏幕工作区之外，
// 由于窗口本身没有可见背景，用户会完全看不到小人——但主进程一切正常（托盘图标在、
// 媒体监听在、音乐照放），表现就是"小人没出现，但功能都在"。
// 因此凡是把窗口摆到某个位置的地方（初始落点、找回、拖动落档），都必须保证它可见。

// 把位置夹取到工作区内，保证整个窗口都落在屏幕上。
// 非法/缺失位置返回 null（调用方自行回退到 defaultPos）。
export function clampToWorkArea(pos, workArea, W, H) {
  if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return null;
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return null;
  const maxX = workArea.x + Math.max(0, workArea.width - W);
  const maxY = workArea.y + Math.max(0, workArea.height - H);
  return {
    x: Math.round(Math.min(Math.max(pos.x, workArea.x), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, workArea.y), maxY)),
  };
}

// 默认落点：工作区右下角（横向留 60px 边距，纵向贴底）
export function defaultPos(workArea, W, H) {
  return clampToWorkArea(
    { x: workArea.x + workArea.width - W - 60, y: workArea.y + workArea.height - H },
    workArea,
    W,
    H,
  );
}

// 窗口是否"足够可见"：至少 ratio 比例的面积落在某块屏幕的工作区内。
// displays 为 Electron 的 screen.getAllDisplays() 结果（含 workArea）。
export function isSufficientlyVisible(bounds, displays, ratio = 0.6) {
  if (!bounds || !Array.isArray(displays) || displays.length === 0) return false;
  if (!(bounds.width > 0) || !(bounds.height > 0)) return false;
  const need = bounds.width * bounds.height * ratio;
  for (const d of displays) {
    const a = (d && (d.workArea || d.bounds)) || null;
    if (!a) continue;
    const ix = Math.max(0, Math.min(bounds.x + bounds.width, a.x + a.width) - Math.max(bounds.x, a.x));
    const iy = Math.max(0, Math.min(bounds.y + bounds.height, a.y + a.height) - Math.max(bounds.y, a.y));
    if (ix * iy >= need) return true;
  }
  return false;
}
