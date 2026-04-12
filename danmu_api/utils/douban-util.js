import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// --- 基础工具：确保所有返回都经过状态检查 ---
async function doubanApiGet(url) {
  const doubanApi = "https://m.douban.com/rexxar/api/v2";
  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1"
  };

  if (globals.doubanCookie) headers["Cookie"] = globals.doubanCookie;

  try {
    const response = await httpGet(`${doubanApi}${url}`, { method: 'GET', headers });
    // 即使是 403，也返回 response 对象供上层逻辑判断，而不是直接 throw
    return response;
  } catch (error) {
    // 捕获网络层级的彻底失败
    return { status: 500, data: null, error: error.message };
  }
}

// --- 降级搜索：确保返回的结构与 Rexxar 尽量一致 ---
async function doubanSuggestFallback(keyword) {
  const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
  try {
    const res = await httpGet(url, {
      method: "GET",
      headers: {
        "Referer": "https://movie.douban.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    const data = res?.data || res;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    log("error", "[DOUBAN] Suggest Fallback Request Error:", error.message);
    return [];
  }
}

// --- 搜索入口：统一返回“列表数组” ---
export async function searchDoubanTitles(keyword, count = 20) {
  const url = `/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}`;
  const res = await doubanApiGet(url);

  // 1. 如果主接口成功返回了标准 Rexxar 结构
  if (res && res.status === 200 && res.data?.subjects?.items) {
    return res.data.subjects.items; 
  }

  // 2. 触发降级
  log("warn", "[DOUBAN] 主接口未命中，执行降级搜索...");
  const fallbackList = await doubanSuggestFallback(keyword);
  
  // 关键：将 Suggest 的数据结构映射成主逻辑能识别的格式
  return fallbackList.map(item => ({
    id: String(item.id),
    title: item.title,
    pic: { normal: item.img }, // 对齐 Rexxar 的图片层级
    year: item.year,
    type: item.type,
    // 增加一个标记，告诉下游这是降级数据
    _is_fallback: true 
  }));
}

// --- 获取详情：增加对 403 的处理逻辑 ---
export async function getDoubanDetail(doubanId) {
  const url = `/subject/${doubanId}?for_mobile=1`;
  const res = await doubanApiGet(url);
  
  if (res && res.status === 200) {
    return res.data || res;
  }
  
  // 如果是 403 或其他错误，返回 null 触发 SmartDetail 的兜底
  return null;
}

// --- 智能集成入口：确保逻辑“必须”完整走完 ---
export async function getDoubanSmartDetail(keyword) {
  log("info", `[DOUBAN] 开始智能详情检索: ${keyword}`);

  // 1. 搜索
  const list = await searchDoubanTitles(keyword);
  if (!list || list.length === 0) {
    log("error", "[DOUBAN] 搜索无任何结果返回");
    return null;
  }

  // 2. 匹配最优 ID
  const bestMatch = list.find(item => item.title === keyword) || list[0];
  log("info", `[DOUBAN] 匹配到 ID: ${bestMatch.id} (${bestMatch.title})`);

  // 3. 尝试详情请求
  const detail = await getDoubanDetail(bestMatch.id);

  if (detail) {
    log("info", "[DOUBAN] 详情接口请求成功");
    return detail;
  }

  // 4. 🔥 逻辑补全：如果详情接口没拿到数据，利用搜索阶段的“降级数据”构造一个保底对象
  log("warn", "[DOUBAN] 详情接口无响应或 403，启动数据伪装补全流程...");

  // 构造一个主脚本期望看到的完整结构，即使某些字段（如播放源）为空
  return {
    id: bestMatch.id,
    title: bestMatch.title,
    year: bestMatch.year || "",
    pic: bestMatch.pic || { normal: "" },
    genres: [],
    countries: [],
    vendors: [], // 哪怕是空的，也要给个数组，防止主脚本读取 .length 时报错
    is_partial: true,
    _source: "fallback_search_info"
  };
}

// --- IMDB 反查 ---
export async function getDoubanInfoByImdbId(imdbId) {
  const doubanApi = "https://api.douban.com/v2";
  try {
    const response = await httpPost(
      `${doubanApi}/movie/imdb/${imdbId}`,
      JSON.stringify({ apikey: "0ac44ae016490db2204ce0a042db2916" }),
      {
        headers: {
          "Referer": "https://api.douban.com",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0"
        }
      }
    );
    return response;
  } catch (error) {
    return null;
  }
}
