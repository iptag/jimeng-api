import _ from 'lodash';
import {
    IMAGE_MODEL_MAP,
    IMAGE_MODEL_MAP_US,
    VIDEO_MODEL_MAP,
    VIDEO_MODEL_MAP_US,
    VIDEO_MODEL_MAP_ASIA,
    DEFAULT_IMAGE_MODEL,
    DEFAULT_VIDEO_MODEL
} from '@/api/consts/common.ts';

// 模型描述信息
const IMAGE_MODEL_DESCRIPTIONS: Record<string, string> = {
    "jimeng-4.5": "即梦AI图像生成模型 4.5 版本（默认）",
    "jimeng-4.1": "即梦AI图像生成模型 4.1 版本",
    "jimeng-4.0": "即梦AI图像生成模型 4.0 版本",
    "jimeng-3.1": "即梦AI图像生成模型 3.1 版本（仅国内站）",
    "jimeng-3.0": "即梦AI图像生成模型 3.0 版本",
    "jimeng-2.1": "即梦AI图像生成模型 2.1 版本（仅国内站）",
    "jimeng-2.0-pro": "即梦AI图像生成模型 2.0 专业版（仅国内站）",
    "jimeng-2.0": "即梦AI图像生成模型 2.0 版本（仅国内站）",
    "jimeng-1.4": "即梦AI图像生成模型 1.4 版本（仅国内站）",
    "jimeng-xl-pro": "即梦AI图像生成模型 XL 专业版（仅国内站）",
    "nanobanana": "Nanobanana 图像模型（仅国际站）",
    "nanobananapro": "Nanobanana Pro 图像模型（仅国际站，支持4k）"
};

const VIDEO_MODEL_DESCRIPTIONS: Record<string, string> = {
    "jimeng-video-3.5-pro": "即梦AI视频生成模型 3.5 专业版（默认，全站点）",
    "jimeng-video-veo3": "Veo3 视频模型（仅亚洲国际站，固定8秒）",
    "jimeng-video-veo3.1": "Veo3.1 视频模型（仅亚洲国际站，固定8秒）",
    "jimeng-video-sora2": "Sora2 视频模型（仅亚洲国际站）",
    "jimeng-video-3.0-pro": "即梦AI视频生成模型 3.0 专业版",
    "jimeng-video-3.0": "即梦AI视频生成模型 3.0 版本（全站点）",
    "jimeng-video-3.0-fast": "即梦AI视频生成模型 3.0 极速版",
    "jimeng-video-2.0-pro": "即梦AI视频生成模型 2.0 专业版",
    "jimeng-video-2.0": "即梦AI视频生成模型 2.0 版本"
};

// 动态生成模型列表
function generateModelList() {
    const imageModels = _.uniq([
        ...Object.keys(IMAGE_MODEL_MAP),
        ...Object.keys(IMAGE_MODEL_MAP_US)
    ]);

    const videoModels = _.uniq([
        ...Object.keys(VIDEO_MODEL_MAP),
        ...Object.keys(VIDEO_MODEL_MAP_US),
        ...Object.keys(VIDEO_MODEL_MAP_ASIA)
    ]);

    const models = [];

    // 添加图像模型
    for (const modelId of imageModels) {
        models.push({
            id: modelId,
            object: "model",
            owned_by: "jimeng-api",
            type: "image",
            description: IMAGE_MODEL_DESCRIPTIONS[modelId] || `即梦AI图像模型 ${modelId}`,
            default: modelId === DEFAULT_IMAGE_MODEL
        });
    }

    // 添加视频模型
    for (const modelId of videoModels) {
        models.push({
            id: modelId,
            object: "model",
            owned_by: "jimeng-api",
            type: "video",
            description: VIDEO_MODEL_DESCRIPTIONS[modelId] || `即梦AI视频模型 ${modelId}`,
            default: modelId === DEFAULT_VIDEO_MODEL
        });
    }

    return models;
}

export default {

    prefix: '/v1',

    get: {
        '/models': async () => {
            return {
                object: "list",
                data: generateModelList()
            };
        }
    }
}
