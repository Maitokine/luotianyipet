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
$netTask.Wait(3000)|Out-Null
$mgr=$netTask.Result
if($null -eq $mgr){ Write-Output 'UNAVAILABLE'; exit }
foreach($s in $mgr.GetSessions()){
  $info=$s.GetPlaybackInfo()
  if($null -ne $info){ Write-Output ($s.SourceAppUserModelId+'|'+$info.PlaybackStatus) }
}
`;

// 解析一次轮询输出 → { playing, available, sessions }
export function parseSmtcOutput(stdout, selfName = '') {
  const text = String(stdout || '').trim();
  if (!text) return { playing: false, available: false, sessions: [] };
  if (text.includes('UNAVAILABLE')) return { playing: false, available: false, sessions: [] };
  const sessions = [];
  for (const line of text.split(/\r?\n/)) {
    const idx = line.lastIndexOf('|');
    if (idx <= 0) continue;
    const source = line.slice(0, idx);
    const status = line.slice(idx + 1).trim();
    if (!status) continue;
    sessions.push({ source, status });
  }
  if (sessions.length === 0) return { playing: false, available: false, sessions: [] };
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

export function pollOnce(selfName, timeoutMs = 4000) {
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

// 持续监听：每 intervalMs 轮询一次，状态变化时回调；连续 3 次失败标记不可用并停止
// poll 可注入（单测用假轮询器）
export function startMediaWatch({ intervalMs = 5000, selfName = '', onStatus, poll = null } = {}) {
  const doPoll = poll || ((sn) => pollOnce(sn));
  let stopped = false;
  let failures = 0;
  let lastPlaying = null;

  const tick = async () => {
    if (stopped) return;
    const r = await doPoll(selfName);
    if (stopped) return;
    if (!r.available) {
      failures += 1;
      lastPlaying = null; // 失败后重置：恢复时必须重新上报（即使 playing 值相同）
      if (failures === 1) onStatus({ playing: false, available: false });
      if (failures >= 3) { stopped = true; return; }
    } else {
      failures = 0;
      if (r.playing !== lastPlaying) {
        lastPlaying = r.playing;
        onStatus({ playing: r.playing, available: true });
      }
    }
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
