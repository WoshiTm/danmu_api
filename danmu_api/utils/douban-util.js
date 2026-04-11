import { log } from './log-util.js'
import { httpGet, httpPost } from "./http-util.js";
import { globals } from '../configs/globals.js';

// ---------------------
// 豆瓣 API 工具方法
// ---------------------

// 统一 headers 处理
function getHeaders() {
    const headers = {
        "Referer": "https://m.douban.com/movie/",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Mobile/15E148 Safari/604.1"
    };
    if (globals.doubanCookie) {
        headers["Cookie"] = globals.doubanCookie;
    }
    return headers;
}

// ---------------------
// 1. 搜索片名（带降级逻辑）
// ---------------------
export async function searchDoubanTitles(keyword, count = 20) {
    const rexxarUrl = `https://m.douban.com/rexxar/api/v2/search?q=${encodeURIComponent(keyword)}&start=0&count=${count}`;
    
    try {
        log("info", `[DOUBAN] 尝试 Rexxar 搜索: ${keyword}`);
        const response = await httpGet(rexxarUrl, { headers: getHeaders() });
        
        // 如果 Rexxar 正常返回且有数据
        if (response && response.subjects) {
            return response;
        }
        
        log("warn", "[DOUBAN] Rexxar 无返回或被封锁，启动降级搜索...");
    } catch (e) {
        log("error", "[DOUBAN] Rexxar 接口报错");
    }

    // --- 降级逻辑开始 ---
    // 这是你提供的那个接口地址
    const fallbackUrl = `https://p.p036.com/p/search/movie?q=${encodeURIComponent(keyword)}`;
    
    try {
        const fallbackRes = await httpGet(fallbackUrl, { headers: getHeaders() });
        
        if (fallbackRes && fallbackRes.items) {
            log("info", "[DOUBAN] 降级搜索成功，正在转换数据结构...");
            
            // 核心步骤：将降级数据的字段 [id, title, img] 
            // 映射为脚本识别的 [target_id, target.title, target.cover_url]
            const mappedItems = fallbackRes.items.map(item => ({
                layout: "subject", // 必须补上，否则脚本循环会跳过
                target_id: item.id, // 把 id 赋给 target_id
                target_type: item.type || "movie",
                type_name: item.type === 'movie' ? '电影' : '电视剧',
                target: {
                    id: item.id,
                    title: item.title,
                    cover_url: item.img, // 将 img 映射为 cover_url
                    year: item.year || "",
                    card_subtitle: `评分: ${item.rating || '暂无'}`
                }
            }));

            // 构造出一个符合原始脚本预期的返回对象
            return {
                subjects: {
                    items: mappedItems
                }
            };
        }
    } catch (err) {
        log("error", "[DOUBAN] 所有搜索接口均失效");
    }
    
    return null;
}

// ---------------------
// 2. 获取详情（核心：确保能拿到 vendors）
// ---------------------
export async function getDoubanDetail(doubanId) {
    // 这里建议加上类型判断，如果是电视剧，路径应该是 /tv/，电影是 /movie/
    // 为了稳妥，通常豆瓣 Rexxar 详情接口用 /subject/ 是通用的
    const url = `https://m.douban.com/rexxar/api/v2/subject/${doubanId}?for_mobile=1`;
    
    try {
        log("info", `[DOUBAN] 获取详情 ID: ${doubanId}`);
        const response = await httpGet(url, { headers: getHeaders() });
        return response; // 这里的 response 应该包含 vendors 字段
    } catch (error) {
        log("error", "[DOUBAN] 获取详情失败", error);
        return null;
    }
}

// ---------------------
// 3. 其他原始方法保持兼容
// ---------------------
export async function getDoubanInfoByImdbId(imdbId) {
    const url = `https://api.douban.com/v2/movie/imdb/${imdbId}`;
    try {
        const response = await httpPost(url, {
            apikey: "0ac44ae016490db2204ce0a042db2916"
        }, { headers: getHeaders() });
        return response;
    } catch (e) {
        return null;
    }
}
