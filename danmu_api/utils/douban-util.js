import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// ---------------------
// 1. 基础工具逻辑
// ---------------------

function getHeaders() {
  const headers = {
    "Referer": "https://m.douban.com/movie/",
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1",
    "Content-Type": "application/json"
  };
  if (globals.doubanCookie) {
    headers["Cookie"] = globals.doubanCookie;
  }
  return headers;
}

// ---------------------
// 2. 搜索逻辑（含全自动降级与字段修复）
// ---------------------

export async function searchDoubanTitles(keyword, count = 20) {
  log("info", `[DOUBAN] 正在搜索关键词: ${keyword}`);

  // --- 尝试原装 Rexxar 接口 ---
  try {
    const rexxarUrl = `https://m.douban.com/rexxar/api/v2/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}`;
    const res = await httpGet(rexxarUrl, { headers: getHeaders() });
    
    // 如果 Rexxar 正常返回且包含 items，直接返回原始数据
    if (res && res.subjects && res.subjects.items && res.subjects.items.length > 0) {
      log("info", "[DOUBAN] Rexxar 搜索成功");
      return res;
    }
  } catch (e) {
    log("warn", "[DOUBAN] Rexxar 接口失效，准备执行降级逻辑...");
  }

  // --- 降级搜索逻辑 (Fallback) ---
  const fallbackUrl = `https://p.p036.com/p/search/movie?q=${encodeURIComponent(keyword)}`;
  
  try {
    const fRes = await httpGet(fallbackUrl, { headers: getHeaders() });
    
    if (fRes && fRes.items && fRes.items.length > 0) {
      log("info", `[DOUBAN] 降级接口命中，正在同步字段映射...`);

      const mappedItems = fRes.items.map(item => {
        const isMovie = item.type === 'movie';
        const strId = String(item.id); // 确保 ID 是字符串格式

        // 核心：伪造一个和 Rexxar 格式一模一样的“全能对象”
        // 这样主脚本通过 item.target_id 或 item.target.id 都能读到数据
        return {
          layout: "subject", 
          target_id: strId,
          id: strId,
          type_name: isMovie ? "电影" : "电视剧",
          target_type: isMovie ? "movie" : "tv",
          target: {
            id: strId,
            target_id: strId,
            title: item.title,
            cover_url: item.img,      // 降级接口的 img 映射为 Rexxar 的 cover_url
            img: item.img,            // 备用
            year: item.year || "",
            uri: `douban://douban.com/${isMovie ? 'movie' : 'tv'}/${strId}`,
            has_linewatch: true,      // 必须设为 true，否则 UI 可能不显示播放按钮
            rating: {
              value: item.rating || 0,
              max: 10,
              star_count: (item.rating || 0) / 2
            },
            card_subtitle: `${item.year || ''} / ${isMovie ? '电影' : '电视剧'} / 评分: ${item.rating || '暂无'}`
          }
        };
      });

      // 返回标准 Rexxar 嵌套格式
      return {
        subjects: {
          items: mappedItems,
          total: mappedItems.length
        }
      };
    } else {
      log("warn", "[DOUBAN] 降级接口也未找到相关内容");
    }
  } catch (err) {
    log("error", "[DOUBAN] 搜索逻辑全部失败: " + err.message);
  }

  return null;
}

// ---------------------
// 3. 详情逻辑 (解析播放源 vendors 的核心)
// ---------------------

export async function getDoubanDetail(doubanId) {
  // 使用 /subject/ 路径可以兼容 movie, tv, anime 等所有类型
  const url = `https://m.douban.com/rexxar/api/v2/subject/${doubanId}?for_mobile=1`;
  
  try {
    log("info", `[DOUBAN] 正在请求详情 ID: ${doubanId}`);
    const response = await httpGet(url, { headers: getHeaders() });
    
    if (response) {
      // 如果拿到详情但里面没有 vendors，说明该剧在豆瓣上确实没挂载平台
      if (!response.vendors || response.vendors.length === 0) {
        log("warn", `[DOUBAN] ID:${doubanId} 详情已获取，但未发现有效播放源(vendors)`);
      } else {
        log("info", `[DOUBAN] 成功获取播放源，数量: ${response.vendors.length}`);
      }
      return response;
    }
  } catch (error) {
    log("error", `[DOUBAN] 获取详情接口失败 (ID: ${doubanId}): ${error.message}`);
  }
  return null;
}

// ---------------------
// 4. IMDB 查询 (保持原始逻辑)
// ---------------------

export async function getDoubanInfoByImdbId(imdbId) {
  const url = `https://api.douban.com/v2/movie/imdb/${imdbId}`;
  try {
    const response = await httpPost(url, {
      apikey: "0ac44ae016490db2204ce0a042db2916"
    }, { headers: getHeaders() });
    return response;
  } catch (e) {
    log("error", `[DOUBAN] IMDB 查询失败: ${imdbId}`);
    return null;
  }
}
