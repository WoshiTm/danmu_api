import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// ---------------------
// 1. 基础工具逻辑 (Rexxar API)
// ---------------------
async function doubanApiGet(url) {
  const doubanApi = "https://m.douban.com/rexxar/api/v2";
  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1"
  };

  if (globals.doubanCookie) {
    headers["Cookie"] = globals.doubanCookie;
  }

  try {
    // 拼接完整的 Rexxar 地址
    const response = await httpGet(`${doubanApi}${url}`, {
      method: 'GET',
      headers
    });
    
    // 兼容处理：有些 httpGet 返回 response 对象，有些直接返回 data
    return response;
  } catch (error) {
    // 这里只记录 warn，由上层 WithFallback 函数决定是否降级
    log("warn", `[DOUBAN] Rexxar API Request Error: ${url}`);
    return null;
  }
}

// ---------------------
// 2. 原始主接口
// ---------------------
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}`;
  return await doubanApiGet(url);
}

export async function getDoubanDetail(doubanId) {
  // 使用 /subject/ 路径比 /movie/ 更通用（兼容剧集和电影）
  const url = `/subject/${doubanId}?for_mobile=1`;
  return await doubanApiGet(url);
}

// ---------------------
// 3. 🔥 降级搜索接口：subject_suggest
// ---------------------
async function searchDoubanSuggest(keyword) {
  try {
    const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
    log("info", `[DOUBAN] 尝试请求 Suggest 接口: ${url}`);

    const response = await httpGet(url, {
      method: 'GET',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://movie.douban.com/"
      }
    });

    // 适配数据格式
    let data = response?.data || response;
    if (typeof data === 'string') data = JSON.parse(data);
    if (!Array.isArray(data)) return [];

    // 核心转换：将 suggest 格式映射为 Rexxar 格式
    return data.map(item => ({
      layout: "subject",
      type_name: item.type === "movie" ? "电影" : "电视剧",
      target_id: String(item.id),
      target: {
        id: String(item.id),
        title: item.title,
        cover_url: item.img, // 修复：此处必须是 img
        year: item.year || "",
        uri: `douban://douban.com/${item.type}/${item.id}`,
        has_linewatch: true
      }
    }));
  } catch (error) {
    log("error", "[DOUBAN] suggest API 彻底失败", error);
    return [];
  }
}

// ---------------------
// 4. 🔥 降级详情逻辑
// ---------------------
async function getDoubanSubjectDetail(doubanId) {
  // 如果搜索降级了，详情依然需要尝试通过 Rexxar 获取（因为只有它有播放源数据）
  const response = await getDoubanDetail(doubanId);
  const d = response?.data || response;

  if (!d || Object.keys(d).length === 0) return null;

  return {
    data: {
      ...d,
      title: d.title,
      year: d.year,
      vendors: d.vendors || d.vendor || [] // 确保播放源字段对齐
    }
  };
}

// ---------------------
// 5. 🔥 对外统一：搜索（主 + 降级融合）
// ---------------------
export async function searchDoubanTitlesWithFallback(keyword, count = 20) {
  let tmpAnimes = [];
  let primaryRes = null;

  // 1️⃣ 先尝试主接口
  try {
    primaryRes = await searchDoubanTitles(keyword, count);
    const data = primaryRes?.data || primaryRes;

    if (data?.subjects?.items?.length > 0) {
      tmpAnimes.push(...data.subjects.items);
    }
    if (data?.smart_box?.length > 0) {
      tmpAnimes.push(...data.smart_box);
    }
  } catch (e) {
    log("warn", "[DOUBAN] 主接口抛出异常，忽略并准备降级");
  }

  // 2️⃣ 如果主接口有数，直接返回
  if (tmpAnimes.length > 0) {
    log("info", "[DOUBAN] 主接口搜索成功");
    return primaryRes;
  }

  // 3️⃣ 主接口失败或无数据，执行降级
  log("warn", `[DOUBAN] 主接口 403 或无结果，启动降级搜索: ${keyword}`);
  const fallbackItems = await searchDoubanSuggest(keyword);

  return {
    status: 200,
    data: {
      subjects: {
        items: fallbackItems
      }
    }
  };
}

// ---------------------
// 6. 🔥 对外统一：详情（主 + 降级融合）
// ---------------------
export async function getDoubanDetailWithFallback(doubanId) {
  try {
    // 详情逻辑本身就是请求 Rexxar
    const response = await getDoubanSubjectDetail(doubanId);
    const resData = response?.data || response;

    if (resData?.vendors?.length > 0) {
      log("info", `[DOUBAN] 详情获取成功，发现播放源: ${resData.vendors.length}个`);
      return response;
    }
    
    log("warn", `[DOUBAN] 详情获取成功但无播放源: ${doubanId}`);
    return response;
  } catch (e) {
    log("error", "[DOUBAN] 详情获取逻辑崩溃", e);
    return null;
  }
}

// ---------------------
// 7. IMDB (保持不变)
// ---------------------
export async function getDoubanInfoByImdbId(imdbId) {
  const url = `https://api.douban.com/v2/movie/imdb/${imdbId}`;
  try {
    const response = await httpPost(url, 
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
    return response;
  } catch (e) {
    return null;
  }
}
