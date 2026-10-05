// 真实环境自检（--selftest）：在真实 Electron 渲染进程中验证
// 番茄钟 tick 驱动、气泡 setTimeout、音乐点歌/歌词链路是否真的工作。
// 结果经 selftest:log IPC 打到主进程 stdout，供开发定位运行时问题。

export async function runSelftest({ api, reminders, bubble, music, fsm, doc }) {
  const log = (m) => { try { api.selftestLog(String(m)); } catch { /* ignore */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    // ---- 1) 番茄钟 + 气泡（并行计时） ----
    reminders.startPomodoro();
    const remain0 = reminders.pomodoro.remain;
    log(`pomo started phase=${reminders.pomodoro.phase} remain0=${remain0}`);
    bubble.say('自检气泡 4 秒后应消失', 4000);

    // ---- 2) 音乐点歌（真实网络 + 真实 <audio>） ----
    await music.startSing();
    log(`music singing=${fsm.singing ? 1 : 0} source=${music.source} song=${music.song ? music.song.name : 'none'}`);

    await sleep(3200);
    const remain1 = reminders.pomodoro.remain;
    const badgeText = (doc.getElementById('badge') || {}).textContent || '';
    log(`pomo after3.2s remain=${remain1} delta=${remain0 - remain1} badge="${badgeText}"`);

    await sleep(1400); // 累计 4.6s > 4s 气泡时长
    const bubbleEl = doc.getElementById('bubble');
    const bubbleHidden = bubbleEl ? bubbleEl.classList.contains('hidden') : 'no-el';
    log(`bubble hiddenAfter4.6s=${bubbleHidden}`);

    // ---- 3) 音乐播放态与歌词 ----
    const audio = music.audio;
    const cur = audio ? (audio.currentTime || 0).toFixed(2) : 'none';
    const dur = audio && audio.duration ? audio.duration.toFixed(1) : 'none';
    const paused = audio ? (audio.paused ? 1 : 0) : 'none';
    const lyricText = (doc.getElementById('lyric-text') || {}).textContent || '';
    log(`music audio currentTime=${cur} duration=${dur} paused=${paused}`);
    log(`music lyricText="${lyricText}" syncLines=${music.sync ? music.sync.lines.length : 'none'}`);

    // ---- 4) 打断态健康状况 ----
    log(`fsm interrupt=${fsm.interrupt ? fsm.interrupt.type : 'none'} daily=${fsm.daily}`);

    // 清理
    music.stopSing();
    reminders.stopPomodoro();
    log('cleanup done');
  } catch (e) {
    log(`ERROR ${e && e.message ? e.message : String(e)}`);
  }
  api.selftestDone();
}
