import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// --- 基础 GET ---
async function doubanApiGet(url) {
  const doubanApi = "https://m.douban.com/rexxar/api/v2";

  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0"
  };

  if (globals.doubanCookie) headers["Cookie"] = globals.doubanCookie;

  try {
    const response = await httpGet(`${doubanApi}${url}`, {
      method: 'GET',
      headers
    });

    if (response && response.status === 403) return { status: 403, data: null };
    if (!response || response.status !== 200) return null;

    return response;
  } catch (err) {
    log("error", "[DOUBAN] GET error:", err.message);
    return null;
  }
}

// --- fallback suggest ---
async function doubanSuggestFallback(keyword) {
  const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;

  try {
    const res = await httpGet(url, {
      method: "GET",
      headers: {
        "Referer": "https://movie.douban.com/",
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!res || res.status !== 200 || !Array.isArray(res.data)) return [];

    return res.data;
  } catch (err) {
    log("error", "[DOUBAN] suggest error:", err.message);
    return [];
  }
}

// ---  统一数据结构转换  ---
function normalizeSubject(item) {
  return {
    layout: "subject",
    target_id: item.id,
    type_name: item.type_name || "电影",
    target: {
      title: item.title,
      cover_url: item.pic?.normal || item.img || ""
    }
  };
}

// --- 搜索 ---
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}&type=movie`;

  const res = await doubanApiGet(url);

  // 正常 search
  if (res?.status === 200 && res.data?.subjects?.length) {
    return res.data.subjects.map(normalizeSubject);
  }

  // fallback suggest
  const fallback = await doubanSuggestFallback(keyword);

  return fallback.map(normalizeSubject);
}

// --- detail ---
export async function getDoubanDetail(doubanId) {
  const url = `/subject/${doubanId}?for_mobile=1`;

  const res = await doubanApiGet(url);
  return (res && res.status === 200) ? res.data : null;
}

// --- smart detail ---
export async function getDoubanSmartDetail(keyword) {
  const list = await searchDoubanTitles(keyword);
  if (!list.length) return null;

  const best = list.find(i => i.target?.title === keyword) || list[0];

  const detail = await getDoubanDetail(best.target_id);

  return detail || {
    id: best.target_id,
    title: best.target?.title,
    pic: best.target?.cover_url,
    is_partial: true
  };
}

// --- imdb ---
export async function getDoubanInfoByImdbId(imdbId) {
  const doubanApi = "https://api.douban.com/v2";

  try {
    const res = await httpPost(
      `${doubanApi}/movie/imdb/${imdbId}`,
      JSON.stringify({ apikey: "0ac44ae016490db2204ce0a042db2916" }),
      {
        method: 'POST',
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    return (res && res.status === 200) ? res : null;
  } catch (err) {
    log("error", "[DOUBAN] imdb error:", err.message);
    return null;
  }
}