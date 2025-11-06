import _ from "lodash";
import crypto from "crypto";
import fs from "fs-extra";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import util from "@/lib/util.ts";
import { getCredit, receiveCredit, request } from "./core.ts";
import logger from "@/lib/logger.ts";
import { SmartPoller, PollingStatus } from "@/lib/smart-poller.ts";
import { DEFAULT_ASSISTANT_ID_CN, DEFAULT_ASSISTANT_ID_US, DEFAULT_ASSISTANT_ID_HK, DEFAULT_ASSISTANT_ID_JP, DEFAULT_ASSISTANT_ID_SG, DEFAULT_VIDEO_MODEL, DRAFT_VERSION, VIDEO_MODEL_MAP } from "@/api/consts/common.ts";
import { BASE_URL_DREAMINA_US, BASE_URL_DREAMINA_HK, BASE_URL_IMAGEX_US, BASE_URL_IMAGEX_HK } from "@/api/consts/dreamina.ts";

export const DEFAULT_MODEL = DEFAULT_VIDEO_MODEL;

export function getModel(model: string) {
  return VIDEO_MODEL_MAP[model] || VIDEO_MODEL_MAP[DEFAULT_MODEL];
}

// AWS4-HMAC-SHA256 签名生成函数（从 images.ts 复制）
function createSignature(
  method: string,
  url: string,
  headers: { [key: string]: string },
  accessKeyId: string,
  secretAccessKey: string,
  sessionToken?: string,
  payload: string = '',
  region: string = 'cn-north-1'
) {
  const urlObj = new URL(url);
  const pathname = urlObj.pathname || '/';
  const search = urlObj.search;

  // 创建规范请求
  const timestamp = headers['x-amz-date'];
  const date = timestamp.substr(0, 8);
  const service = 'imagex';
  
  // 规范化查询参数
  const queryParams: Array<[string, string]> = [];
  const searchParams = new URLSearchParams(search);
  searchParams.forEach((value, key) => {
    queryParams.push([key, value]);
  });
  
  // 按键名排序
  queryParams.sort(([a], [b]) => {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  });
  
  const canonicalQueryString = queryParams
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  
  // 规范化头部
  const headersToSign: { [key: string]: string } = {
    'x-amz-date': timestamp
  };
  
  if (sessionToken) {
    headersToSign['x-amz-security-token'] = sessionToken;
  }
  
  let payloadHash = crypto.createHash('sha256').update('').digest('hex');
  if (method.toUpperCase() === 'POST' && payload) {
    payloadHash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
    headersToSign['x-amz-content-sha256'] = payloadHash;
  }
  
  const signedHeaders = Object.keys(headersToSign)
    .map(key => key.toLowerCase())
    .sort()
    .join(';');
  
  const canonicalHeaders = Object.keys(headersToSign)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(key => `${key.toLowerCase()}:${headersToSign[key].trim()}\n`)
    .join('');
  
  const canonicalRequest = [
    method.toUpperCase(),
    pathname,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  
  // 创建待签名字符串
  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    timestamp,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest, 'utf8').digest('hex')
  ].join('\n');
  
  // 生成签名
  const kDate = crypto.createHmac('sha256', `AWS4${secretAccessKey}`).update(date).digest();
  const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
  const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
  const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  
  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

// 计算文件的CRC32值（从 images.ts 复制）
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

// 核心上传逻辑：上传二进制buffer到ImageX
async function _uploadImageBuffer(imageBuffer: ArrayBuffer, refreshToken: string): Promise<string> {
    // 检测区域
    const isUS = refreshToken.toLowerCase().startsWith('us-');
    const isHK = refreshToken.toLowerCase().startsWith('hk-');
    const isJP = refreshToken.toLowerCase().startsWith('jp-');
    const isSG = refreshToken.toLowerCase().startsWith('sg-');
    const isInternational = isUS || isHK || isJP || isSG;

    logger.info(`开始上传视频图片... (isInternational: ${isInternational}, isUS: ${isUS}, isHK: ${isHK}, isJP: ${isJP}, isSG: ${isSG})`);

    // 第一步：获取上传令牌
    const tokenResult = await request("post", "/mweb/v1/get_upload_token", refreshToken, {
      data: {
        scene: 2, // AIGC 图片上传场景
      },
    });

    const { access_key_id, secret_access_key, session_token, service_id } = tokenResult;
    if (!access_key_id || !secret_access_key || !session_token) {
      throw new Error("获取上传令牌失败");
    }

    const actualServiceId = service_id || (isUS ? "wopfjsm1ax" : (isHK || isJP || isSG) ? "wopfjsm1ax" : "tb4s082cfz");
    logger.info(`获取上传令牌成功: service_id=${actualServiceId}`);
    
    const fileSize = imageBuffer.byteLength;
    const crc32 = calculateCRC32(imageBuffer);
    
    logger.info(`图片Buffer准备完成: 大小=${fileSize}字节, CRC32=${crc32}`);

    // 第二步：申请图片上传权限
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');

    const randomStr = Math.random().toString(36).substring(2, 12);
    const applyUrlHost = isUS ? BASE_URL_IMAGEX_US : (isHK || isJP || isSG) ? BASE_URL_IMAGEX_HK : 'https://imagex.bytedanceapi.com';
    const applyUrl = `${applyUrlHost}/?Action=ApplyImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}&FileSize=${fileSize}&s=${randomStr}${isInternational ? '&device_platform=web' : ''}`;

    const region = isUS ? 'us-east-1' : (isHK || isJP || isSG) ? 'ap-southeast-1' : 'cn-north-1';

    const requestHeaders = {
      'x-amz-date': timestamp,
      'x-amz-security-token': session_token
    };

    const authorization = createSignature('GET', applyUrl, requestHeaders, access_key_id, secret_access_key, session_token, '', region);

    const origin = isUS ? new URL(BASE_URL_DREAMINA_US).origin : (isHK || isJP || isSG) ? new URL(BASE_URL_DREAMINA_HK).origin : 'https://jimeng.jianying.com';

    logger.info(`申请上传权限: ${applyUrl}`);
    
    const applyResponse = await fetch(applyUrl, {
      method: 'GET',
      headers: {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'authorization': authorization,
        'origin': origin,
        'referer': `${origin}/ai-tool/video/generate`,
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
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
    
    logger.info(`申请上传权限成功`);
    
    // 解析上传信息
    const uploadAddress = applyResult?.Result?.UploadAddress;
    if (!uploadAddress || !uploadAddress.StoreInfos || !uploadAddress.UploadHosts) {
      throw new Error(`获取上传地址失败: ${JSON.stringify(applyResult)}`);
    }
    
    const storeInfo = uploadAddress.StoreInfos[0];
    const uploadHost = uploadAddress.UploadHosts[0];
    const auth = storeInfo.Auth;
    
    const uploadUrl = `https://${uploadHost}/upload/v1/${storeInfo.StoreUri}`;
    const imageId = storeInfo.StoreUri.split('/').pop();
    
    logger.info(`准备上传图片: imageId=${imageId}, uploadUrl=${uploadUrl}`);
    
    // 第三步：上传图片文件
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Authorization': auth,
        'Connection': 'keep-alive',
        'Content-CRC32': crc32,
        'Content-Disposition': 'attachment; filename="undefined"',
        'Content-Type': 'application/octet-stream',
        'Origin': 'https://jimeng.jianying.com',
        'Referer': 'https://jimeng.jianying.com/ai-tool/video/generate',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        'X-Storage-U': '704135154117550',
      },
      body: imageBuffer,
    });
    
    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(`图片上传失败: ${uploadResponse.status} - ${errorText}`);
    }
    
    logger.info(`图片文件上传成功`);

    // 第四步：提交上传
    const commitUrl = `${applyUrlHost}/?Action=CommitImageUpload&Version=2018-08-01&ServiceId=${actualServiceId}`;

    const commitTimestamp = new Date().toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const commitPayload = JSON.stringify({
      SessionKey: uploadAddress.SessionKey,
      SuccessActionStatus: "200"
    });

    const payloadHash = crypto.createHash('sha256').update(commitPayload, 'utf8').digest('hex');

    const commitRequestHeaders = {
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': session_token,
      'x-amz-content-sha256': payloadHash
    };

    const commitAuthorization = createSignature('POST', commitUrl, commitRequestHeaders, access_key_id, secret_access_key, session_token, commitPayload, region);

    const commitResponse = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'accept': '*/*',
        'accept-language': 'zh-CN,zh;q=0.9',
        'authorization': commitAuthorization,
        'content-type': 'application/json',
        'origin': origin,
        'referer': `${origin}/ai-tool/video/generate`,
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'cross-site',
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
    
    // 验证图片信息
    const pluginResult = commitResult.Result?.PluginResult?.[0];
    if (pluginResult && pluginResult.ImageUri) {
      logger.info(`视频图片上传完成: ${pluginResult.ImageUri}`);
      return pluginResult.ImageUri;
    }
    
    logger.info(`视频图片上传完成: ${fullImageUri}`);
    return fullImageUri;
}

// 处理来自URL的图片
async function uploadImageFromUrl(imageUrl: string, refreshToken: string): Promise<string> {
  try {
    logger.info(`开始从URL下载并上传视频图片: ${imageUrl}`);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`下载图片失败: ${imageResponse.status}`);
    }
    const imageBuffer = await imageResponse.arrayBuffer();
    return await _uploadImageBuffer(imageBuffer, refreshToken);
  } catch (error) {
    logger.error(`从URL上传视频图片失败: ${error.message}`);
    throw error;
  }
}

// 处理本地上传的文件
async function uploadImageFromFile(file: any, refreshToken: string): Promise<string> {
  try {
    logger.info(`开始从本地文件上传视频图片: ${file.originalFilename} (路径: ${file.filepath})`);
    const imageBuffer = await fs.readFile(file.filepath);
    return await _uploadImageBuffer(imageBuffer, refreshToken);
  } catch (error) {
    logger.error(`从本地文件上传视频图片失败: ${error.message}`);
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
  const isUS = refreshToken.toLowerCase().startsWith('us-');
  const isHK = refreshToken.toLowerCase().startsWith('hk-');
  const isJP = refreshToken.toLowerCase().startsWith('jp-');
  const isSG = refreshToken.toLowerCase().startsWith('sg-');
  const isInternational = isUS || isHK || isJP || isSG;

  logger.info(`视频生成区域检测: isUS=${isUS}, isHK=${isHK}, isJP=${isJP}, isSG=${isSG}, isInternational=${isInternational}`);

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
        const imageUri = await uploadImageFromFile(file, refreshToken);
        if (imageUri) {
          uploadIDs.push(imageUri);
          logger.info(`第 ${i + 1} 张本地图片上传成功: ${imageUri}`);
        } else {
          logger.error(`第 ${i + 1} 张本地图片上传失败: 未获取到 image_uri`);
        }
      } catch (error) {
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
        const imageUri = await uploadImageFromUrl(filePath, refreshToken);
        if (imageUri) {
          uploadIDs.push(imageUri);
          logger.info(`第 ${i + 1} 个URL图片上传成功: ${imageUri}`);
        } else {
          logger.error(`第 ${i + 1} 个URL图片上传失败: 未获取到 image_uri`);
        }
      } catch (error) {
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

  const metricsExtra = JSON.stringify({
    "promptSource": "custom",
    "isDefaultSeed": 1,
    "originSubmitId": originSubmitId,
    "isRegenerate": false,
    "enterFrom": "click",
    "functionMode": functionMode
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
        web_version: "6.6.0",
        da_version: DRAFT_VERSION,
      },
      data: {
        "extend": {
          "root_model": end_frame_image ? VIDEO_MODEL_MAP['jimeng-video-3.0'] : model,
          "m_video_commerce_info": {
            benefit_type: "basic_video_operation_vgfm_v_three",
            resource_id: "generate_video",
            resource_id_type: "str",
            resource_sub_type: "aigc"
          },
          "m_video_commerce_info_list": [{
            benefit_type: "basic_video_operation_vgfm_v_three",
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
          aid: isInternational
            ? (isUS ? DEFAULT_ASSISTANT_ID_US : (isJP ? DEFAULT_ASSISTANT_ID_JP : (isSG ? DEFAULT_ASSISTANT_ID_SG : DEFAULT_ASSISTANT_ID_HK)))
            : DEFAULT_ASSISTANT_ID_CN
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

    // 尝试两种不同的API请求方式
    let result;
    let historyData;
    let useAlternativeApi = pollAttempts > 10 && pollAttempts % 2 === 0 && !isInternational; // 国际站不使用备用API

    if (useAlternativeApi) {
      // 备用API请求方式（仅国内站）
      try {
        logger.info(`尝试备用API请求方式: /mweb/v1/get_history_records, 历史ID: ${historyId}`);
        result = await request("post", "/mweb/v1/get_history_records", refreshToken, {
          data: {
            history_record_ids: [historyId],
          },
        });

        // 尝试直接从响应中提取视频URL
        const responseStr = JSON.stringify(result);
        const videoUrlMatch = responseStr.match(/https:\/\/v[0-9]+-artist\.vlabvod\.com\/[^"\s]+/);
        if (videoUrlMatch && videoUrlMatch[0]) {
          logger.info(`从备用API响应中直接提取到视频URL: ${videoUrlMatch[0]}`);
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

        // 备用API可能返回两种格式：history_records 数组 或 直接用 historyId 作为 key
        if (result.history_records && result.history_records.length > 0) {
          historyData = result.history_records[0];
          logger.info(`从备用API获取到历史记录（数组格式）`);
        } else if (result[historyId]) {
          historyData = result[historyId];
          logger.info(`从备用API获取到历史记录（对象格式）`);
        } else {
          logger.warn(`备用API未返回历史记录，fallback到标准API`);
          useAlternativeApi = false; // fallback到标准API
        }
      } catch (error) {
        logger.warn(`备用API请求失败: ${error.message}，fallback到标准API`);
        useAlternativeApi = false; // fallback到标准API
      }
    }

    if (!useAlternativeApi) {
      // 标准API请求方式
      result = await request("post", "/mweb/v1/get_history_by_ids", refreshToken, {
        data: {
          history_ids: [historyId],
        },
      });

      // 尝试直接从响应中提取视频URL
      const responseStr = JSON.stringify(result);
      const videoUrlMatch = responseStr.match(/https:\/\/v[0-9]+-artist\.vlabvod\.com\/[^"\s]+/);
      if (videoUrlMatch && videoUrlMatch[0]) {
        logger.info(`从标准API响应中直接提取到视频URL: ${videoUrlMatch[0]}`);
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
        logger.warn(`标准API未返回历史记录，historyId: ${historyId}`);
        throw new APIException(EX.API_IMAGE_GENERATION_FAILED, "记录不存在");
      }

      historyData = result[historyId];
      logger.info(`从标准API获取到历史记录`);
    }

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
  let videoUrl = item_list?.[0]?.video?.transcoded_video?.origin?.video_url;

  // 如果通过常规路径无法获取视频URL，尝试其他可能的路径
  if (!videoUrl) {
    if (item_list?.[0]?.video?.play_url) {
      videoUrl = item_list[0].video.play_url;
      logger.info(`从play_url获取到视频URL: ${videoUrl}`);
    } else if (item_list?.[0]?.video?.download_url) {
      videoUrl = item_list[0].video.download_url;
      logger.info(`从download_url获取到视频URL: ${videoUrl}`);
    } else if (item_list?.[0]?.video?.url) {
      videoUrl = item_list[0].video.url;
      logger.info(`从url获取到视频URL: ${videoUrl}`);
    } else {
      logger.error(`未能获取视频URL，item_list: ${JSON.stringify(item_list)}`);
      const error = new APIException(EX.API_IMAGE_GENERATION_FAILED, "未能获取视频URL，请稍后查看");
      error.historyId = historyId;
      throw error;
    }
  }

  logger.info(`视频生成成功，URL: ${videoUrl}，总耗时: ${pollingResult.elapsedTime}秒`);
  return videoUrl;
}