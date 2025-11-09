import { RegionInfo } from "@/api/controllers/core.ts";
import { BASE_URL_DREAMINA_US, BASE_URL_DREAMINA_HK, BASE_URL_IMAGEX_US, BASE_URL_IMAGEX_HK } from "@/api/consts/dreamina.ts";

/**
 * 区域配置工具类
 * 统一管理不同区域的配置信息
 */
export class RegionUtils {
  /**
   * 获取ServiceId
   */
  static getServiceId(regionInfo: RegionInfo, providedServiceId?: string): string {
    if (providedServiceId) {
      return providedServiceId;
    }

    // US/HK/JP/SG 使用相同的 service_id
    if (regionInfo.isUS || regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
      return "wopfjsm1ax";
    }

    // CN 使用默认的 service_id
    return "tb4s082cfz";
  }

  /**
   * 获取ImageX URL
   */
  static getImageXUrl(regionInfo: RegionInfo): string {
    if (regionInfo.isUS) {
      return BASE_URL_IMAGEX_US;
    }

    if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
      return BASE_URL_IMAGEX_HK;
    }

    return 'https://imagex.bytedanceapi.com';
  }

  /**
   * 获取Origin
   */
  static getOrigin(regionInfo: RegionInfo): string {
    if (regionInfo.isUS) {
      return new URL(BASE_URL_DREAMINA_US).origin;
    }

    if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
      return new URL(BASE_URL_DREAMINA_HK).origin;
    }

    return 'https://jimeng.jianying.com';
  }

  /**
   * 获取AWS区域
   */
  static getAWSRegion(regionInfo: RegionInfo): string {
    if (regionInfo.isUS) {
      return 'us-east-1';
    }

    if (regionInfo.isHK || regionInfo.isJP || regionInfo.isSG) {
      return 'ap-southeast-1';
    }

    return 'cn-north-1';
  }

  /**
   * 获取Referer路径
   */
  static getRefererPath(regionInfo: RegionInfo, path: string = '/ai-tool/generate'): string {
    const origin = this.getOrigin(regionInfo);
    return `${origin}${path}`;
  }
}
