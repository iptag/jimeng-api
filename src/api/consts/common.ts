/**
 * 即梦API通用常量
 */

// API基础URL
export const BASE_URL_CN = "https://jimeng.jianying.com";

export const BASE_URL_US_COMMERCE = "https://commerce.us.capcut.com";
export const BASE_URL_HK = "https://mweb-api-sg.capcut.com";

// 默认助手ID
export const DEFAULT_ASSISTANT_ID_CN = 513695;
export const DEFAULT_ASSISTANT_ID_US = 513641;
export const DEFAULT_ASSISTANT_ID_HK = 513641;
export const DEFAULT_ASSISTANT_ID_JP = 513641;
export const DEFAULT_ASSISTANT_ID_SG = 513641;

// 地区
export const REGION_CN = "cn";
export const REGION_US = "US";
export const REGION_HK = "HK";
export const REGION_JP = "JP";
export const REGION_SG = "SG";

// 平台代码
export const PLATFORM_CODE = "7";

// 版本代码
export const VERSION_CODE = "1.0.0";

// 默认模型
export const DEFAULT_IMAGE_MODEL = "jimeng-4.0";
export const DEFAULT_VIDEO_MODEL = "jimeng-video-3.0";

// 草稿版本
export const DRAFT_VERSION = "3.3.3";
export const DRAFT_MIN_VERSION = "3.0.2";

// 图像模型映射
export const IMAGE_MODEL_MAP = {
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.1": "high_aes_general_v30l_art_fangzhou:general_v3.0_18b",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
  "jimeng-2.1": "high_aes_general_v21_L:general_v2.1_L",
  "jimeng-2.0-pro": "high_aes_general_v20_L:general_v2.0_L",
  "jimeng-2.0": "high_aes_general_v20:general_v2.0",
  "jimeng-1.4": "high_aes_general_v14:general_v1.4",
  "jimeng-xl-pro": "text2img_xl_sft"
};

export const IMAGE_MODEL_MAP_US = {
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
  "nanobanana": "external_model_gemini_flash_image_v25",
};

// 视频模型映射
export const VIDEO_MODEL_MAP = {
  "jimeng-video-3.0-pro": "dreamina_ic_generate_video_model_vgfm_3.0_pro",
  "jimeng-video-3.0": "dreamina_ic_generate_video_model_vgfm_3.0",
  "jimeng-video-3.0-fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "jimeng-video-2.0": "dreamina_ic_generate_video_model_vgfm_lite",
  "jimeng-video-2.0-pro": "dreamina_ic_generate_video_model_vgfm1.0"
};

// 状态码映射
export const STATUS_CODE_MAP = {
  20: 'PROCESSING',
  10: 'SUCCESS',
  30: 'FAILED',
  42: 'POST_PROCESSING',
  45: 'FINALIZING',
  50: 'COMPLETED'
};

// 重试配置
export const RETRY_CONFIG = {
  MAX_RETRY_COUNT: 3,
  RETRY_DELAY: 5000
};

// 轮询配置
export const POLLING_CONFIG = {
  MAX_POLL_COUNT: 900, // 15分钟
  POLL_INTERVAL: 5000, // 1秒
  STABLE_ROUNDS: 5,    // 稳定轮次
  TIMEOUT_SECONDS: 900 // 15分钟超时
};

// 支持的图片比例和分辨率
export const RESOLUTION_OPTIONS = {
  "1k":{
    "1:1": { width: 1328, height: 1328, ratio: 1 },
    "4:3": { width: 1472, height: 1104, ratio: 4 },
    "3:4": { width: 1104, height: 1472, ratio: 2 },
    "16:9": { width: 1664, height: 936, ratio: 3 },
    "9:16": { width: 936, height: 1664, ratio: 5 },
    "3:2": { width: 1584, height: 1056, ratio: 7 },
    "2:3": { width: 1056, height: 1584, ratio: 6 },
    "21:9": { width: 2016, height: 864, ratio: 8 },
  },
  "2k": {
    "1:1": {width: 2048, height: 2048, ratio: 1},
    "4:3": {width: 2304, height: 1728, ratio: 4},
    "3:4": {width: 1728, height: 2304, ratio: 2},
    "16:9": {width: 2560, height: 1440, ratio: 3},
    "9:16": {width: 1440, height: 2560, ratio: 5},
    "3:2": {width: 2496, height: 1664, ratio: 7},
    "2:3": {width: 1664, height: 2496, ratio: 6},
    "21:9": {width: 3024, height: 1296, ratio: 8},
  },
  "4k": {
    "1:1": {width: 4096, height: 4096, ratio: 101},
    "4:3": {width: 4608, height: 3456, ratio: 104},
    "3:4": {width: 3456, height: 4608, ratio: 102},
    "16:9": {width: 5120, height: 2880, ratio: 103},
    "9:16": {width: 2880, height: 5120, ratio: 105},
    "3:2": {width: 4992, height: 3328, ratio: 107},
    "2:3": {width: 3328, height: 4992, ratio: 106},
    "21:9": {width: 6048, height: 2592, ratio: 108}
  }
};