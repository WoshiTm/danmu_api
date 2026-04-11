import BaseSource from './base.js';
import { log } from "../utils/log-util.js";
import { getDoubanDetail, searchDoubanTitles } from "../utils/douban-util.js";

export default class DoubanSource extends BaseSource {
  constructor(tencentSource, iqiyiSource, youkuSource, bilibiliSource, miguSource) {
    super('BaseSource');

    this.tencentSource = tencentSource;
    this.iqiyiSource = iqiyiSource;
    this.youkuSource = youkuSource;
    this.bilibiliSource = bilibiliSource;
    this.miguSource = miguSource;
  }

  // =====================
  // 搜索（已修复）
  // =====================
  async search(keyword) {
    try {
      const list = await searchDoubanTitles(keyword);

      log("info", `douban animes.length: ${list.length}`);

      return list;
    } catch (err) {
      log("error", "getDoubanAnimes error:", err);
      return [];
    }
  }

  async getEpisodes(id) {}

  // =====================
  // 核心处理（已修复过滤问题）
  // =====================
  async handleAnimes(sourceAnimes, queryTitle, curAnimes, detailStore = null) {
    const doubanAnimes = [];

    if (!Array.isArray(sourceAnimes)) {
      log("error", "[Douban] invalid sourceAnimes");
      return [];
    }

    const tasks = sourceAnimes.map(async (anime) => {
      try {
        // 修复：fallback 数据也允许进入
        if (!anime?.target_id) return;

        const doubanId = anime.target_id;

        const response = await getDoubanDetail(doubanId);
        if (!response) return;

        let animeType = anime?.type_name || "电影";

        const genres = response?.genres || [];
        const countries = response?.countries || [];

        // ===== 类型修正 =====
        if (genres.includes('真人秀')) animeType = "综艺";
        else if (genres.includes('纪录片')) animeType = "纪录片";
        else if (animeType === "电视剧" && genres.includes('动画') && countries.includes('日本')) animeType = "日番";
        else if (animeType === "电视剧" && genres.includes('动画')) animeType = "动漫";
        else if (animeType === "电影" && genres.includes('动画')) animeType = "动画电影";
        else if (animeType === "电影" && countries.includes('中国')) animeType = "华语电影";
        else if (animeType === "电影") animeType = "外语电影";

        const base = {
          title: response.title,
          year: response.year,
          type: animeType,
          imageUrl: anime?.target?.cover_url
        };

        for (const vendor of response?.vendors ?? []) {
          if (!vendor?.uri) continue;

          const tmp = [{ ...base }];

          switch (vendor.id) {

            case "qq": {
              const cid = new URL(vendor.uri).searchParams.get('cid');
              if (!cid) break;

              tmp[0].provider = "tencent";
              tmp[0].mediaId = cid;

              await this.tencentSource.handleAnimes(tmp, response.title, doubanAnimes, detailStore);
              break;
            }

            case "iqiyi": {
              const tvid = new URL(vendor.uri).searchParams.get('tvid');
              if (!tvid) break;

              tmp[0].provider = "iqiyi";
              tmp[0].mediaId = anime?.type_name === '电影' ? `movie_${tvid}` : tvid;

              await this.iqiyiSource.handleAnimes(tmp, response.title, doubanAnimes, detailStore);
              break;
            }

            case "youku": {
              const showId = new URL(vendor.uri).searchParams.get('showid');
              if (!showId) break;

              tmp[0].provider = "youku";
              tmp[0].mediaId = showId;

              await this.youkuSource.handleAnimes(tmp, response.title, doubanAnimes, detailStore);
              break;
            }

            case "bilibili": {
              const seasonId = new URL(vendor.uri).pathname.split('/').pop();
              if (!seasonId) break;

              tmp[0].provider = "bilibili";
              tmp[0].mediaId = `ss${seasonId}`;

              await this.bilibiliSource.handleAnimes(tmp, response.title, doubanAnimes, detailStore);
              break;
            }

            case "miguvideo": {
              const decodeUrl = decodeURIComponent(vendor.uri);
              const match = decodeUrl.match(/"contentID":"([^"]+)"/);
              const epId = match?.[1];

              if (!epId) break;

              tmp[0].provider = "migu";
              tmp[0].mediaId =
                `https://v3-sc.miguvideo.com/program/v4/cont/content-info/${epId}/1`;

              await this.miguSource.handleAnimes(tmp, response.title, doubanAnimes, detailStore);
              break;
            }
          }
        }
      } catch (err) {
        log("error", "[Douban] handle error:", err.message);
      }
    });

    await Promise.allSettled(tasks);

    this.sortAndPushAnimesByYear(doubanAnimes, curAnimes);

    return doubanAnimes;
  }

  async getEpisodeDanmu(id) {}
  formatComments(comments) {}
}