import _ from "lodash";
import crypto from "crypto";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_ASSISTANT_ID_CN, DEFAULT_ASSISTANT_ID_US, DEFAULT_ASSISTANT_ID_HK, DEFAULT_ASSISTANT_ID_JP, DEFAULT_ASSISTANT_ID_SG, DEFAULT_IMAGE_MODEL, DRAFT_VERSION, DRAFT_MIN_VERSION, IMAGE_MODEL_MAP, IMAGE_MODEL_MAP_US, RESOLUTION_OPTIONS } from "@/api/consts/common.ts";
import { BASE_URL_DREAMINA_US, BASE_URL_DREAMINA_HK, BASE_URL_IMAGEX_US, BASE_URL_IMAGEX_HK, WEB_VERSION as DREAMINA_WEB_VERSION, DA_VERSION as DREAMINA_DA_VERSION, AIGC_FEATURES as DREAMINA_AIGC_FEATURES } from "@/api/consts/dreamina.ts";
import { createSignature } from "@/lib/aws-signature.ts";

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

function calculateCRC32(buffer: ArrayBuffer): string {
  const crcTable = [];
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    crcTable[i] = crc;
  }

  let crc = 0 ^ (-1);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xFF];
  }
  return ((crc ^ (-1)) >>> 0).toString(16).padStart(8, '0');
}

async function uploadImageFromUrl(imageUrl: string, refreshToken: string, isInternational: boolean): Promise<string> {
  try {
    logger.info(`开始上传图片: ${imageUrl} (isInternational: ${isInternational})`);

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`下载图片失败: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();

    return await uploadImageFromBuffer(Buffer.from(imageBuffer), refreshToken, isInternational);

  } catch (error) {
    logger.error(`图片上传失败: ${error.message}`);
    throw error;
  }
}

async function uploadImageFromBuffer(imageBuffer: Buffer, refreshToken: string, isInternational: boolean): Promise<string> {
  try {
    logger.info(`开始通过Buffer上传图片... (isInternational: ${isInternational})`);

    const isUS = refreshToken.toLowerCase().startsWith('us-');
    const isHK = refreshToken.toLowerCase().startsWith('hk-');
    const isJP = refreshToken.toLowerCase().startsWith('jp-');
    const isSG = refreshToken.toLowerCase().startsWith('sg-');

    const tokenResult = await request("post", "/mweb/v1/get_upload_token", refreshToken, {
      data: {
        scene: 2,
      },
      params: isInternational ? {
        aid: isUS ? DEFAULT_ASSISTANT_ID_US : (isJP ? DEFAULT_ASSISTANT_ID_JP : (isSG ? DEFAULT_ASSISTANT_ID_SG : DEFAULT_ASSISTANT_ID_HK)),
        web_version: DREAMINA_WEB_VERSION,
        da_version: DREAMINA_DA_VERSION,
        aigc_features: DREAMINA_AIGC_FEATURES,
      } : {
        aid: DEFAULT_ASSISTANT_ID_CN.toString(),
      },
    });
    const { access_key_id, secret_access_key, session_token } = tokenResult;
    const service_id = isInternational ? tokenResult.space_name : tokenResult.service_id;

    if (!access_key_id || !secret_access_key || !session_token) {
      throw new Error("获取上传令牌失败");
    }

    const actualServiceId = service_id || (isUS ? "wopfjsm1ax" : (isHK || isJP || isSG) ? "wopfjsm1ax" : "tb4s082cfz");

    logger.info(`获取上传令牌成功: service_id=${actualServiceId}`);

    const fileSize = imageBuffer.byteLength;
    const crc32 = calculateCRC32(imageBuffer);

    logger.info(`图片Buffer: 大小=${fileSize}字节, CRC32=${crc32}`);

    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const randomStr = Math.random().toString(36).substring(2, 12);

    const applyUrlHost = isUS ? BASE_URL_IMAGEX_US : (isHK || isJP || isSG) ? BASE_URL_IMAGEX_HK : 'https://imagex.bytedanceapi.com';
    const applyUrl = `${applyUrlHost}/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}&FileSize=${fileSize}&s=${randomStr}${isInternational ? '&device_platform=web' : ''}`;

    const requestHeaders = {
      'x-amz-date': timestamp,
      'x-amz-security-token': session_token
    };

    const authorization = createSignature('GET', applyUrl, requestHeaders, access_key_id, secret_access_key, session_token);

    const origin = isUS ? new URL(BASE_URL_DREAMINA_US).origin : (isHK || isJP || isSG) ? new URL(BASE_URL_DREAMINA_HK).origin : 'https://jimeng.jianying.com';

    const applyResponse = await fetch(applyUrl, {
      method: 'GET',
      headers: {
        'accept': '*/*',
        'authorization': authorization,
        'origin': origin,
        'referer': `${origin}/ai-tool/generate`,
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'x-amz-date': timestamp,
        'x-amz-security-token': session_token,
      },
    });

    if (!applyResponse.ok) {
      const errorText = await applyResponse.text();
      throw new Error(`申请上传权限失败: ${applyResponse.status} - ${errorText}`);
    }

    const applyResult = await applyResponse.json();

    if (applyResult?.ResponseMetadata?.Error) {
      throw new Error(`申请上传权限失败: ${JSON.stringify(applyResult.ResponseMetadata.Error)}`);
    }

    const uploadAddress = applyResult?.Result?.UploadAddress;
    if (!uploadAddress || !uploadAddress.StoreInfos || !uploadAddress.UploadHosts) {
      throw new Error(`获取上传地址失败: ${JSON.stringify(applyResult)}`);
    }

    const storeInfo = uploadAddress.StoreInfos[0];
    const uploadHost = uploadAddress.UploadHosts[0];
    const auth = storeInfo.Auth;
    const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;

    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': auth,
        'Content-CRC32': crc32,
        'Content-Disposition': 'attachment; filename="undefined"',
        'Content-Type': 'application/octet-stream',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      },
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`图片上传失败: ${uploadResponse.status} - ${errorText}`);
    }

    const commitUrl = `${applyUrlHost}/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}`;
    const commitTimestamp = new Date().toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const commitPayload = JSON.stringify({
      SessionKey: uploadAddress.SessionKey
    });
    const payloadHash = crypto.createHash('sha256').update(commitPayload, 'utf8').digest('hex');
    const commitRequestHeaders = {
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': session_token,
      'x-amz-content-sha256': payloadHash
    };
    const commitAuthorization = createSignature('POST', commitUrl, commitRequestHeaders, access_key_id, secret_access_key, session_token, commitPayload);

    const commitResponse = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'authorization': commitAuthorization,
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'x-amz-date': commitTimestamp,
        'x-amz-security-token': session_token,
        'x-amz-content-sha256': payloadHash,
      },
      body: commitPayload,
    });

    if (!commitResponse.ok) {
      const errorText = await commitResponse.text();
      throw new Error(`提交上传失败: ${commitResponse.status} - ${errorText}`);
    }

    const commitResult = await commitResponse.json();
    if (commitResult?.ResponseMetadata?.Error) {
      throw new Error(`提交上传失败: ${JSON.stringify(commitResult.ResponseMetadata.Error)}`);
    }
    if (!commitResult?.Result?.Results || commitResult.Result.Results.length === 0) {
      throw new Error(`提交上传响应缺少结果: ${JSON.stringify(commitResult)}`);
    }
    const uploadResult = commitResult.Result.Results[0];
    if (uploadResult.UriStatus !== 2000) {
      throw new Error(`图片上传状态异常: UriStatus=${uploadResult.UriStatus}`);
    }
    const fullImageUri = uploadResult.Uri;
    logger.info(`图片Buffer上传完成: ${fullImageUri}`);
    return fullImageUri;
  } catch (error) {
    logger.error(`图片Buffer上传失败: ${error.message}`);
    throw error;
  }
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
  }: {
    ratio?: string;
    resolution?: string;
    sampleStrength?: number;
    negativePrompt?: string;
  },
  refreshToken: string
) {
  const isUS = refreshToken.toLowerCase().startsWith('us-');
  const isHK = refreshToken.toLowerCase().startsWith('hk-');
  const isJP = refreshToken.toLowerCase().startsWith('jp-');
  const isSG = refreshToken.toLowerCase().startsWith('sg-');
  const isInternational = isUS || isHK || isJP || isSG;
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
        imageId = await uploadImageFromUrl(image, refreshToken, isInternational);
      } else {
        logger.info(`正在处理第 ${i + 1}/${imageCount} 张图片 (Buffer)...`);
        imageId = await uploadImageFromBuffer(image, refreshToken, isInternational);
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
    intelligent_ratio: false,
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
          aid: isInternational ? (isUS ? DEFAULT_ASSISTANT_ID_US : (isJP ? DEFAULT_ASSISTANT_ID_JP : (isSG ? DEFAULT_ASSISTANT_ID_SG : DEFAULT_ASSISTANT_ID_HK))) : DEFAULT_ASSISTANT_ID_CN
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

  const resultImageUrls = item_list.map((item: any, index: number) => {
    let imageUrl: string | null = null;

    if (item?.image?.large_images?.[0]?.image_url) {
      imageUrl = item.image.large_images[0].image_url;
      logger.debug(`图片 ${index + 1}: 使用 large_images URL`);
    } else if (item?.common_attr?.cover_url) {
      imageUrl = item.common_attr.cover_url;
      logger.debug(`图片 ${index + 1}: 使用 cover_url`);
    } else if (item?.image_url) {
      imageUrl = item.image_url;
      logger.debug(`图片 ${index + 1}: 使用 image_url`);
    } else if (item?.url) {
      imageUrl = item.url;
      logger.debug(`图片 ${index + 1}: 使用 url`);
    } else {
      logger.warn(`图片 ${index + 1}: 无法提取URL，item结构: ${JSON.stringify(item, null, 2)}`);
    }

    return imageUrl;
  }).filter((url: string | null) => url !== null) as string[];

  logger.info(`图生图结果: 成功生成 ${resultImageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);

  if (resultImageUrls.length === 0 && item_list.length > 0) {
    logger.error(`图生图异常: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL`);
    logger.error(`完整的item_list数据: ${JSON.stringify(item_list, null, 2)}`);
  }

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
  }: {
    ratio?: string;
    resolution?: string;
    sampleStrength?: number;
    negativePrompt?: string;
  },
  refreshToken: string
) {
  const isUS = refreshToken.toLowerCase().startsWith('us-');
  const isHK = refreshToken.toLowerCase().startsWith('hk-');
  const isJP = refreshToken.toLowerCase().startsWith('jp-');
  const isSG = refreshToken.toLowerCase().startsWith('sg-');
  const isInternational = isUS || isHK || isJP || isSG;
  const model = getModel(_model, isInternational);
  logger.info(`使用模型: ${_model} 映射模型: ${model} 分辨率: ${resolution} 比例: ${ratio} 精细度: ${sampleStrength}`);

  return await generateImagesInternal(_model, prompt, { ratio, resolution, sampleStrength, negativePrompt }, refreshToken);
}

async function generateImagesInternal(
  _model: string,
  prompt: string,
  {
    ratio,
    resolution,
    sampleStrength = 0.5,
    negativePrompt = "",
  }: {
    ratio: string;
    resolution: string;
    sampleStrength?: number;
    negativePrompt?: string;
  },
  refreshToken: string
) {
  const isUS = refreshToken.toLowerCase().startsWith('us-');
  const isHK = refreshToken.toLowerCase().startsWith('hk-');
  const isJP = refreshToken.toLowerCase().startsWith('jp-');
  const isSG = refreshToken.toLowerCase().startsWith('sg-');
  const isInternational = isUS || isHK || isJP || isSG;
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
    return await generateJimeng40MultiImages(_model, prompt, { ratio, resolution, sampleStrength, negativePrompt }, refreshToken);
  }

  const componentId = util.uuid();
  
  const core_param = {
    type: "",
    id: util.uuid(),
    model,
    prompt,
    negative_prompt: negativePrompt,
    seed: Math.floor(Math.random() * 100000000) + 2500000000,
    sample_strength: sampleStrength,
    image_ratio: image_ratio,
    large_image_info: {
      type: "",
      id: util.uuid(),
      height: height,
      width: width,
      resolution_type: resolution_type
    },
    intelligent_ratio: false
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
          aid: isInternational ? (isUS ? DEFAULT_ASSISTANT_ID_US : (isJP ? DEFAULT_ASSISTANT_ID_JP : (isSG ? DEFAULT_ASSISTANT_ID_SG : DEFAULT_ASSISTANT_ID_HK))) : DEFAULT_ASSISTANT_ID_CN
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

  const imageUrls = item_list.map((item: any, index: number) => {
    let imageUrl: string | null = null;

    if (item?.image?.large_images?.[0]?.image_url) {
      imageUrl = item.image.large_images[0].image_url;
      logger.debug(`图片 ${index + 1}: 使用 large_images URL`);
    } else if (item?.common_attr?.cover_url) {
      imageUrl = item.common_attr.cover_url;
      logger.debug(`图片 ${index + 1}: 使用 cover_url`);
    } else if (item?.image_url) {
      imageUrl = item.image_url;
      logger.debug(`图片 ${index + 1}: 使用 image_url`);
    } else if (item?.url) {
      imageUrl = item.url;
      logger.debug(`图片 ${index + 1}: 使用 url`);
    } else {
      logger.warn(`图片 ${index + 1}: 无法提取URL，item结构: ${JSON.stringify(item, null, 2)}`);
    }

    return imageUrl;
  }).filter((url: string | null) => url !== null) as string[];

  logger.info(`图像生成完成: 成功生成 ${imageUrls.length} 张图片，总耗时 ${pollingResult.elapsedTime} 秒，最终状态: ${pollingResult.status}`);

  if (imageUrls.length === 0) {
    logger.error(`图像生成异常: item_list有 ${item_list.length} 个项目，但无法提取任何图片URL`);
    logger.error(`完整的item_list数据: ${JSON.stringify(item_list, null, 2)}`);
  }
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
  }: {
    ratio?: string;
    resolution?: string;
    sampleStrength?: number;
    negativePrompt?: string;
  },
  refreshToken: string
) {
  const isUS = refreshToken.toLowerCase().startsWith('us-');
  const isHK = refreshToken.toLowerCase().startsWith('hk-');
  const isJP = refreshToken.toLowerCase().startsWith('jp-');
  const isSG = refreshToken.toLowerCase().startsWith('sg-');
  const isInternational = isUS || isHK || isJP || isSG;
  const model = getModel(_model, isInternational);
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
                  core_param: {
                    type: "",
                    id: util.uuid(),
                    model,
                    prompt,
                    negative_prompt: negativePrompt,
                    seed: Math.floor(Math.random() * 100000000) + 2500000000,
                    sample_strength: sampleStrength,
                    image_ratio: image_ratio,
                    large_image_info: {
                      type: "",
                      id: util.uuid(),
                      height: height,
                      width: width,
                      resolution_type: resolution_type
                    },
                    intelligent_ratio: false
                  },
                },
              },
            },
          ],
        }),
        http_common_info: {
          aid: isInternational ? (isUS ? DEFAULT_ASSISTANT_ID_US : (isJP ? DEFAULT_ASSISTANT_ID_JP : (isSG ? DEFAULT_ASSISTANT_ID_SG : DEFAULT_ASSISTANT_ID_HK))) : DEFAULT_ASSISTANT_ID_CN
        }
      },
    }
  );

  const historyId = aigc_data?.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`多图生成任务已提交，submit_id: ${submitId}, history_id: ${historyId}，等待生成 ${targetImageCount} 张图片...`);

  let status = 20, failCode: string | undefined, item_list: any[] = [];
  let pollCount = 0;
  const maxPollCount = 600;

  while (pollCount < maxPollCount) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    pollCount++;

    if (pollCount % 30 === 0) {
      logger.info(`多图生成进度: 第 ${pollCount} 次轮询 (history_id: ${historyId})，当前状态: ${status}，已生成: ${item_list.length}/${targetImageCount} 张图片...`);
    }

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

    status = result[historyId].status;
    failCode = result[historyId].fail_code;
    item_list = result[historyId].item_list || [];

    if (item_list.length >= targetImageCount) {
      logger.info(`多图生成完成: 状态=${status}, 已生成 ${item_list.length} 张图片`);
      break;
    }

    if (pollCount % 60 === 0) {
      logger.info(`详细状态: status=${status}, item_list.length=${item_list.length}, failCode=${failCode || 'none'}`);
    }

    if (status === 10 && item_list.length < targetImageCount && pollCount % 30 === 0) {
      logger.info(`状态已完成但图片数量不足: 状态=${status}, 已生成 ${item_list.length}/${targetImageCount} 张图片，继续等待...`);
    }
  }

  if (pollCount >= maxPollCount) {
    logger.warn(`多图生成超时: 轮询了 ${pollCount} 次，当前状态: ${status}，已生成图片数: ${item_list.length}`);
  }

  if (status === 30) {
    if (failCode === '2038')
      throw new APIException(EX.API_CONTENT_FILTERED);
    else if (failCode === '1001' || failCode === 1001)
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `生成失败，错误代码: ${failCode}。可能原因：文本或图片中包含敏感内容`);
    else
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, `生成失败，错误代码: ${failCode}`);
  }

  const imageUrls = item_list.map((item) => {
    if(!item?.image?.large_images?.[0]?.image_url)
      return item?.common_attr?.cover_url || null;
    return item.image.large_images[0].image_url;
  }).filter(url => url !== null);

  logger.info(`多图生成结果: 成功生成 ${imageUrls.length} 张图片`);
  return imageUrls;
}


export default {
  generateImages,
  generateImageComposition,
};