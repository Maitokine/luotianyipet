// netease.js 单测：假 fetchImpl 全链路（歌手解析/fee 过滤/缓存/降级链），不发真实请求
import {
  FALLBACK_SONGS, KNOWN_ARTIST_ID, CACHE_TTL_MS,
  searchArtistId, fetchHotSongs, fetchLyric, filterPlayable, songsCacheValid, pickSong,
} from '../src/main/netease.js';

const neverFetch = async () => null;

function artistResp(artists) {
  return async (url) => {
    if (url.includes('/api/search/get')) return { result: { artists } };
    return null;
  };
}

function hotResp(songs) {
  return async (url) => {
    if (url.includes('/api/artist/')) return { hotSongs: songs };
    return null;
  };
}

export async function run(t) {
  // ---- 兜底与常量 ----
  t.eq(FALLBACK_SONGS.length, 5, '内置兜底 5 首（PRD §5.7）');
  t.ok(FALLBACK_SONGS.every((s) => Number.isFinite(s.id) && s.name), '兜底曲目结构完整');
  t.eq(KNOWN_ARTIST_ID, 906118, '洛天依Official 歌手 ID（开发期核对）');
  t.eq(CACHE_TTL_MS, 24 * 3600000, '歌单缓存 24h');

  // ---- searchArtistId ----
  t.eq(await searchArtistId('洛天依', artistResp([{ id: 906118, name: '洛天依Official' }, { id: 2, name: '洛天依' }])), 906118, '优先洛天依Official');
  t.eq(await searchArtistId('洛天依', artistResp([{ id: 5, name: '洛天依' }])), 5, '次选精确名匹配');
  t.eq(await searchArtistId('洛天依', artistResp([{ id: 9, name: '别的' }])), 9, '兜底首条');
  t.eq(await searchArtistId('洛天依', artistResp([])), null, '空结果 → null');
  t.eq(await searchArtistId('洛天依', neverFetch), null, '请求失败 → null');

  // ---- fee 过滤 ----
  t.eq(filterPlayable([
    { id: 1, name: '免费', fee: 0 },
    { id: 2, name: '非VIP低音质', fee: 8 },
    { id: 3, name: 'VIP', fee: 1 },
    { id: 4, name: '付费专辑', fee: 4 },
    { id: 5, fee: 0 },          // 无名
    { name: '无ID', fee: 0 },   // 无 id
  ]), [{ id: 1, name: '免费' }, { id: 2, name: '非VIP低音质' }], 'fee∈{0,8} 且 id/name 齐全');
  t.eq(filterPlayable(null), [], '非数组 → 空');
  {
    const songs = await fetchHotSongs(906118, hotResp([{ id: 1, name: 'A', fee: 0 }, { id: 2, name: 'B', fee: 1 }]));
    t.eq(songs, [{ id: 1, name: 'A' }], '热门接口过滤 VIP');
    t.eq(await fetchHotSongs(1, neverFetch), [], '热门接口失败 → 空');
  }

  // ---- 歌词 ----
  {
    const fetch = async (url) => (url.includes('/api/song/lyric') ? { lrc: { lyric: '[00:01.00]词' } } : null);
    t.eq(await fetchLyric(1, fetch), '[00:01.00]词', '取到 LRC 原文');
    t.eq(await fetchLyric(1, neverFetch), null, '歌词失败 → null');
  }

  // ---- 缓存有效期 ----
  {
    const now = 1000000000000;
    t.ok(songsCacheValid({ songs: [{ id: 1, name: 'a' }], songsUpdatedAt: now - 1000 }, now), '24h 内有效');
    t.ok(!songsCacheValid({ songs: [], songsUpdatedAt: now }, now), '空歌单无效');
    t.ok(!songsCacheValid({ songs: [{ id: 1, name: 'a' }], songsUpdatedAt: now - CACHE_TTL_MS - 1 }, now), '过期无效');
    t.ok(!songsCacheValid(null, now), '无缓存无效');
  }

  // ---- pickSong 编排 ----
  {
    // 命中缓存：不发请求
    let fetched = 0;
    const fetch = async () => { fetched += 1; return null; };
    const cache = { songs: [{ id: 11, name: '缓存歌' }, { id: 12, name: '缓存歌2' }], songsUpdatedAt: Date.now() };
    const r = await pickSong({ cache, fetchImpl: fetch, rand: () => 0 });
    t.eq(fetched, 0, '缓存命中零请求');
    t.eq(r.source, 'netease', '来源 netease');
    t.eq(r.song.id, 11, 'rand=0 取第一首');
    t.eq(r.patch, null, '无缓存写入');
  }
  {
    // 缓存过期：已知歌手 ID → 拉热门 → 写缓存
    const now = 5000000;
    const fetch = hotResp([
      { id: 21, name: '热门1', fee: 0 },
      { id: 22, name: '热门2', fee: 8 },
      { id: 23, name: 'VIP曲', fee: 1 },
    ]);
    const r = await pickSong({ cache: {}, now: () => now, fetchImpl: fetch, rand: () => 0.99 });
    t.eq(r.source, 'netease', '热门可用 → netease');
    t.eq(r.song, { id: 22, name: '热门2' }, 'rand→1 且已过滤 VIP');
    t.eq(r.patch.artistId, KNOWN_ARTIST_ID, '写入歌手 ID');
    t.eq(r.patch.songs.length, 2, '写入过滤后歌单');
    t.eq(r.patch.songsUpdatedAt, now, '写入时间戳');
  }
  {
    // 已知 ID 失败 → 搜索重新解析 → 成功
    const calls = [];
    const fetch = async (url) => {
      calls.push(url);
      if (url.includes(`/api/artist/${KNOWN_ARTIST_ID}`)) return null; // 已知 ID 失败
      if (url.includes('/api/search/get')) return { result: { artists: [{ id: 777, name: '洛天依Official' }] } };
      if (url.includes('/api/artist/777')) return { hotSongs: [{ id: 31, name: '搜索重试曲', fee: 0 }] };
      return null;
    };
    const r = await pickSong({ cache: {}, fetchImpl: fetch, rand: () => 0 });
    t.eq(r.song.id, 31, '搜索重试路径成功');
    t.eq(r.patch.artistId, 777, '缓存写入新歌手 ID');
    t.ok(calls.some((u) => u.includes('/api/search/get')), '触发过搜索');
  }
  {
    // 全部失败 → 兜底 5 首
    const r = await pickSong({ cache: {}, fetchImpl: neverFetch, rand: () => 0 });
    t.eq(r.source, 'fallback', '降级到兜底');
    t.eq(r.song.id, FALLBACK_SONGS[0].id, '兜底第一首');
    t.eq(r.patch, null, '失败不写缓存');
  }
  {
    // 网络抛异常（非 null 返回）→ 兜底
    const throwing = async () => { throw new Error('network down'); };
    const r = await pickSong({ cache: {}, fetchImpl: throwing, rand: () => 0.5 });
    t.eq(r.source, 'fallback', '异常路径降级兜底');
  }
}
