import _ from "lodash";
import fs from "fs-extra";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, parseRegionFromToken, getAssistantId, RegionInfo } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_ASSISTANT_ID_CN, DEFAULT_ASSISTANT_ID_US, DEFAULT_ASSISTANT_ID_HK, DEFAULT_ASSISTANT_ID_JP, DEFAULT_ASSISTANT_ID_SG, DEFAULT_VIDEO_MODEL, DRAFT_VERSION, VIDEO_MODEL_MAP } from "@/api/consts/common.ts";
import { uploadImageBuffer } from "@/lib/image-uploader.ts";
import { extractVideoUrl } from "@/lib/image-utils.ts";

export const DEFAULT_MODEL = DEFAULT_VIDEO_MODEL;

export function getModel(model: string) {
  return VIDEO_MODEL_MAP[model] || VIDEO_MODEL_MAP[DEFAULT_MODEL];
}

function getVideoBenefitType(model: string): string {
  if (model.includes("3.5_pro")) {
    return "dreamina_video_seedance_15_pro";
  }
  if (model.includes("3.5")) {
    return "dreamina_video_seedance_15";
  }
  return "basic_video_operation_vgfm_v_three";
}

// 处理本地上传的文件
async function uploadImageFromFile(file: any, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
  try {
    logger.info(`开始从本地文件上传视频图片: ${file.originalFilename} (路径: ${file.filepath})`);
    const imageBuffer = await fs.readFile(file.filepath);
    return await uploadImageBuffer(imageBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从本地文件上传视频图片失败: ${error.message}`);
    throw error;
  }
}

// 处理来自URL的图片
async function uploadImageFromUrl(imageUrl: string, refreshToken: string, regionInfo: RegionInfo): Promise<string> {
  try {
    logger.info(`开始从URL下载并上传视频图片: ${imageUrl}`);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`下载图片失败: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    return await uploadImageBuffer(imageBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从URL上传视频图片失败: ${error.message}`);
    throw error;
  }
}


/**
 * 生成视频
 *
 * @param _model 模型名称
 * @param prompt 提示词
 * @param options 选项
 * @param refreshToken 刷新令牌
 * @returns 视频URL
 */
export async function generateVideo(
  _model: string,
  prompt: string,
  {
    ratio = "1:1",
    resolution = "720p",
    duration = 5,
    filePaths = [],
    files = {},
  }: {
    ratio?: string;
    resolution?: string;
    duration?: number;
    filePaths?: string[];
    files?: any;
  },
  refreshToken: string
) {
  // 检测区域
  const regionInfo = parseRegionFromToken(refreshToken);
  const { isInternational } = regionInfo;

  logger.info(`视频生成区域检测: isInternational=${isInternational}`);

  const model = getModel(_model);

  // 将秒转换为毫秒，只支持5秒和10秒
  const durationMs = duration === 10 ? 10000 : 5000;

  logger.info(`使用模型: ${_model} 映射模型: ${model} 比例: ${ratio} 分辨率: ${resolution} 时长: ${duration}s`);

  // 检查积分
  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0)
    await receiveCredit(refreshToken);

  // 处理首帧和尾帧图片
  let first_frame_image = undefined;
  let end_frame_image = undefined;
  let uploadIDs: string[] = [];

  // 优先处理本地上传的文件
  const uploadedFiles = _.values(files); // 将files对象转为数组
  if (uploadedFiles && uploadedFiles.length > 0) {
    logger.info(`检测到 ${uploadedFiles.length} 个本地上传文件，优先处理`);
    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      if (!file) continue;
      try {
        logger.info(`开始上传第 ${i + 1} 张本地图片: ${file.originalFilename}`);
        const imageUri = await uploadImageFromFile(file, refreshToken, regionInfo);
        if (imageUri) {
          uploadIDs.push(imageUri);
          logger.info(`第 ${i + 1} 张本地图片上传成功: ${imageUri}`);
        } else {
          logger.error(`第 ${i + 1} 张本地图片上传失败: 未获取到 image_uri`);
        }
      } catch (error: any) {
        logger.error(`第 ${i + 1} 张本地图片上传失败: ${error.message}`);
        if (i === 0) {
          throw new APIException(EX.API_REQUEST_FAILED, `首帧图片上传失败: ${error.message}`);
        }
      }
    }
  }
  // 如果没有本地文件，再处理URL
  else if (filePaths && filePaths.length > 0) {
    logger.info(`未检测到本地上传文件，处理 ${filePaths.length} 个图片URL`);
    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      if (!filePath) {
        logger.warn(`第 ${i + 1} 个图片URL为空，跳过`);
        continue;
      }
      try {
        logger.info(`开始上传第 ${i + 1} 个URL图片: ${filePath}`);
        const imageUri = await uploadImageFromUrl(filePath, refreshToken, regionInfo);
        if (imageUri) {
          uploadIDs.push(imageUri);
          logger.info(`第 ${i + 1} 个URL图片上传成功: ${imageUri}`);
        } else {
          logger.error(`第 ${i + 1} 个URL图片上传失败: 未获取到 image_uri`);
        }
      } catch (error: any) {
        logger.error(`第 ${i + 1} 个URL图片上传失败: ${error.message}`);
        if (i === 0) {
          throw new APIException(EX.API_REQUEST_FAILED, `首帧图片上传失败: ${error.message}`);
        }
      }
    }
  } else {
    logger.info(`未提供图片文件或URL，将进行纯文本视频生成`);
  }

  // 如果有图片上传（无论来源），构建对象
  if (uploadIDs.length > 0) {
    logger.info(`图片上传完成，共成功 ${uploadIDs.length} 张`);
    // 构建首帧图片对象
    if (uploadIDs[0]) {
      first_frame_image = {
        format: "",
        height: 0,
        id: util.uuid(),
        image_uri: uploadIDs[0],
        name: "",
        platform_type: 1,
        source_from: "upload",
        type: "image",
        uri: uploadIDs[0],
        width: 0,
      };
      logger.info(`设置首帧图片: ${uploadIDs[0]}`);
    }

    // 构建尾帧图片对象
    if (uploadIDs[1]) {
      end_frame_image = {
        format: "",
        height: 0,
        id: util.uuid(),
        image_uri: uploadIDs[1],
        name: "",
        platform_type: 1,
        source_from: "upload",
        type: "image",
        uri: uploadIDs[1],
        width: 0,
      };
      logger.info(`设置尾帧图片: ${uploadIDs[1]}`);
    }
  }


  const componentId = util.uuid();
  const originSubmitId = util.uuid();

  // 根据官方API的实际行为，所有模式都使用 "first_last_frames"
  // 通过 first_frame_image 和 end_frame_image 是否为 undefined 来区分模式
  const functionMode = "first_last_frames";

  const sceneOption = {
    type: "video",
    scene: "BasicVideoGenerateButton",
    modelReqKey: model,
    videoDuration: duration,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: model,
      useVipFunctionDetailsReporterHoc: true,
    },
  };

  const metricsExtra = JSON.stringify({
    promptSource: "custom",
    isDefaultSeed: 1,
    originSubmitId: originSubmitId,
    isRegenerate: false,
    enterFrom: "click",
    functionMode: functionMode,
    sceneOptions: JSON.stringify([sceneOption]),
  });

  // 当有图片输入时，ratio参数会被图片的实际比例覆盖
  const hasImageInput = uploadIDs.length > 0;
  if (hasImageInput && ratio !== "1:1") {
    logger.warn(`图生视频模式下，ratio参数将被忽略（由输入图片的实际比例决定），但resolution参数仍然有效`);
  }

  logger.info(`视频生成模式: ${uploadIDs.length}张图片 (首帧: ${!!first_frame_image}, 尾帧: ${!!end_frame_image}), resolution: ${resolution}`);
  
  // 构建请求参数
  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    {
      params: {
        aigc_features: "app_lip_sync",
        web_version: "7.5.0",
        da_version: DRAFT_VERSION,
      },
      data: {
        "extend": {
          "root_model": model,
          "m_video_commerce_info": {
            benefit_type: getVideoBenefitType(model),
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          },
          "m_video_commerce_info_list": [{
            benefit_type: getVideoBenefitType(model),
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          }]
        },
        "submit_id": util.uuid(),
        "metrics_extra": metricsExtra,
        "draft_content": JSON.stringify({
          "type": "draft",
          "id": util.uuid(),
          "min_version": "3.0.5",
          "min_features": [],
          "is_from_tsn": true,
          "version": DRAFT_VERSION,
          "main_component_id": componentId,
          "component_list": [{
            "type": "video_base_component",
            "id": componentId,
            "min_version": "1.0.0",
            "aigc_mode": "workbench",
            "metadata": {
              "type": "",
              "id": util.uuid(),
              "created_platform": 3,
              "created_platform_version": "",
              "created_time_in_ms": Date.now().toString(),
              "created_did": ""
            },
            "generate_type": "gen_video",
            "abilities": {
              "type": "",
              "id": util.uuid(),
              "gen_video": {
                "id": util.uuid(),
                "type": "",
                "text_to_video_params": {
                  "type": "",
                  "id": util.uuid(),
                  "video_gen_inputs": [{
                    "type": "",
                    "id": util.uuid(),
                    "min_version": "3.0.5",
                    "prompt": prompt,
                    "video_mode": 2,
                    "fps": 24,
                    "duration_ms": durationMs,
                    "resolution": resolution,
                    "first_frame_image": first_frame_image,
                    "end_frame_image": end_frame_image,
                    "idip_meta_list": []
                  }],
                  "video_aspect_ratio": ratio,
                  "seed": Math.floor(Math.random() * 100000000) + 2500000000,
                  "model_req_key": model,
                  "priority": 0
                },
                "video_task_extra": metricsExtra,
              }
            },
            "process_type": 1
          }],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo)
        },
      },
    }
  );

  const historyId = aigc_data.history_record_id;
  if (!historyId)
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录ID不存在");

  logger.info(`视频生成任务已提交，history_id: ${historyId}，等待生成完成...`);

  // 首次查询前等待，让服务器有时间处理请求
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 使用 SmartPoller 进行智能轮询
  const maxPollCount = 900; // 增加轮询次数，支持更长的生成时间
  let pollAttempts = 0;

  const poller = new SmartPoller({
    maxPollCount,
    pollInterval: 2000, // 2秒基础间隔
    expectedItemCount: 1,
    type: 'video',
    timeoutSeconds: 1200 // 20分钟超时
  });

  const { result: pollingResult, data: finalHistoryData } = await poller.poll(async () => {
    pollAttempts++;

    // 使用标准API请求方式
    const result = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
      data: {
        history_ids: [historyId],
      },
    });

    // 尝试直接从响应中提取视频URL
    const responseStr = JSON.stringify(result);
    const videoUrlMatch = responseStr.match(/https:\/\/v[0-9]+-artist\.vlabvod\.com\/[^"\s]+/);
    if (videoUrlMatch && videoUrlMatch[0]) {
      logger.info(`从API响应中直接提取到视频URL: ${videoUrlMatch[0]}`);
      // 构造成功状态并返回
      return {
        status: {
          status: 10,
          itemCount: 1,
          historyId
        } as PollingStatus,
        data: {
          status: 10,
          item_list: [{
            video: {
              transcoded_video: {
                origin: {
                  video_url: videoUrlMatch[0]
                }
              }
            }
          }]
        }
      };
    }

    // 检查响应中是否有该 history_id 的数据
    if (!result[historyId]) {
      logger.warn(`API未返回历史记录，historyId: ${historyId}`);
      throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
    }

    const historyData = result[historyId];

    const currentStatus = historyData.status;
    const currentFailCode = historyData.fail_code;
    const currentItemList = historyData.item_list || [];
    const finishTime = historyData.task?.finish_time || 0;

    // 记录详细信息
    if (currentItemList.length > 0) {
      const tempVideoUrl = currentItemList[0]?.video?.transcoded_video?.origin?.video_url ||
                          currentItemList[0]?.video?.play_url ||
                          currentItemList[0]?.video?.download_url ||
                          currentItemList[0]?.video?.url;
      if (tempVideoUrl) {
        logger.info(`检测到视频URL: ${tempVideoUrl}`);
      }
    }

    return {
      status: {
        status: currentStatus,
        failCode: currentFailCode,
        itemCount: currentItemList.length,
        finishTime,
        historyId
      } as PollingStatus,
      data: historyData
    };
  }, historyId);

  const item_list = finalHistoryData.item_list || [];

  // 提取视频URL
  let videoUrl = item_list?.[0] ? extractVideoUrl(item_list[0]) : null;

  // 如果无法获取视频URL，抛出异常
  if (!videoUrl) {
    logger.error(`未能获取视频URL，item_list: ${JSON.stringify(item_list)}`);
    throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "未能获取视频URL，请稍后查看");
  }

  logger.info(`视频生成成功，URL: ${videoUrl}，总耗时: ${pollingResult.elapsedTime}秒`);
  return videoUrl;
}
