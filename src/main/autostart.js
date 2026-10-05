// 开机自启（K10/A28）
// portable 目标下 electron-builder 的启动器先把 app 解压到临时目录再运行，
// 此时 process.execPath 指向临时目录里的 exe——注册表自启若用它，
// 下次开机就会指向一个已不存在的路径。必须改用启动器注入的
// PORTABLE_EXECUTABLE_FILE（真实 portable exe 全路径）。
// 依赖注入 app/env 便于单测，不触碰真实注册表。

export function resolveAutoStartPath(env = process.env) {
  const portable = env && typeof env === 'object' ? env.PORTABLE_EXECUTABLE_FILE : '';
  return portable || process.execPath;
}

// 返回 {ok:true} | {ok:false,error}；成功才允许把开关状态落档，
// 避免 UI 勾选态与注册表实际状态不一致。
export function applyAutoStart({ app, enabled, env = process.env } = {}) {
  if (!app || typeof app.setLoginItemSettings !== 'function') {
    return { ok: false, error: 'app.setLoginItemSettings unavailable' };
  }
  try {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: resolveAutoStartPath(env),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}
