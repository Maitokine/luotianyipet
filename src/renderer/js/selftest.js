// 真实环境自检（--selftest）：在真实 Electron 渲染进程中验证
// 番茄钟 tick 驱动、气泡 setTimeout、音乐点歌/歌词链路、右键菜单点击链路是否真的工作。
// 结果经 selftest:log IPC 打到主进程 stdout，供开发定位运行时问题。

export async function runSelftest({ api, reminders, bubble, music, fsm, doc, menu, windowctl }) {
  const log = (m) => { try { api.selftestLog(String(m)); } catch { /* ignore */ } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const win = (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const MouseEventCtor = win ? win.MouseEvent : null;
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

    // ---- 5) 右键菜单链路（真机反馈 bug1：点击无反应 + 显示不全） ----
    if (menu && win && MouseEventCtor) {
      const openMenu = () => win.dispatchEvent(new MouseEventCtor('contextmenu', {
        clientX: 150, clientY: 120, bubbles: true, cancelable: true,
      }));
      const findItem = (text) => {
        const el = doc.getElementById('menu');
        if (!el) return null;
        return Array.from(el.querySelectorAll('.menu-item'))
          .find((r) => r.textContent && r.textContent.includes(text)) || null;
      };
      const clickItem = (el) => {
        el.dispatchEvent(new MouseEventCtor('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEventCtor('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEventCtor('click', { bubbles: true, cancelable: true }));
      };

      // 模拟用户右键角色：pet.js 的 contextmenu 监听器打开菜单 → setMenuOpen(true) → 全窗可交互
      openMenu();
      const menuEl = doc.getElementById('menu');
      const rows = menuEl ? menuEl.querySelectorAll('.menu-item') : [];
      log(`menu open=${menu.isOpen} interactive=${windowctl ? windowctl.interactive : 'n/a'}` +
        ` h=${menuEl ? menuEl.offsetHeight : 'no-el'} vh=${win.innerHeight} rows=${rows.length}`);
      // 点击"置顶"项（安全动作：仅 setState 开关），验证 mousedown→click→onAction→close 全链路
      const target = findItem('置顶');
      if (target) {
        clickItem(target);
        await sleep(120);
        log(`menu click 置顶 → closed=${!menu.isOpen} interactiveAfter=${windowctl ? windowctl.interactive : 'n/a'}`);
      } else {
        log('menu target(置顶) not found');
      }
      if (menu.isOpen) menu.close();

      // 主进程转发链路（bug1 根因验证）：点「显示 / 隐藏」→ 渲染层 sendAction 转发主进程
      // dispatchAction → win.hide() → visibilityState 应变 hidden；再点一次恢复 visible。
      // 注意：窗口隐藏后渲染层计时器被节流（backgroundThrottling 默认开），等待放宽到 1s。
      openMenu();
      await sleep(60);
      const toggleItem = findItem('显示 / 隐藏');
      if (toggleItem) {
        clickItem(toggleItem);
        await sleep(1000);
        log(`menu win.toggle-visible → visibility=${doc.visibilityState}`);
        openMenu(); // 隐藏态下 DOM 合成事件依旧可派发
        await sleep(200);
        const restoreItem = findItem('显示 / 隐藏');
        if (restoreItem) {
          clickItem(restoreItem);
          await sleep(1000);
          log(`menu win.toggle-visible(restore) → visibility=${doc.visibilityState}`);
        } else {
          log('menu restore item not found');
          api.sendAction('win.toggle-visible'); // 兜底：直接转发恢复显示
        }
        if (menu.isOpen) menu.close();
      } else {
        log('menu target(显示 / 隐藏) not found');
      }
    } else {
      log('menu selftest skipped (no menu/win)');
    }

    // 清理
    music.stopSing();
    reminders.stopPomodoro();
    log('cleanup done');
  } catch (e) {
    log(`ERROR ${e && e.message ? e.message : String(e)}`);
  }
  api.selftestDone();
}
