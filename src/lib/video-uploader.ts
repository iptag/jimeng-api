import crypto from "crypto";
import axios from "axios";
import { RegionInfo, request } from "@/api/controllers/core.ts";
import { RegionUtils } from "@/lib/region-utils.ts";
import { createSignature } from "@/lib/aws-signature.ts";
import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";

/**
 * 视频上传模块
 * 通过 VOD (vod.bytedanceapi.com) 上传视频文件，获取 Vid
 */

export interface VideoUploadResult {
  vid: string;
  uri: string;
  videoMeta: {
    width: number;
    height: number;
    duration: number;
    bitrate: number;
    format: string;
    codec: string;
    size: number;
    md5: string;
  };
}

/**
 * 上传视频Buffer到VOD
 * @param videoBuffer 视频二进制数据
 * @param refreshToken 刷新令牌
 * @param regionInfo 区域信息
 * @returns 上传结果，包含 vid 和视频元信息
 */
export async function uploadVideoBuffer(
  videoBuffer: ArrayBuffer | Buffer,
  refreshToken: string,
  regionInfo: RegionInfo
): Promise<VideoUploadResult> {
  try {
    const fileSize = videoBuffer.byteLength;
    logger.info(`开始上传视频Buffer... (size=${fileSize}, isInternational=${regionInfo.isInternational})`);

    // 第一步：获取上传令牌
    const tokenResult = await request("post", "/mweb/v1/get_upload_token", refreshToken, {
      data: {
        scene: 1, // VOD 视频上传场景
      },
    });

    const { access_key_id, secret_access_key, session_token, space_name } = tokenResult;

    if (!access_key_id || !secret_access_key || !session_token) {
      throw new Error("获取视频上传令牌失败");
    }

    const spaceName = space_name || "dreamina";
    logger.info(`获取视频上传令牌成功: spaceName=${spaceName}`);

    // 第二步：申请视频上传权限 (ApplyUploadInner)
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const randomStr = Math.random().toString(36).substring(2, 12);

    const vodHost = "https://vod.bytedanceapi.com";
    const applyUrl = `${vodHost}/?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=${spaceName}&FileType=video&IsInner=1&FileSize=${fileSize}&s=${randomStr}`;

    const awsRegion = RegionUtils.getAWSRegion(regionInfo);
    const origin = RegionUtils.getOrigin(regionInfo);

    const requestHeaders = {
      'x-amz-date': timestamp,
      'x-amz-security-token': session_token,
    };

    const authorization = createSignature(
      'GET', applyUrl, requestHeaders,
      access_key_id, secret_access_key, session_token,
      '', awsRegion, 'vod'
    );

    logger.info(`申请视频上传权限: ${applyUrl}`);

    let applyResponse;
    try {
      applyResponse = await axios({
        method: 'GET',
        url: applyUrl,
        headers: {
          'accept': '*/*',
          'accept-language': 'zh-CN,zh;q=0.9',
          'authorization': authorization,
          'origin': origin,
          'referer': RegionUtils.getRefererPath(regionInfo),
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
        validateStatus: () => true,
      });
    } catch (fetchError: any) {
      logger.error(`ApplyUploadInner请求失败: ${fetchError.message}`);
      throw new Error(`视频上传申请网络请求失败 (${vodHost}): ${fetchError.message}`);
    }

    if (applyResponse.status < 200 || applyResponse.status >= 300) {
      const errorText = typeof applyResponse.data === 'string' ? applyResponse.data : JSON.stringify(applyResponse.data);
      throw new Error(`申请视频上传权限失败: ${applyResponse.status} - ${errorText}`);
    }

    const applyResult = applyResponse.data;

    if (applyResult?.ResponseMetadata?.Error) {
      throw new Error(`申请视频上传权限失败: ${JSON.stringify(applyResult.ResponseMetadata.Error)}`);
    }

    // 解析上传节点（优先使用 Edge 节点）
    const uploadNodes = applyResult?.Result?.InnerUploadAddress?.UploadNodes;
    if (!uploadNodes || uploadNodes.length === 0) {
      throw new Error(`获取视频上传节点失败: ${JSON.stringify(applyResult)}`);
    }

    const uploadNode = uploadNodes[0];
    const storeInfo = uploadNode.StoreInfos?.[0];
    if (!storeInfo) {
      throw new Error(`获取视频上传存储信息失败: ${JSON.stringify(uploadNode)}`);
    }

    const uploadHost = uploadNode.UploadHost;
    const storeUri = storeInfo.StoreUri;
    const auth = storeInfo.Auth;
    const sessionKey = uploadNode.SessionKey;
    const vid = uploadNode.Vid;

    logger.info(`获取视频上传节点成功: host=${uploadHost}, vid=${vid}, type=${uploadNode.Type}`);

    // 第三步：上传视频二进制数据
    const uploadUrl = `https://${uploadHost}/upload/v1/${storeUri}`;
    const crc32 = util.calculateCRC32(videoBuffer);
    logger.info(`开始上传视频文件: ${uploadUrl}, CRC32=${crc32}`);

    let uploadResponse;
    try {
      uploadResponse = await axios({
        method: 'POST',
        url: uploadUrl,
        headers: {
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Authorization': auth,
          'Connection': 'keep-alive',
          'Content-CRC32': crc32,
          'Content-Type': 'application/octet-stream',
          'Origin': origin,
          'Referer': RegionUtils.getRefererPath(regionInfo),
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'cross-site',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
        },
        data: videoBuffer,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        validateStatus: () => true,
      });
    } catch (fetchError: any) {
      logger.error(`视频文件上传请求失败: ${fetchError.message}`);
      throw new Error(`视频文件上传网络请求失败 (${uploadHost}): ${fetchError.message}`);
    }

    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      const errorText = typeof uploadResponse.data === 'string' ? uploadResponse.data : JSON.stringify(uploadResponse.data);
      throw new Error(`视频文件上传失败: ${uploadResponse.status} - ${errorText}`);
    }

    const uploadData = uploadResponse.data;
    if (uploadData?.code !== 2000) {
      throw new Error(`视频文件上传失败: code=${uploadData?.code}, message=${uploadData?.message}`);
    }

    logger.info(`视频文件上传成功: crc32=${uploadData.data?.crc32}`);

    // 第四步：提交上传确认 (CommitUploadInner)
    const commitUrl = `${vodHost}/?Action=CommitUploadInner&Version=2020-11-19&SpaceName=${spaceName}`;
    const commitTimestamp = new Date().toISOString().replace(/[:\-]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const commitPayload = JSON.stringify({
      SessionKey: sessionKey,
      Functions: [],
    });

    const payloadHash = crypto.createHash('sha256').update(commitPayload, 'utf8').digest('hex');

    const commitRequestHeaders = {
      'x-amz-date': commitTimestamp,
      'x-amz-security-token': session_token,
      'x-amz-content-sha256': payloadHash,
    };

    const commitAuthorization = createSignature(
      'POST', commitUrl, commitRequestHeaders,
      access_key_id, secret_access_key, session_token,
      commitPayload, awsRegion, 'vod'
    );

    logger.info(`提交视频上传确认: ${commitUrl}`);

    let commitResponse;
    try {
      commitResponse = await axios({
        method: 'POST',
        url: commitUrl,
        headers: {
          'accept': '*/*',
          'accept-language': 'zh-CN,zh;q=0.9',
          'authorization': commitAuthorization,
          'content-type': 'application/json',
          'origin': origin,
          'referer': RegionUtils.getRefererPath(regionInfo),
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
        data: commitPayload,
        validateStatus: () => true,
      });
    } catch (fetchError: any) {
      logger.error(`CommitUploadInner请求失败: ${fetchError.message}`);
      throw new Error(`提交视频上传网络请求失败 (${vodHost}): ${fetchError.message}`);
    }

    if (commitResponse.status < 200 || commitResponse.status >= 300) {
      const errorText = typeof commitResponse.data === 'string' ? commitResponse.data : JSON.stringify(commitResponse.data);
      throw new Error(`提交视频上传失败: ${commitResponse.status} - ${errorText}`);
    }

    const commitResult = commitResponse.data;

    if (commitResult?.ResponseMetadata?.Error) {
      throw new Error(`提交视频上传失败: ${JSON.stringify(commitResult.ResponseMetadata.Error)}`);
    }

    if (!commitResult?.Result?.Results || commitResult.Result.Results.length === 0) {
      throw new Error(`提交视频上传响应缺少结果: ${JSON.stringify(commitResult)}`);
    }

    const result = commitResult.Result.Results[0];
    const videoMeta = result.VideoMeta;

    if (!result.Vid) {
      throw new Error(`提交视频上传响应缺少 Vid: ${JSON.stringify(result)}`);
    }

    // 校验视频时长，即梦限制不超过15秒
    const MAX_VIDEO_DURATION = 15;
    if (videoMeta?.Duration && videoMeta.Duration > MAX_VIDEO_DURATION) {
      throw new Error(`视频时长 ${videoMeta.Duration.toFixed(2)}s 超过限制 (最大 ${MAX_VIDEO_DURATION}s)`);
    }

    logger.info(`视频上传完成: vid=${result.Vid}, ${videoMeta?.Width}x${videoMeta?.Height}, ${videoMeta?.Duration}s, ${videoMeta?.Format}/${videoMeta?.Codec}`);

    return {
      vid: result.Vid,
      uri: videoMeta?.Uri || '',
      videoMeta: {
        width: videoMeta?.Width || 0,
        height: videoMeta?.Height || 0,
        duration: videoMeta?.Duration || 0,
        bitrate: videoMeta?.Bitrate || 0,
        format: videoMeta?.Format || '',
        codec: videoMeta?.Codec || '',
        size: videoMeta?.Size || 0,
        md5: videoMeta?.Md5 || '',
      },
    };
  } catch (error: any) {
    logger.error(`视频Buffer上传失败: ${error.message}`);
    throw error;
  }
}

/**
 * 从URL下载并上传视频
 * @param videoUrl 视频URL
 * @param refreshToken 刷新令牌
 * @param regionInfo 区域信息
 * @returns 上传结果
 */
export async function uploadVideoFromUrl(
  videoUrl: string,
  refreshToken: string,
  regionInfo: RegionInfo
): Promise<VideoUploadResult> {
  try {
    logger.info(`开始从URL下载并上传视频: ${videoUrl}`);

    const videoResponse = await axios.get(videoUrl, {
      responseType: 'arraybuffer',
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    if (videoResponse.status < 200 || videoResponse.status >= 300) {
      throw new Error(`下载视频失败: ${videoResponse.status}`);
    }

    const videoBuffer = videoResponse.data;
    logger.info(`视频下载完成: ${videoBuffer.byteLength} 字节`);
    return await uploadVideoBuffer(videoBuffer, refreshToken, regionInfo);
  } catch (error: any) {
    logger.error(`从URL上传视频失败: ${error.message}`);
    throw error;
  }
}
