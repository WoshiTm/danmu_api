import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// --- 基础 GET 请求 (前缀: https://m.douban.com/rexxar/api/v2) ---
async function doubanApiGet(url) {
  const doubanApi = "https://m.douban.com/rexxar/api/v2";
  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
  };

  if (globals.doubanCookie) headers["Cookie"] = globals.doubanCookie;

  try {
    const response = await httpGet(`${doubanApi}${url}`, { method: 'GET', headers });
    // 403 时静默返回，不打印错误日志
    if (response && response.status === 403) return { status: 403, data: null };
    if (!response || response.status !== 200) return null;
    return response;
  } catch (error) {
    log("error", "[DOUBAN] GET API unexpected error:", error.message);
    return null;
  }
}

// --- 降级搜索接口 (Suggest API) ---
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
    return (res && res.status === 200 && Array.isArray(res.data)) ? res.data : [];
  } catch (error) {
    log("error", "[DOUBAN] Suggest Fallback Error:", error.message);
    return [];
  }
}

// --- 搜索入口 ---
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}&type=movie`;
  const res = await doubanApiGet(url);

  if (res && res.status === 200 && res.data?.subjects) return res.data.subjects;

  // 触发降级：转换数据结构以兼容后续逻辑
  const fallbackList = await doubanSuggestFallback(keyword);
  return fallbackList.map(item => ({
    id: item.id,
    title: item.title,
    pic: { normal: item.img }
  }));
}

// --- 获取详情 (使用指定的 /subject/ 路径) ---
export async function getDoubanDetail(doubanId) {
  // 拼接结果: https://m.douban.com/rexxar/api/v2/subject/ID?for_mobile=1
  const url = `/subject/${doubanId}?for_mobile=1`;
  const res = await doubanApiGet(url);
  return (res && res.status === 200) ? res.data : null;
}

// --- 智能集成入口 (自动执行：搜索 -> 提取 ID -> 请求详情) ---
export async function getDoubanSmartDetail(keyword) {
  const list = await searchDoubanTitles(keyword);
  if (!list || list.length === 0) return null;

  // 匹配最接近的条目并提取 id
  const bestMatch = list.find(item => item.title === keyword) || list[0];
  if (!bestMatch?.id) return null;

  // 执行下一步：获取详情
  const detail = await getDoubanDetail(bestMatch.id);

  // 详情接口若也 403，则返回搜索阶段拿到的基础数据兜底
  return detail || {
    id: bestMatch.id,
    title: bestMatch.title,
    pic: bestMatch.pic,
    is_partial: true 
  };
}

// --- V2 POST (IMDB反查) ---
export async function getDoubanInfoByImdbId(imdbId) {
  const doubanApi = "https://api.douban.com/v2";
  try {
    const response = await httpPost(
      `${doubanApi}/movie/imdb/${imdbId}`,
      JSON.stringify({ apikey: "0ac44ae016490db2204ce0a042db2916" }),
      {
        method: 'POST',
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      }
    );
    return (response && response.status === 200) ? response : null;
  } catch (error) {
    log("error", "[DOUBAN] IMDB API error:", error.message);
    return null;
  }
}
