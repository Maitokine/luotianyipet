// media.js 单测：SMTC 输出解析 + 轮询监听状态机（注入假 poll，不真起 PowerShell）
import { parseSmtcOutput, startMediaWatch, SMTC_PS_SCRIPT } from '../src/main/media.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(t) {
  // ---- PowerShell 脚本自检 ----
  t.ok(SMTC_PS_SCRIPT.includes('GlobalSystemMediaTransportControlsSessionManager'), '脚本调用 WinRT SMTC API');
  t.ok(SMTC_PS_SCRIPT.includes('AsTask'), '脚本含 IAsyncOperation → Task 转换（WinRT await 模式）');

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
    t.eq(r.available, false, '无有效会话行 → 不可用');
  }
  {
    const r = parseSmtcOutput('A|Playing|extra');
    t.eq(r.sessions[0].source, 'A|Playing', 'lastIndexOf 分隔：来源可含竖线');
    t.eq(r.sessions[0].status, 'extra', '状态取最后一个竖线之后');
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
    // 连续 3 次失败 → 停止（首次失败上报不可用）
    const events = [];
    let polls = 0;
    const w = startMediaWatch({
      intervalMs: 5,
      onStatus: (s) => events.push(s),
      poll: async () => { polls += 1; return { playing: false, available: false, sessions: [] }; },
    });
    await sleep(120);
    const pollsAfterStop = polls;
    await sleep(60);
    w.stop();
    t.eq(polls, pollsAfterStop, '停止后不再轮询');
    t.ok(polls >= 3 && polls <= 4, `连续 3 次失败后自停（实际轮询 ${polls} 次）`);
    t.eq(events.length, 1, '仅首次失败上报不可用');
    t.eq(events[0], { playing: false, available: false }, '失败上报不可用状态');
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
    t.eq(events[2], { playing: false, available: true }, '恢复上报可用状态');
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
