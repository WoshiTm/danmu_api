import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// =====================
// Rexxar GET 基础请求
// =====================
async function doubanApiGet(url) {
  const doubanApi = "https://m.douban.com/rexxar/api/v2";

  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
  };

  if (globals.doubanCookie) {
    headers["Cookie"] = globals.doubanCookie;
  }

  try {
    const response = await httpGet(`${doubanApi}${url}`, {
      method: 'GET',
      headers
    });

    // 状态归类
    if (!response) {
      log("warn", "[DOUBAN] request failed → fallback will be used");
      return null;
    }

    if (response.status === 403) {
      log("warn", "[DOUBAN] blocked (403) → fallback triggered");
      return { blocked: true };
    }

    if (response.status !== 200) {
      log("warn", `[DOUBAN] request non-200 (${response.status}) → fallback`);
      return null;
    }

    return response;

  } catch {
    // 不输出错误
    log("warn", "[DOUBAN] request exception → fallback triggered");
    return null;
  }
}

// =====================
// Suggest fallback
// =====================
async function doubanSuggestFallback(keyword) {
  log("info", `[DOUBAN] fallback start: ${keyword}`);

  const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;

  try {
    const res = await httpGet(url, {
      method: "GET",
      headers: {
        "Referer": "https://movie.douban.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res || res.status !== 200) {
      log("warn", "[DOUBAN] fallback request failed (non-200)");
      return [];
    }

    const data = Array.isArray(res.data) ? res.data : [];

    log("info", `[DOUBAN] fallback success: ${data.length} items`);

    return data;

  } catch {
    log("warn", "[DOUBAN] fallback exception (ignored)");
    return [];
  }
}

// =====================
// 搜索入口
// =====================
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}&type=movie`;

  const res = await doubanApiGet(url);

  const subjects = res?.data?.subjects;

  if (Array.isArray(subjects) && subjects.length > 0) {
    log("info", `[DOUBAN] search success: ${subjects.length}`);
    return {
      status: 200,
      data: { subjects }
    };
  }

  log("warn", "[DOUBAN] search failed → using suggest fallback");

  const fallbackData = await doubanSuggestFallback(keyword);

  return {
    status: 200,
    data: { subjects: fallbackData },
    source: "suggest"
  };
}

// =====================
// 详情接口
// =====================
export async function getDoubanDetail(doubanId) {
  const url = `/subject/${doubanId}?for_mobile=1`;

  log("info", `[DOUBAN] fetching detail: ${doubanId}`);

  return await doubanApiGet(url);
}

// =====================
// IMDb（保留原逻辑）
// =====================
export async function getDoubanInfoByImdbId(imdbId) {
  const url = `/movie/imdb/${imdbId}`;
  return await doubanApiPost(url);
}

// =====================
// POST（保留）
// =====================
async function doubanApiPost(url, data = {}) {
  const doubanApi = "https://api.douban.com/v2";

  try {
    const response = await httpPost(
      `${doubanApi}${url}`,
      JSON.stringify({
        ...data,
        apikey: "0ac44ae016490db2204ce0a042db2916"
      }),
      {
        method: 'POST',
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    return (response && response.status === 200) ? response : null;

  } catch {
    log("warn", "[DOUBAN] POST request failed");
    return null;
  }
}

// =====================
// 归一化匹配（稳定版）
// =====================
function normalize(str) {
  return (str || "")
    .replace(/[，,。.！!？?\s_-]/g, "")
    .toLowerCase();
}

function matchSuggest(list, keyword) {
  if (!Array.isArray(list) || list.length === 0) return null;

  const k = normalize(keyword);

  const exact = list.find(item =>
    normalize(item.title) === k ||
    normalize(item.sub_title) === k
  );

  if (exact) return exact;

  const fuzzy = list.find(item => {
    const t = normalize(item.title);
    const s = normalize(item.sub_title);

    return t.includes(k) || k.includes(t) ||
           s.includes(k) || k.includes(s);
  });

  return fuzzy || list[0];
}

// =====================
// 最终智能入口
// =====================
export async function getDoubanSmartDetail(keyword) {
  log("info", `[DOUBAN] smart search start: ${keyword}`);

  const searchRes = await searchDoubanTitles(keyword);
  const list = searchRes?.data?.subjects || [];

  if (list.length === 0) {
    log("warn", "[DOUBAN] empty result after fallback");
    return null;
  }

  const bestMatch = matchSuggest(list, keyword);

  if (!bestMatch?.id) {
    log("warn", "[DOUBAN] no valid match found");
    return null;
  }

  log("info", `[DOUBAN] match → ${bestMatch.title} (${bestMatch.id})`);

  return await getDoubanDetail(bestMatch.id);
}