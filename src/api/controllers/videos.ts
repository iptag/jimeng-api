import _ from "lodash";
import fs from "fs-extra";
import axios from "axios";

import APIException from "@/lib/exceptions/APIException.ts";

import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request, parseRegionFromToken, getAssistantId, checkImageContent, RegionInfo } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_ASSISTANT_ID_CN, DEFAULT_ASSISTANT_ID_US, DEFAULT_ASSISTANT_ID_HK, DEFAULT_ASSISTANT_ID_JP, DEFAULT_ASSISTANT_ID_SG, DEFAULT_VIDEO_MODEL, DRAFT_VERSION, DRAFT_VERSION_OMNI, OMNI_BENEFIT_TYPE, VIDEO_MODEL_MAP, VIDEO_MODEL_MAP_US, VIDEO_MODEL_MAP_ASIA } from "@/api/consts/common.ts";
import { uploadImageBuffer } from "@/lib/image-uploader.ts";
import { uploadVideoBuffer, VideoUploadResult } from "@/lib/video-uploader.ts";
import { extractVideoUrl } from "@/lib/image-utils.ts";

export const DEFAULT_MODEL = DEFAULT_VIDEO_MODEL;

export function getModel(model: string, regionInfo: RegionInfo) {
  // 根据站点选择不同的模型映射
  let modelMap: Record<string, string>;
  if (regionInfo.isUS) {
    modelMap = VIDEO_MODEL_MAP_US;
  } else if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
    modelMap = VIDEO_MODEL_MAP_ASIA;
  } else {
    modelMap = VIDEO_MODEL_MAP;
  }
  return modelMap[model] || modelMap[DEFAULT_MODEL] || VIDEO_MODEL_MAP[DEFAULT_MODEL];
}

function getVideoBenefitType(model: string): string {
  // veo3.1 模型 (需先于 veo3 检查)
  if (model.includes("veo3.1")) {
    return "generate_video_veo3.1";
  }
  // veo3 模型
  if (model.includes("veo3")) {
    return "generate_video_veo3";
  }
  // sora2 模型
  if (model.includes("sora2")) {
    return "generate_video_sora2";
  }
  if (model.includes("40_pro")) {
    return "dreamina_video_seedance_20_pro";
  }
  if (model.includes("40")) {
    return "dreamina_video_seedance_20";
  }
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
    const imageResponse = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      proxy: false,
    });
    if (imageResponse.status < 200 || imageResponse.status >= 300) {
      throw new Error(`下载图片失败: ${imageResponse.status}`);
    }
    const imageBuffer = imageResponse.data;
    return await uploadImageBuffer(imageBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从URL上传视频图片失败: ${error.message}`);
    throw error;
  }
}

/**
 * 解析 omni_reference 模式的 prompt，将 @引用 拆解为 meta_list
 * 输入: "@image_file_1作为首帧，@image_file_2作为尾帧，运动动作模仿@video_file"
 * 输出: 交替的 text + material_ref 段
 */
function parseOmniPrompt(prompt: string, materialRegistry: Map<string, any>): any[] {
  // 收集所有可识别的引用名（字段名 + 原始文件名），转义正则特殊字符
  const refNames = [...materialRegistry.keys()]
    .sort((a, b) => b.length - a.length) // 长名优先匹配
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (refNames.length === 0) {
    return [{ meta_type: "text", text: prompt }];
  }

  const pattern = new RegExp(`@(${refNames.join('|')})`, 'g');
  const meta_list: any[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(prompt)) !== null) {
    // 文本段
    if (match.index > lastIndex) {
      const textSegment = prompt.slice(lastIndex, match.index);
      if (textSegment) {
        meta_list.push({ meta_type: "text", text: textSegment });
      }
    }
    // 引用段
    const refName = match[1];
    const entry = materialRegistry.get(refName);
    if (entry) {
      meta_list.push({
        meta_type: entry.type,
        text: "",
        material_ref: { material_idx: entry.idx },
      });
    }
    lastIndex = pattern.lastIndex;
  }

  // 尾部文本
  if (lastIndex < prompt.length) {
    meta_list.push({ meta_type: "text", text: prompt.slice(lastIndex) });
  }

  // 如果没有任何 @ 引用，把整个 prompt 作为文本段
  if (meta_list.length === 0) {
    meta_list.push({ meta_type: "text", text: prompt });
  }

  return meta_list;
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
    functionMode = "first_last_frames",
  }: {
    ratio?: string;
    resolution?: string;
    duration?: number;
    filePaths?: string[];
    files?: any;
    functionMode?: string;
  },
  refreshToken: string
) {
  // 检测区域
  const regionInfo = parseRegionFromToken(refreshToken);
  const { isInternational } = regionInfo;

  logger.info(`视频生成区域检测: isInternational=${isInternational}`);

  const model = getModel(_model, regionInfo);
  const isVeo3 = model.includes("veo3");
  const isSora2 = model.includes("sora2");
  const is35Pro = model.includes("3.5_pro");
  const is40Pro = model.includes("40_pro");
  // 只有 video-3.0 和 video-3.0-fast 支持 resolution 参数（3.0-pro 和 3.5-pro 不支持）
  const supportsResolution = (model.includes("vgfm_3.0") || model.includes("vgfm_3.0_fast")) && !model.includes("_pro");

  // 将秒转换为毫秒
  // veo3 模型固定 8 秒
  // sora2 模型支持 4秒、8秒、12秒，默认4秒
  // 3.5-pro 模型支持 5秒、10秒、12秒，默认5秒
  // 4.0-pro (seedance 2.0) 模型支持 4~15秒，默认5秒
  // 其他模型支持 5秒、10秒，默认5秒
  let durationMs: number;
  let actualDuration: number;
  if (isVeo3) {
    durationMs = 8000;
    actualDuration = 8;
  } else if (isSora2) {
    if (duration === 12) {
      durationMs = 12000;
      actualDuration = 12;
    } else if (duration === 8) {
      durationMs = 8000;
      actualDuration = 8;
    } else {
      durationMs = 4000;
      actualDuration = 4;
    }
  } else if (is40Pro) {
    // seedance 2.0: 支持 4~15 秒，clamp 到有效范围，默认 5 秒
    actualDuration = Math.max(4, Math.min(15, duration));
    durationMs = actualDuration * 1000;
  } else if (is35Pro) {
    if (duration === 12) {
      durationMs = 12000;
      actualDuration = 12;
    } else if (duration === 10) {
      durationMs = 10000;
      actualDuration = 10;
    } else {
      durationMs = 5000;
      actualDuration = 5;
    }
  } else {
    durationMs = duration === 10 ? 10000 : 5000;
    actualDuration = duration === 10 ? 10 : 5;
  }

  logger.info(`使用模型: ${_model} 映射模型: ${model} 比例: ${ratio} 分辨率: ${supportsResolution ? resolution : '不支持'} 时长: ${actualDuration}s`);

  // 检查积分
  const { totalCredit } = await getCredit(refreshToken);
  if (totalCredit <= 0) {
    logger.info("积分为 0，尝试收取今日积分...");
    try {
      await receiveCredit(refreshToken);
    } catch (receiveError) {
      logger.warn(`收取积分失败: ${receiveError.message}. 这可能是因为: 1) 今日已收取过积分, 2) 账户受到风控限制, 3) 需要在官网手动收取首次积分`);
      throw new APIException(EX.API_VIDEO_GENERATION_FAILED,
        `积分不足且无法自动收取。请访问即梦官网手动收取首次积分，或检查账户状态。`);
    }
  }

  const isOmniMode = functionMode === "omni_reference";

  // omni_reference 仅支持 seedance 2.0 (40_pro) 模型
  if (isOmniMode && !is40Pro) {
    throw new APIException(EX.API_REQUEST_FAILED,
      `omni_reference 模式仅支持 jimeng-video-seedance-2.0 模型`);
  }

  // omni_reference 模式下不支持 URL 方式
  if (isOmniMode && filePaths && filePaths.length > 0) {
    throw new APIException(EX.API_REQUEST_FAILED,
      `omni_reference 模式不支持 file_paths/filePaths URL 参数，请通过 multipart 上传文件 (image_file_1, image_file_2, video_file)`);
  }

  let requestData: any;

  if (isOmniMode) {
    // ========== omni_reference 分支 ==========
    logger.info(`进入 omni_reference 全能模式`);

    // 按字段名取出具名文件
    const imageFile1 = files?.image_file_1;
    const imageFile2 = files?.image_file_2;
    const videoFile = files?.video_file;

    if (!imageFile1 && !imageFile2 && !videoFile) {
      throw new APIException(EX.API_REQUEST_FAILED,
        `omni_reference 模式需要至少上传一个素材文件 (image_file_1, image_file_2, video_file)`);
    }

    // 素材注册表: fieldName → { idx, type, uploadResult }
    interface MaterialEntry {
      idx: number;
      type: "image" | "video";
      fieldName: string;
      originalFilename: string;
      imageUri?: string;
      videoResult?: VideoUploadResult;
    }
    const materialRegistry: Map<string, MaterialEntry> = new Map();
    let materialIdx = 0;

    // canonical key 集合，防止 originalFilename 覆盖
    const canonicalKeys = new Set(["image_file_1", "image_file_2", "video_file"]);
    // 安全注册别名：originalFilename 不与 canonical key 冲突时才注册
    function registerAlias(filename: string, entry: MaterialEntry) {
      if (!canonicalKeys.has(filename) && !materialRegistry.has(filename)) {
        materialRegistry.set(filename, entry);
      }
    }

    // 串行上传素材
    if (imageFile1) {
      try {
        logger.info(`[omni] 上传 image_file_1: ${imageFile1.originalFilename}`);
        const buf = await fs.readFile(imageFile1.filepath);
        const uri = await uploadImageBuffer(buf, refreshToken, regionInfo);
        await checkImageContent(uri, refreshToken, regionInfo);
        const entry: MaterialEntry = { idx: materialIdx++, type: "image", fieldName: "image_file_1", originalFilename: imageFile1.originalFilename, imageUri: uri };
        materialRegistry.set("image_file_1", entry);
        registerAlias(imageFile1.originalFilename, entry);
        logger.info(`[omni] image_file_1 上传成功: ${uri}`);
      } catch (error: any) {
        throw new APIException(EX.API_REQUEST_FAILED, `image_file_1 处理失败: ${error.message}`);
      }
    }

    if (imageFile2) {
      try {
        logger.info(`[omni] 上传 image_file_2: ${imageFile2.originalFilename}`);
        const buf = await fs.readFile(imageFile2.filepath);
        const uri = await uploadImageBuffer(buf, refreshToken, regionInfo);
        await checkImageContent(uri, refreshToken, regionInfo);
        const entry: MaterialEntry = { idx: materialIdx++, type: "image", fieldName: "image_file_2", originalFilename: imageFile2.originalFilename, imageUri: uri };
        materialRegistry.set("image_file_2", entry);
        registerAlias(imageFile2.originalFilename, entry);
        logger.info(`[omni] image_file_2 上传成功: ${uri}`);
      } catch (error: any) {
        throw new APIException(EX.API_REQUEST_FAILED, `image_file_2 处理失败: ${error.message}`);
      }
    }

    if (videoFile) {
      try {
        logger.info(`[omni] 上传 video_file: ${videoFile.originalFilename}`);
        const buf = await fs.readFile(videoFile.filepath);
        const vResult = await uploadVideoBuffer(buf, refreshToken, regionInfo);
        const entry: MaterialEntry = { idx: materialIdx++, type: "video", fieldName: "video_file", originalFilename: videoFile.originalFilename, videoResult: vResult };
        materialRegistry.set("video_file", entry);
        registerAlias(videoFile.originalFilename, entry);
        logger.info(`[omni] video_file 上传成功: vid=${vResult.vid}, ${vResult.videoMeta.width}x${vResult.videoMeta.height}, ${vResult.videoMeta.duration}s`);
      } catch (error: any) {
        throw new APIException(EX.API_REQUEST_FAILED, `video_file 处理失败: ${error.message}`);
      }
    }

    // 构建 material_list（按注册顺序）
    const orderedEntries = [...new Map([...materialRegistry].filter(([k, v]) => k === v.fieldName)).values()]
      .sort((a, b) => a.idx - b.idx);

    const material_list: any[] = [];
    const materialTypes: number[] = [];

    for (const entry of orderedEntries) {
      if (entry.type === "image") {
        material_list.push({
          material_type: "image",
          image_info: {
            image_uri: entry.imageUri,
            width: 0,
            height: 0,
            format: "",
            id: util.uuid(),
            name: "",
            platform_type: 1,
            source_from: "upload",
            type: "image",
            uri: entry.imageUri,
          },
        });
        materialTypes.push(1);
      } else {
        const vm = entry.videoResult!;
        material_list.push({
          material_type: "video",
          video_info: {
            vid: vm.vid,
            width: vm.videoMeta.width,
            height: vm.videoMeta.height,
            duration: Math.round(vm.videoMeta.duration * 1000),
            format: vm.videoMeta.format,
            codec: vm.videoMeta.codec,
            size: vm.videoMeta.size,
            bitrate: vm.videoMeta.bitrate,
            uri: vm.uri,
          },
        });
        materialTypes.push(2);
      }
    }

    // 解析 prompt → meta_list
    const meta_list = parseOmniPrompt(prompt, materialRegistry);

    logger.info(`[omni] material_list: ${material_list.length} 项, meta_list: ${meta_list.length} 项, materialTypes: [${materialTypes}]`);

    // 构建 omni payload
    const componentId = util.uuid();
    const originSubmitId = util.uuid();

    const sceneOption = {
      type: "video",
      scene: "BasicVideoGenerateButton",
      modelReqKey: model,
      videoDuration: actualDuration,
      materialTypes,
      reportParams: {
        enterSource: "generate",
        vipSource: "generate",
        extraVipFunctionKey: model,
        useVipFunctionDetailsReporterHoc: true,
      },
    };

    const metricsExtra = JSON.stringify({
      position: "page_bottom_box",
      isDefaultSeed: 1,
      originSubmitId,
      isRegenerate: false,
      enterFrom: "click",
      functionMode: "omni_reference",
      sceneOptions: JSON.stringify([sceneOption]),
    });

    requestData = {
      params: {
        aigc_features: "app_lip_sync",
        web_version: "7.5.0",
        da_version: DRAFT_VERSION_OMNI,
      },
      data: {
        extend: {
          root_model: model,
          m_video_commerce_info: {
            benefit_type: OMNI_BENEFIT_TYPE,
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc",
          },
          m_video_commerce_info_list: [{
            benefit_type: OMNI_BENEFIT_TYPE,
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc",
          }],
        },
        submit_id: util.uuid(),
        metrics_extra: metricsExtra,
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: DRAFT_VERSION_OMNI,
          min_features: ["AIGC_Video_UnifiedEdit"],
          is_from_tsn: true,
          version: DRAFT_VERSION_OMNI,
          main_component_id: componentId,
          component_list: [{
            type: "video_base_component",
            id: componentId,
            min_version: "1.0.0",
            aigc_mode: "workbench",
            metadata: {
              type: "",
              id: util.uuid(),
              created_platform: 3,
              created_platform_version: "",
              created_time_in_ms: Date.now().toString(),
              created_did: "",
            },
            generate_type: "gen_video",
            abilities: {
              type: "",
              id: util.uuid(),
              gen_video: {
                id: util.uuid(),
                type: "",
                text_to_video_params: {
                  type: "",
                  id: util.uuid(),
                  video_gen_inputs: [{
                    type: "",
                    id: util.uuid(),
                    min_version: DRAFT_VERSION_OMNI,
                    prompt: "",
                    video_mode: 2,
                    fps: 24,
                    duration_ms: durationMs,
                    unified_edit_input: {
                      type: "",
                      id: util.uuid(),
                      material_list,
                      meta_list,
                    },
                    idip_meta_list: [],
                  }],
                  video_aspect_ratio: ratio,
                  seed: Math.floor(Math.random() * 100000000) + 2500000000,
                  model_req_key: model,
                  priority: 0,
                },
                video_task_extra: metricsExtra,
              },
            },
            process_type: 1,
          }],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo),
        },
      },
    };
  } else {
    // ========== first_last_frames 分支（原有逻辑） ==========
    let first_frame_image = undefined;
    let end_frame_image = undefined;
    let uploadIDs: string[] = [];

    // 优先处理本地上传的文件
    const uploadedFiles = _.values(files);
    if (uploadedFiles && uploadedFiles.length > 0) {
      logger.info(`检测到 ${uploadedFiles.length} 个本地上传文件，优先处理`);
      for (let i = 0; i < uploadedFiles.length; i++) {
        const file = uploadedFiles[i];
        if (!file) continue;
        try {
          logger.info(`开始上传第 ${i + 1} 张本地图片: ${file.originalFilename}`);
          const imageUri = await uploadImageFromFile(file, refreshToken, regionInfo);
          if (imageUri) {
            await checkImageContent(imageUri, refreshToken, regionInfo);
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
    } else if (filePaths && filePaths.length > 0) {
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
            await checkImageContent(imageUri, refreshToken, regionInfo);
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

    if (uploadIDs.length > 0) {
      logger.info(`图片上传完成，共成功 ${uploadIDs.length} 张`);
      if (uploadIDs[0]) {
        first_frame_image = {
          format: "", height: 0, id: util.uuid(), image_uri: uploadIDs[0],
          name: "", platform_type: 1, source_from: "upload", type: "image", uri: uploadIDs[0], width: 0,
        };
        logger.info(`设置首帧图片: ${uploadIDs[0]}`);
      }
      if (uploadIDs[1]) {
        end_frame_image = {
          format: "", height: 0, id: util.uuid(), image_uri: uploadIDs[1],
          name: "", platform_type: 1, source_from: "upload", type: "image", uri: uploadIDs[1], width: 0,
        };
        logger.info(`设置尾帧图片: ${uploadIDs[1]}`);
      }
    }

    const componentId = util.uuid();
    const originSubmitId = util.uuid();
    const flFunctionMode = "first_last_frames";

    const sceneOption = {
      type: "video",
      scene: "BasicVideoGenerateButton",
      ...(supportsResolution ? { resolution } : {}),
      modelReqKey: model,
      videoDuration: actualDuration,
      reportParams: {
        enterSource: "generate",
        vipSource: "generate",
        extraVipFunctionKey: supportsResolution ? `${model}-${resolution}` : model,
        useVipFunctionDetailsReporterHoc: true,
      },
    };

    const metricsExtra = JSON.stringify({
      promptSource: "custom",
      isDefaultSeed: 1,
      originSubmitId,
      isRegenerate: false,
      enterFrom: "click",
      functionMode: flFunctionMode,
      sceneOptions: JSON.stringify([sceneOption]),
    });

    const hasImageInput = uploadIDs.length > 0;
    if (hasImageInput && ratio !== "1:1") {
      logger.warn(`图生视频模式下，ratio参数将被忽略（由输入图片的实际比例决定），但resolution参数仍然有效`);
    }

    logger.info(`视频生成模式: ${uploadIDs.length}张图片 (首帧: ${!!first_frame_image}, 尾帧: ${!!end_frame_image}), resolution: ${resolution}`);

    requestData = {
      params: {
        aigc_features: "app_lip_sync",
        web_version: "7.5.0",
        da_version: DRAFT_VERSION,
      },
      data: {
        extend: {
          root_model: model,
          m_video_commerce_info: {
            benefit_type: getVideoBenefitType(model),
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc",
          },
          m_video_commerce_info_list: [{
            benefit_type: getVideoBenefitType(model),
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc",
          }],
        },
        submit_id: util.uuid(),
        metrics_extra: metricsExtra,
        draft_content: JSON.stringify({
          type: "draft",
          id: util.uuid(),
          min_version: "3.0.5",
          min_features: [],
          is_from_tsn: true,
          version: DRAFT_VERSION,
          main_component_id: componentId,
          component_list: [{
            type: "video_base_component",
            id: componentId,
            min_version: "1.0.0",
            aigc_mode: "workbench",
            metadata: {
              type: "",
              id: util.uuid(),
              created_platform: 3,
              created_platform_version: "",
              created_time_in_ms: Date.now().toString(),
              created_did: "",
            },
            generate_type: "gen_video",
            abilities: {
              type: "",
              id: util.uuid(),
              gen_video: {
                id: util.uuid(),
                type: "",
                text_to_video_params: {
                  type: "",
                  id: util.uuid(),
                  video_gen_inputs: [{
                    type: "",
                    id: util.uuid(),
                    min_version: "3.0.5",
                    prompt,
                    video_mode: 2,
                    fps: 24,
                    duration_ms: durationMs,
                    ...(supportsResolution ? { resolution } : {}),
                    first_frame_image,
                    end_frame_image,
                    idip_meta_list: [],
                  }],
                  video_aspect_ratio: ratio,
                  seed: Math.floor(Math.random() * 100000000) + 2500000000,
                  model_req_key: model,
                  priority: 0,
                },
                video_task_extra: metricsExtra,
              },
            },
            process_type: 1,
          }],
        }),
        http_common_info: {
          aid: getAssistantId(regionInfo),
        },
      },
    };
  }

  // 发送请求
  const { aigc_data } = await request(
    "post",
    "/mweb/v1/aigc_draft/generate",
    refreshToken,
    requestData
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
    // 由于 API 存在最终一致性，早期轮询可能暂时获取不到记录，返回处理中状态继续轮询
    if (!result[historyId]) {
      logger.warn(`API未返回历史记录 (轮询第${pollAttempts}次)，historyId: ${historyId}，继续等待...`);
      return {
        status: {
          status: 20, // PROCESSING
          itemCount: 0,
          historyId
        } as PollingStatus,
        data: { status: 20, item_list: [] }
      };
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
