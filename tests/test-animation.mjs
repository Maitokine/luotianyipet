// M1 测试：动作注册表完整性 / 帧采样 / 姿态合并 / 命中检测 / 地面计算
import {
  ACTIONS, ACTION_NAMES, sampleAction, mergePose, actionDuration, basePose, PART_PIVOTS,
} from '../src/renderer/js/animation.js';
import { pointOnCharacter, computeGroundY, clampWalkX } from '../src/renderer/js/geo.js';

const REQUIRED_ACTIONS = [
  'idle', 'walk', 'sit', 'sleep', 'sing', 'dance', 'grabbed', 'jump',
];

export async function run(t) {
  // 1. 动作注册表完整（PRD §5.1 + K6 规格表）
  for (const name of REQUIRED_ACTIONS) {
    t.ok(ACTIONS[name] != null, `动作存在：${name}`);
  }
  t.eq(ACTION_NAMES.length, REQUIRED_ACTIONS.length, '动作总数 = 19，无多余');

  // 2. 每个动作定义合法
  for (const [name, a] of Object.entries(ACTIONS)) {
    t.ok(Array.isArray(a.frames) && a.frames.length >= 1, `${name} 至少 1 帧`);
    t.ok(typeof a.fps === 'number' && a.fps >= 1 && a.fps <= 24, `${name} fps 合法 (${a.fps})`);
    t.ok(typeof a.loop === 'boolean', `${name} loop 为布尔`);
  }

  // 3. 帧覆盖的部件名合法
  const validParts = [...Object.keys(basePose()), 'face'];
  for (const [name, a] of Object.entries(ACTIONS)) {
    for (const frame of a.frames) {
      for (const k of Object.keys(frame)) {
        t.ok(validParts.includes(k), `${name} 帧部件 "${k}" 合法`);
      }
    }
  }

  // 4. 面部取值合法
  for (const [name, a] of Object.entries(ACTIONS)) {
    for (const frame of a.frames) {
      if (frame.face) {
        if (frame.face.eyes) t.ok(['open', 'closed', 'happy'].includes(frame.face.eyes), `${name} eyes 取值合法`);
        if (frame.face.mouth) t.ok(['smile', 'open', 'puff'].includes(frame.face.mouth), `${name} mouth 取值合法`);
      }
    }
  }

  // 5. 采样：循环动作回绕
  const walk = sampleAction('walk', 0);
  t.eq(walk.frameIndex, 0, 'walk t=0 → 第 0 帧');
  t.eq(walk.done, false, 'walk 永不完成');
  const walk4 = sampleAction('walk', 4 / ACTIONS.walk.fps + 0.001);
  t.eq(walk4.frameIndex, 0, 'walk 循环回绕到第 0 帧');
  const walkMid = sampleAction('walk', 1.5 / ACTIONS.walk.fps);
  t.eq(walkMid.frameIndex, 1, 'walk 中间帧');

  // 6. 采样：单次动作播完停在最后一帧并标记 done
  const j1 = sampleAction('jump', 0);
  t.eq(j1.done, false, 'jump 起始未完成');
  const jEnd = sampleAction('jump', 99);
  t.eq(jEnd.done, true, 'jump 播完 done=true');
  t.eq(jEnd.frameIndex, ACTIONS.jump.frames.length - 1, 'jump 停在最后一帧');

  // 7. 姿态合并：帧部分覆盖 → 完整姿态
  const pose = mergePose({ legL: { rot: 20 } });
  t.eq(pose.legL.rot, 20, '覆盖生效 legL.rot=20');
  t.eq(pose.legR.rot, 0, '未覆盖保持默认 legR.rot=0');
  t.eq(pose.char.dx, 0, 'char 默认 dx=0');
  t.eq(pose.face.eyes, 'open', 'face 默认 open');
  t.ok(Object.keys(pose).length === 11, '完整姿态含 11 个部件/face');

  // 8. 时长：单次动作 ≤ 2 秒（打断态应及时结束）
  for (const name of ['jump']) {
    const d = actionDuration(name);
    t.ok(d > 0 && d <= 2, `${name} 时长合理 (${d.toFixed(2)}s)`);
  }

  // 9. 轴心定义覆盖所有可动部件
  for (const part of ['head', 'tailL', 'tailR', 'armL', 'armR', 'legL', 'legR', 'body']) {
    t.ok(Array.isArray(PART_PIVOTS[part]) && PART_PIVOTS[part].length === 2, `轴心存在：${part}`);
  }

  // 10. 命中检测（K1）
  t.ok(pointOnCharacter(90, 80), '头部中心命中');
  t.ok(pointOnCharacter(90, 148), '身体中心命中');
  t.ok(pointOnCharacter(62, 148), '裙摆左缘命中');
  t.ok(!pointOnCharacter(46, 120), '裙摆左上方空白不命中');
  t.ok(!pointOnCharacter(5, 5), '左上角空白不命中');
  t.ok(!pointOnCharacter(175, 100), '右侧空白不命中');
  t.ok(!pointOnCharacter(90, 15), '头顶上方空白不命中');
  t.ok(pointOnCharacter(90, 186), '脚部命中');

  // 11. 行走地面（K2）
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  t.eq(computeGroundY(wa, 420), 620, '地面 y = 工作区底 - 窗口高');
  t.eq(clampWalkX(99999, wa, 300), 1920 - 60, 'x 超右界钳制');
  t.eq(clampWalkX(-99999, wa, 300), -300 + 60, 'x 超左界钳制');
  t.eq(clampWalkX(500, wa, 300), 500, 'x 在界内不变');
}
