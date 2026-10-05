// lrc.js 单测：LRC 解析（多时间戳/格式变体/排序）+ 同步指针（前进/回跳/边界）
import { parseLrc, LyricSync } from '../src/shared/lrc.js';

export function run(t) {
  // ---- 解析 ----
  {
    const lines = parseLrc('[00:22.23]东汉末狼烟不休\n[00:23.85]常侍乱 朝野陷');
    t.eq(lines.length, 2, '解析两行');
    t.close(lines[0].t, 22.23, 1e-9, '时间换算 22.23s');
    t.eq(lines[0].text, '东汉末狼烟不休', '歌词文本');
    t.ok(lines[0].t < lines[1].t, '按时间排序');
  }
  {
    // 一行多时间戳
    const lines = parseLrc('[01:02.50][00:30.00]副歌句');
    t.eq(lines.length, 2, '一行多时间戳拆成两条');
    t.close(lines[0].t, 30, 1e-9, '排序后 30s 在前');
    t.close(lines[1].t, 62.5, 1e-9, '62.5s 在后');
    t.eq(lines[1].text, '副歌句', '文本一致');
  }
  {
    // 格式变体：整秒 / 冒号毫秒 / 三位毫秒
    const lines = parseLrc('[00:10]整秒\n[00:20:50]冒号毫秒\n[00:30.123]三位毫秒');
    t.close(lines[0].t, 10, 1e-9, '整秒格式');
    t.close(lines[1].t, 20.5, 1e-9, '[mm:ss:xx] 格式');
    t.close(lines[2].t, 30.123, 1e-9, '三位毫秒');
  }
  {
    // 无效与空行
    const lines = parseLrc('普通文本\n[00:10.00]\n[]空时间\n[abc:def]坏时间\n[00:11.00]有效');
    t.eq(lines.length, 1, '无效行全部跳过');
    t.eq(lines[0].text, '有效', '保留有效行');
  }
  t.eq(parseLrc(''), [], '空文本 → 空数组');
  t.eq(parseLrc(null), [], 'null → 空数组');
  {
    // \r\n 兼容
    const lines = parseLrc('[00:01.00]A\r\n[00:02.00]B\r\n');
    t.eq(lines.length, 2, 'CRLF 兼容');
  }

  // ---- 同步指针 ----
  {
    const sync = new LyricSync(parseLrc('[00:22.00]第一句\n[00:24.00]第二句\n[00:27.00]第三句'));
    t.eq(sync.at(0), null, '首行前返回 null');
    t.eq(sync.at(21.99), null, '21.99s 仍在前奏');
    t.eq(sync.at(22), '第一句', '22s 恰好第一句');
    t.eq(sync.at(23.5), '第一句', '23.5s 仍是第一句');
    t.eq(sync.at(24.1), '第二句', '24.1s 切第二句');
    t.eq(sync.at(100), '第三句', '结束后保持最后一句');
    t.eq(sync.at(25), '第二句', '前进指针');
    t.eq(sync.at(23), '第一句', '时间回跳重扫（seek 向后）');
    t.eq(sync.at(26.5), '第二句', '回跳后再前进');
  }
  {
    const sync = new LyricSync([]);
    t.eq(sync.at(10), null, '无歌词返回 null');
    sync.reset();
    t.eq(sync.idx, -1, 'reset');
  }
}
