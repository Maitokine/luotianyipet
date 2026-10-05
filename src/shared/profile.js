// 共享：存档数据模型（主进程与渲染层、测试共用，禁止依赖 Electron/DOM）
export const SCHEMA_VERSION = 1;

// 好感度五档（PRD §5.5）
export const AFFECTION_TIERS = [
  { min: 0, max: 19, key: 'stranger', label: '陌生' },
  { min: 20, max: 39, key: 'familiar', label: '熟悉' },
  { min: 40, max: 59, key: 'friend', label: '朋友' },
  { min: 60, max: 79, key: 'close', label: '亲密' },
  { min: 80, max: 100, key: 'beloved', label: '挚爱' },
];

export function affectionTier(v) {
  for (const t of AFFECTION_TIERS) {
    if (v >= t.min && v <= t.max) return t;
  }
  return AFFECTION_TIERS[v < 0 ? 0 : AFFECTION_TIERS.length - 1];
}

// 累计经验升级阈值：Lv1=0, Lv2=120, Lv3=300 ... Lv8=2800, 之后每级 +800
export function expThreshold(level) {
  const table = [0, 120, 300, 600, 1000, 1500, 2100, 2800];
  if (level <= 1) return 0;
  if (level - 1 < table.length) return table[level - 1];
  // Lv9 起每级 +800
  return 2800 + (level - 8) * 800;
}

export function levelFromExp(exp) {
  let level = 1;
  while (level < 200 && exp >= expThreshold(level + 1)) level += 1;
  return level;
}

export function defaultProfile() {
  const now = Date.now();
  return {
    version: SCHEMA_VERSION,
    createdAt: now,
    level: 1,
    exp: 0,
    affection: 10,
    totalMinutes: 0,
    totalClicks: 0,
    songsCompleted: 0,
    pomodorosDone: 0,
    unlocked: ['outfit_default'],
    outfit: 'default',
    pos: null,
    settings: {
      alwaysOnTop: true,
      clickThrough: false,
      scale: 1.0,
      opacity: 1.0,
      autoStart: false,
      idleRealSing: false,
      danceWithMusic: true,
      sitting: { enabled: true, minutes: 60 },
      water: { enabled: true, minutes: 90 },
      pomodoro: { focus: 25, rest: 5 },
    },
    notes: [],
    affectionToday: { date: '', count: 0 },
    todayMinutes: { date: '', count: 0 },
    lastInteractionAt: 0,
    decayCharged: 0,
    sittingLastFire: 0,
    waterLastFire: 0,
    netease: { artistId: null, songs: [], songsUpdatedAt: 0 },
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// 深合并：补齐缺失字段（老存档迁移），数组整体替换
function deepMerge(base, patch) {
  for (const k of Object.keys(patch)) {
    if (isPlainObject(base[k]) && isPlainObject(patch[k])) {
      deepMerge(base[k], patch[k]);
    } else {
      base[k] = patch[k];
    }
  }
  return base;
}

// 读取旧档案时：以默认档案为底，合并已有值，保证结构完整
export function migrate(raw) {
  const merged = defaultProfile();
  if (raw && isPlainObject(raw)) deepMerge(merged, raw);
  merged.version = SCHEMA_VERSION;
  return validate(merged);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 数值合法性清洗（防手改存档写坏）
export function validate(p) {
  p.level = clamp(Math.floor(Number(p.level) || 1), 1, 200);
  p.exp = clamp(Math.floor(Number(p.exp) || 0), 0, Number.MAX_SAFE_INTEGER);
  p.affection = clamp(Math.floor(Number(p.affection) || 0), 0, 100);
  p.totalMinutes = Math.max(0, Math.floor(Number(p.totalMinutes) || 0));
  p.totalClicks = Math.max(0, Math.floor(Number(p.totalClicks) || 0));
  p.songsCompleted = Math.max(0, Math.floor(Number(p.songsCompleted) || 0));
  p.pomodorosDone = Math.max(0, Math.floor(Number(p.pomodorosDone) || 0));
  const s = p.settings;
  s.scale = clamp(Number(s.scale) || 1, 0.5, 2.0);
  s.opacity = clamp(Number(s.opacity) || 1, 0.2, 1.0);
  s.sitting.minutes = clamp(Math.floor(Number(s.sitting.minutes) || 60), 10, 240);
  s.water.minutes = clamp(Math.floor(Number(s.water.minutes) || 90), 10, 240);
  s.pomodoro.focus = clamp(Math.floor(Number(s.pomodoro.focus) || 25), 5, 60);
  s.pomodoro.rest = clamp(Math.floor(Number(s.pomodoro.rest) || 5), 1, 30);
  for (const b of ['alwaysOnTop', 'clickThrough', 'autoStart', 'idleRealSing', 'danceWithMusic']) {
    s[b] = Boolean(s[b]);
  }
  if (!Array.isArray(p.notes)) p.notes = [];
  p.notes = p.notes.filter((n) => n && typeof n.text === 'string' && n.text.trim().length > 0);
  p.decayCharged = Math.max(0, Math.floor(Number(p.decayCharged) || 0));
  if (!p.affectionToday || typeof p.affectionToday !== 'object') p.affectionToday = { date: '', count: 0 };
  if (!p.todayMinutes || typeof p.todayMinutes !== 'object') p.todayMinutes = { date: '', count: 0 };
  p.todayMinutes.count = Math.max(0, Math.floor(Number(p.todayMinutes.count) || 0));
  if (!Array.isArray(p.unlocked) || p.unlocked.length === 0) p.unlocked = ['outfit_default'];
  if (!['default', 'spring', 'star'].includes(p.outfit)) p.outfit = 'default';
  if (p.level !== levelFromExp(p.exp)) p.level = levelFromExp(p.exp);
  return p;
}
