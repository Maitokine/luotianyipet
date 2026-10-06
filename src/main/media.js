// SMTC 系统媒体监听（M2 / K8 替代方案：PowerShell 轮询，零原生模块依赖）
// 原理：PowerShell 调用 WinRT GlobalSystemMediaTransportControlsSessionManager，
// 列出所有媒体会话（网易云/QQ音乐/浏览器等），过滤自身后判断是否有"Playing"。
import { spawn } from 'node:child_process';

export const SMTC_PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
$op=([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -like 'IAsyncOperation*'})[0]
$netTask=$asTask.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]).Invoke($null,@($op))
$netTask.Wait(5000)|Out-Null
$mgr=$netTask.Result
if($null -eq $mgr){ Write-Output 'UNAVAILABLE'; exit }
Write-Output 'READY'
foreach($s in $mgr.GetSessions()){
  $info=$s.GetPlaybackInfo()
  if($null -ne $info){ Write-Output ($s.SourceAppUserModelId+'|'+$info.PlaybackStatus) }
}
`;

// 解析一次轮询输出 → { playing, available, sessions }
//
// 真机反馈 bug 根因：旧实现把「SMTC 可用但当前没有任何媒体会话」当成「SMTC 不可用」——
// 脚本在无会话时输出为空 → 判 available:false → startMediaWatch 累计 3 次后永久停止监听，
// 于是"先开桌宠、后开网易云/浏览器视频"的场景再也不会跳舞。
// 现在脚本成功拿到 SessionManager 后固定输出 READY 哨兵：
//   含 READY   → SMTC 可用（会话列表允许为空）
//   含 UNAVAILABLE / 空输出 / 无哨兵且无有效会话行 → 真不可用
export function parseSmtcOutput(stdout, selfName = '') {
  const text = String(stdout || '').trim();
  if (!text) return { playing: false, available: false, sessions: [] };
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.includes('UNAVAILABLE')) return { playing: false, available: false, sessions: [] };
  const ready = lines.includes('READY');
  const sessions = [];
  for (const line of lines) {
    if (line === 'READY' || line === 'UNAVAILABLE') continue;
    const idx = line.lastIndexOf('|');
    if (idx <= 0) continue;
    const source = line.slice(0, idx);
    const status = line.slice(idx + 1).trim();
    if (!status) continue;
    sessions.push({ source, status });
  }
  // 无 READY 哨兵且解析不出任何会话 → 脚本异常/输出损坏 → 不可用
  if (!ready && sessions.length === 0) return { playing: false, available: false, sessions: [] };
  const self = selfName.toLowerCase();
  const others = sessions.filter((s) => {
    if (!self) return true;
    const src = s.source.toLowerCase();
    return !src.includes(self);
  });
  return {
    playing: others.some((s) => s.status === 'Playing'),
    available: true,
    sessions,
  };
}

export function pollOnce(selfName, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) { settled = true; resolve(result); }
    };
    let child;
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', SMTC_PS_SCRIPT],
        { windowsHide: true });
    } catch {
      done({ playing: false, available: false, sessions: [] });
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', () => {});
    child.on('error', () => done({ playing: false, available: false, sessions: [] }));
    child.on('close', () => done(parseSmtcOutput(out, selfName)));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      done({ playing: false, available: false, sessions: [] });
    }, timeoutMs);
  });
}

// 持续监听：每 intervalMs 轮询一次，状态变化时回调。
// 真机反馈根因修复：旧实现在连续 3 次失败后永久停止，导致「先启动桌宠（当时无媒体会话）、
// 后打开网易云/浏览器视频」时再也检测不到播放。现在改为退避降频持续重试（intervalMs
// 翻倍至 maxIntervalMs 封顶），仅在显式 stop() 时结束；SMTC 恢复后自动回到正常频率。
// poll 可注入（单测用假轮询器）
export function startMediaWatch({
  intervalMs = 5000,
  maxIntervalMs = 30000,
  selfName = '',
  onStatus,
  poll = null,
} = {}) {
  const doPoll = poll || ((sn) => pollOnce(sn));
  let stopped = false;
  let failures = 0;
  let lastPlaying = null;
  let timer = null;

  // 连续失败 → 指数退避（5s→10s→20s→30s 封顶），恢复后立即回到 intervalMs
  const nextDelay = () => (failures > 0
    ? Math.min(maxIntervalMs, intervalMs * (2 ** failures))
    : intervalMs);

  const tick = async () => {
    if (stopped) return;
    const r = await doPoll(selfName);
    if (stopped) return;
    if (!r.available) {
      failures += 1;
      lastPlaying = null; // 失败后重置：恢复时必须重新上报（即使 playing 值相同）
      if (failures === 1) onStatus({ playing: false, available: false });
    } else {
      if (failures > 0) lastPlaying = null; // 从失败恢复 → 强制重报一次可用态
      failures = 0;
      if (r.playing !== lastPlaying) {
        lastPlaying = r.playing;
        onStatus({ playing: r.playing, available: true });
      }
    }
    if (stopped) return;
    timer = setTimeout(tick, nextDelay());
  };

  tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
