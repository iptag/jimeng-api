import logger from "@/lib/logger.ts";

/**
 * 图片URL提取工具
 * 统一从不同格式的响应中提取图片URL
 */

/**
 * 从API响应项中提取图片URL
 * @param item API响应中的单个项目
 * @param index 项目索引（用于日志）
 * @returns 图片URL或null
 */
export function extractImageUrl(item: any, index?: number): string | null {
  const logPrefix = index !== undefined ? `图片 ${index + 1}` : '图片';

  let imageUrl: string | null = null;

  // 优先尝试 large_images
  if (item?.image?.large_images?.[0]?.image_url) {
    imageUrl = item.image.large_images[0].image_url;
    logger.debug(`${logPrefix}: 使用 large_images URL`);
  }
  // 其次尝试 cover_url
  else if (item?.common_attr?.cover_url) {
    imageUrl = item.common_attr.cover_url;
    logger.debug(`${logPrefix}: 使用 cover_url`);
  }
  // 再尝试 image_url
  else if (item?.image_url) {
    imageUrl = item.image_url;
    logger.debug(`${logPrefix}: 使用 image_url`);
  }
  // 最后尝试 url
  else if (item?.url) {
    imageUrl = item.url;
    logger.debug(`${logPrefix}: 使用 url`);
  }
  // 无法提取URL
  else {
    logger.warn(`${logPrefix}: 无法提取URL，item结构: ${JSON.stringify(item, null, 2)}`);
  }

  return imageUrl;
}

/**
 * 从项目列表中批量提取图片URLs
 * @param itemList 项目列表
 * @returns 图片URL数组
 */
export function extractImageUrls(itemList: any[]): string[] {
  return itemList
    .map((item, index) => extractImageUrl(item, index))
    .filter((url): url is string => url !== null);
}

/**
 * 从视频响应项中提取视频URL
 * @param item 视频响应项
 * @returns 视频URL或null
 */
export function extractVideoUrl(item: any): string | null {
  // 优先尝试 transcoded_video.origin.video_url
  if (item?.video?.transcoded_video?.origin?.video_url) {
    return item.video.transcoded_video.origin.video_url;
  }
  // 尝试 play_url
  if (item?.video?.play_url) {
    return item.video.play_url;
  }
  // 尝试 download_url
  if (item?.video?.download_url) {
    return item.video.download_url;
  }
  // 尝试 url
  if (item?.video?.url) {
    return item.video.url;
  }

  return null;
}
