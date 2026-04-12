import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// ---------------------
// 基础 GET
// ---------------------
async function doubanApiGet(url) {
  const doubanApi = "https://m.douban.com/rexxar/api/v2";

  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };

  if (globals.doubanCookie) {
    headers["Cookie"] = globals.doubanCookie;
  }

  try {
    const response = await httpGet(`${doubanApi}${url}`, {
      method: 'GET',
      headers
    });

    if (response.status != 200) return null;
    return response;

  } catch (error) {
    log("error", "[DOUBAN] GET API error:", error);
    return null;
  }
}

// ---------------------
// 主搜索接口
// ---------------------
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${keyword}&start=0&count=${count}&type=movie`;
  return await doubanApiGet(url);
}

// ---------------------
// 主详情接口
// ---------------------
export async function getDoubanDetail(doubanId) {
  const url = `/movie/${doubanId}?for_mobile=1`;
  return await doubanApiGet(url);
}

// =====================================================
// 降级接口：subject_suggest
// =====================================================
async function searchDoubanSuggest(keyword) {
  try {
    const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;

    const response = await httpGet(url, {
      method: 'GET',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://movie.douban.com/"
      }
    });

    // 兼容不同的 http 工具类返回格式（有的包一层 data，有的直接返回结果）
    let data = response?.data ? response.data : response;
    
    // 如果返回是字符串，尝试解析
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) { return []; }
    }

    if (!Array.isArray(data)) return [];

    // 统一结构化
    return data.map(item => ({
      layout: "subject",
      type_name: item.type === "movie" ? "电影" : "电视剧",
      target_id: item.id,
      target: {
        id: item.id,
        title: item.title,
        cover_url: item.img, // 修复：suggest 接口返回的图片字段叫 img，不是 pic
        year: item.year || ""
      }
    }));

  } catch (error) {
    log("error", "[DOUBAN] suggest API error:", error);
    return [];
  }
}

// =====================================================
// 降级详情接口：subject
// =====================================================
async function getDoubanSubjectDetail(doubanId) {
  try {
    const url = `/subject/${doubanId}?for_mobile=1`;

    // 警告：这里依然调用了 doubanApiGet (也就是 Rexxar 接口)
    // 如果你的 IP 被 Rexxar 彻底 403，这一步必定也会 403 返回 null。
    const response = await doubanApiGet(url);

    // 兼容提取 response 里的内容
    const d = response?.data ? response.data : response;
    if (!d || Object.keys(d).length === 0) return null;

    // 兼容成 movie detail 结构
    return {
      data: {
        title: d.title,
        year: d.year,
        genres: d.genres || [],
        countries: d.countries || [],
        vendors: d.vendor || d.vendors || [],
        ...d // 把原始数据带上，防止上层脚本需要其他字段
      }
    };

  } catch (error) {
    log("error", "[DOUBAN] subject detail error:", error);
    return null;
  }
}

// =====================================================
// 对外统一：搜索（主 + 降级融合）
// =====================================================
export async function searchDoubanTitlesWithFallback(keyword, count = 20) {

  // 1️⃣ 主接口
  const primary = await searchDoubanTitles(keyword, count);

  let data = primary?.data ? primary.data : primary;
  let tmpAnimes = [];

  if (data?.subjects?.items?.length > 0) {
    tmpAnimes.push(...data.subjects.items);
  }

  if (data?.smart_box?.length > 0) {
    tmpAnimes.push(...data.smart_box);
  }

  // 2️⃣ 主接口成功直接返回
  if (tmpAnimes.length > 0) {
    // 保持原来的返回结构
    return primary;
  }

  // 3️⃣ 降级接口
  log("warn", "[DOUBAN] Rexxar 搜索失败，启动 fallback (subject_suggest)");

  const fallbackItems = await searchDoubanSuggest(keyword);

  return {
    status: 200,
    data: {
      subjects: {
        items: fallbackItems
      },
      smart_box: []
    }
  };
}

// =====================================================
// 对外统一：详情（主 + 降级）
// =====================================================
export async function getDoubanDetailWithFallback(doubanId) {

  // 1️⃣ 主接口
  let response = await getDoubanDetail(doubanId);
  let resData = response?.data ? response.data : response;

  if (resData?.vendors?.length > 0) {
    return response;
  }

  // 2️⃣ 降级接口
  log("warn", `[DOUBAN] fallback subject detail: ${doubanId}`);

  const fallback = await getDoubanSubjectDetail(doubanId);

  return fallback;
}

// ---------------------
// imdb
// ---------------------
export async function getDoubanInfoByImdbId(imdbId) {
  const url = `/movie/imdb/${imdbId}`;

  return await httpPost(`${"https://api.douban.com/v2"}${url}`,
    JSON.stringify({
      apikey: "0ac44ae016490db2204ce0a042db2916"
    }), {
      method: 'GET',
      headers: {
        "Referer": "https://api.douban.com",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0"
      }
    });
}
