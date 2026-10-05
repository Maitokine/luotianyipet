// 网易云代理（M4 / T4.1 / K7）：主进程请求（无 CORS），带超时与重试
// 所有 ID 均为 2026-10 开发期实测核对（详见测试与验收记录）
export const CACHE_TTL_MS = 24 * 3600000;

export const NETEASE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const BASE = 'https://music.163.com';

// 洛天依Official（歌手页 50 首热门，实测 44 首可播）
export const KNOWN_ARTIST_ID = 906118;

// 内置兜底 5 首（PRD §5.7；原版 VIP 不可播的用洛天依演唱免费版替代，均已实测 302 可播）
export const FALLBACK_SONGS = [
  { id: 1983315125, name: '普通DISCO' }, // 洛天依/言和 · Mawaru Premix（原版 VIP）
  { id: 2753428108, name: '达拉崩吧' },  // 洛天依 · 乌鱼禅师P cover（原版 VIP）
  { id: 404543406, name: '九九八十一' }, // 洛天依Official/乐正绫
  { id: 1404797306, name: '权御天下' },  // 洛天依Official
  { id: 429460240, name: '世末歌者' },   // 南北组 · 乐正绫/洛天依Official/COP
];

export const FETCH_TIMEOUT_MS = 8000;
export const RETRIES = 1; // 失败重试 1 次（共 2 次尝试）

// ---- 基础请求：8s 超时 + 重试 1 次，返回 JSON 或 null ----
export async function fetchJson(url, { timeoutMs = FETCH_TIMEOUT_MS, retries = RETRIES } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': NETEASE_UA, Referer: `${BASE}/` },
      });
      clearTimeout(timer);
      if (res.ok) return await res.json();
    } catch {
      clearTimeout(timer);
      // 超时/网络错误 → 重试
    }
  }
  return null;
}

// ---- 歌手解析：优先洛天依Official，其次精确名，最后首条 ----
export async function searchArtistId(name = '洛天依', fetchImpl = fetchJson) {
  const url = `${BASE}/api/search/get?s=${encodeURIComponent(name)}&type=100`;
  const d = await fetchImpl(url);
  const artists = d && d.result && Array.isArray(d.result.artists) ? d.result.artists : [];
  if (artists.length === 0) return null;
  const pickArtist =
    artists.find((a) => a && a.name === '洛天依Official') ||
    artists.find((a) => a && a.name === name) ||
    artists[0];
  return pickArtist && Number.isFinite(pickArtist.id) ? pickArtist.id : null;
}

// ---- 热门歌曲：fee∈{0,8} 视为可播（1=VIP 4=付费专辑过滤） ----
export function filterPlayable(songs) {
  if (!Array.isArray(songs)) return [];
  return songs
    .filter((s) => s && Number.isFinite(s.id) && s.name && (s.fee === 0 || s.fee === 8))
    .map((s) => ({ id: s.id, name: s.name }));
}

export async function fetchHotSongs(artistId, fetchImpl = fetchJson) {
  const d = await fetchImpl(`${BASE}/api/artist/${artistId}`);
  if (!d || !Array.isArray(d.hotSongs)) return [];
  return filterPlayable(d.hotSongs);
}

// ---- 歌词 ----
export async function fetchLyric(songId, fetchImpl = fetchJson) {
  const d = await fetchImpl(`${BASE}/api/song/lyric?id=${songId}&lv=1&kv=1&tv=-1`);
  const lrc = d && d.lrc && d.lrc.lyric;
  return typeof lrc === 'string' && lrc.length > 0 ? lrc : null;
}

// ---- 24h 歌单缓存 ----
export function songsCacheValid(cache, now = Date.now()) {
  return Boolean(
    cache && Array.isArray(cache.songs) && cache.songs.length > 0
    && Number.isFinite(cache.songsUpdatedAt)
    && now - cache.songsUpdatedAt < CACHE_TTL_MS,
  );
}

function pickOne(arr, rand) {
  return arr[Math.floor(rand() * arr.length) % arr.length];
}

// ---- 选歌编排（降级链：缓存/歌手页 → 兜底 5 首） ----
// 返回 { source: 'netease' | 'fallback', song: {id,name}, patch: 缓存写入|null }
export async function pickSong({
  cache = {},
  now = () => Date.now(),
  fetchImpl = fetchJson,
  rand = Math.random,
} = {}) {
  if (songsCacheValid(cache, now())) {
    return { source: 'netease', song: pickOne(cache.songs, rand), patch: null };
  }
  let artistId = Number.isFinite(cache.artistId) ? cache.artistId : KNOWN_ARTIST_ID;
  let songs = await fetchHotSongs(artistId, fetchImpl).catch(() => []);
  if (songs.length === 0) {
    const found = await searchArtistId('洛天依', fetchImpl).catch(() => null);
    if (Number.isFinite(found) && found !== artistId) {
      artistId = found;
      songs = await fetchHotSongs(artistId, fetchImpl).catch(() => []);
    }
  }
  if (songs.length > 0) {
    return {
      source: 'netease',
      song: pickOne(songs, rand),
      patch: { artistId, songs, songsUpdatedAt: now() },
    };
  }
  return { source: 'fallback', song: pickOne(FALLBACK_SONGS, rand), patch: null };
}
