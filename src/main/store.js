// 主进程：存档（K9：防抖 + 定时 + 退出保存 + .bak 备份 + 损坏恢复）
// 依赖注入 dir/fs 便于测试
import fs from 'node:fs';
import path from 'node:path';
import { defaultProfile, migrate } from '../shared/profile.js';

export class Store {
  constructor({ dir, debounceMs = 2000, intervalMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
    if (!dir) throw new Error('Store needs dir');
    this.dir = dir;
    this.file = path.join(dir, 'profile.json');
    this.bak = path.join(dir, 'profile.bak');
    this.debounceMs = debounceMs;
    this.intervalMs = intervalMs;
    this.now = now;
    this.profile = null;
    this._debounceTimer = null;
    this._intervalTimer = null;
    this.recoveredFromBackup = false;
    this.freshInstall = false;
  }

  _readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    let raw = this._readJson(this.file);
    if (raw) {
      this.profile = migrate(raw);
      this.recoveredFromBackup = false;
      return this.profile;
    }
    // 主档损坏/不存在 → 尝试备份
    raw = this._readJson(this.bak);
    if (raw) {
      this.profile = migrate(raw);
      this.recoveredFromBackup = true;
      return this.profile;
    }
    this.profile = defaultProfile();
    this.freshInstall = true;
    return this.profile;
  }

  get() {
    if (!this.profile) this.load();
    return JSON.parse(JSON.stringify(this.profile));
  }

  // 深合并补丁并计划保存；返回最新快照
  apply(patch) {
    if (!this.profile) this.load();
    const merged = JSON.parse(JSON.stringify(this.profile));
    deepMergeInPlace(merged, patch || {});
    this.profile = merged;
    this.scheduleSave();
    return this.get();
  }

  scheduleSave() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this.flush();
    }, this.debounceMs);
  }

  flush() {
    if (!this.profile) return;
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      // 备份轮换：现有主档 → .bak
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.bak);
        } catch { /* 备份失败不阻塞写入 */ }
      }
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.profile, null, 2), 'utf-8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] flush failed:', e.message);
    }
  }

  startAutoSave() {
    if (this._intervalTimer) return;
    this._intervalTimer = setInterval(() => this.flush(), this.intervalMs);
  }

  stop() {
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    if (this._intervalTimer) clearInterval(this._intervalTimer);
    this._debounceTimer = this._intervalTimer = null;
  }
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMergeInPlace(base, patch) {
  for (const k of Object.keys(patch)) {
    if (isPlainObject(base[k]) && isPlainObject(patch[k])) deepMergeInPlace(base[k], patch[k]);
    else base[k] = patch[k];
  }
  return base;
}
