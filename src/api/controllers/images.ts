import _ from "lodash";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, parseRegionFromToken, getAssistantId, checkImageContent, RegionInfo } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_MODEL_US, IMAGE_MODEL_MAP, IMAGE_MODEL_MAP_US, IMAGE_MODEL_MAP_ASIA } from "@/api/consts/common.ts";
import { uploadImageFromUrl, uploadImageBuffer } from "@/lib/image-uploader.ts";
import { extractImageUrls } from "@/lib/image-utils.ts";
import {
  resolveResolution,
  getBenefitCount,
  buildCoreParam,
  buildMetricsExtra,
  buildDraftContent,
  buildGenerateRequest,
  buildBlendAbilityList,
  buildPromptPlaceholderList,
  ResolutionResult,
} from "@/api/builders/payload-builder.ts";

export const DEFAULT_MODEL = DEFAULT_IMAGE_MODEL;
export const DEFAULT_MODEL_US = DEFAULT_IMAGE_MODEL_US;

export interface ModelResult {
  model: string;
  userModel: string;
}

/**
 * 获取模型映射
 * - 根据站点选择不同的模型映射 (CN / US / ASIA)
 * - 不支持的模型会抛出错误
 * - 但如果传入的是国内站默认模型，国际站会自动回退到国际站默认模型
 */
export function getModel(model: string, regionInfo: RegionInfo): ModelResult {
  let modelMap: Record<string, string>;
  if (regionInfo.isUS) {
    modelMap = IMAGE_MODEL_MAP_US;
  } else if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
    modelMap = IMAGE_MODEL_MAP_ASIA;
  } else {
    modelMap = IMAGE_MODEL_MAP;
  }
  const defaultModel = regionInfo.isInternational ? DEFAULT_MODEL_US : DEFAULT_MODEL;

  if (regionInfo.isInternational && !modelMap[model]) {
    // 如果传入的是国内站默认模型，回退到国际站默认模型
    if (model === DEFAULT_MODEL) {
      logger.info(`国际站不支持默认模型 "${model}"，回退到 "${defaultModel}"`);
      return { model: modelMap[defaultModel], userModel: defaultModel };
    }
    const supportedModels = Object.keys(modelMap).join(', ');
    throw new Error(`国际版不支持模型 "${model}"。支持的模型: ${supportedModels}`);
  }

  const effectiveUserModel = modelMap[model] ? model : defaultModel;
  return { model: modelMap[effectiveUserModel], userModel: effectiveUserModel };
}

/**
 * 记录分辨率信息
 */
function logResolutionInfo(userModel: string, resolution: ResolutionResult, regionInfo: RegionInfo) {
  if (!resolution.isForced) return;

  if (userModel === 'nanobanana') {
    if (regionInfo.isUS) {
      logger.warn('美区 nanobanana 模型固定使用1024x1024分辨率和2k的清晰度，比例固定为1:1。');
    } else if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
      const regionName = regionInfo.isHK ? '香港' : regionInfo.isJP ? '日本' : '新加坡';
      logger.warn(`${regionName}站 nanobanana 模型固定使用1k清晰度。`);
    }
  }
}

/**
 * 图生图
 */
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
  const regionInfo = parseRegionFromToken(refreshToken);
  const { model, userModel } = getModel(_model, regionInfo);

  // 使用 payload-builder 处理分辨率
  const resolutionResult = resolveResolution(userModel, regionInfo, resolution, ratio);
  logResolutionInfo(userModel, resolutionResult, regionInfo);

  const imageCount = images.length;
  logger.info(`使用模型: ${userModel} 映射模型: ${model} 图生图功能 ${imageCount}张图片 ${resolutionResult.width}x${resolutionResult.height} 精细度: ${sampleStrength}`);

  // 获取积分
  try {
    const { totalCredit } = await getCredit(refreshToken);
    if (totalCredit <= 0) {
      logger.info("积分为 0，尝试收取今日积分...");
      try {
        await receiveCredit(refreshToken);
      } catch (receiveError) {
        logger.warn(`收取积分失败: ${receiveError.message}. 这可能是因为: 1) 今日已收取过积分, 2) 账户受到风控限制, 3) 需要在官网手动收取首次积分`);
      }
    }
  } catch (e) {
    logger.warn(`获取积分失败，可能是不支持的区域或token已失效: ${e.message}`);
  }

  // 上传图片
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
      await checkImageContent(imageId, refreshToken, regionInfo);
      logger.info(`图片 ${i + 1}/${imageCount} 上传成功: ${imageId}`);
    } catch (error) {
      logger.error(`图片 ${i + 1}/${imageCount} 上传失败: ${error.message}`);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `图片上传失败: ${error.message}`);
    }
  }

  logger.info(`所有图片上传完成，开始图生图: ${uploadedImageIds.join(', ')}`);

  const componentId = util.uuid();
  const submitId = util.uuid();

  // 使用 payload-builder 构建 core_param
  const coreParam = buildCoreParam({
    userModel,
    model,
    prompt,
    negativePrompt,
    imageCount,
    sampleStrength,
    resolution: resolutionResult,
    intelligentRatio,
    mode: "img2img",
  });

  // 构建 metrics_extra 中的 abilityList
  const metricsAbilityList = uploadedImageIds.map(() => ({
    abilityName: "byte_edit",
    strength: sampleStrength,
    source: {
      imageUrl: `blob:https://dreamina.capcut.com/${util.uuid()}`
    }
  }));

  // 使用 payload-builder 构建 metrics_extra
  const metricsExtra = buildMetricsExtra({
    userModel,
    regionInfo,
    submitId,
    scene: "ImageBasicGenerate",
    resolutionType: resolutionResult.resolutionType,
    abilityList: metricsAbilityList,
  });

  // 使用 payload-builder 构建 draft_content
  const abilityList = buildBlendAbilityList(uploadedImageIds, sampleStrength);
  const promptPlaceholderInfoList = buildPromptPlaceholderList(uploadedImageIds.length);
  const posteditParam = {
    type: "",
    id: util.uuid(),
    generate_type: 0
  };

  const draftContent = buildDraftContent({
    componentId,
    generateType: "blend",
    coreParam,
    abilityList,
    promptPlaceholderInfoList,
    posteditParam,
    imageCount,
  });

  // 使用 payload-builder 构建完整请求
  const requestData = buildGenerateRequest({
    model,
    regionInfo,
    submitId,
    draftContent,
    metricsExtra,
  });

  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    { data: requestData }
  );

  const historyId = aigc_data?.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`图生图任务已提交，history_id: ${historyId}，等待生成完成...`);

  // 轮询结果
  const poller = new SmartPoller({
    maxPollCount: 900,
    expectedItemCount: 1,
    type: 'image',
    timeoutSeconds: 900 // 15 分钟超时
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
    return {
      status: {
        status: taskInfo.status,
        failCode: taskInfo.fail_code,
        itemCount: (taskInfo.item_list || []).length,
        finishTime: taskInfo.task?.finish_time || 0,
        historyId
      } as PollingStatus,
      data: taskInfo
    };
  }, historyId);

  const item_list = finalTaskInfo.item_list || [];
  const resultImageUrls = extractImageUrls(item_list);

  if (resultImageUrls.length === 0 && item_list.length > 0) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `图生图失败: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL`);
  }

  logger.info(`图生图结果: 成功生成 ${resultImageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);

  return resultImageUrls;
}

/**
 * 文生图入口
 */
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
  const { model, userModel } = getModel(_model, regionInfo);
  logger.info(`使用模型: ${userModel} 映射模型: ${model} 分辨率: ${resolution} 比例: ${ratio} 精细度: ${sampleStrength} 智能比例: ${intelligentRatio}`);

  return await generateImagesInternal(userModel, prompt, { ratio, resolution, sampleStrength, negativePrompt, intelligentRatio }, refreshToken);
}

/**
 * 文生图内部实现
 */
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
  const regionInfo = parseRegionFromToken(refreshToken);
  const { model, userModel } = getModel(_model, regionInfo);

  // 使用 payload-builder 处理分辨率
  const resolutionResult = resolveResolution(userModel, regionInfo, resolution, ratio);
  logResolutionInfo(userModel, resolutionResult, regionInfo);

  // 获取积分
  const { totalCredit, giftCredit, purchaseCredit, vipCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0) {
    logger.info("积分为 0，尝试收取今日积分...");
    try {
      await receiveCredit(refreshToken);
      logger.info("积分收取成功，继续生成图片");
    } catch (receiveError) {
      logger.warn(`收取积分失败: ${receiveError.message}. 这可能是因为: 1) 今日已收取过积分, 2) 账户受到风控限制, 3) 需要在官网手动收取首次积分`);
      throw new APIException(EX.API_IMAGE_GENERATION_INSUFFICIENT_POINTS,
        `积分不足且无法自动收取。请访问即梦官网手动收取首次积分，或检查账户状态。`);
    }
  } else {
    logger.info(`当前积分状态: 总计=${totalCredit}, 赠送=${giftCredit}, 购买=${purchaseCredit}, VIP=${vipCredit}`);
  }

  // 检查是否为多图生成模式 (jimeng-4.0/jimeng-4.1/jimeng-4.5 支持)
  const isJimeng4xMultiImage = ['jimeng-4.0', 'jimeng-4.1', 'jimeng-4.5'].includes(userModel) && (
    prompt.includes("连续") ||
    prompt.includes("绘本") ||
    prompt.includes("故事") ||
    /\d+张/.test(prompt)
  );

  if (isJimeng4xMultiImage) {
    return await generateJimeng4xMultiImages(userModel, prompt, { ratio, resolution, sampleStrength, negativePrompt, intelligentRatio }, refreshToken);
  }

  const componentId = util.uuid();
  const submitId = util.uuid();

  // 使用 payload-builder 构建 core_param
  const coreParam = buildCoreParam({
    userModel,
    model,
    prompt,
    negativePrompt,
    seed: Math.floor(Math.random() * 100000000) + 2500000000,
    sampleStrength,
    resolution: resolutionResult,
    intelligentRatio,
    mode: "text2img",
  });

  // 使用 payload-builder 构建 metrics_extra
  const metricsExtra = buildMetricsExtra({
    userModel,
    regionInfo,
    submitId,
    scene: "ImageBasicGenerate",
    resolutionType: resolutionResult.resolutionType,
    abilityList: [],
  });

  // 使用 payload-builder 构建 draft_content
  const draftContent = buildDraftContent({
    componentId,
    generateType: "generate",
    coreParam,
  });

  // 使用 payload-builder 构建完整请求
  const requestData = buildGenerateRequest({
    model,
    regionInfo,
    submitId,
    draftContent,
    metricsExtra,
  });

  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    { data: requestData }
  );

  const historyId = aigc_data?.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  // 轮询结果
  const poller = new SmartPoller({
    maxPollCount: 900,
    expectedItemCount: 4,
    type: 'image',
    timeoutSeconds: 900 // 15 分钟超时
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
    return {
      status: {
        status: taskInfo.status,
        failCode: taskInfo.fail_code,
        itemCount: (taskInfo.item_list || []).length,
        finishTime: taskInfo.task?.finish_time || 0,
        historyId
      } as PollingStatus,
      data: taskInfo
    };
  }, historyId);

  const item_list = finalTaskInfo.item_list || [];
  const imageUrls = extractImageUrls(item_list);

  if (imageUrls.length === 0 && item_list.length > 0) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `图像生成失败: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL`);
  }

  logger.info(`图像生成完成: 成功生成 ${imageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);

  return imageUrls;
}

/**
 * jimeng-4.0/jimeng-4.1/jimeng-4.5 多图生成
 */
async function generateJimeng4xMultiImages(
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
  const { model, userModel } = getModel(_model, regionInfo);

  // 使用 payload-builder 处理分辨率
  const resolutionResult = resolveResolution(userModel, regionInfo, resolution, ratio);

  const targetImageCount = prompt.match(/(\d+)张/) ? parseInt(prompt.match(/(\d+)张/)[1]) : 4;

  logger.info(`使用 多图生成: ${targetImageCount}张图片 ${resolutionResult.width}x${resolutionResult.height} 精细度: ${sampleStrength}`);

  const componentId = util.uuid();
  const submitId = util.uuid();

  // 使用 payload-builder 构建 core_param
  const coreParam = buildCoreParam({
    userModel,
    model,
    prompt,
    negativePrompt,
    seed: Math.floor(Math.random() * 100000000) + 2500000000,
    sampleStrength,
    resolution: resolutionResult,
    intelligentRatio,
    mode: "text2img",
  });

  // 使用 payload-builder 构建 metrics_extra (多图模式)
  const metricsExtra = buildMetricsExtra({
    userModel,
    regionInfo,
    submitId,
    scene: "ImageMultiGenerate",
    resolutionType: resolutionResult.resolutionType,
    abilityList: [],
    isMultiImage: true,
  });

  // 使用 payload-builder 构建 draft_content
  const draftContent = buildDraftContent({
    componentId,
    generateType: "generate",
    coreParam,
  });

  // 使用 payload-builder 构建完整请求
  const requestData = buildGenerateRequest({
    model,
    regionInfo,
    submitId,
    draftContent,
    metricsExtra,
  });

  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    { data: requestData }
  );

  const historyId = aigc_data?.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`多图生成任务已提交，submit_id: ${submitId}, history_id: ${historyId}，等待生成 ${targetImageCount} 张图片...`);

  // 轮询结果
  const poller = new SmartPoller({
    maxPollCount: 600,
    expectedItemCount: targetImageCount,
    type: 'image',
    timeoutSeconds: 900 // 15 分钟超时
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
    return {
      status: {
        status: taskInfo.status,
        failCode: taskInfo.fail_code,
        itemCount: (taskInfo.item_list || []).length,
        finishTime: taskInfo.task?.finish_time || 0,
        historyId
      } as PollingStatus,
      data: taskInfo
    };
  }, historyId);

  const item_list = finalTaskInfo.item_list || [];
  const imageUrls = extractImageUrls(item_list);

  if (imageUrls.length === 0 && item_list.length > 0) {
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `多图生成失败: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL`);
  }

  logger.info(`多图生成结果: 成功生成 ${imageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);
  return imageUrls;
}


export default {
  generateImages,
  generateImageComposition,
};
