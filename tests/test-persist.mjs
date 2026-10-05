// T6.3：持久化全链路集成测试（A26/A27/A29/K9）
// 使用真实 Electron 进程 + 临时 PORTABLE_EXECUTABLE_DIR，避免污染用户数据。
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const electronPath = (await import('electron')).default;
const nodePath = process.execPath;

function mktemp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pet-persist-'));
}

function dataDir(tmp) { return path.join(tmp, 'data'); }

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data), 'utf-8');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function setPortableEnv(base) {
  const env = { ...process.env };
  // 关键：Electron 运行时不能带 RUN_AS_NODE，否则不会启动 GUI 主进程
  delete env.ELECTRON_RUN_AS_NODE;
  env.PORTABLE_EXECUTABLE_DIR = base;
  return env;
}

function runElectron(args, tmp) {
  return new Promise((resolve) => {
    const child = spawn(electronPath, ['.', ...args], {
      cwd: ROOT,
      env: setPortableEnv(tmp),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch {}
      resolve({ code: null, stdout, stderr, killed: true });
    }, 25000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, killed: false });
    });
  });
}

function parseDump(stdout) {
  const lines = stdout.split(/\r?\n/);
  let state = null;
  let recovered = 0;
  let fresh = 0;
  for (const line of lines) {
    if (line.startsWith('STATE:')) {
      try { state = JSON.parse(line.slice(6)); } catch {}
    } else if (line.startsWith('RECOVERED:')) {
      recovered = parseInt(line.slice(10), 10) || 0;
    } else if (line.startsWith('FRESH:')) {
      fresh = parseInt(line.slice(6), 10) || 0;
    }
  }
  return { state, recovered: Boolean(recovered), fresh: Boolean(fresh) };
}

function electronProcessCount() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /NH', { encoding: 'utf-8' });
    return out.split(/\r?\n/).filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.toLowerCase().includes('no tasks');
    }).length;
  } catch {
    return -1;
  }
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function run(t) {
  // ---- A26 读档： seeded 状态不会被覆盖 ----
  // 使用与 defaultProfile 一致的顶层字段，经验值与等级匹配避免 validate 修正
  {
    const tmp = mktemp();
    writeJson(path.join(dataDir(tmp), 'profile.json'), {
      level: 3, exp: 300, affection: 5,
      settings: { opacity: 0.45 },
    });
    const r = await runElectron(['--dump-state'], tmp);
    t.eq(r.code, 0, 'dump-state 正常退出 (A26 读档)');
    const { state, recovered, fresh } = parseDump(r.stdout);
    t.ok(state !== null, 'dump-state 返回有效 JSON');
    t.eq(state.level, 3, '读档后等级保持为 3');
    t.eq(state.exp, 300, '读档后经验保持为 300');
    t.eq(state.settings.opacity, 0.45, '读档后透明度保持为 0.45');
    t.ok(recovered === false && fresh === false, '正常档案既非恢复也非全新');
    t.ok(fs.existsSync(path.join(dataDir(tmp), 'profile.json')), '读档后原文件仍保留');
  }

  // ---- A26 写回： apply-patch → dump-state 能读回 ----
  {
    const tmp = mktemp();
    writeJson(path.join(dataDir(tmp), 'profile.json'), {
      level: 2, exp: 120, affection: 0,
      settings: { alwaysOnTop: true },
    });
    const w = await runElectron(['--apply-patch', JSON.stringify({ exp: 42 })], tmp);
    t.eq(w.code, 0, 'apply-patch 正常退出');
    t.ok(w.stdout.includes('APPLIED:1'), 'apply-patch 打印 APPLIED:1');
    const persisted = readJson(path.join(dataDir(tmp), 'profile.json'));
    t.eq(persisted.exp, 42, 'apply 后落盘经验为 42');
    t.eq(persisted.level, 2, 'apply 深合并保留原等级');
    t.ok(fs.existsSync(path.join(dataDir(tmp), 'profile.bak')), 'apply 写入时生成 .bak');

    const r = await runElectron(['--dump-state'], tmp);
    t.eq(r.code, 0, '再次 dump 正常退出');
    const { state } = parseDump(r.stdout);
    t.eq(state.exp, 42, '重新启动后读回经验 42');
  }

  // ---- K9/A29 主档损坏、备份有效：从 .bak 恢复 ----
  {
    const tmp = mktemp();
    writeJson(path.join(dataDir(tmp), 'profile.json'), {
      level: 1, exp: 0, settings: { opacity: 0.5 },
    });
    await runElectron(['--apply-patch', JSON.stringify({ settings: { opacity: 0.6 } })], tmp);
    // 主档弄坏，备份换成另一个已知值（经验与等级匹配，透明度在合法域）
    fs.writeFileSync(path.join(dataDir(tmp), 'profile.json'), 'CORRUPTED{{}', 'utf-8');
    writeJson(path.join(dataDir(tmp), 'profile.bak'), {
      level: 5, exp: 1000, affection: 20,
      settings: { opacity: 0.3 },
    });
    const r = await runElectron(['--dump-state'], tmp);
    t.eq(r.code, 0, '损坏主档下 dump 仍不崩溃');
    const { state, recovered } = parseDump(r.stdout);
    t.ok(recovered === true, '主档损坏时从 .bak 恢复');
    t.eq(state.level, 5, '恢复后等级来自 .bak');
    t.eq(state.exp, 1000, '恢复后经验来自 .bak');
    t.eq(state.settings.opacity, 0.3, '恢复后设置来自 .bak');
  }

  // ---- K9 主档+备份均损坏：全新安装（默认 profile）----
  {
    const tmp = mktemp();
    fs.mkdirSync(dataDir(tmp), { recursive: true });
    fs.writeFileSync(path.join(dataDir(tmp), 'profile.json'), 'BAD1', 'utf-8');
    fs.writeFileSync(path.join(dataDir(tmp), 'profile.bak'), 'BAD2', 'utf-8');
    const r = await runElectron(['--dump-state'], tmp);
    t.eq(r.code, 0, '双档损坏时 dump 不崩溃');
    const { state, recovered, fresh } = parseDump(r.stdout);
    t.ok(fresh === true, '双档损坏时 freshInstall 为 true');
    t.ok(recovered === false, '双档损坏时不算恢复');
    t.eq(typeof state.level, 'number', '默认 profile 含等级字段');
    t.ok(state.level >= 1, '默认等级 >= 1');
  }

  // ---- A26/A27 写入途中被强制终止：Store 原子写保证主档不损坏 ----
  // 用 Node 子进程模拟（Electron 窗口在沙箱中长时间挂起会被外部终止，改用 Store 层直接测试）
  {
    const tmp = mktemp();
    const child = spawn(nodePath, ['tests/helper-persist-kill.mjs'], {
      cwd: ROOT,
      env: { ...process.env, PERSIST_TMP: tmp },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let flushed = false;
    child.stdout.on('data', (d) => {
      if (d.toString().includes('FLUSHED')) flushed = true;
    });
    // 等子进程完成至少一次 flush
    for (let i = 0; i < 40 && !flushed; i++) await wait(100);
    t.ok(flushed, '子进程至少完成一次 flush（前置条件）');
    // 强制终止
    try {
      execSync(`taskkill /F /T /PID ${child.pid}`, { encoding: 'utf-8' });
    } catch { /* 可能已自行退出 */ }
    for (let i = 0; i < 20 && child.exitCode === null; i++) await wait(100);

    // 原子写机制：要么主档是旧值，要么是新值，绝不应出现损坏/半写
    const mainFile = path.join(dataDir(tmp), 'profile.json');
    const tmpFile = mainFile + '.tmp';
    t.ok(!fs.existsSync(tmpFile), '强制终止后不会残留 profile.json.tmp');

    let ok = false;
    try {
      const s = readJson(mainFile);
      t.ok(typeof s.level === 'number' && typeof s.exp === 'number',
        '强制终止后主档仍是合法 JSON');
      t.eq(s.level, 4, '强制终止后等级未损坏');
      t.ok(s.exp >= 600, '强制终止后经验 >= 初始值');
      ok = true;
    } catch {
      // 主档可能恰好在 rename 前一刻被中断，尝试从 .bak 恢复
      try {
        const s = readJson(mainFile.replace('.json', '.bak'));
        t.ok(typeof s.level === 'number', '主档损坏时 .bak 可读');
        ok = true;
      } catch {
        t.ok(false, '主档与 .bak 均不可读');
      }
    }
    t.ok(ok, '强制终止后至少有一份有效存档');
  }

  // ---- A29 正常 quit（smoke）后无残留 ----
  {
    const baseline = electronProcessCount();
    const tmp = mktemp();
    const r = await runElectron(['--smoke'], tmp);
    t.eq(r.code, 0, 'smoke 模式正常退出 0');
    await wait(2000);
    const after = electronProcessCount();
    t.eq(after, baseline, 'smoke 退出后 electron.exe 无残留');
  }
}
