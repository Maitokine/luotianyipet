// 系统媒体监听（M2 / K8）——双通道设计
//
// 通道一：SMTC（GlobalSystemMediaTransportControlsSessionManager，PowerShell 轮询）
//   能拿到"应用主动上报"的播放状态（Playing/Paused），精确、零依赖。
//   局限：需要应用自己实现 SMTC 上报。网易云音乐桌面版实测不上报
//   （真机验证：播放中 SMTC 里完全没有它的会话），所以单靠此通道覆盖不全。
//
// 通道二：Windows Core Audio 音频会话（WASAPI，PowerShell + 内联 C#）
//   枚举系统音频会话，看"哪个进程正在输出声音"（AudioSessionStateActive）。
//   不依赖应用配合，覆盖网易云/QQ音乐/各类客户端/浏览器。
//   实测语义可靠：播放时会话出现且 state=1，停止后会话直接消失。
//
// 判定：任一通道判定为"播放中"即视为系统在放媒体（playing = smtc || audio）。
import { spawn } from 'node:child_process';

// ─────────────────────────────────────────────────────────────
// 通道一：SMTC
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

// 解析一次 SMTC 轮询输出 → { playing, available, sessions }
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

// ─────────────────────────────────────────────────────────────
// 通道二：Core Audio 音频会话
//
// 会长期处于 Active、但并不代表"用户在看/听媒体"的进程，需要排除：
//   wallpaper*       Wallpaper Engine 动态壁纸（壁纸自带音频会一直出声）
//   audio_web_helper MiraBox/StreamDock 音频可视化插件（它在"监听"音频）
//   audiodg          Windows 音频引擎自身
//   svchost          系统服务宿主（系统提示音等）
// 另外始终排除 pid<=0（System Sounds / Idle）与桌宠自身进程。
export const AUDIO_IGNORE_PROCESSES = ['wallpaper', 'audio_web_helper', 'audiodg', 'svchost'];

// 音频会话枚举：C# 内联编译（PowerShell 自身无法把 COM 对象转成自定义接口，
// 必须把 COM 交互整体放进 C#）。输出 AUDIO|<pid>|<进程名Base64>|<state>
// 进程名走 Base64：PowerShell 重定向输出中文会乱码，会破坏"排除自身"的判断。
export const AUDIO_PS_SCRIPT = `
$ErrorActionPreference='SilentlyContinue'
try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}
$src = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, out IntPtr ppDevices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr SessionControl);
    int GetSimpleAudioVolume(IntPtr AudioSessionGuid, int StreamFlags, out IntPtr AudioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
    int RegisterSessionNotification(IntPtr SessionNotification);
    int UnregisterSessionNotification(IntPtr SessionNotification);
    int RegisterDuckNotification(string sessionID, IntPtr duckNotification);
    int UnregisterDuckNotification(IntPtr duckNotification);
}

[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionEnumerator {
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl2 Session);
}

[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioSessionControl2 {
    int GetState(out int pRetVal);
    int GetDisplayName(out IntPtr pRetVal);
    int SetDisplayName(string Value, IntPtr EventContext);
    int GetIconPath(out IntPtr pRetVal);
    int SetIconPath(string Value, IntPtr EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, IntPtr EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    int GetSessionIdentifier(out IntPtr pRetVal);
    int GetSessionInstanceIdentifier(out IntPtr pRetVal);
    int GetProcessId(out int pRetVal);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
}

public static class LtpetAudioSession {
    public static string[] List() {
        List<string> result = new List<string>();
        try {
            Guid clsid = new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E");
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)Activator.CreateInstance(Type.GetTypeFromCLSID(clsid));
            IMMDevice dev = null;
            int hr = en.GetDefaultAudioEndpoint(0, 1, out dev);
            if (hr != 0 || dev == null) { result.Add("ERR|device|" + hr); return result.ToArray(); }
            Guid iid = typeof(IAudioSessionManager2).GUID;
            object mgrObj = null;
            hr = dev.Activate(ref iid, 23, IntPtr.Zero, out mgrObj);
            if (hr != 0 || mgrObj == null) { result.Add("ERR|activate|" + hr); return result.ToArray(); }
            IAudioSessionManager2 mgr = (IAudioSessionManager2)mgrObj;
            IAudioSessionEnumerator sessEnum = null;
            hr = mgr.GetSessionEnumerator(out sessEnum);
            if (hr != 0 || sessEnum == null) { result.Add("ERR|enumerate|" + hr); return result.ToArray(); }
            int count = 0;
            sessEnum.GetCount(out count);
            for (int i = 0; i < count; i++) {
                IAudioSessionControl2 ctl = null;
                sessEnum.GetSession(i, out ctl);
                if (ctl == null) continue;
                int pid = 0;
                ctl.GetProcessId(out pid);
                int state = -1;
                ctl.GetState(out state);
                string name = "";
                try { name = Process.GetProcessById(pid).ProcessName; } catch { }
                // 进程名可能含中文（打包后桌宠进程名为「洛天依桌宠」）。
                // PowerShell 输出被重定向时编码不受 [Console]::OutputEncoding 控制
                // （实测中文变乱码），会让"排除自身"失效 → 统一 Base64 传输。
                string nameB64 = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(name));
                result.Add(pid + "|" + nameB64 + "|" + state);
            }
        } catch (Exception ex) {
            result.Add("ERR|exception|" + ex.GetType().Name);
        }
        return result.ToArray();
    }
}
'@
try { Add-Type -TypeDefinition $src -Language CSharp -ErrorAction Stop } catch { Write-Output 'AUDIO_UNAVAILABLE'; exit }
Write-Output 'AUDIO_READY'
foreach ($r in [LtpetAudioSession]::List()) { Write-Output ('AUDIO|' + $r) }
`;

// 进程名以 Base64 传输并在此解码（PowerShell 重定向输出中文进程名会乱码）
function decodeProcessName(b64) {
  try {
    return Buffer.from(String(b64 || ''), 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
}

// 解析音频会话输出 → { playing, available, sessions }
// 判定：存在任一「外部进程 && state=1(Active)」的音频会话即视为正在播放。
export function parseAudioOutput(stdout, selfName = '') {
  const text = String(stdout || '').trim();
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length === 0) return { playing: false, available: false, sessions: [] };
  const ready = lines.includes('AUDIO_READY');
  const sessions = [];
  for (const line of lines) {
    if (!line.startsWith('AUDIO|')) continue;
    const parts = line.slice('AUDIO|'.length).split('|');
    if (parts.length < 3) continue;
    const pid = Number(parts[0]);
    const state = Number(parts[2]);
    if (!Number.isFinite(pid) || !Number.isFinite(state)) continue; // ERR|... 行
    sessions.push({ pid, proc: decodeProcessName(parts[1]), state });
  }
  if (!ready) return { playing: false, available: false, sessions };
  const self = String(selfName || '').toLowerCase();
  const active = sessions.filter((s) => {
    if (s.state !== 1) return false;                                  // 仅 AudioSessionStateActive
    if (!(s.pid > 0)) return false;                                   // System Sounds / Idle
    const name = String(s.proc || '').toLowerCase();
    if (!name) return false;
    if (self && name.includes(self)) return false;                    // 桌宠自身（自己放歌不算外部媒体）
    if (AUDIO_IGNORE_PROCESSES.some((k) => name.includes(k))) return false; // 壁纸/可视化/系统
    return true;
  });
  return { playing: active.length > 0, available: true, sessions };
}

// ─────────────────────────────────────────────────────────────
function runPowerShell(script, parse, selfName, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result) => {
      if (!settled) { settled = true; resolve(result); }
    };
    let child;
    try {
      child = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true });
    } catch {
      done(parse('', selfName));
      return;
    }
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', () => {});
    child.on('error', () => done(parse('', selfName)));
    child.on('close', () => done(parse(out, selfName)));
    setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      done(parse('', selfName));
    }, timeoutMs);
  });
}

export function pollSmtcOnce(selfName, timeoutMs = 8000) {
  return runPowerShell(SMTC_PS_SCRIPT, parseSmtcOutput, selfName, timeoutMs);
}

export function pollAudioOnce(selfName, timeoutMs = 8000) {
  return runPowerShell(AUDIO_PS_SCRIPT, parseAudioOutput, selfName, timeoutMs);
}

// 合并两通道结果（纯函数，便于单测）：
//   任一通道判定播放 → playing；任一通道可用 → available。
//   via 记录判定来源（smtc 优先，其次 audio），用于诊断。
export function mergeChannels(smtc, audio) {
  const s = smtc || { playing: false, available: false, sessions: [] };
  const a = audio || { playing: false, available: false, sessions: [] };
  return {
    playing: Boolean(s.playing || a.playing),
    available: Boolean(s.available || a.available),
    sessions: s.sessions || [],
    audioSessions: a.sessions || [],
    via: s.playing ? 'smtc' : (a.playing ? 'audio' : null),
  };
}

// 一次完整轮询：两通道并行（耗时取较长者，而非相加）。
// 真机反馈修复：网易云音乐不向 SMTC 上报（SMTC 里没有它的会话），
// 必须靠音频会话通道才能检测到；而音频通道对壁纸/可视化插件不可靠，
// 所以两通道互为补充。
export async function pollOnce(selfName, timeoutMs = 8000) {
  const [smtc, audio] = await Promise.all([
    pollSmtcOnce(selfName, timeoutMs),
    pollAudioOnce(selfName, timeoutMs),
  ]);
  return mergeChannels(smtc, audio);
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
      if (failures === 1) onStatus({ playing: false, available: false, via: null });
    } else {
      if (failures > 0) lastPlaying = null; // 从失败恢复 → 强制重报一次可用态
      failures = 0;
      if (r.playing !== lastPlaying) {
        lastPlaying = r.playing;
        onStatus({ playing: r.playing, available: true, via: r.via || null });
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
