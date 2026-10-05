# -*- coding: utf-8 -*-
"""洛天依桌宠图标生成器（T6.2/K10）

纯 stdlib（zlib/struct/math）PNG 编码 + SDF 形状合成：
- build/icon.png        256x256  electron-builder 应用图标（自动转 .ico）
- src/assets/icon-tray.png 32x32 托盘图标（分辨率无关重渲，非缩放）

几何在 256 坐标系定义，render(size) 按比例缩放，任何尺寸都清晰。
配色取洛天依官方色系：天依蓝 #66CCFF、灰发、青绿瞳、黑蝴蝶结。
"""
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---------- SDF 基元（负值 = 形状内部，单位 px） ----------

def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r

def sd_ellipse(px, py, cx, cy, rx, ry):
    dx, dy = (px - cx) / rx, (py - cy) / ry
    return (math.hypot(dx, dy) - 1.0) * min(rx, ry)

def sd_rounded_box(px, py, cx, cy, hx, hy, r):
    qx, qy = abs(px - cx) - hx + r, abs(py - cy) - hy + r
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r

def lerp(a, b, t):
    return a + (b - a) * t

def lerp_color(c1, c2, t):
    return tuple(lerp(a, b, t) for a, b in zip(c1, c2))

# ---------- 图层（256 坐标系） ----------

HAIR = (201, 206, 223)      # 灰发 #C9CEDF
SKIN = (255, 233, 217)      # 肤色 #FFE9D9
EYE = (47, 191, 168)        # 青绿瞳 #2FBFA8
BLUSH = (255, 179, 193, 0.85)
MOUTH = (194, 91, 102)      # #C25B66
BOW = (43, 43, 61)          # 黑蝴蝶结 #2B2B3D
TIANYI_BLUE = (102, 204, 255)  # #66CCFF
BG_TOP = (143, 219, 255)
BG_BOTTOM = (78, 165, 224)

def background(x, y):
    """圆角方形天依蓝渐变底，返回 RGBA。"""
    return lerp_color(BG_TOP, BG_BOTTOM, y / 256.0) + (255,)

LAYERS = [
    # (距离函数, 颜色或 color(x,y))
    (lambda x, y: sd_rounded_box(x, y, 128, 128, 118, 118, 54), background),
    # 脸
    (lambda x, y: sd_circle(x, y, 128, 152, 58), SKIN + (255,)),
    # 腮红
    (lambda x, y: sd_circle(x, y, 94, 172, 9), BLUSH),
    (lambda x, y: sd_circle(x, y, 162, 172, 9), BLUSH),
    # 嘴：半圆微笑（圆 ∩ 下半平面）
    (lambda x, y: max(sd_circle(x, y, 128, 172, 7), 172 - y), MOUTH + (255,)),
    # 眼睛 + 高光
    (lambda x, y: sd_ellipse(x, y, 100, 154, 9, 13), EYE + (255,)),
    (lambda x, y: sd_ellipse(x, y, 156, 154, 9, 13), EYE + (255,)),
    (lambda x, y: sd_circle(x, y, 97, 149, 3), (255, 255, 255, 255)),
    (lambda x, y: sd_circle(x, y, 153, 149, 3), (255, 255, 255, 255)),
    # 头发：圆顶（切平到 y<134）
    (lambda x, y: max(sd_circle(x, y, 128, 116, 76), y - 134), HAIR + (255,)),
    # 刘海三扇贝
    (lambda x, y: sd_circle(x, y, 98, 112, 21), HAIR + (255,)),
    (lambda x, y: sd_circle(x, y, 128, 122, 23), HAIR + (255,)),
    (lambda x, y: sd_circle(x, y, 158, 112, 21), HAIR + (255,)),
    # 两侧鬓发
    (lambda x, y: sd_ellipse(x, y, 72, 152, 13, 36), HAIR + (255,)),
    (lambda x, y: sd_ellipse(x, y, 184, 152, 13, 36), HAIR + (255,)),
    # 头顶小呆毛
    (lambda x, y: sd_ellipse(x, y, 158, 40, 5, 15), HAIR + (255,)),
    # 蝴蝶结（左上）
    (lambda x, y: sd_ellipse(x, y, 74, 62, 12, 9), BOW + (255,)),
    (lambda x, y: sd_ellipse(x, y, 98, 62, 12, 9), BOW + (255,)),
    (lambda x, y: sd_circle(x, y, 86, 66, 7.5), BOW + (255,)),
    (lambda x, y: sd_circle(x, y, 86, 66, 4.2), TIANYI_BLUE + (255,)),
]

def render(size):
    """按图层序绘制，SDF 1px 解析抗锯齿，返回 RGBA bytearray。"""
    s = size / 256.0
    buf = bytearray(size * size * 4)
    for iy in range(size):
        py = (iy + 0.5) / s
        row = iy * size * 4
        for ix in range(size):
            px = (ix + 0.5) / s
            r = g = b = 0
            a = 0.0
            for sd, color in LAYERS:
                cov = min(max(0.5 - sd(px, py), 0.0), 1.0)
                if cov <= 0:
                    continue
                if callable(color):
                    color = color(px, py)
                cr, cg, cb = color[0], color[1], color[2]
                ca = color[3] / 255.0 if len(color) > 3 else 1.0
                ea = cov * ca          # 该层有效 alpha
                if ea <= 0:
                    continue
                # source-over 合成
                na = ea + a * (1 - ea)
                if na > 0:
                    r = (cr * ea + r * a * (1 - ea)) / na
                    g = (cg * ea + g * a * (1 - ea)) / na
                    b = (cb * ea + b * a * (1 - ea)) / na
                    a = na
            o = row + ix * 4
            buf[o] = int(r + 0.5)
            buf[o + 1] = int(g + 0.5)
            buf[o + 2] = int(b + 0.5)
            buf[o + 3] = int(a * 255 + 0.5)
    return buf

# ---------- PNG 编码（RGBA8，无滤波） ----------

def chunk(ctype, data):
    return (struct.pack('>I', len(data)) + ctype + data
            + struct.pack('>I', zlib.crc32(ctype + data) & 0xFFFFFFFF))

def write_png(path, size, pixels):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: None
        raw += pixels[y * stride:(y + 1) * stride]
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    blob = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b''))
    Path(path).write_bytes(blob)
    return len(blob)

def main():
    out1 = ROOT / 'build' / 'icon.png'
    out1.parent.mkdir(parents=True, exist_ok=True)
    n1 = write_png(out1, 256, render(256))
    out2 = ROOT / 'src' / 'assets' / 'icon-tray.png'
    n2 = write_png(out2, 32, render(32))
    print(f'[icon] {out1} 256x256 {n1} bytes')
    print(f'[icon] {out2} 32x32 {n2} bytes')

if __name__ == '__main__':
    main()
