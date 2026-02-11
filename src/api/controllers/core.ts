import path from "path";
import _ from "lodash";
import mime from "mime";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import { JimengErrorHandler, JimengErrorResponse } from "@/lib/error-handler.ts";
import { BASE_URL_DREAMINA_US, BASE_URL_DREAMINA_HK, DA_VERSION, WEB_VERSION } from "@/api/consts/dreamina.ts";

import {
  BASE_URL_CN,
  BASE_URL_US_COMMERCE,
  BASE_URL_HK_COMMERCE,
  BASE_URL_HK,
  DEFAULT_ASSISTANT_ID_CN,
  DEFAULT_ASSISTANT_ID_US,
  DEFAULT_ASSISTANT_ID_HK,
  DEFAULT_ASSISTANT_ID_JP,
  DEFAULT_ASSISTANT_ID_SG,
  PLATFORM_CODE,
  REGION_CN,
  REGION_US,
  REGION_HK,
  REGION_JP,
  REGION_SG,
  VERSION_CODE,
  RETRY_CONFIG
} from "@/api/consts/common.ts";

// 模型名称
const MODEL_NAME = "jimeng";
// 设备ID
const DEVICE_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// WebID
const WEB_ID = Math.random() * 999999999999999999 + 7000000000000000000;
// 用户ID
const USER_ID = util.uuid(false);
// 伪装headers
const FAKE_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Encoding": "gzip, deflate, br, zstd",
  "Accept-language": "zh-CN,zh;q=0.9",
  "Cache-control": "no-cache",
  Appvr: VERSION_CODE,
  Pragma: "no-cache",
  Priority: "u=1, i",
  Pf: PLATFORM_CODE,
  "Sec-Ch-Ua": '"Google Chrome";v="142", "Chromium";v="142", "Not_A Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
};
// 文件最大大小
const FILE_MAX_SIZE = 100 * 1024 * 1024;

/**
 * 获取缓存中的access_token
 *
 * 目前jimeng的access_token是固定的，暂无刷新功能
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function acquireToken(refreshToken: string): Promise<string> {
  return refreshToken;
}

/**
 * 解析 token 中的地区信息
 *
 * @param refreshToken 刷新令牌
 * @returns 地区信息对象
 */
export interface RegionInfo {
  isUS: boolean;
  isHK: boolean;
  isJP: boolean;
  isSG: boolean;
  isInternational: boolean;
  isCN: boolean;
}

export interface TokenWithProxy {
  token: string;
  proxyUrl: string | null;
}

export function parseProxyFromToken(rawToken: string): TokenWithProxy {
  const tokenValue = rawToken.trim();
  const proxyPattern = /^(https?|socks(?:4|5)?):\/\//i;
  if (!proxyPattern.test(tokenValue)) return { token: tokenValue, proxyUrl: null };

  const lastAtIndex = tokenValue.lastIndexOf("@");
  if (lastAtIndex <= 0 || lastAtIndex === tokenValue.length - 1)
    return { token: tokenValue, proxyUrl: null };

  const proxyUrl = tokenValue.slice(0, lastAtIndex);
  const token = tokenValue.slice(lastAtIndex + 1);
  if (!proxyUrl || !token) return { token: tokenValue, proxyUrl: null };

  return { token, proxyUrl };
}

export function parseRegionFromToken(refreshToken: string): RegionInfo {
  const { token: parsedToken } = parseProxyFromToken(refreshToken);
  const token = parsedToken.toLowerCase();
  const isUS = token.startsWith('us-');
  const isHK = token.startsWith('hk-');
  const isJP = token.startsWith('jp-');
  const isSG = token.startsWith('sg-');
  const isInternational = isUS || isHK || isJP || isSG;

  return {
    isUS,
    isHK,
    isJP,
    isSG,
    isInternational,
    isCN: !isInternational
  };
}

/**
 * 根据地区获取 Referer
 *
 * @param refreshToken 刷新令牌
 * @param cnPath 国内站路径
 * @returns Referer URL
 */
export function getRefererByRegion(refreshToken: string, cnPath: string): string {
  const { isInternational } = parseRegionFromToken(refreshToken);
  return isInternational
    ? "https://dreamina.capcut.com/"
    : `https://jimeng.jianying.com${cnPath}`;
}

/**
 * 根据地区获取 AssistantID
 *
 * @param regionInfo 地区信息
 * @returns AssistantID
 */
export function getAssistantId(regionInfo: RegionInfo): number {
  if (regionInfo.isUS) return DEFAULT_ASSISTANT_ID_US;
  if (regionInfo.isJP) return DEFAULT_ASSISTANT_ID_JP;
  if (regionInfo.isSG) return DEFAULT_ASSISTANT_ID_SG;
  if (regionInfo.isHK) return DEFAULT_ASSISTANT_ID_HK;
  return DEFAULT_ASSISTANT_ID_CN;
}

/**
 * 生成cookie
 */
export function generateCookie(refreshToken: string) {
  const { token: tokenWithRegion } = parseProxyFromToken(refreshToken);
  const { isUS, isHK, isJP, isSG } = parseRegionFromToken(tokenWithRegion);
  const token = (isUS || isHK || isJP || isSG)
    ? tokenWithRegion.substring(3)
    : tokenWithRegion;

  let storeRegion = 'cn-gd';
  if (isUS) storeRegion = 'us';
  else if (isHK) storeRegion = 'hk';
  else if (isJP) storeRegion = 'hk'; // JP uses HK store region
  else if (isSG) storeRegion = 'hk'; // SG uses HK store region

  return [
    `_tea_web_id=${WEB_ID}`,
    `is_staff_user=false`,
    `store-region=${storeRegion}`,
    `store-region-src=uid`,
    `sid_guard=${token}%7C${util.unixTimestamp()}%7C5184000%7CMon%2C+03-Feb-2025+08%3A17%3A09+GMT`,
    `uid_tt=${USER_ID}`,
    `uid_tt_ss=${USER_ID}`,
    `sid_tt=${token}`,
    `sessionid=${token}`,
    `sessionid_ss=${token}`,
    `sid_tt=${token}`
  ].join("; ");
}

/**
 * 获取积分信息
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function getCredit(refreshToken: string) {
  const referer = getRefererByRegion(refreshToken, "/ai-tool/image/generate");

  const {
    credit: { gift_credit, purchase_credit, vip_credit }
  } = await request("POST", "/commerce/v1/benefits/user_credit", refreshToken, {
    data: {},
    headers: {
      Referer: referer,
    },
    noDefaultParams: true
  });
  logger.info(`\n积分信息: \n赠送积分: ${gift_credit}, 购买积分: ${purchase_credit}, VIP积分: ${vip_credit}`);
  return {
    giftCredit: gift_credit,
    purchaseCredit: purchase_credit,
    vipCredit: vip_credit,
    totalCredit: gift_credit + purchase_credit + vip_credit
  }
}

/**
 * 接收今日积分（仅在积分为 0 时调用）
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 */
export async function receiveCredit(refreshToken: string) {
  logger.info("正在尝试收取今日积分...")
  const referer = getRefererByRegion(refreshToken, "/ai-tool/home");

  const { receive_quota } = await request("POST", "/commerce/v1/benefits/credit_receive", refreshToken, {
    data: {
      time_zone: "Asia/Shanghai"
    },
    headers: {
      Referer: referer
    }
  });
  logger.info(`今日${receive_quota}积分收取成功`);
  return receive_quota;
}

/**
 * 请求jimeng
 *
 * @param method 请求方法
 * @param uri 请求路径
 * @param params 请求参数
 * @param headers 请求头
 */
export async function request(
  method: string,
  uri: string,
  refreshToken: string,
  options: AxiosRequestConfig & { noDefaultParams?: boolean } = {}
) {
  const { token: tokenWithRegion, proxyUrl } = parseProxyFromToken(refreshToken);
  const regionInfo = parseRegionFromToken(tokenWithRegion);
  const { isUS, isHK, isJP, isSG } = regionInfo;
  await acquireToken(regionInfo.isInternational ? tokenWithRegion.substring(3) : tokenWithRegion);
  const deviceTime = util.unixTimestamp();
  const sign = util.md5(
    `9e2c|${uri.slice(-7)}|${PLATFORM_CODE}|${VERSION_CODE}|${deviceTime}||11ac`
  );

  let baseUrl: string;
  let aid: number;
  let region: string;

  if (isUS) {
    if (uri.startsWith("/commerce/")) {
      baseUrl = BASE_URL_US_COMMERCE;
    } else {
      baseUrl = BASE_URL_DREAMINA_US;
    }
    aid = DEFAULT_ASSISTANT_ID_US;
    region = REGION_US;
  } else if (isHK || isJP || isSG) {
    // HK, JP and SG regions use the same SG base URL
    if (uri.startsWith("/commerce/")) {
      baseUrl = BASE_URL_HK_COMMERCE;
    } else {
      baseUrl = BASE_URL_DREAMINA_HK;
    }
    if (isJP) {
      aid = DEFAULT_ASSISTANT_ID_JP;
      region = REGION_JP;
    } else if (isSG) {
      aid = DEFAULT_ASSISTANT_ID_SG;
      region = REGION_SG;
    } else {
      aid = DEFAULT_ASSISTANT_ID_HK;
      region = REGION_HK;
    }
  } else {
    // CN region
    baseUrl = BASE_URL_CN;
    aid = DEFAULT_ASSISTANT_ID_CN;
    region = REGION_CN;
  }

  const origin = new URL(baseUrl).origin;

  const fullUrl = `${baseUrl}${uri}`;
  const requestParams = options.noDefaultParams ? (options.params || {}) : {
    aid: aid,
    device_platform: "web",
    region: region,
    ...(isUS || isHK || isJP || isSG ? {} : { webId: WEB_ID }),
    da_version: DA_VERSION,
    os: "windows",
    web_component_open_flag: 0,
    web_version: WEB_VERSION,
    aigc_features: "app_lip_sync",
    ...(options.params || {}),
  };

  const headers = {
    ...FAKE_HEADERS,
    Origin: origin,
    Referer: origin,
    Appid: aid,
    Cookie: generateCookie(tokenWithRegion),
    "Device-Time": deviceTime,
    Sign: sign,
    "Sign-Ver": "1",
    ...(options.headers || {}),
  };

  logger.info(`发送请求: ${method.toUpperCase()} ${fullUrl}`);
  if (proxyUrl) {
    const maskedProxyUrl = proxyUrl.replace(/\/\/([^@/]+)@/i, "//***@");
    logger.info(`使用代理: ${maskedProxyUrl}`);
  }
  logger.info(`请求参数: ${JSON.stringify(requestParams)}`);
  logger.info(`请求数据: ${JSON.stringify(options.data || {})}`);

  const proxyAgent = proxyUrl
    ? (proxyUrl.toLowerCase().startsWith("socks")
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl))
    : undefined;

  // 添加重试逻辑
  let retries = 0;
  const maxRetries = RETRY_CONFIG.MAX_RETRY_COUNT;
  let lastError = null;

  while (retries <= maxRetries) {
    try {
      if (retries > 0) {
        logger.info(`第 ${retries} 次重试请求: ${method.toUpperCase()} ${fullUrl}`);
        // 重试前等待一段时间
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.RETRY_DELAY));
      }

      const response = await axios.request({
        method,
        url: fullUrl,
        params: requestParams,
        headers: headers,
        timeout: 45000, // 增加超时时间到45秒
        validateStatus: () => true, // 允许任何状态码
        ..._.omit(options, "params", "headers"),
        ...(proxyAgent ? { httpAgent: proxyAgent, httpsAgent: proxyAgent, proxy: false } : {}),
      });

      // 记录响应状态和头信息
      logger.info(`响应状态: ${response.status} ${response.statusText}`);

      // 流式响应直接返回response
      if (options.responseType == "stream") return response;

      // 记录响应数据摘要
      const responseDataSummary = JSON.stringify(response.data).substring(0, 500) +
        (JSON.stringify(response.data).length > 500 ? "..." : "");
      //const responseDataSummary = JSON.stringify(response.data)
      logger.info(`响应数据摘要: ${responseDataSummary}`);

      // 检查HTTP状态码
      if (response.status >= 400) {
        logger.warn(`HTTP错误: ${response.status} ${response.statusText}`);
        if (retries < maxRetries) {
          retries++;
          continue;
        }
      }

      return checkResult(response);
    }
    catch (error) {
      lastError = error;
      logger.error(`请求失败 (尝试 ${retries + 1}/${maxRetries + 1}): ${error.message}`);

      // 如果是网络错误或超时，尝试重试
      // 包含常见的网络错误：ECONNRESET（连接重置）、ENOTFOUND（DNS解析失败）、
      // ECONNREFUSED（连接被拒绝）、EAI_AGAIN（DNS临时失败）、EPIPE（管道破裂）
      const retryableErrorCodes = [
        'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND',
        'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH'
      ];
      const isRetryableError = retryableErrorCodes.includes(error.code) ||
        error.message.includes('timeout') ||
        error.message.includes('network') ||
        error.message.includes('ECONNRESET') ||
        error.message.includes('socket hang up') ||
        error.message.includes('Proxy connection');

      if (isRetryableError && retries < maxRetries) {
        retries++;
        continue;
      }

      // 其他错误直接抛出
      break;
    }
  }

  // 所有重试都失败了，抛出最后一个错误
  if (lastError) {
    logger.error(`请求失败，已重试 ${retries} 次: ${lastError.message}`);
    if (lastError.response) {
      logger.error(`响应状态: ${lastError.response.status}`);
      logger.error(`响应数据: ${JSON.stringify(lastError.response.data)}`);
    }
    throw lastError;
  } else {
    // 这种情况理论上不应该发生，但为了安全起见
    const error = new Error(`请求失败，已重试 ${retries} 次，但没有具体错误信息`);
    logger.error(error.message);
    throw error;
  }
 }

/**
 * 检测上传图片内容合规性（仅国内站）
 * 调用 algo_proxy 接口进行图片安全检测，不通过则抛出异常
 *
 * @param imageUri 已上传图片的 URI
 * @param refreshToken 刷新令牌
 * @param regionInfo 区域信息
 */
export async function checkImageContent(
  imageUri: string,
  refreshToken: string,
  regionInfo: RegionInfo
): Promise<void> {
  // 仅国内站需要内容检测
  if (regionInfo.isInternational) return;

  const babiParam = JSON.stringify({
    scenario: "image_video_generation",
    feature_key: "aigc_to_image",
    feature_entrance: "to-generate",
    feature_entrance_detail: "to-generate-algo_proxy",
  });

  logger.info(`开始图片内容安全检测: ${imageUri}`);

  try {
    await request("post", "/mweb/v1/algo_proxy", refreshToken, {
      params: {
        babi_param: babiParam,
      },
      data: {
        scene: "image_face_ip",
        options: { ip_check: true },
        req_key: "benchmark_test_user_upload_image_input",
        file_list: [{ file_uri: imageUri }],
        req_params: {},
      },
    });
    logger.info(`图片内容安全检测通过: ${imageUri}`);
  } catch (error: any) {
    // 区分内容违规(ret=2003等) vs 网络/服务异常
    const isContentViolation = error.message && (
      error.message.includes('2003') ||
      error.message.includes('risk not pass') ||
      error.message.includes('detected risk')
    );
    if (isContentViolation) {
      logger.error(`图片内容安全检测未通过: ${imageUri}, ${error.message}`);
      throw new APIException(
        EX.API_REQUEST_FAILED,
        `图片内容检测未通过，该图片可能包含违规内容`
      );
    }
    // 网络/服务异常不阻塞，仅记录警告
    logger.warn(`图片内容安全检测服务异常(不阻塞): ${imageUri}, ${error.message}`);
  }
}

 /**
  * 预检查文件URL有效性
  *
  * @param fileUrl 文件URL
  */
 export async function checkFileUrl(fileUrl: string) {
  if (util.isBASE64Data(fileUrl)) return;
  const result = await axios.head(fileUrl, {
    timeout: 15000,
    validateStatus: () => true,
  });
  if (result.status >= 400)
    throw new APIException(
      EX.API_FILE_URL_INVALID,
      `File ${fileUrl} is not valid: [${result.status}] ${result.statusText}`
    );
  // 检查文件大小
  if (result.headers && result.headers["content-length"]) {
    const fileSize = parseInt(result.headers["content-length"], 10);
    if (fileSize > FILE_MAX_SIZE)
      throw new APIException(
        EX.API_FILE_EXECEEDS_SIZE,
        `File ${fileUrl} is not valid`
      );
  }
}

/**
 * 上传文件
 *
 * @param refreshToken 用于刷新access_token的refresh_token
 * @param fileUrl 文件URL或BASE64数据
 * @param isVideoImage 是否是用于视频图像
 * @returns 上传结果，包含image_uri
 */
export async function uploadFile(
  refreshToken: string,
  fileUrl: string,
  isVideoImage: boolean = false
) {
  try {
    logger.info(`开始上传文件: ${fileUrl}, 视频图像模式: ${isVideoImage}`);

    // 预检查远程文件URL可用性
    await checkFileUrl(fileUrl);

    let filename, fileData, mimeType;
    // 如果是BASE64数据则直接转换为Buffer
    if (util.isBASE64Data(fileUrl)) {
      mimeType = util.extractBASE64DataFormat(fileUrl);
      const ext = mime.getExtension(mimeType);
      filename = `${util.uuid()}.${ext}`;
      fileData = Buffer.from(util.removeBASE64DataHeader(fileUrl), "base64");
      logger.info(`处理BASE64数据，文件名: ${filename}, 类型: ${mimeType}, 大小: ${fileData.length}字节`);
    }
    // 下载文件到内存，如果您的服务器内存很小，建议考虑改造为流直传到下一个接口上，避免停留占用内存
    else {
      filename = path.basename(fileUrl);
      logger.info(`开始下载远程文件: ${fileUrl}`);
      ({ data: fileData } = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        // 100M限制
        maxContentLength: FILE_MAX_SIZE,
        // 60秒超时
        timeout: 60000,
      }));
      logger.info(`文件下载完成，文件名: ${filename}, 大小: ${fileData.length}字节`);
    }

    // 获取文件的MIME类型
    mimeType = mimeType || mime.getType(filename);
    logger.info(`文件MIME类型: ${mimeType}`);

    // 构建FormData
    const formData = new FormData();
    const blob = new Blob([fileData], { type: mimeType });
    formData.append('file', blob, filename);

    // 获取上传凭证
    logger.info(`请求上传凭证，场景: ${isVideoImage ? 'video_cover' : 'aigc_image'}`);
    const uploadProofUrl = 'https://imagex.bytedanceapi.com/';
    const proofResult = await request(
      'POST',
      '/mweb/v1/get_upload_image_proof',
      refreshToken,
      {
        data: {
          scene: isVideoImage ? 'video_cover' : 'aigc_image',
          file_name: filename,
          file_size: fileData.length,
        }
      }
    );

    if (!proofResult || !proofResult.proof_info) {
      logger.error(`获取上传凭证失败: ${JSON.stringify(proofResult)}`);
      throw new APIException(EX.API_REQUEST_FAILED, '获取上传凭证失败');
    }

    logger.info(`获取上传凭证成功`);

    // 上传文件
    const { proof_info } = proofResult;
    logger.info(`开始上传文件到: ${uploadProofUrl}`);

    const uploadResult = await axios.post(
      uploadProofUrl,
      formData,
      {
        headers: {
          ...proof_info.headers,
          'Content-Type': 'multipart/form-data',
        },
        params: proof_info.query_params,
        timeout: 60000,
        validateStatus: () => true, // 允许任何状态码以便详细处理
      }
    );

    logger.info(`上传响应状态: ${uploadResult.status}`);

    if (!uploadResult || uploadResult.status !== 200) {
      logger.error(`上传文件失败: 状态码 ${uploadResult?.status}, 响应: ${JSON.stringify(uploadResult?.data)}`);
      throw new APIException(EX.API_REQUEST_FAILED, `上传文件失败: 状态码 ${uploadResult?.status}`);
    }

    // 验证 proof_info.image_uri 是否存在
    if (!proof_info.image_uri) {
      logger.error(`上传凭证中缺少 image_uri: ${JSON.stringify(proof_info)}`);
      throw new APIException(EX.API_REQUEST_FAILED, '上传凭证中缺少 image_uri');
    }

    logger.info(`文件上传成功: ${proof_info.image_uri}`);

    // 返回上传结果
    return {
      image_uri: proof_info.image_uri,
      uri: proof_info.image_uri,
    }
  } catch (error) {
    logger.error(`文件上传过程中发生错误: ${error.message}`);
    throw error;
  }
}

/**
 * 检查请求结果
 *
 * @param result 结果
 */
export function checkResult(result: AxiosResponse) {
  const { ret, errmsg, data } = result.data;
  if (!_.isFinite(Number(ret))) return result.data;
  if (ret === '0') return data;

  // 使用统一错误处理器
  JimengErrorHandler.handleApiResponse(result.data as JimengErrorResponse, {
    context: '即梦API请求',
    operation: '请求'
  });
}

/**
 * Token切分
 *
 * @param authorization 认证字符串
 */
export function tokenSplit(authorization: string) {
  return authorization.replace("Bearer ", "").split(",");
}

/**
 * 获取Token存活状态
 */
export async function getTokenLiveStatus(refreshToken: string) {
  try {
    const result = await request(
      "POST",
      "/passport/account/info/v2",
      refreshToken,
      {
        params: {
          account_sdk_source: "web",
        },
      }
    );
    // request 内部已调用 checkResult，直接使用返回值
    return !!result?.user_id;
  } catch (err) {
    return false;
  }
}
