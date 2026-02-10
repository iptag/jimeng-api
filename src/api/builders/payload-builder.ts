import util from "@/lib/util.ts";
import { DRAFT_MIN_VERSION, DRAFT_VERSION, RESOLUTION_OPTIONS, RESOLUTION_OPTIONS_NANOBANANAPRO_4K } from "@/api/consts/common.ts";
import { RegionInfo, getAssistantId } from "@/api/controllers/core.ts";

export type RegionKey = "CN" | "US" | "HK" | "JP" | "SG";

export interface ResolutionResult {
  width: number;
  height: number;
  imageRatio: number;
  resolutionType: string;
  isForced: boolean;
}

function getRegionKey(regionInfo: RegionInfo): RegionKey {
  if (regionInfo.isUS) return "US";
  if (regionInfo.isHK) return "HK";
  if (regionInfo.isJP) return "JP";
  if (regionInfo.isSG) return "SG";
  return "CN";
}

function lookupResolution(resolution: string = "2k", ratio: string = "1:1", userModel?: string) {
  // nanobananapro 模型使用 4k 时，使用专用配置
  if (userModel === "nanobananapro" && resolution === "4k") {
    const ratioConfig = RESOLUTION_OPTIONS_NANOBANANAPRO_4K[ratio];
    if (!ratioConfig) {
      const supportedRatios = Object.keys(RESOLUTION_OPTIONS_NANOBANANAPRO_4K).join(", ");
      throw new Error(`nanobananapro 模型在 4k 分辨率下，不支持的比例 "${ratio}"。支持的比例: ${supportedRatios}`);
    }
    return {
      width: ratioConfig.width,
      height: ratioConfig.height,
      imageRatio: ratioConfig.ratio,
      resolutionType: resolution,
    };
  }

  const resolutionGroup = RESOLUTION_OPTIONS[resolution];
  if (!resolutionGroup) {
    const supportedResolutions = Object.keys(RESOLUTION_OPTIONS).join(", ");
    throw new Error(`不支持的分辨率 "${resolution}"。支持的分辨率: ${supportedResolutions}`);
  }

  const ratioConfig = resolutionGroup[ratio];
  if (!ratioConfig) {
    const supportedRatios = Object.keys(resolutionGroup).join(", ");
    throw new Error(`在 "${resolution}" 分辨率下，不支持的比例 "${ratio}"。支持的比例: ${supportedRatios}`);
  }

  return {
    width: ratioConfig.width,
    height: ratioConfig.height,
    imageRatio: ratioConfig.ratio,
    resolutionType: resolution,
  };
}

/**
 * 统一分辨率处理逻辑
 * - CN 站: 不支持 nano 系列模型 (nanobanana/nanobananapro)，抛出异常
 * - US 站 nanobanana: 强制 1024x1024 @ 2k，image_ratio=1
 * - HK/JP/SG 站 nanobanana: 强制 1k 分辨率，但 ratio 可自定义
 * - 所有站点 nanobananapro: resolution 和 ratio 都可自定义
 */
export function resolveResolution(
  userModel: string,
  regionInfo: RegionInfo,
  resolution: string = "2k",
  ratio: string = "1:1"
): ResolutionResult {
  const regionKey = getRegionKey(regionInfo);

  // ⚠️ 国内站不支持nano系列模型
  if (regionKey === "CN" && (userModel === "nanobanana" || userModel === "nanobananapro")) {
    throw new Error(
      `国内站不支持${userModel}模型,请使用jimeng系列模型`
    );
  }

  // ⚠️ nanobanana 模型的站点差异处理
  if (userModel === "nanobanana") {
    if (regionKey === "US") {
      // US 站: 强制 1024x1024@2k, ratio 固定为 1
      return {
        width: 1024,
        height: 1024,
        imageRatio: 1,
        resolutionType: "2k",
        isForced: true,
      };
    } else if (regionKey === "HK" || regionKey === "JP" || regionKey === "SG") {
      // HK/JP/SG 站: 强制 1k 分辨率，但 ratio 可自定义
      const params = lookupResolution("1k", ratio, userModel);
      return {
        width: params.width,
        height: params.height,
        imageRatio: params.imageRatio,
        resolutionType: "1k",
        isForced: true,
      };
    }
  }

  // 其他所有情况: 使用用户指定的 resolution 和 ratio
  const params = lookupResolution(resolution, ratio, userModel);
  return {
    ...params,
    isForced: false,
  };
}

/**
 * benefitCount 规则
 * - 生图模式统一返回 4
 * - 多图模式: 不加
 */
export function getBenefitCount(
  userModel: string,
  regionInfo: RegionInfo,
  isMultiImage: boolean = false
): number | undefined {
  if (isMultiImage) return undefined;

  return 4;
}

export type GenerateMode = "text2img" | "img2img";

export interface BuildCoreParamOptions {
  userModel: string;  // 用户模型名（如 'jimeng-4.0', 'nanobanana'）
  model: string;      // 映射后的内部模型名
  prompt: string;
  imageCount?: number;  // 图生图时的图片数量，用于生成动态 ## 前缀
  negativePrompt?: string;
  seed?: number;
  sampleStrength: number;
  resolution: ResolutionResult;
  intelligentRatio?: boolean;
  mode?: GenerateMode;
}

/**
 * 构建 core_param
 * - 图生图: image_ratio 始终保留，prompt 前缀为 ## * imageCount
 * - 文生图: intelligent_ratio=true 时移除 image_ratio
 * - intelligent_ratio 仅对 jimeng-4.0/jimeng-4.1/jimeng-4.5 模型有效，其他模型忽略此参数
 */
export function buildCoreParam(options: BuildCoreParamOptions) {
  const {
    userModel,
    model,
    prompt,
    imageCount = 0,
    negativePrompt,
    seed,
    sampleStrength,
    resolution,
    intelligentRatio = false,
    mode = "text2img",
  } = options;

  // ⚠️ intelligent_ratio 仅对 jimeng-4.0/jimeng-4.1/jimeng-4.5/jimeng-4.6/jimeng-5.0 模型有效
  const effectiveIntelligentRatio = ['jimeng-4.0', 'jimeng-4.1', 'jimeng-4.5', 'jimeng-4.6', 'jimeng-5.0'].includes(userModel) ? intelligentRatio : false;

  // 图生图时，prompt 前缀规则: 每张图片对应 2 个 #
  // 1张图 → ##, 2张图 → ####, 3张图 → ######
  const promptPrefix = mode === "img2img" ? '#'.repeat(imageCount * 2) : '';

  const coreParam: any = {
    type: "",
    id: util.uuid(),
    model,
    prompt: `${promptPrefix}${prompt}`,
    sample_strength: sampleStrength,
    large_image_info: {
      type: "",
      id: util.uuid(),
      min_version: DRAFT_MIN_VERSION,
      height: resolution.height,
      width: resolution.width,
      resolution_type: resolution.resolutionType,
    },
    intelligent_ratio: effectiveIntelligentRatio,
  };

  if (mode === "img2img") {
    coreParam.image_ratio = resolution.imageRatio;
  } else if (!effectiveIntelligentRatio) {
    coreParam.image_ratio = resolution.imageRatio;
  }

  if (negativePrompt !== undefined) {
    coreParam.negative_prompt = negativePrompt;
  }

  if (seed !== undefined) {
    coreParam.seed = seed;
  }

  return coreParam;
}

export type SceneType = "ImageBasicGenerate" | "ImageMultiGenerate";

/**
 * metrics_extra 中 abilityList 的能力项
 * - source.imageUrl: 前端使用 blob URL (如 blob:https://dreamina.capcut.com/[uuid])
 * - 后端实现时需要生成占位符,保持 blob URL 格式
 */
interface Ability {
  abilityName: string;
  strength: number;
  source?: {
    imageUrl: string;  // 格式: blob:https://dreamina.capcut.com/[uuid]
  };
}

export interface BuildMetricsExtraOptions {
  userModel: string;
  regionInfo: RegionInfo;
  submitId: string;
  scene: SceneType;
  resolutionType: string;
  abilityList?: Ability[];
  isMultiImage?: boolean;
}

/**
 * 构建 metrics_extra，自动处理 benefitCount 站点差异 & 多图禁用
 */
export function buildMetricsExtra({
  userModel,
  regionInfo,
  submitId,
  scene,
  resolutionType,
  abilityList = [],
  isMultiImage = false,
}: BuildMetricsExtraOptions): string {
  const benefitCount = getBenefitCount(userModel, regionInfo, isMultiImage);

  const sceneOption: any = {
    type: "image",
    scene,
    modelReqKey: userModel,
    resolutionType,
    abilityList,
    reportParams: {
      enterSource: "generate",
      vipSource: "generate",
      extraVipFunctionKey: `${userModel}-${resolutionType}`,
      useVipFunctionDetailsReporterHoc: true,
    },
  };

  if (benefitCount !== undefined) {
    sceneOption.benefitCount = benefitCount;
  }

  const metrics: any = {
    promptSource: "custom",
    generateCount: 1,
    enterFrom: "click",
    sceneOptions: JSON.stringify([sceneOption]),
    generateId: submitId,
    isRegenerate: false,
  };

  if (isMultiImage) {
    Object.assign(metrics, {
      templateId: "",
      templateSource: "",
      lastRequestId: "",
      originRequestId: "",
    });
  }

  return JSON.stringify(metrics);
}

export interface BuildDraftContentOptions {
  componentId: string;
  generateType: "generate" | "blend";
  coreParam: any;
  abilityList?: any[];
  promptPlaceholderInfoList?: any[];
  posteditParam?: any;
  imageCount?: number;  // 图生图时的图片数量
}

export function buildDraftContent({
  componentId,
  generateType,
  coreParam,
  abilityList,
  promptPlaceholderInfoList,
  posteditParam,
  imageCount = 0,
}: BuildDraftContentOptions): string {
  const abilities: any = {
    type: "",
    id: util.uuid(),
  };

  // 图生图时，draft 和 blend 的 min_version 规则:
  // - draft.min_version: 始终为 "3.2.9"
  // - blend.min_version: 仅当 imageCount >= 2 时添加 "3.2.9"
  const isBlend = generateType === "blend";
  const draftMinVersion = isBlend ? "3.2.9" : DRAFT_MIN_VERSION;

  if (generateType === "generate") {
    abilities.generate = {
      type: "",
      id: util.uuid(),
      core_param: coreParam,
      gen_option: {
        type: "",
        id: util.uuid(),
        generate_all: false,
      },
    };
  } else {
    abilities.blend = {
      type: "",
      id: util.uuid(),
      ...(imageCount >= 2 ? { min_version: "3.2.9" } : {}),
      min_features: [],
      core_param: coreParam,
      ability_list: abilityList,
      prompt_placeholder_info_list: promptPlaceholderInfoList,
      postedit_param: posteditParam,
    };
    abilities.gen_option = {
      type: "",
      id: util.uuid(),
      generate_all: false,
    };
  }

  const draftContent = {
    type: "draft",
    id: util.uuid(),
    min_version: draftMinVersion,
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
        generate_type: generateType,
        abilities,
      },
    ],
  };

  return JSON.stringify(draftContent);
}

export interface BuildGenerateRequestOptions {
  model: string;
  regionInfo: RegionInfo;
  submitId: string;
  draftContent: string;
  metricsExtra: string;
}

export function buildGenerateRequest({
  model,
  regionInfo,
  submitId,
  draftContent,
  metricsExtra,
}: BuildGenerateRequestOptions) {
  return {
    extend: {
      root_model: model,
    },
    submit_id: submitId,
    metrics_extra: metricsExtra,
    draft_content: draftContent,
    http_common_info: {
      aid: getAssistantId(regionInfo),
    },
  };
}

export function buildBlendAbilityList(uploadedImageIds: string[], strength: number): any[] {
  return uploadedImageIds.map((imageId) => ({
    type: "",
    id: util.uuid(),
    name: "byte_edit",
    image_uri_list: [imageId],
    image_list: [
      {
        type: "image",
        id: util.uuid(),
        source_from: "upload",
        platform_type: 1,
        name: "",
        image_uri: imageId,
        width: 0,
        height: 0,
        format: "",
        uri: imageId,
      },
    ],
    strength,
  }));
}

export function buildPromptPlaceholderList(count: number): any[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "",
    id: util.uuid(),
    ability_index: index,
  }));
}
