// T6.3 辅助进程：被父进程杀掉的持久化写入者
// 用纯 Node 模拟“程序正在落盘时被强制终止”的场景，避免在沙箱里长时间挂起 Electron 窗口。
import fs from 'node:fs';
import path from 'node:path';
import { Store } from '../src/main/store.js';

const tmp = process.env.PERSIST_TMP;
if (!tmp) {
  console.error('missing PERSIST_TMP');
  process.exit(1);
}
const dir = path.join(tmp, 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify({ level: 4, exp: 600, settings: { scale: 1.2 } }));

const store = new Store({ dir });
store.load();

for (let i = 0; i < 200; i++) {
  store.apply({ exp: (store.profile.exp || 0) + 1 });
  store.flush();
  console.log('FLUSHED');
  // 同步阻塞一小段时间，提高父进程在落盘中途杀掉我们的概率
  const t = Date.now();
  while (Date.now() - t < 50) {}
}
