// 几何纯函数：命中检测（K1）+ 行走地面计算（K2），可在 Node 中测试

// 角色本地画布 180×200；命中区 = 头部椭圆 + 身体椭圆（近似轮廓）
// x/y 为归一化到画布坐标的点（已含缩放归一），scale 为显示缩放
export function pointOnCharacter(x, y, scale = 1) {
  const hit = (cx, cy, rx, ry) => {
    const dx = (x - cx) / (rx * scale);
    const dy = (y - cy) / (ry * scale);
    return dx * dx + dy * dy <= 1;
  };
  return hit(90, 80, 44, 50) || hit(90, 148, 46, 52);
}

// 窗口底边贴住任务栏上沿：返回窗口应处的 y 坐标
export function computeGroundY(workArea, winH) {
  return workArea.y + workArea.height - winH;
}

// 窗口水平可移动范围（角色 60px 边距折返）
export function clampWalkX(x, workArea, winW, margin = 60) {
  const lo = workArea.x - winW + margin;
  const hi = workArea.x + workArea.width - margin;
  return Math.min(Math.max(x, lo), hi);
}
