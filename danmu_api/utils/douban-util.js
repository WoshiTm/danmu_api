import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// =====================
// 基础 GET
// =====================
async function doubanApiGet(url) {
  const base = "https://m.douban.com/rexxar/api/v2";

  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0"
  };

  if (globals.doubanCookie) headers["Cookie"] = globals.doubanCookie;

  try {
    const res = await httpGet(`${base}${url}`, {
      method: "GET",
      headers
    });

    if (res && res.status === 403) {
      return { status: 403, data: null };
    }

    if (!res || res.status !== 200) return null;

    return res;
  } catch (err) {
    log("error", "[DOUBAN] GET error:", err.message);
    return null;
  }
}

// =====================
// fallback suggest
// =====================
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

// =====================
// 🔥 统一结构（关键修复）
// =====================
function normalize(item) {
  return {
    layout: "subject",

    // 👉 关键：保证一定有 id
    target_id: item.id || item.target_id,

    type_name: item.type_name || "电影",

    target: {
      title: item.title || item.target?.title || "",
      cover_url: item.img || item.pic?.normal || item.target?.cover_url || ""
    }
  };
}

// =====================
// search（只改这里就够）
// =====================
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}&type=movie`;

  const res = await doubanApiGet(url);

  let list = [];

  // ✅ 正常 search
  if (res?.status === 200 && res.data?.subjects?.length) {
    list = res.data.subjects;
  } else {
    // ❗ fallback
    list = await doubanSuggestFallback(keyword);
  }

  // 🔥 统一结构输出（关键）
  return list
    .map(normalize)
    .filter(i => i.target_id); // 防止脏数据
}

// =====================
// detail（不动）
// =====================
export async function getDoubanDetail(id) {
  const url = `/subject/${id}?for_mobile=1`;

  const res = await doubanApiGet(url);
  return res?.status === 200 ? res.data : null;
}

// =====================
// smart detail（不动）
// =====================
export async function getDoubanSmartDetail(keyword) {
  const list = await searchDoubanTitles(keyword);
  if (!list.length) return null;

  const best = list[0];

  const detail = await getDoubanDetail(best.target_id);

  return detail || {
    id: best.target_id,
    title: best.target?.title,
    pic: best.target?.cover_url,
    is_partial: true
  };
}

// =====================
// imdb（不动）
// =====================
export async function getDoubanInfoByImdbId(imdbId) {
  const base = "https://api.douban.com/v2";

  try {
    const res = await httpPost(
      `${base}/movie/imdb/${imdbId}`,
      JSON.stringify({ apikey: "0ac44ae016490db2204ce0a042db2916" }),
      {
        method: "POST",
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );

    return res?.status === 200 ? res : null;
  } catch (err) {
    log("error", "[DOUBAN] imdb error:", err.message);
    return null;
  }
}