// 换装（M1 建立 / M3 接入解锁校验）：服装 = 调色板变量覆盖
import { RIG_PALETTES } from './palettes.js';

// 服装注册表：解锁等级（存档 unlocked 数组为解锁事实来源，此处仅作元信息）
export const OUTFITS = [
  { id: 'default', label: '初见·默认装', unlockId: 'outfit_default', level: 1 },
  { id: 'spring', label: '春日裙', unlockId: 'outfit_spring', level: 3 },
  { id: 'star', label: '星海礼服', unlockId: 'outfit_star', level: 5 },
];

export class Outfit {
  constructor(rig, state) {
    this.rig = rig;
    this.current = null;
    this.state = state; // 引用会由 sync 刷新
  }

  // 返回 true=已穿上；false=未解锁或未知服装
  apply(outfitId) {
    const meta = OUTFITS.find((o) => o.id === outfitId);
    const palette = RIG_PALETTES[outfitId] || RIG_PALETTES.default;
    if (meta && this.state && Array.isArray(this.state.unlocked)) {
      if (!this.state.unlocked.includes(meta.unlockId)) {
        return false; // 未解锁：拒绝切换（菜单/设置页负责灰显）
      }
    }
    this.rig.setPalette(palette.vars);
    this.current = outfitId;
    return true;
  }

  sync(state) {
    if (state) this.state = state;
    if (this.state && this.state.outfit && this.state.outfit !== this.current) {
      this.apply(this.state.outfit);
    }
  }
}
