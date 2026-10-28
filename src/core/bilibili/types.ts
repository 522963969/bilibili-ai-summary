/** B 站接口的最小类型刻画，仅声明本项目实际读取的字段。 */

export interface BilibiliEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export interface BilibiliVideoPage {
  cid: number;
  page: number;
  part: string;
  duration: number;
}

export interface BilibiliVideoView {
  bvid: string;
  aid: number;
  title: string;
  duration: number;
  /** 接口会返回当前（或第一个）分P 的 cid；只在 pages 缺失时作为兜底 */
  cid?: number;
  pages: BilibiliVideoPage[];
}

export interface BilibiliSubtitleItem {
  id?: number;
  id_str?: string;
  lan?: string;
  lan_doc?: string;
  subtitle_url?: string;
  subtitle_url_v2?: string;
  is_lock?: boolean;
  ai_status?: number;
  ai_type?: number;
  type?: number;
}

export interface BilibiliPlayerSubtitle {
  subtitles?: BilibiliSubtitleItem[];
  lan?: string;
  lan_doc?: string;
}

export interface BilibiliPlayerData {
  cid?: number;
  login_mid?: number;
  need_login_subtitle?: boolean;
  subtitle?: BilibiliPlayerSubtitle;
}
