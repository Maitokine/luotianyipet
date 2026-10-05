// 音效单测（T5.5）：Sfx 模块行为（缓存/降级）+ 5 个 WAV 产物格式校验
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sfx, SFX_NAMES } from '../src/renderer/js/sfx.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SFX_DIR = path.join(__dirname, '..', 'src', 'assets', 'sfx');

function makeAudioFactory() {
  const created = [];
  const fakeAudio = () => {
    const a = {
      url: '',
      volume: 1,
      currentTime: 0,
      played: 0,
      play() { this.played += 1; return Promise.resolve(); },
    };
    created.push(a);
    return a;
  };
  return {
    created,
    factory: (url) => {
      const a = fakeAudio();
      a.url = url;
      return a;
    },
  };
}

// 解析 WAV 头（RIFF/WAVE/fmt）
function parseWav(buf) {
  const ascii = (off, len) => String.fromCharCode(...buf.slice(off, off + len));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') return null;
  let off = 12;
  const info = { channels: 0, sampleRate: 0, bits: 0, dataLen: 0 };
  while (off + 8 <= buf.length) {
    const id = ascii(off, 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      info.channels = buf.readUInt16LE(off + 10);
      info.sampleRate = buf.readUInt32LE(off + 12);
      info.bits = buf.readUInt16LE(off + 22);
    } else if (id === 'data') {
      info.dataLen = size;
      info.dataOff = off + 8;
    }
    off += 8 + size + (size % 2);
  }
  return info;
}

export function run(t) {
  // ---------- Sfx 模块 ----------
  t.eq(SFX_NAMES, ['jump', 'land', 'happy', 'alert', 'pomo_end'], '5 个音效名单');

  {
    const { created, factory } = makeAudioFactory();
    const s = new Sfx({ createAudio: factory });
    t.eq(s.play('jump'), true, '播放 jump 返回 true');
    t.eq(created.length, 1, '懒创建一个 Audio');
    t.ok(created[0].url.endsWith('/jump.wav'), 'URL 指向 jump.wav');
    t.ok(created[0].url.includes('assets/sfx'), 'URL 在 sfx 目录下');
    t.eq(created[0].volume, 0.5, '默认音量 0.5');
    t.eq(created[0].played, 1, 'play 已调用');
    t.eq(created[0].currentTime, 0, '重播位置归零');
    s.play('jump');
    t.eq(created.length, 1, '同名音效复用缓存');
    t.eq(created[0].played, 2, '第二次播放');
  }

  {
    const { factory } = makeAudioFactory();
    const s = new Sfx({ createAudio: factory });
    t.eq(s.play('nonexistent'), false, '未知音效名返回 false');
    t.eq(s.play(''), false, '空名返回 false');
    t.eq(s.play(null), false, 'null 返回 false');
  }

  {
    const s = new Sfx({ createAudio: () => { throw new Error('no audio'); } });
    t.eq(s.play('land'), false, '创建抛错静默返回 false');
    const s2 = new Sfx({ createAudio: () => null });
    t.eq(s2.play('land'), false, '创建返回 null 返回 false');
  }

  {
    let calls = 0;
    const boom = {
      volume: 1,
      set currentTime(v) { if (v === 0) throw new Error('seek failed'); },
      get currentTime() { return 0; },
      play() { calls += 1; return Promise.resolve(); },
    };
    const s = new Sfx({ createAudio: () => boom });
    t.eq(s.play('alert'), false, 'currentTime 赋值抛错静默返回 false');
    const rejected = {
      volume: 1,
      currentTime: 0,
      play() { return Promise.reject(new Error('not allowed')); },
    };
    const s2 = new Sfx({ createAudio: () => rejected });
    t.eq(s2.play('alert'), true, 'play 返回 Promise 拒绝也不抛出');
  }

  {
    // 自定义 base 目录
    const { created, factory } = makeAudioFactory();
    const s = new Sfx({ createAudio: factory, base: 'media/sfx', volume: 0.2 });
    s.play('pomo_end');
    t.ok(created[0].url.startsWith('media/sfx/'), '自定义 base 生效');
    t.eq(created[0].volume, 0.2, '自定义音量生效');
  }

  // ---------- WAV 产物校验（scripts/gen_sfx.py 生成） ----------
  const expected = {
    jump: [0.05, 0.3],
    land: [0.05, 0.3],
    happy: [0.2, 0.8],
    alert: [0.1, 0.5],
    pomo_end: [0.3, 1.0],
  };
  for (const name of SFX_NAMES) {
    const file = path.join(SFX_DIR, `${name}.wav`);
    t.ok(fs.existsSync(file), `${name}.wav 存在`);
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const info = parseWav(buf);
    t.ok(info !== null, `${name}.wav 是合法 RIFF/WAVE`);
    if (!info) continue;
    t.eq(info.channels, 1, `${name}.wav 单声道`);
    t.eq(info.sampleRate, 22050, `${name}.wav 采样率 22050`);
    t.eq(info.bits, 8, `${name}.wav 8-bit PCM`);
    const dur = info.dataLen / info.sampleRate;
    t.ok(dur >= expected[name][0] && dur <= expected[name][1],
      `${name}.wav 时长 ${dur.toFixed(2)}s 在预期范围`);
    // 非静音：峰值偏离中心足够远
    const data = buf.slice(info.dataOff, info.dataOff + info.dataLen);
    let peak = 0;
    for (const b of data) peak = Math.max(peak, Math.abs(b - 128));
    t.ok(peak >= 40, `${name}.wav 有可闻波形（峰值偏离 ${peak}）`);
    // 首尾淡入淡出：边界样本接近中心，无爆音
    t.ok(Math.abs(data[0] - 128) <= 20, `${name}.wav 首样本无爆音`);
    t.ok(Math.abs(data[data.length - 1] - 128) <= 20, `${name}.wav 末样本无爆音`);
  }
}
