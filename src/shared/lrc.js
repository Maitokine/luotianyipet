// LRC 歌词解析 + 同步指针（M4 / T4.3，共享纯逻辑，Node 可测）
// 支持 [mm:ss.xx] / [mm:ss.xxx] / [mm:ss] / 一行多时间戳

export function parseLrc(text) {
  const lines = [];
  const raw = String(text || '');
  for (const row of raw.split(/\r?\n/)) {
    const m = row.match(/^((?:\[\d+:\d+(?:[.:]\d+)?\])+)(.*)$/);
    if (!m) continue;
    const body = m[2].trim();
    if (!body) continue;
    for (const ts of m[1].matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)) {
      const sec = parseFloat(String(ts[2]).replace(':', '.'));
      const t = Number(ts[1]) * 60 + sec;
      if (Number.isFinite(t)) lines.push({ t, text: body });
    }
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

// 前进式指针：timeupdate 高频回调下 O(1) 均摊；支持时间回跳重扫
export class LyricSync {
  constructor(lines = []) {
    this.lines = lines;
    this.idx = -1;
  }

  reset() { this.idx = -1; }

  // 返回 timeSec 时刻应显示的歌词行；首行之前返回 null
  at(timeSec) {
    const L = this.lines;
    if (L.length === 0) return null;
    if (timeSec < L[0].t) { this.idx = -1; return null; }
    // 回跳（重播/seek 向后）→ 重扫
    if (this.idx >= L.length || (this.idx >= 0 && L[this.idx].t > timeSec)) this.idx = -1;
    while (this.idx + 1 < L.length && L[this.idx + 1].t <= timeSec) this.idx += 1;
    return L[this.idx].text;
  }
}
