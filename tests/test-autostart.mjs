// T6.1 开机自启（A28）：portable 路径解析 + 注册调用 + 失败不落档语义
// 全部用注入的假 app / 假 env，不触碰真实注册表
import {
  resolveAutoStartPath,
  applyAutoStart,
} from '../src/main/autostart.js';

function makeAppSpy(throwErr = null) {
  const calls = [];
  return {
    calls,
    setLoginItemSettings(opts) {
      if (throwErr) throw throwErr;
      calls.push(opts);
    },
  };
}

export function run(t) {
  // ---- resolveAutoStartPath：portable 优先 ----
  t.eq(
    resolveAutoStartPath({ PORTABLE_EXECUTABLE_FILE: 'X:/pet/洛天依桌宠.exe' }),
    'X:/pet/洛天依桌宠.exe',
    'portable 环境变量存在时返回真实 exe 路径',
  );
  t.eq(
    resolveAutoStartPath({}),
    process.execPath,
    '无 portable 变量时回退 process.execPath（开发态）',
  );
  t.eq(
    resolveAutoStartPath({ PORTABLE_EXECUTABLE_FILE: '' }),
    process.execPath,
    'portable 变量为空串视为缺失，回退 execPath',
  );
  t.eq(resolveAutoStartPath(), process.execPath, '不传 env 默认读 process.env 不抛错');

  // ---- applyAutoStart：正常调用 ----
  const app1 = makeAppSpy();
  const r1 = applyAutoStart({ app: app1, enabled: true, env: { PORTABLE_EXECUTABLE_FILE: 'D:/pet/pet.exe' } });
  t.ok(r1.ok === true, '注册成功返回 ok:true');
  t.eq(app1.calls.length, 1, 'setLoginItemSettings 恰好调用一次');
  t.eq(
    app1.calls[0],
    { openAtLogin: true, path: 'D:/pet/pet.exe' },
    '开启时参数：openAtLogin:true + portable 真实路径',
  );

  const app2 = makeAppSpy();
  applyAutoStart({ app: app2, enabled: false, env: {} });
  t.eq(
    app2.calls[0].openAtLogin,
    false,
    '关闭时 openAtLogin:false',
  );
  t.ok(typeof app2.calls[0].path === 'string' && app2.calls[0].path.length > 0, '关闭调用同样携带 path');

  // 布尔规整：truthy/falsy 统一
  const app3 = makeAppSpy();
  applyAutoStart({ app: app3, enabled: 1, env: {} });
  t.eq(app3.calls[0].openAtLogin, true, 'enabled 传 1 规整为 true');

  // ---- applyAutoStart：异常与防御 ----
  const r2 = applyAutoStart({ app: makeAppSpy(new Error('registry denied')), enabled: true, env: {} });
  t.ok(r2.ok === false && typeof r2.error === 'string' && r2.error.includes('registry'),
    '底层抛错时返回 ok:false 带错误信息（调用方据此不落档）');

  const r3 = applyAutoStart({ app: null, enabled: true });
  t.ok(r3.ok === false, 'app 为 null 返回 ok:false');
  const r4 = applyAutoStart({ app: {}, enabled: true });
  t.ok(r4.ok === false, 'app 缺少 setLoginItemSettings 方法返回 ok:false');
  const r5 = applyAutoStart();
  t.ok(r5.ok === false, '完全不传参数返回 ok:false 而非抛错');
}
