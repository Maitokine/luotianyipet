#!/usr/bin/env python3
"""8-bit 风格音效合成器（M5 / T5.5）：纯标准库（wave/math/struct），不依赖 numpy。

生成 5 个音效到 src/assets/sfx/：
  jump     单击跳跃：300→700Hz 快速上滑
  land     落地：160→70Hz 低频闷响
  happy    开心/升级：C 大调琶音 523-659-784-1047
  alert    提醒：880Hz 双短哔
  pomo_end 番茄完成：G-C-E-G 上行胜利乐句

全部为单声道 8-bit 无符号 PCM / 22050Hz（真·8-bit 音色），输出确定性可复现。
"""
import math
import os
import wave

SAMPLE_RATE = 22050
FADE_S = 0.005  # 首尾 5ms 线性淡入淡出，消除爆音


def synth(segments):
    """segments: [(f0, f1, dur_ms, vol), ...] —— 频率线性滑音的方波段；频率 0 表示静音段"""
    samples = []
    phase = 0.0
    for (f0, f1, dur_ms, vol) in segments:
        n = max(1, int(SAMPLE_RATE * dur_ms / 1000))
        fade = max(1, int(SAMPLE_RATE * FADE_S))
        for i in range(n):
            frac = i / max(1, n - 1)
            freq = f0 + (f1 - f0) * frac
            if freq <= 0:
                v = 0.0
            else:
                phase += freq / SAMPLE_RATE
                v = 1.0 if (phase % 1.0) < 0.5 else -1.0
            env = 1.0
            if i < fade:
                env = i / fade
            if i > n - fade:
                env = max(0.0, (n - i) / fade)
            samples.append(int(round(128 + v * vol * env)))
    return samples


def write_wav(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)  # 8-bit unsigned PCM
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(samples))


# (f0, f1, dur_ms, vol)；音量 0-100（8-bit 满幅 128，留余量防削波）
EFFECTS = {
    "jump": [(300, 700, 130, 90)],
    "land": [(160, 70, 110, 100)],
    "happy": [
        (523, 523, 90, 90),
        (659, 659, 90, 90),
        (784, 784, 90, 90),
        (1047, 1047, 150, 90),
    ],
    "alert": [
        (880, 880, 110, 95),
        (0, 0, 60, 0),
        (880, 880, 110, 95),
    ],
    "pomo_end": [
        (392, 392, 120, 90),
        (523, 523, 120, 90),
        (659, 659, 120, 90),
        (784, 784, 260, 95),
    ],
}


def main():
    out_dir = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                            "..", "src", "assets", "sfx"))
    os.makedirs(out_dir, exist_ok=True)
    for name, segments in EFFECTS.items():
        samples = synth(segments)
        path = os.path.join(out_dir, f"{name}.wav")
        write_wav(path, samples)
        dur = len(samples) / SAMPLE_RATE
        print(f"  {name}.wav  {dur:.2f}s  {len(samples)} samples")
    print(f"done -> {out_dir}")


if __name__ == "__main__":
    main()
