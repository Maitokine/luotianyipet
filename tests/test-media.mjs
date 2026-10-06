// media.js 单测：双通道（SMTC + 音频会话）解析、合并、轮询监听状态机（注入假 poll，不真起 PowerShell）
import {
  parseSmtcOutput, parseAudioOutput, mergeChannels, startMediaWatch,
  SMTC_PS_SCRIPT, AUDIO_PS_SCRIPT, AUDIO_IGNORE_PROCESSES,
} from '../src/main/media.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(t) {
  // ---- PowerShell 脚本自检 ----
  t.ok(SMTC_PS_SCRIPT.includes('GlobalSystemMediaTransportControlsSessionManager'), '脚本调用 WinRT SMTC API');
  t.ok(SMTC_PS_SCRIPT.includes('AsTask'), '脚本含 IAsyncOperation → Task 转换（WinRT await 模式）');
  t.ok(/(^|\n)\s*Write-Output 'READY'/.test(SMTC_PS_SCRIPT), '脚本成功取到 SessionManager 后输出 READY 哨兵');

  // 音频通道脚本自检（真机反馈：网易云不上报 SMTC，必须靠 Core Audio 会话）
  t.ok(AUDIO_PS_SCRIPT.includes('IAudioSessionManager2'), '音频脚本调用 Core Audio 会话管理接口');
  t.ok(AUDIO_PS_SCRIPT.includes('GetDefaultAudioEndpoint'), '音频脚本取默认渲染设备');
  t.ok(AUDIO_PS_SCRIPT.includes('GetProcessId'), '音频脚本读取会话所属进程');
  t.ok(/Write-Output 'AUDIO_READY'/.test(AUDIO_PS_SCRIPT), '音频脚本输出 AUDIO_READY 哨兵');
  t.ok(AUDIO_IGNORE_PROCESSES.includes('wallpaper'), '忽略名单含 Wallpaper Engine');
  t.ok(AUDIO_IGNORE_PROCESSES.includes('audio_web_helper'), '忽略名单含音频可视化插件');

  // ---- parseSmtcOutput ----
  t.eq(parseSmtcOutput(''), { playing: false, available: false, sessions: [] }, '空输出 → 不可用');
  t.eq(parseSmtcOutput('UNAVAILABLE'), { playing: false, available: false, sessions: [] }, 'UNAVAILABLE → 不可用');
  t.eq(parseSmtcOutput(null), { playing: false, available: false, sessions: [] }, 'null → 不可用');

  {
    const r = parseSmtcOutput('Chrome.Bad\x09|Playing');
    t.eq(r.available, true, '有会话 → 可用');
    t.eq(r.playing, true, 'Playing 状态 → 播放中');
    t.eq(r.sessions.length, 1, '解析出 1 个会话');
  }
  {
    const r = parseSmtcOutput('CloudMusic.exe|Paused\r\nChrome.Bad\x09|Stopped');
    t.eq(r.available, true, '多会话 → 可用');
    t.eq(r.playing, false, '无 Playing 会话 → 未播放');
    t.eq(r.sessions.length, 2, '解析出 2 个会话');
  }
  {
    // 自身会话过滤（selfName 包含匹配，忽略大小写）
    const out = 'C:\\Apps\\electron.exe|Playing\r\nCloudMusic.exe|Paused';
    const self = parseSmtcOutput(out, 'electron.exe');
    t.eq(self.playing, false, '仅自身在放 → 过滤后不算播放');
    t.eq(self.available, true, '过滤后仍有会话 → 可用');
    const other = parseSmtcOutput(out, 'someother.exe');
    t.eq(other.playing, true, '非自身 Playing → 算播放');
  }
  {
    const r = parseSmtcOutput('garbage line without pipe\nanother');
    t.eq(r.available, false, '无哨兵且无有效会话行 → 不可用（脚本异常）');
  }
  {
    const r = parseSmtcOutput('A|Playing|extra');
    t.eq(r.sessions[0].source, 'A|Playing', 'lastIndexOf 分隔：来源可含竖线');
    t.eq(r.sessions[0].status, 'extra', '状态取最后一个竖线之后');
  }

  // ---- READY 哨兵：区分「SMTC 可用但无会话」与「脚本失败」 ----
  // 真机反馈 bug 根因：旧实现把空会话当不可用 → 监听 15s 后永久停止 → 之后再放音乐不跳舞
  {
    const r = parseSmtcOutput('READY');
    t.eq(r.available, true, 'READY 哨兵 → SMTC 可用');
    t.eq(r.playing, false, '无会话 → 未播放');
    t.eq(r.sessions.length, 0, '会话列表为空');
  }
  {
    const r = parseSmtcOutput('READY\r\nCloudMusic.exe|Playing');
    t.eq(r.available, true, 'READY + 会话 → 可用');
    t.eq(r.playing, true, '网易云 Playing → 播放中');
    t.eq(r.sessions.length, 1, '解析出 1 个会话');
  }
  {
    const r = parseSmtcOutput('READY\nChrome|Paused');
    t.eq(r.available, true, 'READY + 仅暂停会话 → 可用');
    t.eq(r.playing, false, '仅 Paused → 未播放');
  }
  {
    // 哨兵行不能被当成会话行解析
    const r = parseSmtcOutput('READY\nCode.exe|Playing');
    t.eq(r.sessions.map((s) => s.source).join(','), 'Code.exe', 'READY 行不计入会话');
  }

  // ---- parseAudioOutput（音频会话通道）----
  // 真机反馈：网易云不向 SMTC 注册会话（SMTC 里只有 Chrome），
  // 但 Core Audio 会给出 cloudmusic 的 Active 音频会话。
  // 进程名以 Base64 传输（PowerShell 重定向输出中文进程名会乱码）。
  const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
  const a = (pid, proc, state) => `AUDIO|${pid}|${b64(proc)}|${state}`;

  t.eq(parseAudioOutput(''), { playing: false, available: false, sessions: [] }, '音频：空输出 → 不可用');
  t.eq(parseAudioOutput('AUDIO_UNAVAILABLE'), { playing: false, available: false, sessions: [] },
    '音频：脚本失败（无哨兵）→ 不可用');
  {
    const r = parseAudioOutput('AUDIO_READY');
    t.eq(r.available, true, '音频：AUDIO_READY → 可用');
    t.eq(r.playing, false, '音频：无会话 → 未播放');
  }
  {
    // 真机实测场景：网易云 Active + 壁纸 + 可视化插件
    const out = ['AUDIO_READY', a(14520, 'wallpaper64', 1), a(18048, 'cloudmusic', 1), a(20420, 'audio_web_helper', 1)].join('\n');
    const r = parseAudioOutput(out);
    t.eq(r.playing, true, '音频：网易云 Active → 播放中');
    t.eq(r.sessions.length, 3, '音频：会话明细完整保留');
    t.eq(r.sessions[1].proc, 'cloudmusic', '音频：Base64 进程名正确解码');
  }
  {
    // 真机实测场景：网易云停止后壁纸/可视化插件仍 Active，不得误判为播放
    const out = ['AUDIO_READY', a(14520, 'wallpaper64', 1), a(20420, 'audio_web_helper', 1), a(18048, 'cloudmusic', 0)].join('\n');
    t.eq(parseAudioOutput(out).playing, false,
      '音频：网易云转 Inactive、仅剩壁纸/可视化 → 未播放（关键：不得误报）');
  }
  {
    const out = ['AUDIO_READY', a(14520, 'wallpaper64', 1), a(20420, 'audio_web_helper', 1)].join('\n');
    t.eq(parseAudioOutput(out).playing, false, '音频：仅壁纸与可视化插件 Active → 未播放');
  }
  {
    t.eq(parseAudioOutput(`AUDIO_READY\n${a(0, 'Idle', 1)}`).playing, false, '音频：pid=0（系统声音）被排除');
  }
  {
    const out = ['AUDIO_READY', a(999, 'audiodg', 1), a(998, 'svchost', 1)].join('\n');
    t.eq(parseAudioOutput(out).playing, false, '音频：系统音频引擎/服务宿主被排除');
  }
  {
    // 关键回归防护：打包后桌宠进程名为中文，必须能正确解码并排除自身
    const out = `AUDIO_READY\n${a(777, '洛天依桌宠', 1)}`;
    t.eq(parseAudioOutput(out, '洛天依桌宠').playing, false, '音频：桌宠自身（中文进程名）放歌不算外部媒体');
    t.eq(parseAudioOutput(out, '其他应用').playing, true, '音频：非自身进程正常计入');
    t.eq(parseAudioOutput(out).sessions[0].proc, '洛天依桌宠', '音频：中文进程名无损传输');
  }
  {
    const out = `AUDIO_READY\n${a(888, 'Electron', 1)}`;
    t.eq(parseAudioOutput(out, 'electron').playing, false, '音频：自身过滤忽略大小写');
  }
  {
    const r = parseAudioOutput('AUDIO_READY\nAUDIO|ERR|device|-2147024890');
    t.eq(r.playing, false, '音频：ERR 行不计为播放');
    t.eq(r.sessions.length, 0, '音频：ERR 行不进入会话列表');
    t.eq(r.available, true, '音频：设备查询失败但探测本身可用');
  }
  {
    const out = `AUDIO_READY\n${a(111, 'QQMusic', 0)}`;
    const r = parseAudioOutput(out);
    t.eq(r.playing, false, '音频：Inactive 会话不算播放');
    t.eq(r.sessions.length, 1, '音频：Inactive 会话仍保留明细');
  }

  // ---- mergeChannels（两通道合并，纯函数）----
  {
    const none = { playing: false, available: false, sessions: [] };
    const play = { playing: true, available: true, sessions: [{ source: 'Chrome', status: 'Playing' }] };
    const idle = { playing: false, available: true, sessions: [{ source: 'Chrome', status: 'Paused' }] };

    let m = mergeChannels(idle, play);
    t.eq(m.playing, true, '合并：SMTC 未播 + 音频在播 → 播放中');
    t.eq(m.via, 'audio', '合并：来源标记 audio');
    t.eq(m.available, true, '合并：可用');

    m = mergeChannels(play, idle);
    t.eq(m.playing, true, '合并：SMTC 在播 + 音频静默 → 播放中');
    t.eq(m.via, 'smtc', '合并：来源标记 smtc');

    m = mergeChannels(play, play);
    t.eq(m.via, 'smtc', '合并：两通道都在播 → 优先标 smtc');

    m = mergeChannels(idle, idle);
    t.eq(m.playing, false, '合并：都没播 → 未播放');
    t.eq(m.via, null, '合并：无来源');

    m = mergeChannels(none, idle);
    t.eq(m.available, true, '合并：SMTC 不可用但音频可用 → 可用');
    m = mergeChannels(idle, none);
    t.eq(m.available, true, '合并：音频不可用但 SMTC 可用 → 可用');
    m = mergeChannels(none, none);
    t.eq(m.available, false, '合并：两通道都不可用 → 不可用');

    m = mergeChannels(undefined, play);
    t.eq(m.playing, true, '合并：容忍通道缺省');
  }

  // ---- startMediaWatch（注入 poll） ----
  {
    // 状态变化才上报
    const events = [];
    let n = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => ({ playing: (n++ % 2) === 0, available: true, sessions: [] }),
    });
    await sleep(80);
    w.stop();
    t.ok(events.length >= 2, `状态变化上报（${events.length} 次）`);
    t.ok(events.every((e) => e.available === true), '均可用');
    t.ok(events.some((e) => e.playing === true) && events.some((e) => e.playing === false), '播放态交替上报');
  }
  {
    // 状态不变不重复上报
    const events = [];
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => ({ playing: true, available: true, sessions: [] }),
    });
    await sleep(60);
    w.stop();
    t.eq(events.length, 1, '持续同一状态只上报一次');
  }
  {
    // 真机反馈根因：失败（含「无媒体会话」）不得永久停止监听，
    // 否则「先开桌宠、后开网易云/浏览器视频」会永远漏检 → 不跳舞。
    // 新行为：首次失败上报不可用，之后退避降频持续重试。
    const events = [];
    let polls = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      maxIntervalMs: 20,
      onStatus: (s) => events.push(s),
      poll: async () => { polls += 1; return { playing: false, available: false, sessions: [] }; },
    });
    await sleep(100);
    const p1 = polls;
    await sleep(80);
    const p2 = polls;
    w.stop();
    t.ok(p1 >= 3, `失败后持续轮询（100ms 内 ${p1} 次）`);
    t.ok(p2 > p1, `退避后仍在重试（${p1} → ${p2}），不再永久停止`);
    t.eq(events.length, 1, '仅首次失败上报不可用（不刷屏）');
    t.eq(events[0], { playing: false, available: false, via: null }, '失败上报不可用状态');
  }
  {
    // stop() 在失败态下同样立即生效
    const events = [];
    let polls = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => { polls += 1; return { playing: false, available: false, sessions: [] }; },
    });
    await sleep(30);
    w.stop();
    const p = polls;
    const e = events.length;
    await sleep(80);
    t.eq(polls, p, '失败态下 stop 后不再轮询');
    t.eq(events.length, e, '失败态下 stop 后无新事件');
  }
  {
    // 失败后恢复 → 必须重新上报（即使 playing 值与失败前相同）
    const events = [];
    const seq = [
      { playing: false, available: true, sessions: [] },  // 初始上报
      { playing: false, available: false, sessions: [] }, // 失败 1
      { playing: false, available: true, sessions: [] },  // 恢复（同 playing 值）
    ];
    let i = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => seq[Math.min(i++, seq.length - 1)],
    });
    await sleep(100);
    w.stop();
    t.eq(events.length, 3, '失败后恢复重新上报（共 3 次）');
    t.eq(events[2], { playing: false, available: true, via: null }, '恢复上报可用状态');
  }
  {
    // 通道来源 via 透传给上层（诊断用）：音频通道触发时标记 audio
    const events = [];
    let n = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => (n++ === 0
        ? { playing: false, available: true, sessions: [], via: null }
        : { playing: true, available: true, sessions: [], via: 'audio' }),
    });
    await sleep(60);
    w.stop();
    t.ok(events.some((e) => e.via === 'audio'), 'via 来源通道透传到回调');
  }
  {
    // stop() 立即生效
    const events = [];
    let polls = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => { polls += 1; return { playing: true, available: true, sessions: [] }; },
    });
    await sleep(20);
    w.stop();
    const p = polls;
    const e = events.length;
    await sleep(60);
    t.eq(polls, p, 'stop 后轮询计数不变');
    t.eq(events.length, e, 'stop 后无新事件');
  }
}
