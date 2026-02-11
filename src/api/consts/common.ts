/**
 * 即梦API通用常量
 */

// API基础URL
export const BASE_URL_CN = "https://jimeng.jianying.com";

export const BASE_URL_US_COMMERCE = "https://commerce.us.capcut.com";
export const BASE_URL_HK_COMMERCE = "https://commerce-api-sg.capcut.com";
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
export const VERSION_CODE = "8.4.0";

// 默认模型
export const DEFAULT_IMAGE_MODEL = "jimeng-4.5";
export const DEFAULT_IMAGE_MODEL_US = "jimeng-4.5";
export const DEFAULT_VIDEO_MODEL = "jimeng-video-3.5-pro";

// 草稿版本
export const DRAFT_VERSION = "3.3.8";
export const DRAFT_MIN_VERSION = "3.0.2";
export const DRAFT_VERSION_OMNI = "3.3.9";

// omni_reference 模式专用 benefit_type
export const OMNI_BENEFIT_TYPE = "dreamina_video_seedance_20_video_add";

// 图像模型映射
export const IMAGE_MODEL_MAP = {
  "jimeng-5.0": "high_aes_general_v50",
  "jimeng-4.6": "high_aes_general_v42",
  "jimeng-4.5": "high_aes_general_v40l",
  "jimeng-4.1": "high_aes_general_v41",
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.1": "high_aes_general_v30l_art_fangzhou:general_v3.0_18b",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
};

export const IMAGE_MODEL_MAP_US = {
  "jimeng-4.5": "high_aes_general_v40l",
  "jimeng-4.1": "high_aes_general_v41",
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
  "nanobanana": "external_model_gemini_flash_image_v25",
  "nanobananapro": "dreamina_image_lib_1",
};

// 图像模型映射 - 亚洲国际站 (HK/JP/SG)
export const IMAGE_MODEL_MAP_ASIA = {
  "jimeng-5.0": "high_aes_general_v50",
  "jimeng-4.6": "high_aes_general_v42",
  "jimeng-4.5": "high_aes_general_v40l",
  "jimeng-4.1": "high_aes_general_v41",
  "jimeng-4.0": "high_aes_general_v40",
  "jimeng-3.0": "high_aes_general_v30l:general_v3.0_18b",
  "nanobanana": "external_model_gemini_flash_image_v25",
  "nanobananapro": "dreamina_image_lib_1",
};

// 视频模型映射 - 国内站 (CN)
export const VIDEO_MODEL_MAP = {
  "jimeng-video-seedance-2.0": "dreamina_seedance_40_pro",
  "jimeng-video-3.5-pro": "dreamina_ic_generate_video_model_vgfm_3.5_pro",
  "jimeng-video-3.0-pro": "dreamina_ic_generate_video_model_vgfm_3.0_pro",
  "jimeng-video-3.0": "dreamina_ic_generate_video_model_vgfm_3.0",
  "jimeng-video-3.0-fast": "dreamina_ic_generate_video_model_vgfm_3.0_fast",
  "jimeng-video-2.0": "dreamina_ic_generate_video_model_vgfm_lite",
  "jimeng-video-2.0-pro": "dreamina_ic_generate_video_model_vgfm1.0"
};

// 视频模型映射 - 美国站 (US) - 仅保留 3.0 和 3.5-pro
export const VIDEO_MODEL_MAP_US = {
  "jimeng-video-3.5-pro": "dreamina_ic_generate_video_model_vgfm_3.5_pro",
  "jimeng-video-3.0": "dreamina_ic_generate_video_model_vgfm_3.0",
};

// 视频模型映射 - 亚洲国际站 (HK/JP/SG)
export const VIDEO_MODEL_MAP_ASIA = {
  "jimeng-video-veo3": "dreamina_veo3_generate_video",
  "jimeng-video-veo3.1": "dreamina_veo3.1_generate_video",
  "jimeng-video-sora2": "dreamina_sora2_generate_video",
  "jimeng-video-3.5-pro": "dreamina_ic_generate_video_model_vgfm_3.5_pro",
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
  MAX_POLL_COUNT: 900,   // 最大轮询次数
  POLL_INTERVAL: 5000,   // 轮询间隔 5 秒
  STABLE_ROUNDS: 5,      // 稳定轮次
  TIMEOUT_SECONDS: 900   // 默认超时 15 分钟
};

// 支持的图片比例和分辨率
export const RESOLUTION_OPTIONS = {
  "1k":{
    "1:1": { width: 1024, height: 1024, ratio: 1 },
    "4:3": { width: 768, height: 1024, ratio: 4 },
    "3:4": { width: 1024, height: 768, ratio: 2 },
    "16:9": { width: 1024, height: 576, ratio: 3 },
    "9:16": { width: 576, height: 1024, ratio: 5 },
    "3:2": { width: 1024, height: 682, ratio: 7 },
    "2:3": { width: 682, height: 1024, ratio: 6 },
    "21:9": { width: 1195, height: 512, ratio: 8 },
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

// nanobananapro 模型专用的 4k 分辨率配置（ratio 值与 1k/2k 一致）
export const RESOLUTION_OPTIONS_NANOBANANAPRO_4K = {
  "1:1": { width: 4096, height: 4096, ratio: 1 },
  "4:3": { width: 4693, height: 3520, ratio: 4 },
  "3:4": { width: 3520, height: 4693, ratio: 2 },
  "16:9": { width: 5404, height: 3040, ratio: 3 },
  "9:16": { width: 3040, height: 5404, ratio: 5 },
  "3:2": { width: 4992, height: 3328, ratio: 7 },
  "2:3": { width: 3328, height: 4992, ratio: 6 },
  "21:9": { width: 6197, height: 2656, ratio: 8 }
};
