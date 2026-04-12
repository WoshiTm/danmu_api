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
    const response = await httpGet(`${doubanApi}${url}`, {
      method: 'GET',
      headers
    });
    // 注意：底层 http-util 报错时会抛出异常，进入 catch
    return response;
  } catch (error) {
    // 这里仅记录日志，不抛出异常，让上层逻辑继续执行 fallback
    log("warn", `[DOUBAN] Rexxar API Request Error: ${url}`);
    return null;
  }
}

// ---------------------
// 2. 原始主接口 (Rexxar)
// ---------------------
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}`;
  return await doubanApiGet(url);
}

export async function getDoubanDetail(doubanId) {
  const url = `/subject/${doubanId}?for_mobile=1`;
  return await doubanApiGet(url);
}

// ---------------------
// 3. 🔥 降级搜索接口：subject_suggest (Web端接口)
// ---------------------
async function searchDoubanSuggest(keyword) {
  try {
    const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
    log("info", `[DOUBAN] 尝试请求 Suggest 降级接口: ${url}`);

    const response = await httpGet(url, {
      method: 'GET',
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://movie.douban.com/"
      }
    });

    // 适配各种可能的 httpGet 返回结构 (response.data 或 response 本身)
    let data = response?.data || response;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch(e) { return []; }
    }

    if (!Array.isArray(data)) {
      log("warn", "[DOUBAN] Suggest 接口返回数据格式非数组");
      return [];
    }

    // 字段映射：将 Web 端格式转换为脚本兼容的 Rexxar 格式
    return data.map(item => ({
      layout: "subject",
      type_name: item.type === "movie" ? "电影" : "电视剧",
      target_id: String(item.id),
      target: {
        id: String(item.id),
        title: item.title,
        cover_url: item.img, // 关键：Web 端接口返回的是 img 字段
        year: item.year || "",
        uri: `douban://douban.com/${item.type}/${item.id}`,
        has_linewatch: true
      }
    }));
  } catch (error) {
    log("error", "[DOUBAN] suggest API 请求彻底失败", error.message);
    return [];
  }
}

// ---------------------
// 4. 🔥 降级详情处理
// ---------------------
async function getDoubanSubjectDetail(doubanId) {
  // 详情依然只能去尝试 Rexxar，因为只有那里有播放源 (vendors)
  const response = await getDoubanDetail(doubanId);
  if (!response) return null;

  const d = response.data || response;
  if (!d || Object.keys(d).length === 0) return null;

  return {
    data: {
      ...d,
      title: d.title,
      year: d.year,
      vendors: d.vendors || d.vendor || [] 
    }
  };
}

// ---------------------
// 5. 🔥 对外统一导出：搜索 (主 + 降级)
// ---------------------
export async function searchDoubanTitlesWithFallback(keyword, count = 20) {
  let tmpItems = [];
  let primaryRes = null;

  log("info", `[DOUBAN] --- 开始搜索流程: ${keyword} ---`);

  // 1️⃣ 尝试主接口 (包裹在 try-catch 中，防止 403 直接把脚本带崩)
  try {
    primaryRes = await searchDoubanTitles(keyword, count);
    if (primaryRes) {
      const data = primaryRes.data || primaryRes;
      if (data?.subjects?.items?.length > 0) {
        tmpItems.push(...data.subjects.items);
      } else if (data?.smart_box?.length > 0) {
        tmpItems.push(...data.smart_box);
      }
    }
  } catch (e) {
    log("warn", "[DOUBAN] 主接口执行异常，已捕获并准备降级");
  }

  // 2️⃣ 如果主接口成功拿到结果，直接返回
  if (tmpItems.length > 0) {
    log("info", `[DOUBAN] 主接口成功返回 ${tmpItems.length} 条数据`);
    return primaryRes;
  }

  // 3️⃣ 主接口失效，强制执行降级搜索
  log("warn", "[DOUBAN] 主接口无有效数据 (可能是403)，强制启动降级接口...");
  
  try {
    const fallbackItems = await searchDoubanSuggest(keyword);
    log("info", `[DOUBAN] 降级搜索完毕，找到 ${fallbackItems.length} 条结果`);

    return {
      status: 200,
      data: {
        subjects: {
          items: fallbackItems
        }
      }
    };
  } catch (err) {
    log("error", "[DOUBAN] 降级链路执行失败");
    return null;
  }
}

// ---------------------
// 6. 🔥 对外统一导出：详情 (主 + 降级)
// ---------------------
export async function getDoubanDetailWithFallback(doubanId) {
  try {
    const response = await getDoubanSubjectDetail(doubanId);
    if (!response) {
      log("error", `[DOUBAN] 无法通过详情接口获取 ID 为 ${doubanId} 的数据`);
      return null;
    }

    const resData = response.data || response;
    if (resData?.vendors?.length > 0) {
      log("info", `[DOUBAN] 成功获取播放源，数量: ${resData.vendors.length}`);
    } else {
      log("warn", `[DOUBAN] 获取到详情但未发现播放源 (Vendors为空)`);
    }
    return response;
  } catch (e) {
    log("error", "[DOUBAN] 详情 Fallback 流程崩溃");
    return null;
  }
}

// ---------------------
// 7. IMDB 接口
// ---------------------
export async function getDoubanInfoByImdbId(imdbId) {
  const url = `https://api.douban.com/v2/movie/imdb/${imdbId}`;
  try {
    return await httpPost(url, 
      JSON.stringify({ apikey: "0ac44ae016490db2204ce0a042db2916" }), 
      {
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );
  } catch (e) {
    return null;
  }
}
