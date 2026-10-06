// winpos.js 单测：窗口位置夹取 / 默认落点 / 「是否足够可见」判定
// 覆盖「透明窗口跑到屏外 → 小人消失」这一 bug 的两条防线。
import { clampToWorkArea, defaultPos, isSufficientlyVisible } from '../src/shared/winpos.js';

const WA = { x: 0, y: 0, width: 1920, height: 1080 }; // 主屏工作区
const W = 300;
const H = 420;

export function run(t) {
  // ---- clampToWorkArea：屏内位置原样返回 ----
  {
    t.eq(clampToWorkArea({ x: 100, y: 100 }, WA, W, H), { x: 100, y: 100 }, '屏内位置保持不变');
    t.eq(clampToWorkArea({ x: 0, y: 0 }, WA, W, H), { x: 0, y: 0 }, '左上角合法');
    t.eq(clampToWorkArea({ x: 1620, y: 660 }, WA, W, H), { x: 1620, y: 660 }, '右下极限位置合法（窗口恰好贴边）');
  }

  // ---- clampToWorkArea：越界被夹回，且保证整窗在屏内 ----
  {
    t.eq(clampToWorkArea({ x: 5000, y: 5000 }, WA, W, H), { x: 1620, y: 660 }, '超出右下 → 夹到右下极限');
    t.eq(clampToWorkArea({ x: -500, y: -500 }, WA, W, H), { x: 0, y: 0 }, '超出左上 → 夹到左上极限');
    t.eq(clampToWorkArea({ x: 1900, y: 900 }, WA, W, H), { x: 1620, y: 660 },
      '部分越界也被夹回整窗可见（旧实现只留 20px 反而看不见）');
  }

  // ---- clampToWorkArea：非主屏工作区（副屏在主屏左下为负坐标）----
  {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    t.eq(clampToWorkArea({ x: -1800, y: 50 }, left, W, H), { x: -1800, y: 50 }, '负坐标工作区内位置合法');
    t.eq(clampToWorkArea({ x: 100, y: 50 }, left, W, H), { x: -300, y: 50 }, '不属于该屏的位置被拉回该屏内（右缘）');
    t.eq(clampToWorkArea({ x: -3000, y: 0 }, left, W, H), { x: -1920, y: 0 }, '插屏后被拉回可见区');
  }

  // ---- clampToWorkArea：非法输入返回 null（调用方回退默认落点）----
  {
    t.eq(clampToWorkArea(null, WA, W, H), null, 'null → null');
    t.eq(clampToWorkArea(undefined, WA, W, H), null, 'undefined → null');
    t.eq(clampToWorkArea({}, WA, W, H), null, '缺字段 → null');
    t.eq(clampToWorkArea({ x: 1 }, WA, W, H), null, '缺 y → null');
    t.eq(clampToWorkArea({ x: 'a', y: 1 }, WA, W, H), null, '非数值 → null');
    t.eq(clampToWorkArea({ x: NaN, y: 1 }, WA, W, H), null, 'NaN → null');
    t.eq(clampToWorkArea({ x: Infinity, y: 1 }, WA, W, H), null, 'Infinity → null');
  }

  // ---- defaultPos：右下角落点 ----
  {
    t.eq(defaultPos(WA, W, H), { x: 1560, y: 660 }, '默认落点=右下角（横向留 60px）');
    t.eq(defaultPos({ x: 0, y: 0, width: 1366, height: 768 }, W, H), { x: 1006, y: 348 },
      '1366×768 屏下落点正确');
  }

  // ---- defaultPos：工作区比窗口还小时不产生负坐标 ----
  {
    t.eq(defaultPos({ x: 0, y: 0, width: 200, height: 300 }, W, H), { x: 0, y: 0 },
      '工作区小于窗口 → 退化为原点，不出现负坐标');
  }

  // ---- isSufficientlyVisible：整窗在屏内 ----
  {
    const displays = [{ workArea: WA }];
    t.ok(isSufficientlyVisible({ x: 1000, y: 300, width: W, height: H }, displays), '整窗在屏内 → 可见');
    t.ok(isSufficientlyVisible({ x: 0, y: 0, width: W, height: H }, displays), '贴左上角 → 可见');
  }

  // ---- isSufficientlyVisible：越界比例判定 ----
  {
    const displays = [{ workArea: WA }];
    // x=1900 → 只有 20px 横向露出（旧实现允许的情形）
    t.ok(!isSufficientlyVisible({ x: 1900, y: 700, width: W, height: H }, displays),
      '仅露出 20px → 判定为不可见（正是小人消失的成因）');
    t.ok(!isSufficientlyVisible({ x: 3000, y: 0, width: W, height: H }, displays), '完全在屏外 → 不可见');
    // x=1740 → 横向露出 180px = 60%，恰好达标
    t.ok(isSufficientlyVisible({ x: 1740, y: 100, width: W, height: H }, displays), '露出 60% → 恰好可见');
    t.ok(!isSufficientlyVisible({ x: 1741, y: 100, width: W, height: H }, displays), '露出略低于 60% → 不可见');
    t.ok(isSufficientlyVisible({ x: 1741, y: 100, width: W, height: H }, displays, 0.5),
      '放宽阈值到 50% 后同一位置可见（ratio 参数生效）');
  }

  // ---- isSufficientlyVisible：多屏与异常输入 ----
  {
    const displays = [
      { workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
      { workArea: { x: 1920, y: 0, width: 1920, height: 1080 } },
    ];
    t.ok(isSufficientlyVisible({ x: 2000, y: 100, width: W, height: H }, displays), '落在副屏 → 可见');
    t.ok(!isSufficientlyVisible({ x: 5000, y: 100, width: W, height: H }, displays), '所有屏之外 → 不可见');
    t.ok(isSufficientlyVisible({ x: 100, y: 100, width: W, height: H },
      [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]), '仅提供 bounds 时回退到 bounds 判定');
    t.ok(!isSufficientlyVisible({ x: 100, y: 100, width: W, height: H }, []), '无显示器信息 → 不可见');
    t.ok(!isSufficientlyVisible(null, displays), 'bounds 缺失 → 不可见');
    t.ok(!isSufficientlyVisible({ x: 0, y: 0, width: 0, height: 0 }, displays), '零尺寸 → 不可见');
  }
}
