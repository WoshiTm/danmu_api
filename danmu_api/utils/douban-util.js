import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// --- Rexxar GET 请求基础方法 ---
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
    const response = await httpGet(`${doubanApi}${url}`, { method: 'GET', headers });
    if (!response || response.status != 200) return null;
    return response;
  } catch (error) {
    log("error", "[DOUBAN] GET API error:", error.message);
    return null;
  }
}

// --- Suggest 接口降级方法 ---
async function doubanSuggestFallback(keyword) {
  const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
  try {
    const res = await httpGet(url, {
      method: "GET",
      headers: {
        "Referer": "https://movie.douban.com/",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
      }
    });
    if (!res || res.status !== 200) return [];
    return Array.isArray(res.data) ? res.data : [];
  } catch (error) {
    log("error", "[DOUBAN] suggest fallback error:", error.message);
    return [];
  }
}

// --- 搜索入口 ---
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}&type=movie`;
  const res = await doubanApiGet(url);

  if (res && res.data?.subjects) {
    return res;
  }

  log("warn", "[DOUBAN] search fallback triggered");
  const fallbackData = await doubanSuggestFallback(keyword);

  return {
    status: 200,
    data: { subjects: fallbackData }
  };
}

// --- 获取详情 ---
export async function getDoubanDetail(doubanId) {
  const url = `/subject/${doubanId}?for_mobile=1`;
  return await doubanApiGet(url);
}

// --- IMDB 查询 ---
export async function getDoubanInfoByImdbId(imdbId) {
  const url = `/movie/imdb/${imdbId}`;
  return await doubanApiPost(url);
}

// --- 基础 POST 请求方法 ---
async function doubanApiPost(url, data = {}) {
  const doubanApi = "https://api.douban.com/v2";
  try {
    const response = await httpPost(
      `${doubanApi}${url}`,
      JSON.stringify({ ...data, apikey: "0ac44ae016490db2204ce0a042db2916" }),
      {
        method: 'POST',
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      }
    );
    return (response && response.status == 200) ? response : null;
  } catch (error) {
    log("error", "[DOUBAN] POST API error:", error.message);
    return null;
  }
}

// --- 列表匹配算法 ---
function matchSuggest(list, keyword) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const exact = list.find(item => item.title === keyword);
  if (exact) return exact;
  const fuzzy = list.find(item => item.title?.includes(keyword) || keyword.includes(item.title));
  return fuzzy || list[0];
}

// --- 最终集成智能入口 ---
export async function getDoubanSmartDetail(keyword) {
  const searchRes = await searchDoubanTitles(keyword);
  const list = searchRes?.data?.subjects;

  if (!list || list.length === 0) return null;

  const bestMatch = matchSuggest(list, keyword);
  if (!bestMatch?.id) return null;

  return await getDoubanDetail(bestMatch.id);
}
