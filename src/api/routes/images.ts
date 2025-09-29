import _ from "lodash";

import Request from "@/lib/request/Request.ts";
import { generateImages, generateImageComposition } from "@/api/controllers/images.ts";
import { tokenSplit } from "@/api/controllers/core.ts";
import { SIZE_MAP,ASPECT_RATIOS } from "@/api/consts/common.ts";
import util from "@/lib/util.ts";

// 解析ratio参数为width和height（仅支持官网标准比例）
function parseRatio(ratio?: string): { width: number; height: number } {
  if (!ratio) {
    return { width: 2048, height: 2048 }; // 默认1:1
  }

  // 只从ASPECT_RATIOS中查找匹配的标准比例
  const ratioConfig = ASPECT_RATIOS[ratio];
  if (ratioConfig) {
    return {
      width: ratioConfig.width,
      height: ratioConfig.height
    };
  }

  // 如果不是标准比例，抛出错误
  const supportedRatios = Object.keys(ASPECT_RATIOS).join(', ');
  throw new Error(`不支持的比例 "${ratio}"。支持的比例: ${supportedRatios}`);
}

// 解析size参数为width和height
function parseSize(size?: string): { width: number; height: number } {
  if (!size) {
    return { width: 2048, height: 2048 }; // 默认1:1
  }

  const sizeConfig = SIZE_MAP[size];
  if (sizeConfig) {
    return sizeConfig;
  }

  // 尝试解析 "widthxheight" 格式
  const match = size.match(/^(\d+)x(\d+)$/);
  if (match) {
    return {
      width: parseInt(match[1]),
      height: parseInt(match[2])
    };
  }

  // 默认返回正方形
  return { width: 2048, height: 2048 };
}

export default {
  prefix: "/v1/images",

  post: {
    "/generations": async (request: Request) => {
      request
        .validate("body.model", v => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.negative_prompt", v => _.isUndefined(v) || _.isString(v))
        .validate("body.width", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.height", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.size", v => _.isUndefined(v) || _.isString(v))
        .validate("body.ratio", v => _.isUndefined(v) || _.isString(v))
        .validate("body.sample_strength", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
        .validate("headers.authorization", _.isString);
      // refresh_token切分
      const tokens = tokenSplit(request.headers.authorization);
      // 随机挑选一个refresh_token
      const token = _.sample(tokens);
      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        width: requestWidth,
        height: requestHeight,
        size,
        ratio,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;

      // 解析尺寸：优先级 ratio > size > width/height
      let width: number, height: number;
      if (ratio) {
        const ratioConfig = parseRatio(ratio);
        width = ratioConfig.width;
        height = ratioConfig.height;
      } else if (size) {
        const sizeConfig = parseSize(size);
        width = sizeConfig.width;
        height = sizeConfig.height;
      } else {
        width = requestWidth || 2048;
        height = requestHeight || 2048;
      }
      const responseFormat = _.defaultTo(response_format, "url");
      const imageUrls = await generateImages(model, prompt, {
        width,
        height,
        sampleStrength,
        negativePrompt,
      }, token);
      let data = [];
      if (responseFormat == "b64_json") {
        data = (
          await Promise.all(imageUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }));
      } else {
        data = imageUrls.map((url) => ({
          url,
        }));
      }
      return {
        created: util.unixTimestamp(),
        data,
      };
    },
    
    // 新增图片合成路由
    "/compositions": async (request: Request) => {
      request
        .validate("body.model", v => _.isUndefined(v) || _.isString(v))
        .validate("body.prompt", _.isString)
        .validate("body.images", _.isArray)
        .validate("body.negative_prompt", v => _.isUndefined(v) || _.isString(v))
        .validate("body.width", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.height", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.ratio", v => _.isUndefined(v) || _.isString(v))
        .validate("body.sample_strength", v => _.isUndefined(v) || _.isFinite(v))
        .validate("body.response_format", v => _.isUndefined(v) || _.isString(v))
        .validate("headers.authorization", _.isString);

      // 验证图片数组
      const { images } = request.body;
      if (!images || images.length === 0) {
        throw new Error("至少需要提供1张输入图片");
      }
      if (images.length > 10) {
        throw new Error("最多支持10张输入图片");
      }

      // 验证每个图片元素
      images.forEach((image, index) => {
        if (!_.isString(image) && !_.isObject(image)) {
          throw new Error(`图片 ${index + 1} 格式不正确：应为URL字符串或包含url字段的对象`);
        }
        if (_.isObject(image) && !image.url) {
          throw new Error(`图片 ${index + 1} 缺少url字段`);
        }
      });

      // refresh_token切分
      const tokens = tokenSplit(request.headers.authorization);
      // 随机挑选一个refresh_token
      const token = _.sample(tokens);
      
      const {
        model,
        prompt,
        negative_prompt: negativePrompt,
        width: requestWidth,
        height: requestHeight,
        ratio,
        sample_strength: sampleStrength,
        response_format,
      } = request.body;

      // 解析尺寸：优先使用ratio参数，其次使用width/height
      let width: number, height: number;
      if (ratio) {
        const ratioConfig = parseRatio(ratio);
        width = ratioConfig.width;
        height = ratioConfig.height;
      } else {
        width = requestWidth || 2560;
        height = requestHeight || 1440;
      }

      // 提取图片URL
      const imageUrls = images.map(img => _.isString(img) ? img : img.url);

      const responseFormat = _.defaultTo(response_format, "url");
      const resultUrls = await generateImageComposition(model, prompt, imageUrls, {
        width,
        height,
        sampleStrength,
        negativePrompt,
      }, token);

      let data = [];
      if (responseFormat == "b64_json") {
        data = (
          await Promise.all(resultUrls.map((url) => util.fetchFileBASE64(url)))
        ).map((b64) => ({ b64_json: b64 }));
      } else {
        data = resultUrls.map((url) => ({
          url,
        }));
      }

      return {
        created: util.unixTimestamp(),
        data,
        input_images: imageUrls.length,
        composition_type: "multi_image_synthesis",
      };
    },
  },
};
