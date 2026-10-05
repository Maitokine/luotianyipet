// M0 测试：存档读写 / 防抖保存 / 备份轮换 / 损坏恢复（真实临时目录）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/main/store.js';

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pet-store-test-'));
}

export async function run(t) {
  // 1. 首次启动 → 默认档案
  {
    const dir = tmpdir();
    const s = new Store({ dir });
    const p = s.load();
    t.ok(s.freshInstall === true, '空目录 → 全新档案');
    t.ok(p.level === 1, '全新档案等级 1');
    s.flush();
    t.ok(fs.existsSync(path.join(dir, 'profile.json')), 'flush 后主档存在');
    t.ok(!fs.existsSync(path.join(dir, 'profile.json.tmp')), '无残留 .tmp 文件');
  }

  // 2. apply + flush → 新实例读到相同数据（持久化）
  {
    const dir = tmpdir();
    const s1 = new Store({ dir });
    s1.load();
    s1.apply({ level: 2, exp: 130, affection: 25, settings: { scale: 1.4 } });
    s1.flush();
    const s2 = new Store({ dir });
    const p = s2.load();
    t.ok(s2.freshInstall === false, '二次启动非全新');
    t.eq(p.level, 2, '重启后等级保持');
    t.eq(p.exp, 130, '重启后经验保持');
    t.eq(p.affection, 25, '重启后好感保持');
    t.eq(p.settings.scale, 1.4, '重启后设置保持');
  }

  // 3. 主档损坏 → 从 .bak 恢复
  {
    const dir = tmpdir();
    const s1 = new Store({ dir });
    s1.load();
    s1.apply({ affection: 42 });
    s1.flush();
    // 第二次写入会生成 .bak（内容为第一次的档案，好感 10）
    s1.apply({ affection: 88 });
    s1.flush();
    t.ok(fs.existsSync(path.join(dir, 'profile.bak')), '备份文件存在');
    // 模拟主档损坏
    fs.writeFileSync(path.join(dir, 'profile.json'), '{corrupted!!!', 'utf-8');
    const s2 = new Store({ dir });
    const p = s2.load();
    t.ok(s2.recoveredFromBackup === true, '主档损坏 → 从备份恢复');
    t.eq(p.affection, 42, '恢复到备份值 42（第二次写入前的状态）');
  }

  // 4. 双档皆损坏 → 回默认（不清零逻辑上有备份兜底，此处为极端路径）
  {
    const dir = tmpdir();
    fs.writeFileSync(path.join(dir, 'profile.json'), 'bad', 'utf-8');
    fs.writeFileSync(path.join(dir, 'profile.bak'), 'bad2', 'utf-8');
    const s = new Store({ dir });
    const p = s.load();
    t.ok(s.freshInstall === true, '双档损坏 → 回默认档案');
    t.eq(p.affection, 10, '默认好感 10');
  }

  // 5. 防抖：短时间多次 apply 只写一次最终值
  {
    const dir = tmpdir();
    const s = new Store({ dir, debounceMs: 30 });
    s.load();
    s.apply({ affection: 11 });
    s.apply({ affection: 12 });
    s.apply({ affection: 13 });
    await new Promise((r) => setTimeout(r, 150));
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf-8'));
    t.eq(raw.affection, 13, '防抖合并写入最终值');
    t.stop?.();
  }

  // 6. stop() 后不再自动保存
  {
    const dir = tmpdir();
    const s = new Store({ dir, debounceMs: 20, intervalMs: 50 });
    s.load();
    s.apply({ affection: 20 });
    s.flush();
    s.apply({ affection: 30 });
    s.stop();
    await new Promise((r) => setTimeout(r, 120));
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf-8'));
    t.eq(raw.affection, 20, 'stop 后未保存的补丁不落盘');
  }
}
