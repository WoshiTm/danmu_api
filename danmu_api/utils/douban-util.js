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
// 降级接口
// =====================================================
async function searchDoubanSuggest(keyword) {
  try {
    const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;

    const response = await httpGet(url, {
      method: 'GET',
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://movie.douban.com/"
      }
    });

    if (response.status != 200) return [];

    const data = response.data;

    if (!Array.isArray(data)) return [];

    // 统一结构化
    return data.map(item => ({
      layout: "subject",
      type_name: item.type === "movie" ? "电影" : "电视剧",
      target_id: item.id,
      target: {
        id: item.id,
        title: item.title,
        cover_url: item.pic,
        year: item.year
      }
    }));

  } catch (error) {
    log("error", "[DOUBAN] suggest API error:", error);
    return [];
  }
}

// =====================================================
// 降级详情接口
// =====================================================
async function getDoubanSubjectDetail(doubanId) {
  try {
    const url = `/subject/${doubanId}?for_mobile=1`;

    const response = await doubanApiGet(url);

    if (!response?.data) return null;

    const d = response.data;

    // 兼容成 movie detail 结构
    return {
      data: {
        title: d.title,
        year: d.year,
        genres: d.genres || [],
        countries: d.countries || [],
        vendors: d.vendor || d.vendors || []
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

  let data = primary?.data;

  let tmpAnimes = [];

  if (data?.subjects?.items?.length > 0) {
    tmpAnimes.push(...data.subjects.items);
  }

  if (data?.smart_box?.length > 0) {
    tmpAnimes.push(...data.smart_box);
  }

  // 2️⃣ 主接口成功直接返回
  if (tmpAnimes.length > 0) {
    return primary;
  }

  // 3️⃣ 降级接口
  log("warn", "[DOUBAN] fallback to subject_suggest");

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
// 🔥 对外统一：详情（主 + 降级）
// =====================================================
export async function getDoubanDetailWithFallback(doubanId) {

  // 1️⃣ 主接口
  let response = await getDoubanDetail(doubanId);

  if (response?.data?.vendors?.length > 0) {
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