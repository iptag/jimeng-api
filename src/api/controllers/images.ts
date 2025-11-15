import _ from "lodash";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, parseRegionFromToken, getAssistantId, RegionInfo } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_ASSISTANT_ID_CN, DEFAULT_ASSISTANT_ID_US, DEFAULT_ASSISTANT_ID_HK, DEFAULT_ASSISTANT_ID_JP, DEFAULT_ASSISTANT_ID_SG, DEFAULT_IMAGE_MODEL, DRAFT_VERSION, DRAFT_MIN_VERSION, IMAGE_MODEL_MAP, IMAGE_MODEL_MAP_US, RESOLUTION_OPTIONS } from "@/api/consts/common.ts";
import { WEB_VERSION as DREAMINA_WEB_VERSION, DA_VERSION as DREAMINA_DA_VERSION, AIGC_FEATURES as DREAMINA_AIGC_FEATURES } from "@/api/consts/dreamina.ts";
import { uploadImageFromUrl, uploadImageBuffer } from "@/lib/image-uploader.ts";
import { extractImageUrls } from "@/lib/image-utils.ts";

export const DEFAULT_MODEL = DEFAULT_IMAGE_MODEL;

function getResolutionParams(resolution: string = '2k', ratio: string = '1:1'): { width: number; height: number; image_ratio: number; resolution_type: string } {
  const resolutionGroup = RESOLUTION_OPTIONS[resolution];
  if (!resolutionGroup) {
    const supportedResolutions = Object.keys(RESOLUTION_OPTIONS).join(', ');
    throw new Error(`不支持的分辨率 "${resolution}"。支持的分辨率: ${supportedResolutions}`);
  }

  const ratioConfig = resolutionGroup[ratio];
  if (!ratioConfig) {
    const supportedRatios = Object.keys(resolutionGroup).join(', ');
    throw new Error(`在 "${resolution}" 分辨率下，不支持的比例 "${ratio}"。支持的比例: ${supportedRatios}`);
  }

  return {
    width: ratioConfig.width,
    height: ratioConfig.height,
    image_ratio: ratioConfig.ratio,
    resolution_type: resolution,
  };
}
export function getModel(model: string, isInternational: boolean) {
  const modelMap = isInternational ? IMAGE_MODEL_MAP_US : IMAGE_MODEL_MAP;
  if (isInternational && !modelMap[model]) {
    const supportedModels = Object.keys(modelMap).join(', ');
    throw new Error(`国际版不支持模型 "${model}"。支持的模型: ${supportedModels}`);
  }
  return modelMap[model] || modelMap[DEFAULT_MODEL];
}

export async function generateImageComposition(
  _model: string,
  prompt: string,
  images: (string | Buffer)[],
  {
    ratio = '1:1',
    resolution = '2k',
    sampleStrength = 0.5,
    negativePrompt = "",
    intelligentRatio = false,
  }: {
    ratio?: string;
    resolution?: string;
    sampleStrength?: number;
    negativePrompt?: string;
    intelligentRatio?: boolean;
  },
  refreshToken: string
) {
  if (typeof prompt !== 'string') {
    logger.error(`图生图提示词类型错误: ${typeof prompt}, 期望string类型`);
    throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "提示词必须是字符串类型");
  }
  
  if (!images || images.length === 0) {
    logger.error('图生图缺少输入图片');
    throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "图生图至少需要1张输入图片");
  }

  const regionInfo = parseRegionFromToken(refreshToken);
  const { isInternational } = regionInfo;
  const model = getModel(_model, isInternational);
  
  let width, height, image_ratio, resolution_type;

  if (_model === 'nanobanana') {
    logger.warn('nanobanana模型当前固定使用1024x1024分辨率和2k的清晰度，您输入的参数将被忽略。');
    width = 1024;
    height = 1024;
    image_ratio = 1;
    resolution_type = '2k';
  } else {
    const params = getResolutionParams(resolution, ratio);
    width = params.width;
    height = params.height;
    image_ratio = params.image_ratio;
    resolution_type = params.resolution_type;
  }

  const imageCount = images.length;
  logger.info(`使用模型: ${_model} 映射模型: ${model} 图生图功能 ${imageCount}张图片 ${width}x${height} 精细度: ${sampleStrength}`);

  try {
    const { totalCredit } = await getCredit(refreshToken);
    if (totalCredit <= 0)
      await receiveCredit(refreshToken);
  } catch (e) {
    logger.warn(`获取积分失败，可能是不支持的区域或token已失效: ${e.message}`);
  }

  const uploadedImageIds: string[] = [];
  for (let i = 0; i < images.length; i++) {
    try {
      const image = images[i];
      let imageId: string;
      if (typeof image === 'string') {
        logger.info(`正在处理第 ${i + 1}/${imageCount} 张图片 (URL)...`);
        imageId = await uploadImageFromUrl(image, refreshToken, regionInfo);
      } else {
        logger.info(`正在处理第 ${i + 1}/${imageCount} 张图片 (Buffer)...`);
        imageId = await uploadImageBuffer(image, refreshToken, regionInfo);
      }
      uploadedImageIds.push(imageId);
      logger.info(`图片 ${i + 1}/${imageCount} 上传成功: ${imageId}`);
    } catch (error) {
      logger.error(`图片 ${i + 1}/${imageCount} 上传失败: ${error.message}`);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `图片上传失败: ${error.message}`);
    }
  }

  logger.info(`所有图片上传完成，开始图生图: ${uploadedImageIds.join(', ')}`);

  const componentId = util.uuid();
  const submitId = util.uuid();

  const core_param = {
    type: "",
    id: util.uuid(),
    model,
    prompt: `##${prompt}`,
    sample_strength: sampleStrength,
    image_ratio: image_ratio,
    large_image_info: {
      type: "",
      id: util.uuid(),
      height: height,
      width: width,
      resolution_type: resolution_type
    },
    intelligent_ratio: intelligentRatio,
  };

  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
      },
      data: {
        extend: {
          root_model: model,
        },
        submit_id: submitId,
        metrics_extra: JSON.stringify({
          promptSource: "custom",
          generateCount: 1,
          enterFrom: "click",
          generateId: submitId,
          isRegenerate: false
        }),
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: DRAFT_MIN_VERSION,
          min_features: [],
          is_from_tsn: true,
          version: DRAFT_VERSION,
          main_component_id: componentId,
          component_list: [
            {
              type: "image_base_component",
              id: componentId,
              min_version: DRAFT_MIN_VERSION,
              aigc_mode: "workbench",
              metadata: {
                type: "",
                id: util.uuid(),
                created_platform: 3,
                created_platform_version: "",
                created_time_in_ms: Date.now().toString(),
                created_did: "",
              },
              generate_type: "blend",
              abilities: {
                type: "",
                id: util.uuid(),
                blend: {
                  type: "",
                  id: util.uuid(),
                  min_features: [],
                  core_param: core_param,
                  ability_list: uploadedImageIds.map((imageId) => ({
                    type: "",
                    id: util.uuid(),
                    name: "byte_edit",
                    image_uri_list: [imageId],
                    image_list: [{
                      type: "image",
                      id: util.uuid(),
                      source_from: "upload",
                      platform_type: 1,
                      name: "",
                      image_uri: imageId,
                      width: 0,
                      height: 0,
                      format: "",
                      uri: imageId
                    }],
                    strength: sampleStrength
                  })),
                  prompt_placeholder_info_list: uploadedImageIds.map((_, index) => ({
                    type: "",
                    id: util.uuid(),
                    ability_index: index
                  })),
                  postedit_param: {
                    type: "",
                    id: util.uuid(),
                    generate_type: 0
                  }
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo)
        }
      },
    }
  );

  const historyId = aigc_data?.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`图生图任务已提交，history_id: ${historyId}，等待生成完成...`);

  const maxPollCount = 900;

  const poller = new SmartPoller({
    maxPollCount,
    expectedItemCount: 1,
    type: 'image'
  });

  const { result: pollingResult, data: finalTaskInfo } = await poller.poll(async () => {
    const response = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [historyId],
        image_info: {
          width: 2048,
          height: 2048,
          format: "webp",
          image_scene_list: [
            { scene: "smart_crop", width: 360, height: 360, uniq_key: "smart_crop-w:360-h:360", format: "webp" },
            { scene: "smart_crop", width: 480, height: 480, uniq_key: "smart_crop-w:480-h:480", format: "webp" },
            { scene: "smart_crop", width: 720, height: 720, uniq_key: "smart_crop-w:720-h:720", format: "webp" },
            { scene: "smart_crop", width: 720, height: 480, uniq_key: "smart_crop-w:720-h:480", format: "webp" },
            { scene: "normal", width: 2400, height: 2400, uniq_key: "2400", format: "webp" },
            { scene: "normal", width: 1080, height: 1080, uniq_key: "1080", format: "webp" },
            { scene: "normal", width: 720, height: 720, uniq_key: "720", format: "webp" },
            { scene: "normal", width: 480, height: 480, uniq_key: "480", format: "webp" },
            { scene: "normal", width: 360, height: 360, uniq_key: "360", format: "webp" }
          ]
        }
      }
    });

    if (!response[historyId]) {
      logger.error(`历史记录不存在: historyId=${historyId}`);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
    }

    const taskInfo = response[historyId];
    const currentStatus = taskInfo.status;
    const currentFailCode = taskInfo.fail_code;
    const currentItemList = taskInfo.item_list || [];
    const finishTime = taskInfo.task?.finish_time || 0;

    return {
      status: {
        status: currentStatus,
        failCode: currentFailCode,
        itemCount: currentItemList.length,
        finishTime,
        historyId
      } as PollingStatus,
      data: taskInfo
    };
  }, historyId);

  const item_list = finalTaskInfo.item_list || [];
  const resultImageUrls = extractImageUrls(item_list);

  if (resultImageUrls.length === 0 && item_list.length > 0) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `图生图失败: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL，所有item都缺少 image.large_images[0].image_url 字段`);
  }

  logger.info(`图生图结果: 成功生成 ${resultImageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);

  return resultImageUrls;
}

// ... (rest of the file is for text-to-image, can be left as is for now)
export async function generateImages(
  _model: string,
  prompt: string,
  {
    ratio = '1:1',
    resolution = '2k',
    sampleStrength = 0.5,
    negativePrompt = "",
    intelligentRatio = false,
  }: {
    ratio?: string;
    resolution?: string;
    sampleStrength?: number;
    negativePrompt?: string;
    intelligentRatio?: boolean;
  },
  refreshToken: string
) {
  const regionInfo = parseRegionFromToken(refreshToken);
  const model = getModel(_model, regionInfo.isInternational);
  logger.info(`使用模型: ${_model} 映射模型: ${model} 分辨率: ${resolution} 比例: ${ratio} 精细度: ${sampleStrength} 智能比例: ${intelligentRatio}`);

  return await generateImagesInternal(_model, prompt, { ratio, resolution, sampleStrength, negativePrompt, intelligentRatio }, refreshToken);
}

async function generateImagesInternal(
  _model: string,
  prompt: string,
  {
    ratio,
    resolution,
    sampleStrength = 0.5,
    negativePrompt = "",
    intelligentRatio = false,
  }: {
    ratio: string;
    resolution: string;
    sampleStrength?: number;
    negativePrompt?: string;
    intelligentRatio?: boolean;
  },
  refreshToken: string
) {
  if (typeof prompt !== 'string') {
    logger.error(`提示词类型错误: ${typeof prompt}, 期望string类型`);
    throw new APIException(EX.API_REQUEST_PARAMS_INVALID, "提示词必须是字符串类型，如需使用图片请使用图生图接口");
  }

  const regionInfo = parseRegionFromToken(refreshToken);
  const model = getModel(_model, regionInfo.isInternational);
  
  let width, height, image_ratio, resolution_type;

  if (_model === 'nanobanana') {
    logger.warn('nanobanana模型当前固定使用1024x1024分辨率和2k的清晰度，您输入的参数将被忽略。');
    width = 1024;
    height = 1024;
    image_ratio = 1;
    resolution_type = '2k';
  } else {
    const params = getResolutionParams(resolution, ratio);
    width = params.width;
    height = params.height;
    image_ratio = params.image_ratio;
    resolution_type = params.resolution_type;
  }

  const { totalCredit, giftCredit, purchaseCredit, vipCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0)
    await receiveCredit(refreshToken);

  logger.info(`当前积分状态: 总计=${totalCredit}, 赠送=${giftCredit}, 购买=${purchaseCredit}, VIP=${vipCredit}`);

  const isJimeng40MultiImage = _model === "jimeng-4.0" && (
    prompt.includes("连续") ||
    prompt.includes("绘本") ||
    prompt.includes("故事") ||
    /\d+张/.test(prompt)
  );

  if (isJimeng40MultiImage) {
    return await generateJimeng40MultiImages(_model, prompt, { ratio, resolution, sampleStrength, negativePrompt, intelligentRatio }, refreshToken);
  }

  const componentId = util.uuid();

  const core_param: any = {
    type: "",
    id: util.uuid(),
    model,
    prompt,
    negative_prompt: negativePrompt,
    seed: Math.floor(Math.random() * 100000000) + 2500000000,
    sample_strength: sampleStrength,
    large_image_info: {
      type: "",
      id: util.uuid(),
      height: height,
      width: width,
      resolution_type: resolution_type
    },
    intelligent_ratio: intelligentRatio
  };

  // 智能比例模式下不包含 image_ratio 字段
  if (!intelligentRatio) {
    core_param.image_ratio = image_ratio;
  }

  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
      },
      data: {
        extend: {
          root_model: model,
        },
        submit_id: util.uuid(),
        metrics_extra: JSON.stringify({
          promptSource: "custom",
          generateCount: 1,
          enterFrom: "click",
          generateId: util.uuid(),
          isRegenerate: false
        }),
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: DRAFT_MIN_VERSION,
          min_features: [],
          is_from_tsn: true,
          version: DRAFT_VERSION,
          main_component_id: componentId,
          component_list: [
            {
              type: "image_base_component",
              id: componentId,
              min_version: DRAFT_MIN_VERSION,
              aigc_mode: "workbench",
              metadata: {
                type: "",
                id: util.uuid(),
                created_platform: 3,
                created_platform_version: "",
                created_time_in_ms: Date.now().toString(),
                created_did: ""
              },
              generate_type: "generate",
              abilities: {
                type: "",
                id: util.uuid(),
                generate: {
                  type: "",
                  id: util.uuid(),
                  core_param: core_param,
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo)
        }
      },
    }
  );
  const historyId = aigc_data.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  const maxPollCount = 900;

  const poller = new SmartPoller({
    maxPollCount,
    expectedItemCount: 4,
    type: 'image'
  });

  const { result: pollingResult, data: finalTaskInfo } = await poller.poll(async () => {
    const response = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [historyId],
        image_info: {
          width: 2048,
          height: 2048,
          format: "webp",
          image_scene_list: [
            { scene: "smart_crop", width: 360, height: 360, uniq_key: "smart_crop-w:360-h:360", format: "webp" },
            { scene: "smart_crop", width: 480, height: 480, uniq_key: "smart_crop-w:480-h:480", format: "webp" },
            { scene: "smart_crop", width: 720, height: 720, uniq_key: "smart_crop-w:720-h:720", format: "webp" },
            { scene: "smart_crop", width: 720, height: 480, uniq_key: "smart_crop-w:720-h:480", format: "webp" },
            { scene: "smart_crop", width: 360, height: 240, uniq_key: "smart_crop-w:360-h:240", format: "webp" },
            { scene: "smart_crop", width: 240, height: 320, uniq_key: "smart_crop-w:240-h:320", format: "webp" },
            { scene: "smart_crop", width: 480, height: 640, uniq_key: "smart_crop-w:480-h:640", format: "webp" },
            { scene: "normal", width: 2400, height: 2400, uniq_key: "2400", format: "webp" },
            { scene: "normal", width: 1080, height: 1080, uniq_key: "1080", format: "webp" },
            { scene: "normal", width: 720, height: 720, uniq_key: "720", format: "webp" },
            { scene: "normal", width: 480, height: 480, uniq_key: "480", format: "webp" },
            { scene: "normal", width: 360, height: 360, uniq_key: "360", format: "webp" },
          ],
        }
      },
    });

    if (!response[historyId]) {
      logger.error(`历史记录不存在: historyId=${historyId}`);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
    }

    const taskInfo = response[historyId];
    const currentStatus = taskInfo.status;
    const currentFailCode = taskInfo.fail_code;
    const currentItemList = taskInfo.item_list || [];
    const finishTime = taskInfo.task?.finish_time || 0;

    return {
      status: {
        status: currentStatus,
        failCode: currentFailCode,
        itemCount: currentItemList.length,
        finishTime,
        historyId
      } as PollingStatus,
      data: taskInfo
    };
  }, historyId);

  const item_list = finalTaskInfo.item_list || [];
  const group_key_md5 = finalTaskInfo.history_group_key_md5 || '0'
  const item_ids: string[] = (finalTaskInfo?.pre_gen_item_ids ?? [])
    .map((x: any) => String(x).trim())
    .filter(Boolean);

  const imageUrls = extractImageUrls(item_list);

  if (imageUrls.length === 0 && item_list.length > 0) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `图像生成失败: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL，所有item都缺少 image.large_images[0].image_url 字段`);
  }

  logger.info(`图像生成完成: 成功生成 ${imageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);

  return imageUrls;
}

async function generateJimeng40MultiImages(
  _model: string,
  prompt: string,
  {
    ratio = '1:1',
    resolution = '2k',
    sampleStrength = 0.5,
    negativePrompt = "",
    intelligentRatio = false,
  }: {
    ratio?: string;
    resolution?: string;
    sampleStrength?: number;
    negativePrompt?: string;
    intelligentRatio?: boolean;
  },
  refreshToken: string
) {
  const regionInfo = parseRegionFromToken(refreshToken);
  const model = getModel(_model, regionInfo.isInternational);
  const { width, height, image_ratio, resolution_type } = getResolutionParams(resolution, ratio);

  const targetImageCount = prompt.match(/(\d+)张/) ? parseInt(prompt.match(/(\d+)张/)[1]) : 4;

  logger.info(`使用 多图生成: ${targetImageCount}张图片 ${width}x${height} 精细度: ${sampleStrength}`);

  const componentId = util.uuid();
  const submitId = util.uuid();

  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
      },
      data: {
        extend: {
          root_model: model,
        },
        submit_id: submitId,
        metrics_extra: JSON.stringify({
          templateId: "",
          generateCount: 1,
          promptSource: "custom",
          templateSource: "",
          lastRequestId: "",
          originRequestId: "",
        }),
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: DRAFT_MIN_VERSION,
          min_features: [],
          is_from_tsn: true,
          version: DRAFT_VERSION,
          main_component_id: componentId,
          component_list: [
            {
              type: "image_base_component",
              id: componentId,
              min_version: DRAFT_MIN_VERSION,
              aigc_mode: "workbench",
              metadata: {
                type: "",
                id: util.uuid(),
                created_platform: 3,
                created_platform_version: "",
                created_time_in_ms: Date.now().toString(),
                created_did: ""
              },
              generate_type: "generate",
              abilities: {
                type: "",
                id: util.uuid(),
                generate: {
                  type: "",
                  id: util.uuid(),
                  core_param: (() => {
                    const param: any = {
                      type: "",
                      id: util.uuid(),
                      model,
                      prompt,
                      negative_prompt: negativePrompt,
                      seed: Math.floor(Math.random() * 100000000) + 2500000000,
                      sample_strength: sampleStrength,
                      large_image_info: {
                        type: "",
                        id: util.uuid(),
                        height: height,
                        width: width,
                        resolution_type: resolution_type
                      },
                      intelligent_ratio: intelligentRatio
                    };
                    // 智能比例模式下不包含 image_ratio 字段
                    if (!intelligentRatio) {
                      param.image_ratio = image_ratio;
                    }
                    return param;
                  })(),
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo)
        }
      },
    }
  );

  const historyId = aigc_data?.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`多图生成任务已提交，submit_id: ${submitId}, history_id: ${historyId}，等待生成 ${targetImageCount} 张图片...`);

  const maxPollCount = 600;

  const poller = new SmartPoller({
    maxPollCount,
    expectedItemCount: targetImageCount,
    type: 'image'
  });

  const { result: pollingResult, data: finalTaskInfo } = await poller.poll(async () => {
    const result = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [historyId],
        image_info: {
          width: 2048,
          height: 2048,
          format: "webp",
          image_scene_list: [
            { scene: "smart_crop", width: 360, height: 360, uniq_key: "smart_crop-w:360-h:360", format: "webp" },
            { scene: "smart_crop", width: 480, height: 480, uniq_key: "smart_crop-w:480-h:480", format: "webp" },
            { scene: "smart_crop", width: 720, height: 720, uniq_key: "smart_crop-w:720-h:720", format: "webp" },
            { scene: "smart_crop", width: 720, height: 480, uniq_key: "smart_crop-w:720-h:480", format: "webp" },
            { scene: "normal", width: 2400, height: 2400, uniq_key: "2400", format: "webp" },
            { scene: "normal", width: 1080, height: 1080, uniq_key: "1080", format: "webp" },
            { scene: "normal", width: 720, height: 720, uniq_key: "720", format: "webp" },
            { scene: "normal", width: 480, height: 480, uniq_key: "480", format: "webp" },
            { scene: "normal", width: 360, height: 360, uniq_key: "360", format: "webp" },
          ],
        },
      },
    });

    if (!result[historyId])
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");

    const taskInfo = result[historyId];
    const currentStatus = taskInfo.status;
    const currentFailCode = taskInfo.fail_code;
    const currentItemList = taskInfo.item_list || [];
    const finishTime = taskInfo.task?.finish_time || 0;

    return {
      status: {
        status: currentStatus,
        failCode: currentFailCode,
        itemCount: currentItemList.length,
        finishTime,
        historyId
      } as PollingStatus,
      data: taskInfo
    };
  }, historyId);

  const item_list = finalTaskInfo.item_list || [];
  const imageUrls = extractImageUrls(item_list);

  if (imageUrls.length === 0 && item_list.length > 0) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `多图生成失败: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL，所有item都缺少 image.large_images[0].image_url 字段`);
  }

  logger.info(`多图生成结果: 成功生成 ${imageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);
  return imageUrls;
}


export default {
  generateImages,
  generateImageComposition,
};