// music.js 单测：假 <audio>/假 IPC 驱动的播放控制器（A17/A18/A19/A22 结算链）
import { Music, REWARD_RATIO, HUM_MS, idleSingChance, IDLE_SING_CHANCE } from '../src/renderer/js/music.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeFsm({ allowBegin = true } = {}) {
  return {
    _singing: false,
    allowBegin,
    get singing() { return this._singing; },
    beginCalls: 0,
    endCalls: 0,
    triggers: [],
    beginSing() {
      this.beginCalls += 1;
      if (!this.allowBegin) return false;
      this._singing = true;
      return true;
    },
    endSing() { this.endCalls += 1; this._singing = false; },
    trigger(ev) { this.triggers.push(ev); return 'sing-request'; },
  };
}

function fakeBubble() {
  return {
    says: [],
    lyrics: [],
    hideLyricCalls: 0,
    say(text, ms) { this.says.push({ text, ms }); },
    lyric(text, song) { this.lyrics.push({ text, song }); },
    hideSay() {},
    hideLyric() { this.hideLyricCalls += 1; },
    fx() {}, badge() {}, hideBadge() {}, clearFx() {},
  };
}

function fakeGrowth() {
  return {
    tierKey: () => 'friend',
    songRewards: 0,
    onSongCompleted() { this.songRewards += 1; },
    onActivity() {},
  };
}

function fakeDialogue() {
  return {
    picks: [],
    pick(scene) { this.picks.push(scene); return `${scene}的台词`; },
  };
}

function fakeAudio() {
  return {
    url: '',
    currentTime: 0,
    duration: 100,
    listeners: {},
    playCalls: 0,
    pauseCalls: 0,
    addEventListener(ev, fn) {
      (this.listeners[ev] = this.listeners[ev] || []).push(fn);
    },
    play() { this.playCalls += 1; return Promise.resolve(); },
    pause() { this.pauseCalls += 1; },
    emit(ev) { for (const fn of this.listeners[ev] || []) fn(); },
  };
}

function setup({ pickResult, lyricResult, allowBegin = true, humMs = HUM_MS } = {}) {
  const fsm = fakeFsm({ allowBegin });
  const bubble = fakeBubble();
  const growth = fakeGrowth();
  const dialogue = fakeDialogue();
  const audios = [];
  const api = {
    pickSongCalls: 0,
    pickSong: async () => { api.pickSongCalls += 1; return pickResult ?? { source: 'netease', song: { id: 42, name: '测试歌' } }; },
    getLyric: async () => lyricResult ?? { ok: true, lrc: '[00:10.00]第一句\n[00:20.00]第二句' },
  };
  const music = new Music({
    api, fsm, bubble, growth, dialogue,
    createAudio: (url) => { const a = fakeAudio(); a.url = url; audios.push(a); return a; },
    humMs,
  });
  return { music, fsm, bubble, growth, dialogue, api, audios };
}

export async function run(t) {
  t.eq(REWARD_RATIO, 0.6, '结算阈值 60%（PRD §5.5）');

  // ---- A17 点歌成功 ----
  {
    const { music, fsm, bubble, audios } = setup();
    t.eq(music.singing, false, '初始未唱');
    await music.toggle();
    t.eq(fsm.beginCalls, 1, '进入唱歌态');
    t.ok(fsm.triggers.includes('dblclick'), '双击标记互动+惊醒');
    t.eq(audios.length, 1, '创建音频');
    t.ok(audios[0].url.includes('id=42'), '音频 URL 指向网易云外链');
    t.ok(audios[0].url.includes('.mp3'), 'mp3 外链');
    t.eq(audios[0].playCalls, 1, '开始播放');
    t.ok(bubble.says.some((s) => s.text === 'sing-start的台词'), '唱前台词');
    t.eq(music.song.name, '测试歌', '记录当前曲目');
  }

  // ---- A17 歌词逐句 ----
  {
    const { music, bubble, audios } = setup();
    await music.toggle();
    await sleep(10); // 等歌词加载微任务
    const a = audios[0];
    a.currentTime = 15;
    a.emit('timeupdate');
    t.eq(bubble.lyrics[bubble.lyrics.length - 1].text, '第一句', '15s 显示第一句');
    t.eq(bubble.lyrics[bubble.lyrics.length - 1].song, '洛天依 · 测试歌', '歌名标签');
    a.currentTime = 25;
    a.emit('timeupdate');
    t.eq(bubble.lyrics[bubble.lyrics.length - 1].text, '第二句', '25s 切第二句');
  }

  // ---- 播完结算（100% ≥ 60% → 奖励）----
  {
    const { music, fsm, bubble, growth, audios } = setup();
    await music.toggle();
    await sleep(10);
    audios[0].emit('ended');
    t.eq(growth.songRewards, 1, '听完歌结算（经验+好感）');
    t.eq(fsm.endCalls, 1, '退出唱歌态（A22 衔接 dance）');
    t.ok(bubble.hideLyricCalls >= 1, '隐藏歌词条');
    t.ok(bubble.says.some((s) => s.text === 'sing-end的台词'), '唱完台词');
    t.eq(audios[0].pauseCalls, 1, '音频暂停清理');
    t.eq(music.singing, false, '结束');
  }

  // ---- A18 唱歌中双击停止：不足 60% 无奖励 ----
  {
    const { music, fsm, growth, audios } = setup();
    await music.toggle();
    await sleep(10);
    const a = audios[0];
    a.currentTime = 30; // 30%
    a.emit('timeupdate');
    await music.toggle(); // 双击 → 停止
    t.eq(fsm.endCalls, 1, '停止退出唱歌');
    t.eq(growth.songRewards, 0, '30% 不结算');
    t.eq(music.singing, false, '已停止');
  }
  {
    // ≥60% 手动停止 → 结算
    const { music, growth, audios } = setup();
    await music.toggle();
    await sleep(10);
    const a = audios[0];
    a.currentTime = 70;
    a.emit('timeupdate');
    await music.toggle();
    t.eq(growth.songRewards, 1, '70% 手动停止仍结算');
  }

  // ---- A19 音频失败 → 哼唱降级 ----
  {
    const { music, fsm, bubble, growth, audios } = setup({ humMs: 40 });
    await music.toggle();
    await sleep(10);
    audios[0].emit('error');
    t.eq(music.source, 'hum', '降级为哼唱');
    t.ok(bubble.says.some((s) => s.text.includes('网络好像不太听话')), '降级提示台词');
    t.ok(bubble.lyrics.some((l) => l.text === '♪ 哼唱中 ♪'), '哼唱歌词条');
    await sleep(90); // 哼唱时长到
    t.eq(fsm.endCalls, 1, '哼唱结束退出');
    t.eq(growth.songRewards, 0, '哼唱不结算听歌奖励');
    t.eq(music.singing, false, '结束');
  }
  {
    // pickSong 直接返回 hum → 直接哼唱（不创建音频）
    const { music, audios, fsm } = setup({ pickResult: { source: 'hum', song: null }, humMs: 40 });
    await music.toggle();
    t.eq(audios.length, 0, '哼唱无音频');
    t.eq(music.source, 'hum', 'hum 来源');
    t.ok(fsm._singing, '仍在唱歌态');
    await music.toggle(); // 手动停止
    t.eq(fsm.endCalls, 1, '手动停止哼唱');
  }

  // ---- 忙碌（被抓）时点歌被拒 ----
  {
    const { music, fsm, audios, api } = setup({ allowBegin: false });
    await music.toggle();
    t.eq(fsm.beginCalls, 1, '尝试进入唱歌');
    t.eq(audios.length, 0, '未创建音频');
    t.eq(fsm._singing, false, '未进入唱歌');
    t.eq(api.pickSongCalls, 1, '选歌发生过');
  }

  // ---- 空闲时双击 toggle 幂等：非唱歌状态 toggle 才开始 ----
  {
    const { music } = setup();
    t.eq(music.singing, false, '未唱');
    await music.toggle();
    t.eq(music.singing, true, '开始唱');
  }

  // ---- 真机修复回归：startSing 即时反馈（挑歌网络等待期间先提示，避免"双击没反应"）----
  {
    const { music, fsm, bubble } = setup();
    const p = music.startSing(); // 不 await：模拟用户双击后的瞬间
    // 即时反馈位于 startSing 第一个 await 之前 → 调用后同步即可观测
    t.ok(fsm.triggers.includes('dblclick'), '挑歌等待期间已标记互动+惊醒');
    t.ok(bubble.says.some((s) => s.text === '我去挑首歌～'), '挑歌等待期间已提示「我去挑首歌～」');
    await p;
    t.eq(fsm.beginCalls, 1, '挑歌成功后正常进入唱歌');
    t.ok(bubble.says.some((s) => s.text === 'sing-start的台词'), '唱前台词仍在');
  }

  // ---- 真机修复回归：无歌词显示歌名（而非干巴巴的 "♪ ～"）----
  {
    const { music, bubble } = setup({ lyricResult: { ok: true, lrc: '' } });
    await music.toggle();
    await sleep(10); // 等歌词加载微任务
    t.ok(bubble.lyrics.some((l) => l.text === '♪ 测试歌 ♪'), '空歌词显示歌名条');
    t.ok(bubble.lyrics.every((l) => l.text !== '♪ ～'), '不再显示无信息量的 "♪ ～"');
  }

  // ---- 真机修复回归：fsm 打断唱歌后音频残留 → onSingInterrupted 立即停 ----
  {
    const { music, fsm, audios } = setup();
    await music.toggle();
    t.ok(audios.length >= 1, '已开播');
    // 模拟拖拽打断：fsm 退出唱歌态但音频未被 music 感知（打断前的真实状态）
    fsm._singing = false;
    t.eq(music.singing, false, 'fsm 已不在唱歌态');
    t.ok(music.playing, '但音频仍在播放（playing=true）');
    music.onSingInterrupted(); // fsm 打断回调
    t.eq(audios[0].pauseCalls, 1, '打断回调停掉音频');
    t.eq(music.song, null, '曲目已清空');
    t.eq(music.playing, false, '不再播放');
  }

  // ---- 真机修复回归：toggle 对残留音频先停再放（不叠加两首） ----
  {
    const { music, fsm, audios, api } = setup();
    await music.toggle();
    fsm._singing = false; // 模拟打断后状态不同步
    await music.toggle(); // 用户双击切歌
    t.eq(audios.length, 1, '未创建第二个音频（先停旧歌）');
    t.eq(audios[0].pauseCalls, 1, '旧音频被停掉');
    t.eq(api.pickSongCalls, 1, '没有重复点歌');
  }

  // ---- 真机修复回归：startSing 开头清场残留 ----
  {
    const { music, fsm, audios } = setup();
    await music.toggle();
    fsm._singing = false; // 模拟打断后残留
    await music.startSing(); // 直接调用（如闲逛随机真唱路径）
    t.eq(audios[0].pauseCalls, 1, 'startSing 前先停掉残留音频');
    t.ok(audios.length >= 2, '新音频正常创建');
    t.eq(audios.filter((a) => a.pauseCalls === 0).length, 1, '只有新音频在播');
  }

  // ---- 闲逛随机真唱判定（T5.4 通用页开关，默认关）----
  {
    const base = { enabled: true, daily: 'hum', singing: false, dancing: false, grabbed: false, rand: () => 0.1 };
    t.eq(idleSingChance({ ...base, enabled: false }), false, '开关关闭不触发');
    t.eq(idleSingChance({ ...base, daily: 'walk' }), false, '非哼唱状态不触发');
    t.eq(idleSingChance({ ...base, daily: 'sleep' }), false, '睡觉不触发');
    t.eq(idleSingChance({ ...base, singing: true }), false, '唱歌中不触发');
    t.eq(idleSingChance({ ...base, dancing: true }), false, '跳舞中不触发');
    t.eq(idleSingChance({ ...base, grabbed: true }), false, '被拎着不触发');
    t.eq(idleSingChance(base), true, '哼唱 + 低随机值 → 触发');
    t.eq(idleSingChance({ ...base, rand: () => 0.99 }), false, '高随机值不触发');
    t.eq(idleSingChance({ ...base, rand: () => IDLE_SING_CHANCE }), false, '恰等于阈值不触发');
    t.eq(idleSingChance({}), false, '默认参数（关+无状态）不触发');
  }
}
